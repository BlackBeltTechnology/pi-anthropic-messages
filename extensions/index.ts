// ---------------------------------------------------------------------------
// @blackbelt-technology/pi-anthropic-messages — pi extension entry point.
//
// Intercepts LLM requests/responses for Claude-model sessions whose protocol
// is `anthropic-messages` (direct Anthropic OAuth/API key with a Claude
// model, 9Router cc/claude-*, pi-model-proxy → Claude, any proxy speaking
// the Messages API to a Claude backend).
//
// SINGLE GATE
// -----------
// The bridge activates only when BOTH of these hold for the active session:
//   1. ctx.model.api === "anthropic-messages"
//   2. /claude/i.test(ctx.model.id ?? "")
//
// When the gate fails (non-Claude anthropic-messages, e.g.
// 9Router/glm/glm-5 or 9Router/gemini/gemini-3-pro-preview; or any
// non-anthropic-messages api), every hook handler returns without modifying
// any payload, message, system prompt, or internal state. This keeps the
// bridge a true no-op for non-Claude provider paths.
//
// Escape hatches (env vars):
//   PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL=1
//     Forces the gate open for any anthropic-messages session regardless of
//     model id. Useful for Claude models with unusual ids.
//   PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL=1
//     Forces the gate closed even for Claude-matching sessions. Useful for
//     false positives (e.g. a non-Claude model whose id contains "claude").
//
// WHAT THE BRIDGE DOES WHEN GATED
// --------------------------------
// Outbound (before_provider_request):
//   - Tools in payload.tools[]: renamed via resolveOutboundName. Canonical
//     names pass through; custom pi tools get mcp__pi__ prefixed; lowercase
//     pi core tools (read/write/bash/grep) get canonical capitalization.
//   - payload.tool_choice.name rewritten accordingly.
//   - Historical tool_use / tool_result blocks in
//     payload.messages[*].content[*] get the same name rewrites so retries
//     and context replay stay consistent.
//   - System prompt text rewritten ("pi" → "the cli") to avoid Claude
//     Code identity checks seeing the word "pi".
//
// Inbound (message_end):
//   - Each toolCall block's name is translated back to the original pi
//     name via the reverse map, with defensive `_ide` suffix stripping
//     for names mangled by the Claude Code endpoint.
//
// NO-COLLISION WITH pi-ai
// -----------------------
// pi-ai's anthropic provider already canonicalizes tool names when it
// detects an OAuth token. For OAuth sessions, pi-ai rewrites `read` → `Read`
// in the payload before our bridge sees it. Our bridge's exact-match check
// against CC_CANONICAL_NAMES finds `Read`, passes it through unchanged —
// zero double-rename. For non-OAuth Claude anthropic-messages sessions
// (9Router sk-key, pi-model-proxy, etc.), pi-ai does nothing; our bridge
// picks up `read` via PI_TO_CC_CANONICAL and rewrites it. No duplication,
// no conflict.
//
// Debug logging
// -------------
// Set PI_ANTHROPIC_MESSAGES_DEBUG_LOG=/path/to/file to dump each
// before/after payload and inbound rename for inspection. Errors in the
// logger never break requests. Non-gated sessions emit no outbound/inbound
// entries; only the once-per-process load marker appears.
// ---------------------------------------------------------------------------

import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	CC_CANONICAL_NAMES,
	DEFAULT_MCP_PREFIX,
	FLAT_TO_MCP,
	NATIVE_ALIASES,
	PI_TO_CC_CANONICAL,
	resolveOutboundName,
} from "./core-tools.js";
import {
	buildReverseMap,
	lookupReverse,
	renameToolCallsInPlace,
} from "./inbound.js";
import { transformPayload } from "./transform.js";

// TEMP DIAGNOSIS: until the package has been confirmed working end-to-end,
// always write to /tmp/pi-am.log so we can tell from the filesystem whether
// the extension loaded and whether its hooks fired. Remove this fallback
// once the package is trusted; diagnostic-only logging should go through
// PI_ANTHROPIC_MESSAGES_DEBUG_LOG.
const debugLogPath =
	process.env.PI_ANTHROPIC_MESSAGES_DEBUG_LOG ?? "/tmp/pi-am.log";

function writeDebugLog(entry: unknown): void {
	if (!debugLogPath) return;
	try {
		appendFileSync(
			debugLogPath,
			`${new Date().toISOString()}\n${JSON.stringify(entry, null, 2)}\n---\n`,
			"utf-8",
		);
	} catch {
		/* never throw from logging */
	}
}

// Load marker — written exactly once per pi process import. Seeing an
// ISO timestamp followed by "stage: load" in /tmp/pi-am.log is proof that
// the extension was resolved, imported, and evaluated by pi's loader.
writeDebugLog({ stage: "load", pid: process.pid, cwd: process.cwd() });

/**
 * The single gate. Returns true iff the bridge should run for this session.
 *
 * The gate opens for any `anthropic-messages` API session regardless of
 * model id. This covers Anthropic OAuth, API-key, AND proxy providers
 * (9Router, custom OpenAI-compatible bases, etc.) that route to Anthropic
 * but report non-Claude model ids — those used to fall through the
 * historical `/claude/i` check and silently break tool dispatch.
 *
 * Escape-hatch env overrides take precedence:
 *   - DISABLE_CANONICAL=1 closes the gate unconditionally.
 *   - FORCE_CANONICAL=1 opens the gate even for non-anthropic-messages APIs
 *     (useful for misreported model metadata in proxies).
 *
 * See change: fix-pi-flows-end-to-end (Group 4).
 */
export function isAnthropicMessagesGated(
	ctx: { model?: { api?: string; id?: string } | undefined } | undefined,
): boolean {
	if (process.env.PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL === "1") return false;
	if (process.env.PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL === "1") return true;
	return ctx?.model?.api === "anthropic-messages";
}

/**
 * @deprecated Use `isAnthropicMessagesGated` — the gate no longer requires
 * the model id to contain "claude". Kept as alias for one minor release so
 * downstream consumers (notably the dashboard's flows-anthropic-bridge
 * plugin) don't break before they migrate.
 */
export const isClaudeAnthropicMessages = isAnthropicMessagesGated;

export default async function piAnthropicMessages(pi: ExtensionAPI): Promise<void> {
	writeDebugLog({ stage: "activate", pid: process.pid });

	// Cached reverse map. Rebuilt lazily from pi.getAllTools() when needed.
	// Only exists for gated sessions; cleared on session boundaries and
	// whenever an outbound rewrite adds a new mapping.
	let reverseMap: Map<string, string> | undefined;
	let reverseMapStamp = 0;

	function getReverseMap(): Map<string, string> {
		// Crude TTL: invalidate every second in case extensions register tools
		// lazily. Rebuilding is O(tools) and runs at most once per assistant
		// message.
		const now = Date.now();
		if (!reverseMap || now - reverseMapStamp > 1000) {
			const names = pi.getAllTools().map((t) => t.name);
			reverseMap = buildReverseMap(names);
			reverseMapStamp = now;
		}
		return reverseMap;
	}

	function invalidateReverseMap(): void {
		reverseMap = undefined;
	}

	// Session boundaries can change the model / provider combination.
	pi.on("session_start", () => {
		invalidateReverseMap();
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		invalidateReverseMap();
		// No payload here; pre-build only if the gate is open so the first
		// inbound translation is hot. For non-gated sessions we skip the
		// rebuild entirely.
		if (isAnthropicMessagesGated(ctx)) {
			void getReverseMap();
		}
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!isAnthropicMessagesGated(ctx)) return undefined;
		const raw = event.payload;
		writeDebugLog({
			stage: "outbound:before",
			model: ctx.model?.id,
			payload: raw,
		});
		const { payload, nameMap } = transformPayload(raw, resolveOutboundName);
		writeDebugLog({
			stage: "outbound:after",
			model: ctx.model?.id,
			renames: Array.from(nameMap.entries()),
			payload,
		});
		// If the outbound rename added mappings, invalidate the reverse cache
		// so the next getReverseMap() picks them up.
		if (nameMap.size > 0) invalidateReverseMap();
		return payload;
	});

	pi.on("message_end", (event, ctx) => {
		if (!isAnthropicMessagesGated(ctx)) return;
		const msg = (event as unknown as { message?: { content?: unknown } }).message;
		if (!msg) return;
		const changed = renameToolCallsInPlace(msg, getReverseMap());
		if (changed) {
			writeDebugLog({
				stage: "inbound:renamed",
				model: ctx.model?.id,
				message: msg,
			});
		}
	});
}

// Public API — consumers (tests, dashboard, pi-flows) can import these
// authoritative lists without duplicating them.
export {
	CC_CANONICAL_NAMES,
	PI_TO_CC_CANONICAL,
	NATIVE_ALIASES,
	FLAT_TO_MCP,
	DEFAULT_MCP_PREFIX,
	resolveOutboundName,
	transformPayload,
	buildReverseMap,
	lookupReverse,
	renameToolCallsInPlace,
};

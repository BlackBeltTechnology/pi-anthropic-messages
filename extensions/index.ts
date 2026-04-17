// ---------------------------------------------------------------------------
// @pi/anthropic-messages — pi extension entry point.
//
// Intercepts LLM requests/responses for models whose protocol is
// `anthropic-messages` (direct Anthropic, 9Router, pi-model-proxy, any proxy
// speaking the Messages API). Applies a payload transform on the way out
// and an inverse name translation on the way in, so custom pi tools survive
// end-to-end without being filtered or colliding with Claude Code's
// canonical tool set.
//
// Activation
//   * Guard is purely protocol-based: `model.api === "anthropic-messages"`.
//     Covers direct Anthropic (OAuth or API key), 9Router, pi-model-proxy,
//     etc. without hardcoding provider names.
//
// Outbound (before_provider_request)
//   * For every tool in `payload.tools[]` that isn't a core Claude Code
//     tool, isn't already `mcp__`-prefixed, isn't aliased to an Anthropic
//     native tool via NATIVE_ALIASES, and isn't a known companion in
//     FLAT_TO_MCP → rename to `mcp__<original>`.
//   * Rewrite `payload.tool_choice.name` if it references a renamed tool.
//   * Rewrite `name` on historical `tool_use` blocks in
//     `payload.messages[...].content[]` so message history stays consistent.
//   * Light system-prompt text rewrites (pi → "the cli") to avoid the word
//     "pi" in upstream identity fingerprints.
//
// Inbound (message_end)
//   * For each `toolCall` block in the assistant message, translate
//     outbound names back to the original pi tool name so the agent-loop's
//     `tools.find(t => t.name === toolCall.name)` dispatch succeeds.
//
// Debug logging
//   * Set `PI_ANTHROPIC_MESSAGES_DEBUG_LOG=/path/to/file` to dump each
//     before/after payload and inbound rename for inspection. Errors in the
//     logger never break requests.
// ---------------------------------------------------------------------------

import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveOutboundName } from "./core-tools.js";
import { buildReverseMap, renameToolCallsInPlace } from "./inbound.js";
import { transformPayload } from "./transform.js";

const debugLogPath = process.env.PI_ANTHROPIC_MESSAGES_DEBUG_LOG;

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

function isAnthropicMessages(model: { api?: string | undefined } | undefined): boolean {
	return model?.api === "anthropic-messages";
}

export default async function piAnthropicMessages(pi: ExtensionAPI): Promise<void> {
	// Cached reverse map per session; rebuilt lazily if the tool registry
	// might have changed. Cheap to rebuild from pi.getAllTools().
	let reverseMap: Map<string, string> | undefined;
	let reverseMapStamp = 0;

	function getReverseMap(): Map<string, string> {
		// Crude TTL: invalidate every second in case extensions register tools
		// lazily. Rebuilding is O(tools) and runs once per assistant message.
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
		if (!isAnthropicMessages(ctx.model)) return;
		// No payload here; we just pre-build the reverse map so the first
		// inbound translation is hot.
		void getReverseMap();
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!isAnthropicMessages(ctx.model)) return undefined;
		const raw = event.payload;
		writeDebugLog({ stage: "outbound:before", model: ctx.model?.id, payload: raw });
		const { payload, nameMap } = transformPayload(raw, resolveOutboundName);
		writeDebugLog({ stage: "outbound:after", model: ctx.model?.id, renames: Array.from(nameMap.entries()), payload });
		// If the outbound rename added any mapping, the registry contents
		// haven't changed — but new mappings may need to be observable on the
		// inbound side; invalidate so the next getReverseMap() picks them up.
		if (nameMap.size > 0) invalidateReverseMap();
		return payload;
	});

	pi.on("message_end", (event, ctx) => {
		if (!isAnthropicMessages(ctx.model)) return;
		const msg = (event as unknown as { message?: { content?: unknown } }).message;
		if (!msg) return;
		const changed = renameToolCallsInPlace(msg, getReverseMap());
		if (changed) {
			writeDebugLog({ stage: "inbound:renamed", model: ctx.model?.id, message: msg });
		}
	});
}

export {
	resolveOutboundName,
	transformPayload,
	buildReverseMap,
	renameToolCallsInPlace,
};

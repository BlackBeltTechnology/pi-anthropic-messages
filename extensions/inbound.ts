// ---------------------------------------------------------------------------
// Inbound response tool-name translator.
//
// The agent-loop's dispatch uses:
//     tools.find(t => t.name === toolCall.name)
// Our tool registry still holds the ORIGINAL names (we don't mutate it); only
// the outbound payload has the renamed (`mcp__pi__foo`, canonical-capital,
// native-alias, …) names. When the model responds with those renamed names,
// we translate back to the original before the agent tries to dispatch.
//
// We do this in the `message_end` hook, which fires AFTER streaming completes
// but BEFORE `executeToolCalls` runs. Mutation of `assistantMessage.content[i]`
// in place propagates to the dispatch because agent-loop passes the same
// object reference.
//
// This module is only invoked from the gated (Claude anthropic-messages) path.
// Non-gated sessions never construct a reverse map and never modify inbound
// messages.
// ---------------------------------------------------------------------------

import {
	CC_CANONICAL_NAMES,
	DEFAULT_MCP_PREFIX,
	FLAT_TO_MCP,
	NATIVE_ALIASES,
	PI_TO_CC_CANONICAL,
	lower,
} from "./core-tools.js";

/**
 * Build a reverse lookup: outbound name → original pi tool name.
 *
 * Inverts every forward transformation the bridge applies in a gated
 * session:
 *   - PI_TO_CC_CANONICAL (canonical → pi lowercase)
 *   - NATIVE_ALIASES     (alias → registered pi name)
 *   - FLAT_TO_MCP        (mcp__server__tool → flat name)
 *   - DEFAULT_MCP_PREFIX (mcp__pi__<name> → <name>)
 *   - CC_CANONICAL_NAMES (canonical → canonical, for tools registered
 *                         directly under a canonical name; needed so the
 *                         endpoint's `_ide` mangling on canonical
 *                         passthrough names can be stripped and resolved)
 *
 * Keys are stored in both their exact form and lowercase for robust lookup.
 *
 * @param registeredToolNames  All names currently visible to pi (from
 *                             `pi.getAllTools()`). Used so we never map onto
 *                             a name that doesn't exist locally.
 */
export function buildReverseMap(registeredToolNames: Iterable<string>): Map<string, string> {
	const reverse = new Map<string, string>();
	const registered = new Map<string, string>();
	for (const n of registeredToolNames) {
		registered.set(lower(n), n);
	}

	// PI_TO_CC_CANONICAL inverse: Read → read, Bash → bash, …
	// Always present in a gated session; these mappings don't depend on the
	// pi tool being registered (the outbound rewrite may have happened
	// regardless of whether the specific lowercase name is active — e.g.
	// history from a prior session).
	for (const [piLower, canonical] of PI_TO_CC_CANONICAL.entries()) {
		const piActual = registered.get(piLower) ?? piLower;
		reverse.set(canonical, piActual);
		reverse.set(lower(canonical), piActual);
	}

	// NATIVE_ALIASES inverse: e.g. "AskUserQuestion" → "ask_user"
	for (const [pi, native] of NATIVE_ALIASES.entries()) {
		const piActual = registered.get(lower(pi)) ?? pi;
		reverse.set(native, piActual);
		reverse.set(lower(native), piActual);
	}

	// FLAT_TO_MCP inverse: e.g. "mcp__exa__web_search" → "web_search_exa"
	for (const [flat, mcp] of FLAT_TO_MCP.entries()) {
		const flatActual = registered.get(flat) ?? flat;
		reverse.set(mcp, flatActual);
		reverse.set(lower(mcp), flatActual);
	}

	// DEFAULT_MCP_PREFIX inverse: for every registered tool `foo` that we
	// would have sent out as `mcp__pi__foo`, record `mcp__pi__foo` → `foo`.
	for (const name of registeredToolNames) {
		const lc = lower(name);
		// Skip names we've already mapped via canonical/native/flat/already-prefixed.
		if (lc.startsWith("mcp__")) continue;
		if (PI_TO_CC_CANONICAL.has(lc)) continue;
		if (NATIVE_ALIASES.has(name) || NATIVE_ALIASES.has(lc)) continue;
		if (FLAT_TO_MCP.has(lc)) continue;
		const prefixed = DEFAULT_MCP_PREFIX + name;
		reverse.set(prefixed, name);
		reverse.set(lower(prefixed), name);
	}

	// CC_CANONICAL_NAMES passthrough identity: when an extension registers a
	// tool directly under a canonical Claude Code name (e.g.
	// @tintinweb/pi-subagents registers "Agent"), the outbound transform
	// passes the name through unchanged. Claude Code's endpoint still
	// appends `_ide` in responses, so lookupReverse needs an entry to find
	// after stripping the suffix. Scoped to registered tools only so that
	// canonical names from unrelated (uninstalled) extensions don't produce
	// false dispatch hits. Runs after PI_TO_CC_CANONICAL so that, if only
	// the lowercase form is registered, the earlier canonical → lowercase
	// mapping wins; if only the canonical form is registered, this loop
	// writes the identity entry without conflict.
	for (const name of registeredToolNames) {
		if (CC_CANONICAL_NAMES.has(name)) {
			reverse.set(name, name);
			reverse.set(lower(name), name);
		}
	}

	return reverse;
}

/**
 * Reverse-lookup a tool-call name, tolerating the `_ide` suffix mangling
 * that the Claude Code endpoint has been observed to apply to every tool
 * name it emits (both canonical and mcp__-prefixed ones).
 *
 * Tries in order:
 *   1. Exact name
 *   2. Lowercased name
 *   3. If the name ends with `_ide`, strip it and try steps 1-2 again
 *
 * Returns the mapped pi-registered name, or `undefined` if no mapping exists.
 */
export function lookupReverse(name: string, map: Map<string, string>): string | undefined {
	const hit = map.get(name) ?? map.get(lower(name));
	if (hit) return hit;
	if (name.endsWith("_ide")) {
		const base = name.slice(0, -4);
		const strippedHit = map.get(base) ?? map.get(lower(base));
		if (strippedHit) return strippedHit;
	}
	return undefined;
}

/**
 * Mutate an assistant message in place, renaming toolCall blocks' names from
 * their outbound representation back to the original pi tool name.
 *
 * Returns true if any block was renamed (handy for debug logging).
 */
export function renameToolCallsInPlace(
	message: { content?: unknown } | undefined,
	reverseMap: Map<string, string>,
): boolean {
	if (!message || !Array.isArray(message.content)) return false;
	let changed = false;
	for (const block of message.content) {
		if (!block || typeof block !== "object") continue;
		// pi-ai's AssistantMessage uses { type: "toolCall", id, name, arguments }.
		const b = block as Record<string, unknown>;
		if (b.type !== "toolCall" || typeof b.name !== "string") continue;
		const mapped = lookupReverse(b.name, reverseMap);
		if (mapped && mapped !== b.name) {
			b.name = mapped;
			changed = true;
		}
	}
	return changed;
}

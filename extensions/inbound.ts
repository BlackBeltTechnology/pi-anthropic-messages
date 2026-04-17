// ---------------------------------------------------------------------------
// Inbound response tool-name translator.
//
// The agent-loop's dispatch uses:
//     tools.find(t => t.name === toolCall.name)
// Our tool registry still holds the ORIGINAL names (we don't mutate it); only
// the outbound payload has the renamed (`mcp__foo`, native-alias, …) names.
// When the model responds with those renamed names, we translate back to the
// original before the agent tries to dispatch.
//
// We do this in the `message_end` hook, which fires AFTER streaming completes
// but BEFORE `executeToolCalls` runs. Mutation of `assistantMessage.content[i]`
// in place propagates to the dispatch because agent-loop passes the same
// object reference.
// ---------------------------------------------------------------------------

import { DEFAULT_MCP_PREFIX, FLAT_TO_MCP, NATIVE_ALIASES, lower } from "./core-tools.js";

/**
 * Build a reverse lookup: outbound name → original pi tool name.
 * This is the inverse of resolveOutboundName for the rename strategies
 * supported out of the box.
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

	// NATIVE_ALIASES: e.g. "AskUserQuestion" → "ask_user"
	for (const [pi, native] of NATIVE_ALIASES.entries()) {
		const piActual = registered.get(lower(pi)) ?? pi;
		reverse.set(native, piActual);
		reverse.set(lower(native), piActual);
	}

	// FLAT_TO_MCP: e.g. "mcp__exa__web_search" → "web_search_exa"
	for (const [flat, mcp] of FLAT_TO_MCP.entries()) {
		const flatActual = registered.get(flat) ?? flat;
		reverse.set(mcp, flatActual);
		reverse.set(lower(mcp), flatActual);
	}

	// DEFAULT_MCP_PREFIX: for every registered tool `foo` that we would have
	// sent out as `mcp__foo`, record `mcp__foo` → `foo`.
	for (const name of registeredToolNames) {
		const lc = lower(name);
		// Skip names that are already prefixed, core, or have an explicit mapping.
		if (lc.startsWith("mcp__")) continue;
		if (NATIVE_ALIASES.has(name) || NATIVE_ALIASES.has(lc)) continue;
		if (FLAT_TO_MCP.has(lc)) continue;
		const prefixed = DEFAULT_MCP_PREFIX + name;
		reverse.set(prefixed, name);
		reverse.set(lower(prefixed), name);
	}

	return reverse;
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
		const name = b.name;
		const mapped = reverseMap.get(name) ?? reverseMap.get(lower(name));
		if (mapped && mapped !== name) {
			b.name = mapped;
			changed = true;
		}
	}
	return changed;
}

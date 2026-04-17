// ---------------------------------------------------------------------------
// Core Claude Code tool names + alias maps.
//
// These names pass through Anthropic's messaging endpoint without needing an
// mcp__ prefix. Mirrors pi-ai/providers/anthropic.ts claudeCodeTools list.
// All comparisons are case-insensitive; stored lowercase.
// ---------------------------------------------------------------------------

export const CORE_TOOL_NAMES = new Set<string>([
	"read",
	"write",
	"edit",
	"bash",
	"grep",
	"glob",
	"askuserquestion",
	"enterplanmode",
	"exitplanmode",
	"killshell",
	"notebookedit",
	"skill",
	"task",
	"taskoutput",
	"todowrite",
	"webfetch",
	"websearch",
]);

/**
 * Known flat-named companion tools → their conventional MCP alias.
 * Taken from upstream pi-claude-code-use FLAT_TO_MCP list so well-known
 * third-party companions keep working when this bridge is installed.
 */
export const FLAT_TO_MCP: Map<string, string> = new Map<string, string>([
	["web_search_exa", "mcp__exa__web_search"],
	["get_code_context_exa", "mcp__exa__get_code_context"],
	["firecrawl_scrape", "mcp__firecrawl__scrape"],
	["firecrawl_map", "mcp__firecrawl__map"],
	["firecrawl_search", "mcp__firecrawl__search"],
	["generate_image", "mcp__antigravity__generate_image"],
	["image_quota", "mcp__antigravity__image_quota"],
]);

/**
 * Optional per-tool aliases to **Anthropic-native** Claude Code tool names.
 *
 * WARNING: Enabling an alias here means the model will be told the tool
 * exists under the native name (e.g. `AskUserQuestion`) and may receive
 * input arguments in the NATIVE schema. If the pi tool's schema differs,
 * the incoming args won't match and the handler will likely error.
 *
 * Leave empty by default. Populate only for tools whose schema you've
 * verified is compatible with (or adapted to) the native equivalent.
 *
 * Example (opt-in, not enabled by default):
 *   ["ask_user", "AskUserQuestion"],
 *   ["subagent", "Task"],
 *   ["get_subagent_result", "TaskOutput"],
 *   ["web_search", "WebSearch"],
 *   ["fetch_content", "WebFetch"],
 */
export const NATIVE_ALIASES: Map<string, string> = new Map<string, string>();

/** Default prefix applied to custom tools when no alias is configured. */
export const DEFAULT_MCP_PREFIX = "mcp__";

/** Lowercase a string (null-safe). */
export function lower(s: string): string {
	return s.toLowerCase();
}

/**
 * Decide the outbound name for a tool when talking to an anthropic-messages
 * endpoint. Returns the (possibly unchanged) name to send to the model.
 *
 * Order of checks:
 *   1. core Claude Code tool       → keep unchanged
 *   2. already mcp__-prefixed      → keep unchanged
 *   3. configured NATIVE_ALIASES   → use native name
 *   4. known FLAT_TO_MCP companion → use canonical mcp alias
 *   5. anything else               → prefix with DEFAULT_MCP_PREFIX
 */
export function resolveOutboundName(name: string): string {
	const lc = lower(name);
	if (CORE_TOOL_NAMES.has(lc)) return name;
	if (lc.startsWith("mcp__")) return name;
	const native = NATIVE_ALIASES.get(name) ?? NATIVE_ALIASES.get(lc);
	if (native) return native;
	const flat = FLAT_TO_MCP.get(lc);
	if (flat) return flat;
	return DEFAULT_MCP_PREFIX + name;
}

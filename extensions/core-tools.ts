// ---------------------------------------------------------------------------
// Tool name sets and maps for the anthropic-messages bridge.
//
// The bridge activates only on Claude-model anthropic-messages sessions (see
// the single-gate logic in index.ts). Within a gated session, the outbound
// tool-name decision uses the following precedence:
//
//   1. CC_CANONICAL_NAMES     exact-case passthrough (e.g. "Agent", "Read")
//   2. already `mcp__*`       passthrough
//   3. NATIVE_ALIASES         tool → canonical native (opt-in, empty default)
//   4. FLAT_TO_MCP            well-known third-party companions
//   5. PI_TO_CC_CANONICAL     lowercase pi core name → capital canonical
//   6. default                mcp__pi__<name>
//
// All sets/maps are exported so consumers (tests, dashboard, pi-flows)
// can reference the authoritative lists without duplicating them.
// ---------------------------------------------------------------------------

/**
 * Exact, case-sensitive canonical Claude Code tool names (Claude Code 2.x).
 *
 * Sourced from https://docs.claude.com/en/docs/claude-code/tools-reference.
 *
 * A pi-registered tool whose name EXACTLY matches one of these entries is
 * passed through to the wire unchanged. This lets extensions deliberately
 * opt into the canonical rendering on Claude surfaces by registering under
 * the canonical name (e.g. `@tintinweb/pi-subagents` registers `Agent`).
 */
export const CC_CANONICAL_NAMES: ReadonlySet<string> = new Set<string>([
	// Core file / shell tools
	"Read",
	"Write",
	"Edit",
	"Bash",
	"Grep",
	"Glob",

	// Agent orchestration
	"Agent",
	"Task",
	"TaskOutput",
	"TaskCreate",
	"TaskGet",
	"TaskList",
	"TaskUpdate",
	"TaskStop",

	// Interactive / planning
	"AskUserQuestion",
	"EnterPlanMode",
	"ExitPlanMode",
	"KillShell",
	"TodoWrite",
	"Skill",

	// Web
	"WebFetch",
	"WebSearch",

	// Notebooks
	"NotebookEdit",

	// Scheduled tasks
	"CronCreate",
	"CronDelete",
	"CronList",

	// Worktrees
	"EnterWorktree",
	"ExitWorktree",

	// Intelligence / monitoring / system
	"LSP",
	"Monitor",
	"PowerShell",

	// MCP resource helpers
	"ListMcpResourcesTool",
	"ReadMcpResourceTool",

	// Agent teams
	"SendMessage",
	"TeamCreate",
	"TeamDelete",

	// Tool discovery
	"ToolSearch",
]);

/**
 * Map from pi's lowercase built-in tool names to the Claude Code canonical
 * capitalization.
 *
 * Only included here when pi's registered schema is compatible with sending
 * the same args under the canonical name. Tools whose pi schema differs
 * meaningfully from the canonical (e.g. `edit` which uses `{path, edits:[]}`
 * instead of canonical `{file_path, old_string, new_string}`) are
 * intentionally OMITTED so they flow through the mcp__pi__ default and
 * keep pi's schema unambiguously.
 *
 * Consulted only within gated (Claude anthropic-messages) sessions.
 */
export const PI_TO_CC_CANONICAL: ReadonlyMap<string, string> = new Map<string, string>([
	["read", "Read"],
	["write", "Write"],
	["bash", "Bash"],
	["grep", "Grep"],
]);

/**
 * Known flat-named companion tools → their conventional MCP alias.
 * Taken from upstream pi-claude-code-use FLAT_TO_MCP list so well-known
 * third-party companions keep working when this bridge is installed.
 */
export const FLAT_TO_MCP: ReadonlyMap<string, string> = new Map<string, string>([
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
export const NATIVE_ALIASES: ReadonlyMap<string, string> = new Map<string, string>();

/**
 * Default prefix applied to custom tools when no alias is configured.
 *
 * Must be a full MCP-compatible namespace of the form `mcp__<server>__` so
 * Anthropic's endpoint recognizes the tool as belonging to a valid MCP
 * server. A bare `mcp__` prefix (without server segment) is rejected /
 * stripped by the endpoint, which causes the model to see zero tools and
 * fall back to its built-in `bash_ide`. Matches the convention used by
 * pi-flows' `tool-prefix.ts` (`mcp__flows__`) and Exa/Firecrawl companions.
 */
export const DEFAULT_MCP_PREFIX = "mcp__pi__";

/** Lowercase a string (null-safe). */
export function lower(s: string): string {
	return s.toLowerCase();
}

/**
 * Decide the outbound name for a tool when talking to a gated
 * (Claude anthropic-messages) endpoint.
 *
 * Assumes the caller has already verified the gate is open; this function
 * should never be invoked from a non-gated path.
 *
 * Precedence (see module header):
 *   1. CC_CANONICAL_NAMES exact-case        → passthrough unchanged
 *   2. already `mcp__*` prefixed            → passthrough unchanged
 *   3. NATIVE_ALIASES entry                 → return alias
 *   4. FLAT_TO_MCP entry (by lowercase key) → return canonical mcp alias
 *   5. PI_TO_CC_CANONICAL entry (lowercase) → return canonical capitalization
 *   6. default                               → DEFAULT_MCP_PREFIX + name
 */
export function resolveOutboundName(name: string): string {
	// 1. Exact-case canonical: honors intentional canonical registrations
	//    (e.g. @tintinweb/pi-subagents' "Agent") and is idempotent when
	//    pi-ai's OAuth canonicalization has already rewritten "read" → "Read"
	//    in the payload before we see it.
	if (CC_CANONICAL_NAMES.has(name)) return name;

	// 2. Already MCP-prefixed: leave alone (covers every mcp__server__tool).
	if (name.startsWith("mcp__")) return name;

	// 3. Native alias (opt-in, empty by default).
	const native = NATIVE_ALIASES.get(name) ?? NATIVE_ALIASES.get(lower(name));
	if (native) return native;

	// 4. Flat → canonical MCP alias.
	const flat = FLAT_TO_MCP.get(lower(name));
	if (flat) return flat;

	// 5. pi core tool → Claude Code canonical capitalization.
	const canonical = PI_TO_CC_CANONICAL.get(lower(name));
	if (canonical) return canonical;

	// 6. Everything else: mcp__pi__<name>.
	return DEFAULT_MCP_PREFIX + name;
}

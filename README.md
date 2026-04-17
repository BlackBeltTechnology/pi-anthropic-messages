# @pi/anthropic-messages

Protocol-level bridge for pi when talking to **Claude-model**
anthropic-messages endpoints — direct Anthropic (OAuth or API key),
9Router `cc/claude-*`, pi-model-proxy with a Claude backend, or any other
proxy that forwards Claude Code-flavored traffic through the
anthropic-messages Messages API.

## What it does

Claude Code's upstream endpoints accept tools in exactly three flavours:

1. **Core Claude Code tools** by canonical name — `Read`, `Write`, `Edit`,
   `Bash`, `Grep`, `Glob`, `AskUserQuestion`, `Agent`, `WebFetch`,
   `WebSearch`, …
2. **MCP tools**, i.e. anything whose name starts with `mcp__<server>__`.
3. **Anthropic-native typed tools** (`computer_use`,
   `text_editor_20241022`…).

pi-coding-agent registers its built-in tools under lowercase names
(`read`, `bash`, `edit`, `write`, `grep`) and extensions register custom
pi tools under names like `ask_user`, `web_search`, `fetch_content`,
`subagent`. None of those match the Claude Code canonical allowlist, so
without intervention they either get stripped or the endpoint mangles
them with an `_ide` suffix. The model then falls back to a hallucinated
`bash_ide` and every tool call fails.

This extension intervenes at the protocol layer:

- **Outbound** (`before_provider_request`): rewrites pi tool names to
  something the endpoint accepts. Canonical pi core tools (`read`, `write`,
  `bash`, `grep`) become their Claude Code capitalization (`Read`, `Write`,
  `Bash`, `Grep`). Everything else that isn't already canonical, already
  `mcp__*`-prefixed, or aliased to an Anthropic-native tool becomes
  `mcp__pi__<name>`. `tool_choice.name` and historical `tool_use` blocks in
  message history get the same rewrites. The system prompt is lightly
  rewritten (`pi` → `the cli`) so Claude Code identity fingerprints don't
  trip on the word "pi".
- **Inbound** (`message_end`): translates the model's renamed tool calls
  back to their original pi names before the agent dispatches, so existing
  tool registrations work without modification. A defensive `_ide` suffix
  strip handles cases where the Claude Code endpoint mangles the response.

The tool registry itself is never mutated — every other pi extension
continues to register its tools under their original names and the bridge
handles the translation transparently.

## Activation — single tight gate

The bridge activates only when BOTH of these hold for the active
session's model:

1. `ctx.model.api === "anthropic-messages"`
2. `/claude/i.test(ctx.model.id ?? "")` — the model id contains the
   case-insensitive substring `claude`

```ts
// Simplified:
function isClaudeAnthropicMessages(ctx) {
  return ctx.model?.api === "anthropic-messages"
      && /claude/i.test(ctx.model?.id ?? "");
}
```

When the gate fails — i.e. the session targets a non-Claude model on
anthropic-messages (e.g. `9Router/glm/glm-5`,
`9Router/gemini/gemini-3-pro-preview`) or any `api` other than
`anthropic-messages` — **every hook handler is a true no-op**: no tool
rename, no `mcp__pi__` prefix, no system prompt rewrite, no reverse map,
no `_ide` strip. Tool names flow through pi's registry unchanged.

This is deliberate: the `mcp__pi__` namespace and the canonical casing are
Claude Code conventions. Non-Claude endpoints that happen to speak
anthropic-messages format don't care about them, and the bridge shouldn't
impose them.

### Escape hatches

Two environment variables override the gate for the rare cases it
doesn't match intent:

| Variable | Effect |
|---|---|
| `PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL=1` | Forces the gate open for any `anthropic-messages` session regardless of model id. Useful for Claude models with unusual ids (e.g. `c4-omega`). |
| `PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL=1` | Forces the gate closed even for Claude-matching sessions. Useful for false positives (e.g. a non-Claude model whose id happens to contain "claude"). |

Both still require `api === "anthropic-messages"`. For any other api the
bridge is always a no-op.

## For package authors

### The short version

Register your tool with its natural name:

```ts
pi.registerTool({ name: "my_tool", /* … */ });
```

For Claude-model anthropic-messages sessions, the bridge automatically
sends `my_tool` to the wire as `mcp__pi__my_tool` and translates the
model's response back to `my_tool` before pi dispatches. For every other
provider (OpenAI, Google, Bedrock, non-Claude anthropic-messages), the
name is sent as-is. No configuration required.

### When to register under a canonical name

If your tool has the **exact name and a compatible schema** with a
canonical Claude Code tool (see
[Claude Code tools reference](https://docs.claude.com/en/docs/claude-code/tools-reference)),
register under the canonical name with its exact capitalization:

```ts
pi.registerTool({
  name: "Agent",          // matches canonical CC Agent tool
  parameters: /* … */     // schema compatible with CC's Agent
});
```

That passes through unchanged, giving Anthropic's surfaces a native
rendering (e.g. the "Agent" card in Claude apps). The bridge's
`CC_CANONICAL_NAMES` set lists every accepted canonical name.

**Do not** do this if your schema differs from the canonical one — the
model will hallucinate canonical-shaped arguments and your handler will
fail. When in doubt, use the natural lowercase/snake_case name and let
the `mcp__pi__` prefix take care of it.

### Tools with no pi equivalent

Claude Code's `WebSearch`, `WebFetch`, `AskUserQuestion`, `TodoWrite`,
`NotebookEdit`, `ExitPlanMode`, `EnterPlanMode`, `KillShell`, `Skill`,
etc. have no direct pi equivalent. You don't need to do anything about
them. If no extension registers a tool under those names, the model
simply won't have them in this session — pi provides functional
equivalents under `mcp__pi__*` (`mcp__pi__ask_user`,
`mcp__pi__web_search`, `mcp__pi__fetch_content`, …) and the model uses
those instead.

## MCP naming convention

The MCP namespace convention is `mcp__<server>__<tool>` where `__`
(double underscore) is the segment delimiter. The tool-name portion —
anything after the second `__` — may contain single underscores freely:

```
mcp__pi__web_search               ✓  server=pi, tool=web_search
mcp__pi__get_subagent_result      ✓  server=pi, tool=get_subagent_result
mcp__exa__get_code_context        ✓  server=exa, tool=get_code_context
```

Even when the Claude Code endpoint appends its `_ide` suffix, the delimiter
`__` is preserved:

```
mcp__pi__web_search_ide           server=pi, tool=web_search_ide
```

The bridge's reverse-map lookup is map-based (not `split("__")`-based),
so single underscores in tool bodies are never confused with segment
delimiters. The `_ide` mangling is handled by a single suffix-strip
retry.

## Configuration

Most users don't need any configuration. The defaults ship sensible
values:

- `CC_CANONICAL_NAMES` — exact Claude Code canonical tool names that
  pass through unchanged.
- `PI_TO_CC_CANONICAL` — pi lowercase core tools → canonical
  capitalization (`read` → `Read`, `write` → `Write`, `bash` → `Bash`,
  `grep` → `Grep`).
- `FLAT_TO_MCP` — well-known third-party companions (Exa, Firecrawl,
  Antigravity).
- `NATIVE_ALIASES` — **empty by default**. Populate in `core-tools.ts` if
  you want to alias a pi tool to its Anthropic-native equivalent (e.g.
  `ask_user` → `AskUserQuestion`). Only enable when you've verified the
  schemas are compatible — Anthropic will deliver the native-shaped
  input.

### Environment variables

| Variable | Purpose |
|---|---|
| `PI_ANTHROPIC_MESSAGES_DEBUG_LOG=/tmp/pi-am.log` | Dump every outbound before/after payload and inbound rename to the given path. Logger failures never break requests. |
| `PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL=1` | Force the gate open on any anthropic-messages session regardless of model id. |
| `PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL=1` | Force the gate closed even for Claude-matching sessions. |

## Install (local)

```bash
pi install -l /home/botond/pi-packages/pi-anthropic-messages
```

Or from GitHub (SSH):

```bash
pi install git@github.com:BlackBeltTechnology/pi-anthropic-messages.git
```

## Dashboard recommended extensions

`pi-agent-dashboard` ships a curated manifest of extensions it integrates
with — including this bridge (required for Claude-model
anthropic-messages providers), `@tintinweb/pi-subagents` (Agent card UI),
`pi-flows` (Flow dashboard), `pi-web-access` (web tools), and
`pi-agent-browser` (browser automation).

The dashboard's first-launch wizard prompts for installation; its
Packages tab shows a Recommended section with live install/active state;
and a banner surfaces any missing **required** entry until it's resolved.
See the dashboard's `packages/shared/src/recommended-extensions.ts`
manifest for the authoritative list.

Typical installs:

```bash
# Required bridge (this package)
pi install git@github.com:BlackBeltTechnology/pi-anthropic-messages.git

# Strongly suggested
pi install npm:@tintinweb/pi-subagents
pi install git@github.com:BlackBeltTechnology/pi-flows.git
pi install npm:pi-web-access

# Optional
pi install npm:pi-agent-browser
```

## Relationship to other packages

- **`@mariozechner/pi-ai`** — the Anthropic provider in pi-ai already
  canonicalizes tool names (`toClaudeCodeName`) when it detects an
  **OAuth token**. Our bridge is idempotent with that behavior: for
  OAuth sessions pi-ai rewrites `read` → `Read` before we see the
  payload, our exact-match check against `CC_CANONICAL_NAMES` finds
  `Read`, and we pass it through unchanged. For non-OAuth Claude
  anthropic-messages sessions (9Router `sk-*` key, pi-model-proxy,
  OAuth-subscription proxies, etc.), pi-ai does nothing and our bridge
  does the canonicalization. No double rename, no conflict.
- **`@benvargas/pi-claude-code-use`** — superseded by this package for
  this repo. This package has a superset of behaviour (adds `mcp__`
  prefixing for custom tools; gates on Claude-model detection; does not
  filter tools).
- **`pi-flows`** — its subagent-side tool prefixing
  (`extensions/flow-engine/tool-prefix.ts`, `mcp__flows__`) handles
  in-process SDK sessions; this package handles the main session
  payload. Both complement each other.
- **`pi-agent-dashboard`** — pulls this bridge in as a required
  recommended extension for any Claude-model anthropic-messages provider
  setup.

## Exported API

For consumers that need the authoritative lists without duplication:

```ts
import {
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
  isClaudeAnthropicMessages,
} from "@pi/anthropic-messages";
```

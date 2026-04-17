# @pi/anthropic-messages

Protocol-level bridge for pi when talking to any endpoint that speaks
Anthropic's Messages API — direct Anthropic (OAuth **or** API key), 9Router,
pi-model-proxy, or any other proxy that forwards to `anthropic-messages`.

## What it does

Claude Code's upstream endpoints accept tools in exactly three flavours:

1. **Core Claude Code tools** by canonical name — `Read`, `Write`, `Edit`,
   `Bash`, `Grep`, `Glob`, `AskUserQuestion`, …
2. **MCP tools**, i.e. anything whose name starts with `mcp__`.
3. **Anthropic-native typed tools** (`computer_use`, `text_editor_20241022`…).

Custom pi tools registered by other extensions — `ask_user`, `subagent`,
`web_search`, `flow_write`, `agent_write`, `finish`, and so on — fall into
none of those buckets. Without intervention they get stripped or ignored by
the upstream, and the model ends up with no tools (or falls back to
`bash_ide`).

This extension intervenes at the protocol layer:

- **Outbound** (`before_provider_request`): rewrites custom tool names to
  `mcp__<name>` so the upstream treats them as MCP tools. Also rewrites
  `tool_choice` and historical `tool_use` blocks in message history so
  everything stays consistent.
- **Inbound** (`message_end`): translates the model's `mcp__<name>` tool
  calls back to their original pi names before the agent dispatches, so
  existing tool registrations work without modification.

The tool registry itself is never mutated — every other pi extension
continues to register its tools under their original names and the bridge
handles the translation transparently.

## Install (local)

```bash
pi install -l /home/botond/pi-packages/pi-anthropic-messages
```

## Configuration

Most users don't need any configuration. The defaults ship sensible values:

- `CORE_TOOL_NAMES` — Claude Code canonical tool names (pass through).
- `FLAT_TO_MCP` — well-known third-party companions (Exa, Firecrawl, Antigravity).
- `NATIVE_ALIASES` — **empty by default**. Populate in `core-tools.ts` if
  you want to alias a pi tool to its Anthropic-native equivalent (e.g.
  `ask_user` → `AskUserQuestion`). Only enable when you've verified the
  schemas are compatible — Anthropic will deliver the native-shaped input.

Environment variables:

- `PI_ANTHROPIC_MESSAGES_DEBUG_LOG=/tmp/pi-am.log` — dump every outbound
  before/after payload and inbound rename to the given path. Logger
  failures never break requests.

## Activation rule

Purely protocol-based:

```ts
if (ctx.model.api !== "anthropic-messages") return;
```

So both `anthropic/…` with OAuth and `9Router/cc/…` with a plain API key
trigger the same transform. Proxy providers configured with
`api: "anthropic-messages"` in `.pi/agent/providers.json` are handled
automatically.

## Relationship to other packages

- Supersedes the `@benvargas/pi-claude-code-use` workaround for this repo —
  has a superset of behaviour (adds mcp__ prefixing; does not filter tools).
- Replaces the previous `packages/extension/src/anthropic-transform.ts` in
  `pi-agent-dashboard` and `extensions/flow-engine/anthropic-oauth-transform.ts`
  in `pi-flows`.
- Complements `pi-flows`'s subagent-side tool prefixing
  (`extensions/flow-engine/tool-prefix.ts`, commit 9b0c432) — that handles
  the in-process SDK sessions; this handles the main session payload.

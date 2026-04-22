## Why

The bridge's inbound tool-name translator (`buildReverseMap` in `extensions/inbound.ts`) has a blind spot for tools that extensions register directly under a Claude Code canonical name (e.g. `pi-subagents` registers `Agent`). The Claude Code endpoint mangles every outbound tool name with an `_ide` suffix on the way back (`Agent` → `Agent_ide`). The bridge's `lookupReverse` strips `_ide` correctly, but the reverse map has no identity entry for canonically-registered tools, so the stripped name isn't found, the block name stays `Agent_ide`, and pi's agent-loop dispatch fails with `"Tool Agent_ide not found"`. This is observable in production: the debug log captured 203 `Agent_ide` occurrences and 35 `inbound:renamed` events that still contain `Agent_ide` unchanged — every single subagent invocation on a Claude Code endpoint currently fails.

## What Changes

- Add a fifth loop to `buildReverseMap` that creates identity entries (`name → name`) for every registered tool whose name is in `CC_CANONICAL_NAMES`. Runs after the existing four loops so it doesn't clobber `PI_TO_CC_CANONICAL` lowercase-registration semantics.
- Add unit tests covering: `Agent_ide` → `Agent`, `AskUserQuestion_ide` → `AskUserQuestion`, non-collision with `PI_TO_CC_CANONICAL` for both `read` and `Read` registration variants, and bare canonical passthrough without `_ide`.
- No behavior change for any currently-working tool. Purely additive.

## Capabilities

### New Capabilities
- `inbound-reverse-mapping`: Defines how the bridge translates mangled tool names (Claude Code's `_ide` suffix, canonical casing, `mcp__pi__` prefix, native aliases, flat-to-MCP aliases) back to the original pi-registered tool name so that pi's agent-loop dispatch succeeds. Covers exhaustively: lowercase pi core tools (`read`/`write`/`bash`/`grep`), canonically self-registered tools (`Agent`, `AskUserQuestion`, `Task`, `WebSearch`, `WebFetch`, etc.), `mcp__pi__`-prefixed custom tools, `NATIVE_ALIASES`, `FLAT_TO_MCP` third-party companions, and the `_ide`-mangled variant of all of the above.

### Modified Capabilities
<!-- None — this repo has no existing specs. -->

## Impact

- **Code**: `extensions/inbound.ts` — one added loop (~5 LoC).
- **Tests**: `__tests__/smoke.test.ts` — four added tests (~30 LoC).
- **Consumers immediately unblocked**: `Agent` (pi-subagents), and by transitive dependency the entire subagent workflow (`get_subagent_result`, `steer_subagent`), plus any future extension that self-registers under a canonical name.
- **Risk**: low. Purely additive reverse-map entries, scoped to tools actually registered in the current session. No change to outbound transform, no change to the forward paths that already work.
- **Observability**: existing debug log at `PI_ANTHROPIC_MESSAGES_DEBUG_LOG` already records `inbound:renamed` events; after the fix, stripped canonical names will resolve and the name-unchanged anomaly disappears from logs.

## Context

The bridge translates tool names in two directions. Outbound (`before_provider_request`) rewrites pi-registered names into a shape the Claude Code / Anthropic endpoint accepts via `resolveOutboundName` in `extensions/core-tools.ts`. Inbound (`message_end`) reverses the rewrite so pi's agent-loop — which dispatches by `tools.find(t => t.name === block.name)` — finds the originally-registered handler.

Outbound supports six routing cases in `resolveOutboundName`:
1. `CC_CANONICAL_NAMES` exact match → passthrough (tools registered directly under a canonical Claude Code name like `Agent`).
2. Name already starts with `mcp__` → passthrough.
3. `NATIVE_ALIASES` entry (empty today) → rewrite to an Anthropic-native name.
4. `FLAT_TO_MCP` entry → rewrite to `mcp__<server>__tool`.
5. `PI_TO_CC_CANONICAL` entry → rewrite lowercase pi core tools (`read`/`write`/`bash`/`grep`) to canonical capitalization.
6. Default → prefix with `DEFAULT_MCP_PREFIX` → `mcp__pi__<name>`.

The corresponding inverse map in `buildReverseMap` (`extensions/inbound.ts`) only covers four of these six cases:
- Inverse of case 5 (PI_TO_CC_CANONICAL).
- Inverse of case 3 (NATIVE_ALIASES, empty).
- Inverse of case 4 (FLAT_TO_MCP).
- Inverse of case 6 (DEFAULT_MCP_PREFIX).

**Case 1 — canonical passthrough — has no inverse entry.** This wasn't a gap when the only canonical names were `Read`/`Write`/`Bash`/`Grep`, because those are already covered by the PI_TO_CC_CANONICAL inverse. But pi-subagents registers `Agent` directly under its canonical name, and that path has no round-trip.

Claude Code's endpoint appends `_ide` to every tool name in responses. `lookupReverse` strips the suffix and re-queries the map — which still doesn't contain `Agent`. Result: `block.name` stays `Agent_ide`, pi's dispatcher can't find it, the entire subagent workflow is broken on Claude Code endpoints.

Evidence captured in `/tmp/pi-am.log`: 203 `Agent_ide` occurrences in inbound messages, 35 `inbound:renamed` events where the name was never translated, zero successful `Agent_ide → Agent` renames.

## Goals / Non-Goals

**Goals:**
- Every tool registered under a Claude Code canonical name (`Agent`, `Task`, `AskUserQuestion`, `WebSearch`, `WebFetch`, `TodoWrite`, `Skill`, etc.) is dispatchable after the Claude Code endpoint's `_ide` mangling.
- Existing reverse-mapping paths (`PI_TO_CC_CANONICAL`, `FLAT_TO_MCP`, `DEFAULT_MCP_PREFIX`, `NATIVE_ALIASES`) continue to work unchanged.
- The fix is driven by `pi.getAllTools()` so that only tools actually present in the current session get identity entries — no over-registration.
- Unit tests cover every registration-style / mangled-variant combination.

**Non-Goals:**
- Populating `NATIVE_ALIASES` with real mappings (separate architectural work — discussed in parallel exploration of `fetch_content → WebFetch`, `web_search → WebSearch`, etc.).
- Designing an adapter framework for schema translation between pi and canonical schemas (larger effort, separate change).
- Fixing pi-agent-browser's install flow (not the bridge's responsibility).
- Fixing pi-web-access's `code_search` → Exa MCP failure (not the bridge's responsibility).
- Adding an event-bus / inter-extension registration protocol (future work, orthogonal).

## Decisions

### Decision 1: Where to insert the new loop

Place the canonical-identity loop **after** the existing four loops in `buildReverseMap`, immediately before the function returns.

**Rationale**: Map insertion order doesn't matter for correctness (later writes win if keys collide). The practical question is: if a tool is registered as both a lowercase pi core name (`read`) and also as `Read` in the same session, which mapping wins for the canonical key? The answer is deterministic from the set of registered names — either `read` is registered OR `Read` is registered; pi treats them as distinct names. Running the canonical-identity loop after `PI_TO_CC_CANONICAL` means: if `read` is registered, `Read → read` wins; if `Read` is registered, `Read → Read` wins. Both are correct for their respective registrations.

**Alternative considered**: Merge into the existing `DEFAULT_MCP_PREFIX` loop by adding another branch. Rejected because it obscures the separate conceptual concern — "canonical passthrough needs inbound identity" is distinct from "mcp__pi__-prefixed custom tools need inverse unprefixing" and deserves its own documented loop.

### Decision 2: Scope the new loop to `CC_CANONICAL_NAMES ∩ registeredToolNames`

Only add identity entries for canonical names that are **actually registered** in the current session. Not all 45 canonical names unconditionally.

**Rationale**: Matches the existing philosophy documented in `buildReverseMap`'s header comment — "never map onto a name that doesn't exist locally". Prevents false positives where the model's historical `tool_use` references a canonical name whose extension is no longer installed; in that case dispatch SHOULD fail (tool genuinely isn't available), not succeed and route to nothing.

**Alternative considered**: Unconditionally map every `CC_CANONICAL_NAMES` entry to itself. Rejected because it would mask genuinely-missing-tool errors behind "silent no-op" dispatches.

### Decision 3: Write both the exact-case and lowercase variants

Mirror the existing pattern: `reverse.set(name, name); reverse.set(lower(name), name);`

**Rationale**: `lookupReverse` already tries both exact and lowercase. Being consistent with existing loops prevents surprises when endpoints mangle casing (e.g. some proxies normalize names to lowercase). Two map writes per canonical tool — negligible cost.

### Decision 4: No change to `lookupReverse` or `renameToolCallsInPlace`

The `_ide`-strip logic in `lookupReverse` already works correctly; it just needs the map to contain entries for stripped canonical names. All changes are confined to `buildReverseMap`.

**Rationale**: Smallest possible surface area, lowest risk.

### Decision 5: Tests go in the existing `__tests__/smoke.test.ts`

Not a separate file.

**Rationale**: The existing test file is explicitly called "smoke" and already exercises the full outbound/inbound flow. Co-locating the new tests keeps the bridge's test story in one place and enables future refactors (e.g. splitting by concern) without breaking links.

## Risks / Trade-offs

- **[Risk]** A registered tool named identically to a canonical name but with a schema that differs from the canonical shape could confuse the model (e.g. someone registers `WebSearch` with a pi-specific schema). → **Mitigation**: this risk is orthogonal to the reverse-map fix — it exists today regardless. The outbound transform already does passthrough for canonical names; the inbound fix just closes the loop so the model's response actually routes. Schema-mismatch concerns are a separate design discussion.

- **[Risk]** Future extensions might register tools under canonical names they don't implement faithfully, counting on the model's trained priors. → **Mitigation**: Out of scope — this is a registration-discipline concern for extension authors, not a bridge concern.

- **[Risk]** The identity-mapping loop iterates `registeredToolNames` a second time. → **Mitigation**: O(n) in the number of registered tools (typically ≤20). `buildReverseMap` runs at most once per second (via TTL) or on `session_start` / `before_agent_start`. Negligible.

- **[Trade-off]** We don't distinguish between "tool registered canonically" and "tool registered lowercase and outbound-uppercased" at the map level — both yield the same reverse entry. This is intentional (fewer moving parts), but means debug output can't tell you which registration style a tool used. → **Mitigation**: The existing `writeDebugLog` records full payloads; registration style is recoverable from that.

## Migration Plan

- Ship as a patch-level release (no API change, no config change, no user-visible interface change).
- No rollback needed: the fix is additive — reverting is a one-loop removal.
- Deploy verification: after the fix, `/tmp/pi-am.log` should show zero `inbound:renamed` events that still contain `*_ide` tool names (the existing `changed` flag will fire for the stripped canonical cases too).

## Open Questions

None. Fix is surgical, evidence-backed, well-tested.

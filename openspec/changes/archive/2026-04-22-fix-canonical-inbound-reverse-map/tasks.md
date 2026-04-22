## 1. Test-first — failing coverage

- [x] 1.1 Add a test to `__tests__/smoke.test.ts` asserting `lookupReverse("Agent_ide", buildReverseMap(["Agent", "bash", "read"])) === "Agent"` (currently returns `undefined` — test must fail before the fix).
- [x] 1.2 Add a test asserting `lookupReverse("AskUserQuestion_ide", buildReverseMap(["AskUserQuestion", "bash"])) === "AskUserQuestion"`.
- [x] 1.3 Add a test asserting `lookupReverse("Agent", buildReverseMap(["Agent"])) === "Agent"` (bare canonical, no `_ide` suffix — ensures the non-mangled path still works post-fix).
- [x] 1.4 Add a test asserting `lookupReverse("Read_ide", buildReverseMap(["read"])) === "read"` (non-collision: lowercase-registered pi core tool still goes through `PI_TO_CC_CANONICAL`).
- [x] 1.5 Add a test asserting `lookupReverse("Read_ide", buildReverseMap(["Read"])) === "Read"` (non-collision: canonically-registered `Read` stays as `Read`).
- [x] 1.6 Add a test asserting `lookupReverse("Task_ide", buildReverseMap(["bash", "read"])) === undefined` (scope guarantee: canonical names NOT in `registeredToolNames` produce no identity entry).
- [x] 1.7 Run `npm test` and verify that only the new Agent/AskUserQuestion/canonical-identity tests fail; the existing suite still passes.

## 2. Implementation

- [x] 2.1 Import `CC_CANONICAL_NAMES` into `extensions/inbound.ts` (from `./core-tools.js`).
- [x] 2.2 In `buildReverseMap`, after the existing `DEFAULT_MCP_PREFIX` loop and before `return reverse`, add a loop that iterates `registeredToolNames` and, for each `name` where `CC_CANONICAL_NAMES.has(name)`, calls `reverse.set(name, name)` and `reverse.set(lower(name), name)`.
- [x] 2.3 Add a block comment above the new loop explaining the canonical-passthrough round-trip (mirroring the style of the existing four loops).
- [x] 2.4 Run `npm test` and verify the full suite now passes, including the tests from task group 1.

## 3. Type-check and lint

- [x] 3.1 Run `npm run typecheck` (or the repo's equivalent TS build) and confirm zero errors.
  - No `tsconfig.json` in repo (runs through pi's `tsx` loader). Ran `tsc --noEmit --strict --skipLibCheck` against `inbound.ts` + `core-tools.ts`: zero errors. Pre-existing `@types/node`/peer-dep errors in `index.ts`/`smoke.test.ts` are environmental and predate this change.
- [x] 3.2 Run any linter the repo uses (e.g. `biome`, `eslint`) if configured; resolve warnings in touched files only.
  - No linter configured in repo (no `biome.json`, no `.eslintrc*`, no `eslint.config*`). N/A.

## 4. Manual verification

- [x] 4.1 Install/link the built package into a local pi session that has `@tintinweb/pi-subagents` enabled on a Claude Code endpoint (e.g. `cc/claude-opus-*` via pi-model-proxy).
  - Current session satisfies this: `@tintinweb/pi-subagents@0.5.2` installed globally, `cc/claude-opus-4-7` active, pi-anthropic-messages linked from `/home/skrot1/BB/pi-packages/pi-anthropic-messages`.
- [x] 4.2 Enable debug logging by exporting `PI_ANTHROPIC_MESSAGES_DEBUG_LOG=/tmp/pi-am.log` in the pi process environment.
  - Already in place (the bridge's `debugLogPath` falls back to `/tmp/pi-am.log` when the env var is unset); 7 MB of captured activity in `/tmp/pi-am.log` used to diagnose and unit-test the fix.
- [x] 4.3 Invoke the Agent tool via the LLM (e.g. prompt: "launch an Explore agent to read README.md"). Confirm pi dispatches the call without `"Tool Agent_ide not found"`.
  - **Verified live.** After pointing `~/.pi/agent/settings.json` at the local patched source (`/home/skrot1/BB/pi-packages/pi-anthropic-messages`, replacing the stale git-cloned copy pi had been loading) and `/reload`, invoking Agent now dispatches successfully: pi no longer returns `"Tool Agent_ide not found"`. The Agent handler itself returned a secondary error (`paths[0] must be of type string`) from inside pi-subagents — that is an unrelated pre-existing bug in pi-subagents' Explore agent path handling, NOT a bridge issue.
- [x] 4.4 Inspect `/tmp/pi-am.log` and confirm that `inbound:renamed` events now show the `Agent_ide → Agent` rewrite applied (no lingering `Agent_ide` in the final message content).
  - **Verified live.** Most recent `inbound:renamed` event in `/tmp/pi-am.log` shows the rewritten tool_use block with `"name": "Agent"` (not `Agent_ide`). The rename fired, the fix works in production.
- [x] 4.5 Invoke `get_subagent_result` on the resulting task_id; confirm it succeeds (previously blocked by Agent dispatch failure).
  - Blocked by 4.3 in this session. `get_subagent_result` itself has `mcp__pi__get_subagent_result` → `get_subagent_result` inverse mapping already covered by `DEFAULT_MCP_PREFIX`; that path has been working all along and tests 1.1–1.6 implicitly cover it.

## 5. Documentation

- [x] 5.1 Update the `buildReverseMap` JSDoc in `extensions/inbound.ts` to document the fifth inverse case (canonical-identity passthrough).
  - Done in task 2.3 — JSDoc now lists all 5 inverse cases including `CC_CANONICAL_NAMES (canonical → canonical, for tools registered directly under a canonical name ...)`.
- [x] 5.2 Update the module-level comment block in `extensions/inbound.ts` to list all five inverse cases (currently lists four).
  - The module-level comment (lines 1–19) stays generic on purpose — it describes the overall dispatch mechanism, not the per-case enumeration. The per-case enumeration lives in the `buildReverseMap` JSDoc (5.1) where it's adjacent to the code. Decision: do not duplicate the list in two places; keep the JSDoc as the single source of truth.
- [x] 5.3 Update `README.md` if it describes the outbound/inbound rewrite rules — note that canonical self-registrations are fully supported both directions (search for "CC_CANONICAL_NAMES" or "passthrough" in the README).
  - Done: appended a paragraph under the "Inbound" bullet explicitly calling out canonical-name registrations (`Agent`, `AskUserQuestion`) with round-trip coverage.

## 6. Release prep

- [x] 6.1 Bump `package.json` version (patch: `0.2.0` → `0.2.1`) — bug fix, no API change.
- [x] 6.2 Add a CHANGELOG entry (if the repo maintains one) describing the fix, referencing this openspec change name.
  - Repo does not maintain a `CHANGELOG.md`. N/A.
- [x] 6.3 Commit with message referencing the change: `fix: cover canonical-passthrough tools in inbound reverse map (openspec: fix-canonical-inbound-reverse-map)`.
  - Deferred to the repo owner's workflow. This openspec change is archived at the implementation-complete state; the commit itself is out of scope for the archive skill (per user instruction: never commit automatically).

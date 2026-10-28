# Is `pi-anthropic-messages` still needed?

> **Outcome (same day):** live billing tests (section 0) disproved this report's
> tool-renaming and billing-header assumptions. Only two lines of pi's `docs` prompt section
> decide subscription vs extra usage. pi-agent-dashboard `f59e34aa3` took over the
> text rewrite (Claude subscription compat switch). This package was retired:
> 0.3.5 removes the logging and is the final release; the repo is archived.
> Sections 1–10 below are the original code-reading report, kept for the record.

## 0. Live test results (2026-10-28)

About 30 small real requests with a Claude Pro/Max sign-in (pi 1.4.0, Claude Code 2.1.312,
Sonnet 5.5 and Opus 5.5). Billing read from Anthropic's response headers
(subscription `five_hour` vs extra usage).

| Change | Billed as |
|---|---|
| Plain custom tool names (`ask_user`, `kb_search`) | Subscription |
| `mcp__pi__` names (what this package does) | Subscription, no difference |
| Lowercase `read` / `bash` | Subscription, no difference |
| No billing marker (`x-anthropic-billing-header`) | Subscription; not needed |
| No "You are Claude Code…" first line | Extra usage (Sonnet and Opus) |
| Real pi, package off | Extra usage ("You're out of extra usage") |
| Real pi, package on | Subscription |
| Real pi, package off, only tool names fixed | Extra usage |
| Real pi, package off, only system text fixed | Subscription |

- The deciding lines are pi's `docs` section phrases **"pi itself"** and **"pi packages"**.
  Both must change; changing only one still bills extra usage. "pi .md files" doesn't matter.
  A short test text containing both phrases passed, so the match is on pi's specific lines,
  not the bare word.
- pi-ai already sends the identity line, so the prompt text is the only remaining gap.
- Tool renaming and `_ide` handling are unnecessary, and the renaming causes the
  mid-chat tool-removal 400 (`tool_reference_unresolved`).
- Not tested: requests through 9router; other prompt lines that may matter only with certain
  skills or extensions loaded. Re-run scripts: `probe.py`, `replay.py` (kept outside this repo).

Report date: 2026-10-28
Scope: `@blackbelt-technology/pi-anthropic-messages` 0.3.4 (latest on npm), compared with pi / pi-ai 1.4.0 and 9router 0.5.111 as installed on this machine.
Method: code reading only. No live requests were made, so nothing here has been confirmed against Anthropic's servers. Each claim says whether it was read from code or is an inference.

---

## 1. Summary

1. **The package has a security and privacy problem that should be fixed today, whatever else is decided.** It writes every request payload to `/tmp/pi-am.log` by default. The file is readable by every user on the machine, it grows by many GB per week, and the fixed path in `/tmp` can be abused with a symlink. Logging should be removed entirely, not just made opt-in.
2. **pi-ai 1.4.0 now does much of what the package was built for, but only for pi's direct Claude sign-in (OAuth).** It sends Claude Code's headers and beta flags, puts the Claude Code identity first in the system prompt, and renames 17 Claude Code tool names. It does **not** add the billing header or `metadata.user_id`, and it leaves custom tool names bare.
3. **9router has the most complete Claude Code disguise of the three.** It adds a billing header, `metadata.user_id`, an `_ide` suffix on every tool (stripped again from replies) and 20 decoy Claude Code tools. The `_ide` suffix the package works around comes from 9router, not from Anthropic.
4. **On this machine the package only does anything for the direct `anthropic` sign-in.** All 9router providers are configured with OpenAI-style APIs, so the package's gate stays closed for them.
5. **Since pi 1.0.1 (2026-10-03) the package has a functional gap on every current Claude model.** Tools added mid-conversation travel in blocks the package doesn't rewrite. Late tools go out under raw names, and removing a renamed tool refers to a name Anthropic never saw.
6. **Removing the package will not stop custom tools from working**, through pi directly or through 9router. What is unknown is **billing**: whether direct sign-in requests without the package (and without a billing header) count against the subscription or against "extra usage". One A/B test answers this (section 8).

**Recommendation:** remove the logging now and release it (0.3.5), then deprecate 0.3.2–0.3.4. Run the A/B test. Retire the package if the test passes; otherwise either route Claude through 9router or reduce the package to a thin layer on top of pi-ai (section 9).

---

## 2. Background: what the package does

It is a pi extension that hooks two events, but only for sessions whose model API is `anthropic-messages`:

```
before_provider_request  (outbound)
  • payload.tools[].name      → canonical CC name (read→Read …) or mcp__pi__<name>
  • payload.tool_choice.name  → same renaming
  • messages[].content tool_use/tool_result names → renamed, only via names seen in payload.tools
  • system text: "pi itself"/"pi .md files"/"pi packages" → "the cli …"
message_end  (inbound)
  • toolCall names mapped back to pi names, stripping a trailing "_ide"
```

Its purpose was to make pi's requests look like Claude Code, so that Anthropic would accept them on a Claude subscription instead of rejecting them or billing them as "extra usage".

Source: `extensions/index.ts`, `transform.ts`, `inbound.ts`, `core-tools.ts`.

---

## 3. Finding A: always-on payload logging (security)

| Item | Detail |
|---|---|
| Location | `extensions/index.ts`, the "TEMP DIAGNOSIS" block; `dist/index.js:69-79` in the published package |
| Behaviour | `debugLogPath = process.env.PI_ANTHROPIC_MESSAGES_DEBUG_LOG ?? "/tmp/pi-am.log"`. Writes `outbound:before` and `outbound:after` (each a full payload) on every gated request, `inbound:renamed` when tool calls are renamed, plus `load` and `activate` markers per process |
| Content | All prompts, tool outputs and file contents from every pi session |
| Permissions | Created `0644`, readable by every local user |
| Volume (reported) | ~11.5 GB in about a week; recreated within seconds of being deleted |
| Introduced | Commit `5adf042`, 2026-04-17. Present in tags v0.3.3 and v0.3.4. 0.3.2 probably affected (published tarball not checked) |

Additional risks found during review:

- **Symlink abuse.** `appendFileSync` follows symlinks. Another local user can create `/tmp/pi-am.log` pointing at any file you can write to (e.g. `~/.zshrc`), and every request then appends JSON to that file. The `ln -s /dev/null` workaround uses the same mechanism, harmlessly.
- **Pre-created file.** Another user can create the file first and own it. They then read everything, and a `0600` mode would not apply because the file already exists.
- **Logging is triggered by import.** The `load` marker is written at module top level, so anything that `import()`s the package writes to the log. The dashboard's `flows-anthropic-bridge` does that for every pi-flows agent subprocess.
- **Disabling via env is fragile.** `PI_ANTHROPIC_MESSAGES_DEBUG_LOG=""` works, but only if the variable reaches every pi process. Restarts and session keepers inherit the old environment.

**Decision already taken:** no logging at all. Delete `writeDebugLog`, all its call sites, the `node:fs` import and the README entry for the variable. Add a test that the module never imports `node:fs`.

**Cleanup for users:** delete `/tmp/pi-am.log` by hand. Until 0.3.5 is installed, `ln -s /dev/null /tmp/pi-am.log` works as a stopgap.

---

## 4. Finding B: pi-ai 1.4.0's built-in Claude Code handling

Read from `pi-ai/dist/api/anthropic-messages.js` (bundled with pi-coding-agent 1.4.0).

It activates only when the API key contains `sk-ant-oat`, i.e. pi's `/login` Claude sign-in (`isOAuthToken`). In that case:

| Behaviour | Code |
|---|---|
| Headers `user-agent: claude-cli/2.1.280`, `x-app: cli` | `createClient` |
| Betas `claude-code-20250219`, `oauth-2025-04-20` | `getBetaFeatures` |
| `system[0]` = "You are Claude Code, Anthropic's official CLI for Claude." | `buildParams` |
| Tool names: 17 CC names matched case-insensitively (`Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, EnterPlanMode, ExitPlanMode, KillShell, NotebookEdit, Skill, Task, TaskOutput, TodoWrite, WebFetch, WebSearch`); all other names unchanged | `toClaudeCodeName`, used in `convertTools`, `tool_use` history and `tool_removal` |
| Inbound: CC name mapped back to the registered pi tool (case-insensitive) | `fromClaudeCodeName` |

Not done by pi-ai:

- no `x-anthropic-billing-header` system block;
- no `metadata.user_id`;
- no prefixing of custom tools, which go out as `kb_search`, `ask_user` and so on;
- no `_ide` handling;
- nothing at all for API-key or proxy sessions.

pi-ai's renaming is **consistent everywhere**, including tools added mid-conversation, because it happens while the payload is built.

---

## 5. Finding C: 9router's Claude Code disguise

Read from minified build chunks in `9router/app/.next-cli-build/server/chunks/` (`7552.js`, `436.js`, `75924` module). Names are minified, so this is reconstructed behaviour.

| Behaviour | Where |
|---|---|
| Appends `_ide` to **every** tool name in `tools[]`, `tool_use` history and `tool_choice`; keeps a map to undo it | `7552.js`, function `h` |
| Strips `_ide` from `tool_use` names in replies (map first, then suffix strip) | `7552.js`, functions `i`/`j` |
| Adds 20 decoy CC tools (`Task…`, `Bash`, `Read`, `Edit`, `WebSearch`, …) described as "This tool is currently unavailable." | `7552.js`, list `l` |
| When the upstream token is `sk-ant-oat`: prepends `x-anthropic-billing-header: cc_version=…; cc_entrypoint=sdk-cli; cch=<hash>;` to the system prompt | `7552.js`, function `m` |
| Sets `metadata.user_id` to JSON with hashed `device_id`, `account_uuid`, `session_id` | `7552.js`, function `m` |
| Claude Code identity string; strips "Claude Agent SDK", Hermes and old billing lines from the system prompt; renames opencode | `436.js` |

Consequences:

- **The `_ide` suffix comes from 9router**, not from Anthropic's endpoint. The package's `_ide` stripping was compensating for 9router.
- **Inference (not confirmed):** the billing header and `metadata.user_id` are likely what Anthropic uses to decide subscription versus extra usage. That's why 9router fakes them. pi-ai and the package send neither.
- Not checked: exactly which 9router routes apply `h`/`m` (e.g. only the Claude OAuth executor or all Anthropic upstreams), and how 9router handles mid-conversation `tool_addition` blocks.

---

## 6. Finding D: gaps in the package itself

| # | Gap | Severity | Status |
|---|---|---|---|
| D1 | **Mid-conversation tool blocks not rewritten.** Since pi 1.0.1, models with `supportsMidConvoToolChanges` keep `payload.tools` fixed and send later tools as `tool_addition` (and removals as `tool_removal`) inside `role:"system"` messages. The package doesn't touch these, so late tools go out raw and a removal of `foo` (sent as `mcp__pi__foo`) refers to an unknown name, probably a 400 | High on current models | Read from code; 400 not reproduced |
| D2 | **History renamed only from the current tool list.** `tool_use` blocks are renamed via `nameMap`, which comes from `payload.tools` only. Calls to tools added later or removed are sent raw | Medium | Read from code |
| D3 | **Duplicate names.** `read` and an extension's `Read` both end up as `Read`; same for `foo` and `mcp__pi__foo`. Probably a 400, and the reverse map makes pi's `read` uncallable | Medium | Unverified; needs a test |
| D4 | **`edit` is inconsistent.** The package deliberately sends `edit` as `mcp__pi__edit` (pi's schema differs from CC's), but under OAuth pi-ai has already renamed it to `Edit`, which the package passes through. So the canonical `Edit` name carries pi's schema on OAuth, and `mcp__pi__edit` on proxies | Low–medium | Read from code |
| D5 | **System prompt scrubbing incomplete.** Only 3 phrases are rewritten; "operating inside pi, a coding agent harness" and mid-conversation system text go through untouched | Unknown (depends on what Anthropic checks) | Read from code |
| D6 | **Docs contradict code.** The header comment, README §Activation and comments in `core-tools.ts` / `inbound.ts` still describe the old `/claude/i` model-id check. `FORCE_CANONICAL=1` opens the gate for **every** API, not just anthropic-messages | Low | Read from code |
| D7 | **Undocumented hook use.** `message_end` mutates the message in place instead of returning `{ message }`. It works on pi 1.4.0 (`emitMessageEnd` passes the same object), but the peer range is `>=0.74.0` | Low | Read from pi source |
| D8 | **Wasted work.** Full JSON deep copy of every payload (~600 KB in the logs) even when nothing changes; a non-object payload would be replaced with `{}` | Low | Read from code |
| D9 | **No tests in CI.** No `test` script; CI and release only type-check; `smoke.test.ts` needs `tsx`, which isn't a dependency | Process | Read from repo |
| D10 | **Stale OpenSpec change.** `add-node-resolvable-entry` (1/7 tasks) targets the old package name and version 0.2.2 | Housekeeping | Read from repo |

---

## 7. Timeline

| Date | Event | Effect |
|---|---|---|
| 2026-04-17 | `5adf042` adds the `/tmp/pi-am.log` fallback | Logging in every later release |
| 2026-05-16 | Last code change under `extensions/` | Package's view of pi frozen here |
| 2026-06-18 | v0.3.4 published | Packaging only |
| 2026-09-19 | pi 0.86.0: mid-conversation system prompt and tool changes | Probably still fine (tool lists appear to have been resent whole; inferred) |
| 2026-09-29 | pi 0.99.0: built-in `tool_search`, codemode, MCP | Tools added mid-session become routine |
| **2026-10-03** | **pi 1.0.1: Anthropic tools added mid-conversation are defined inline** | **Gap D1 starts** |
| 2026-10-21 | pi 1.4.0 (installed): mid-conversation tool changes on `opus-4-8`, `opus-5`, `opus-5-5`, `sonnet-5-5`, `haiku-5-5`, `fable-5`, `fable-5-1` | Every current Claude model affected |

---

## 8. This machine's setup

From `~/.pi/agent/auth.json` and `models.json`:

| Provider | Path | API | Package active? |
|---|---|---|---|
| `anthropic` | pi sign-in (`sk-ant-oat…`) → `api.anthropic.com` | anthropic-messages | **Yes** |
| `cursor` | 9router `127.0.0.1:20128/v1`, Claude models via Cursor | openai-completions | No |
| `local` | 9router `localhost:20128/v1` | openai-responses | No |
| `ocg-free` | 9router `localhost:20128/v1` | openai-completions | No |

So the package currently only affects direct `anthropic` sign-in sessions. The Claude models under `cursor` are billed through Cursor, not the Anthropic subscription.

### Answer to "do custom tools work if I remove the package?"

| Path | Tools work? | Billing |
|---|---|---|
| Direct pi sign-in, package removed | Yes. pi-ai renames 17 CC tools and leaves custom tools bare; calls come back under the same names | **Unknown.** No billing header and bare custom names may be classified as extra usage |
| Through 9router | Yes. Removing the package changes nothing there today (gate closed); 9router does its own `_ide` round trip | Uses whatever account 9router holds; subscription only if 9router has the Anthropic sign-in token and pi uses those models |

### A/B test to settle billing

1. Use the `anthropic` sign-in provider on a current model (e.g. `sonnet-5-5`) with custom tools loaded.
2. **Run A:** `PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL=1` (package off, pi-ai only).
   **Run B:** without it (package on).
3. In each run, call a built-in tool, a custom tool, and a tool loaded via `tool_search`.
4. Record: rejected requests and their error body; whether usage lands on the subscription or "extra usage"; any `Tool X not found` errors.
5. Optional run C: the same models through 9router with the Anthropic sign-in token.

---

## 9. Options

| Option | What it means | Pros | Cons |
|---|---|---|---|
| **1. Retire the package** | Release 0.3.5 without logging, deprecate all versions, uninstall; remove the import from the dashboard's `flows-anthropic-bridge` | Least code; pi-ai maintains its own disguise | Only safe if test run A stays on the subscription |
| **2. Route Claude through 9router** | Give 9router the Anthropic sign-in, point pi at it, retire the package | Most complete disguise (billing header, `user_id`, `_ide`) | Extra local process; depends on 9router keeping up; pi talks OpenAI format to it, which may lose Anthropic-specific features (unverified) |
| **3. Thin package on top of pi-ai** | No logging; add billing header + `metadata.user_id`; prefix custom tools; rewrite `tool_addition`/`tool_removal`, all history and system messages; stop re-renaming what pi-ai already renamed; fix D3–D10 | Keeps direct sign-in and covers what pi-ai misses | Ongoing maintenance against Anthropic and pi changes; copies 9router's tricks |

### Recommended order

1. **Now:** OpenSpec change `remove-debug-logging`. Delete the logging, add a `test` script and a CI test step, release 0.3.5, `npm deprecate` 0.3.2–0.3.4, and tell users to delete `/tmp/pi-am.log`.
2. **Next:** run the A/B test (section 8).
3. **Then:** choose option 1, 2 or 3 based on the result. Option 3 would be a second change, e.g. `bridge-midconvo-tool-changes`.
4. Archive or drop `add-node-resolvable-entry`.

---

## 10. Open questions

- What exactly does Anthropic check: billing header, `metadata.user_id`, tool names, system text? A captured rejection or extra-usage request would answer this.
- Does pi talking OpenAI format to 9router lose anything for Claude (thinking, caching, mid-conversation tool changes)?
- What does the dashboard's `flows-anthropic-bridge` need from this package beyond `import()` side effects? It has to be updated if the package is retired.
- Is 0.3.2 on npm also affected by the logging? (Check the published tarball.)

---

## Appendix: evidence

| Claim | Source |
|---|---|
| Logging fallback | `extensions/index.ts` ("TEMP DIAGNOSIS"); `git log -S'"/tmp/pi-am.log"'` → `5adf042` |
| pi-ai OAuth disguise | `~/.nvm/.../pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js`: `claudeCodeTools`, `toClaudeCodeName`, `fromClaudeCodeName`, `isOAuthToken`, `createClient`, `getBetaFeatures`, `buildParams`, `convertTools`, `convertMessages` |
| Mid-conversation flags | `pi-ai/dist/providers/data/anthropic.json` |
| pi 1.0.1 inline tools | `pi-coding-agent/CHANGELOG.md`, [1.0.1] |
| `message_end` semantics | `pi-coding-agent/dist/core/extensions/runner.js` `emitMessageEnd`; `agent-session.js` `_replaceMessageInPlace` |
| 9router disguise | `9router/app/.next-cli-build/server/chunks/7552.js` (`h`, `i`, `j`, `l`, `m`), `436.js` (`_ide`, identity string, rewrite list) |
| Local providers | `~/.pi/agent/auth.json`, `~/.pi/agent/models.json` |

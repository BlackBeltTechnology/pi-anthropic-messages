# CHANGELOG

## [Unreleased]

## [0.3.1] - 2026-05-15

### Changed
- **Tracked upstream npm scope migration.** Peer dependency renamed from `@mariozechner/pi-coding-agent` (frozen at 0.73.1) to `@earendil-works/pi-coding-agent` (>=0.74.0). Upstream `pi-coding-agent` 0.74.0 moved the entire `pi-mono` workspace from `@mariozechner/*` to `@earendil-works/*` and the repo from `badlogic/pi-mono` to `earendil-works/pi-mono`. Consumers must update their own `pi-coding-agent` dependency to the new scope; the old scope will receive no further releases.

## [0.3.0]

### Changed
- **Widened the activation gate.** `isAnthropicMessagesGated` (formerly `isClaudeAnthropicMessages`) now opens for any session with `model.api === "anthropic-messages"` regardless of the model id. The historical `/claude/i` regex was silently skipping proxy providers (9Router, custom OpenAI-compatible bases, …) that route to Anthropic but report non-Claude model ids — tool dispatch broke for those sessions. See change `fix-pi-flows-end-to-end` (Group 4).
- `PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL=1` now opens the gate even when `model.api` is not `anthropic-messages`. Useful when a proxy misreports its API kind.

### Deprecated
- `isClaudeAnthropicMessages` — kept as an alias of `isAnthropicMessagesGated` for one minor release. Migrate before 0.4.x.

### Notes
- No protocol change; outbound/inbound transforms unchanged. Only the gate predicate widens.

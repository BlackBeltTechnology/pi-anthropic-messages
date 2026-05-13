# CHANGELOG

## [Unreleased]

### Changed
- **Widened the activation gate.** `isAnthropicMessagesGated` (formerly `isClaudeAnthropicMessages`) now opens for any session with `model.api === "anthropic-messages"` regardless of the model id. The historical `/claude/i` regex was silently skipping proxy providers (9Router, custom OpenAI-compatible bases, …) that route to Anthropic but report non-Claude model ids — tool dispatch broke for those sessions. See change `fix-pi-flows-end-to-end` (Group 4).
- `PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL=1` now opens the gate even when `model.api` is not `anthropic-messages`. Useful when a proxy misreports its API kind.

### Deprecated
- `isClaudeAnthropicMessages` — kept as an alias of `isAnthropicMessagesGated` for one minor release. Migrate before 0.4.x.

### Notes
- No protocol change; outbound/inbound transforms unchanged. Only the gate predicate widens.

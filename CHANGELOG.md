# CHANGELOG

## [Unreleased]

### Added

### Changed

### Fixed

## [0.3.4] - 2026-06-18

### Changed
- **Ship compiled JavaScript.** `main`/`exports`/`pi.extensions` now point to `dist/index.js` (built via `tsc -p tsconfig.build.json`, emitted on `prepack`). The package previously published raw TypeScript (`extensions/*.ts`), which a plain `import()` cannot load from `node_modules` (Node `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). This broke programmatic consumers — notably the pi-dashboard `flows-anthropic-bridge` plugin, which `await import()`s this package to forward the bridge into spawned pi-flows agent subprocesses; the failed import left the architect un-bridged ("out of extra usage"). Built JS is importable by any loader (native or jiti).

### Added
- `CHANGELOG.md` to the published tarball (`files`), so the dashboard "What's New" local fallback can read it.

## [0.3.3] - 2026-06-18

### Changed
- **Renamed npm package** from `@pi/anthropic-messages` to `@blackbelt-technology/pi-anthropic-messages`. Consumers must update their install spec and any direct `import("@pi/anthropic-messages")` to the new scope; the old name receives no further releases.

### Added
- CI workflow (type-check on push / PR) and tag-triggered Release workflow (`npm publish` + draft GitHub Release), plus `release-cut` / `release-revoke` skills.

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

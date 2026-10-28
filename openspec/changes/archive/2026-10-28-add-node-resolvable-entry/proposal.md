# Add Node-resolvable package entry

## Why

`@pi/anthropic-messages` declares `"type": "module"` and `pi.extensions` in `package.json` but no `main` or `exports` field. Pi loads the package via `pi.extensions` directly. Other packages that try `import("@pi/anthropic-messages")` or `createRequire(...).resolve("@pi/anthropic-messages")` fail with `MODULE_NOT_FOUND`.

This blocked the dashboard's `flows-anthropic-bridge-plugin`: its peer-probe couldn't resolve `@pi/anthropic-messages` even when pi had cloned the package into `~/.pi/agent/git/.../pi-anthropic-messages/`. The bridge sat in `waiting_peers` forever, so flow subagents never received the anthropic-messages hooks and Claude tool calls broke. See `pi-agent-dashboard/openspec/changes/fix-flows-anthropic-bridge-resolution/` for the cross-repo context.

## What changes

Add the standard Node entry-point fields to `package.json`, pointing at the same file `pi.extensions` already lists:

```json
{
  "name": "@pi/anthropic-messages",
  "type": "module",
  "main": "./extensions/index.ts",
  "exports": { ".": "./extensions/index.ts" },
  "pi": {
    "extensions": ["./extensions/index.ts"]
  }
}
```

`@pi/anthropic-messages`'s `default` export is `piAnthropicMessages: (pi) => Promise<void>` — the activator function the bridge plugin needs to call against each subagent's pi instance. With `exports` in place, the bridge can `import("@pi/anthropic-messages")` and call `mod.default(agentPi)` directly, as the existing README documents.

Add a `package-manifest` spec capturing the contract.

## Impact

- **Affected specs:** new `package-manifest` capability.
- **Affected code:** `package.json` only.
- **Affected consumers:**
  - `flows-anthropic-bridge-plugin` peer probe (dashboard) now resolves `@pi/anthropic-messages` from any cwd that has it reachable via `node_modules` (including symlinks).
  - The package's own README example `await import("@pi/anthropic-messages")` now works as advertised.
- **Backward compatibility:** strictly additive. Pi loads via `pi.extensions` and is unaffected.
- **Out of scope:** shipping compiled `dist/`. The `.ts` entry is fine because every pi runtime has jiti preloaded.

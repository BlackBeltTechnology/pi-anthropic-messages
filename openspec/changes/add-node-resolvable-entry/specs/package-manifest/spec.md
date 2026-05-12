# package-manifest delta

## ADDED Requirements

### Requirement: Package is Node-resolvable as an ES module

`@pi/anthropic-messages/package.json` SHALL declare `"type": "module"`, `"main": "./extensions/index.ts"`, and `"exports": { ".": "./extensions/index.ts" }`. The entry path SHALL be the same file `pi.extensions[0]` already references.

Pi's own loader SHALL continue to read `pi.extensions` and SHALL NOT depend on `main` or `exports` for its operation. The new fields exist solely so Node-style consumers can resolve the package via `require.resolve("@pi/anthropic-messages")` or `import("@pi/anthropic-messages")`.

#### Scenario: Bare-specifier import resolves

- **WHEN** a process that has `@pi/anthropic-messages` reachable in its `node_modules` chain calls `await import("@pi/anthropic-messages")`
- **THEN** the import SHALL return an object whose `default` property is the `piAnthropicMessages` activator function with signature `(pi: ExtensionAPI) => Promise<void>`.

#### Scenario: require.resolve succeeds

- **WHEN** a process calls `createRequire(...).resolve("@pi/anthropic-messages")` with the package reachable via `node_modules` (real install or symlink)
- **THEN** the call SHALL return the absolute path to `extensions/index.ts` and SHALL NOT throw `MODULE_NOT_FOUND`.

#### Scenario: Default export usable by dashboard bridge plugin

- **WHEN** the dashboard's `flows-anthropic-bridge-plugin` does `const mod = await import("@pi/anthropic-messages"); await mod.default(pi);`
- **THEN** the activator SHALL register `before_provider_request` and `message_end` hooks on `pi`
- **AND** subsequent LLM requests SHALL flow through the transform pipeline.

#### Scenario: Pi loader still works

- **WHEN** pi-coding-agent reads `~/.pi/agent/settings.json#packages[]`, finds an entry pointing at the `@pi/anthropic-messages` directory (e.g. via a GitHub URL clone), and invokes its extension-discovery code
- **THEN** the loader SHALL read `pi.extensions` (NOT `main` or `exports`) and load `./extensions/index.ts` as before. No change to existing pi loading behaviour.

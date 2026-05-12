# Tasks

- [x] 1. Add `"main": "./extensions/index.ts"` and `"exports": { ".": "./extensions/index.ts" }` to `package.json`. `"type": "module"` is already present.
- [ ] 2. Verify `require.resolve("@pi/anthropic-messages")` succeeds from any cwd that has the package in `node_modules` (real or symlinked).
- [ ] 3. Verify `await import("@pi/anthropic-messages")` from a jiti-loaded process returns an object whose `default` is the `piAnthropicMessages` activator function.
- [ ] 4. Add `package-manifest` spec capturing the contract (see `specs/package-manifest/spec.md`).
- [ ] 5. Apply the same change to the GH-cloned copy at `~/.pi/agent/git/github.com/BlackBeltTechnology/pi-anthropic-messages/package.json` for the local dev workflow (optional; production npm publishes will carry the new fields).
- [ ] 6. Update `README.md` "For package authors" section to note that the package can now be imported as a regular Node module from any jiti-aware context.
- [ ] 7. Bump version to `0.2.2`, note in CHANGELOG, republish to GitHub release tag.

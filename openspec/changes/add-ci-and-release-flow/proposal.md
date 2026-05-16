# Add CI and Release Flow

## Why

Today this repo has no automation:

- **No `.github/`** — no CI, no release workflow, no published artifacts triggered from git.
- **No tags** — `git tag -l 'v*'` is empty, yet `CHANGELOG.md` records releases up to `0.3.1` and `package.json` says `0.3.2`. Releases were cut by hand, without a git anchor, leaving no auditable correspondence between published tarballs and source commits.
- **No `npm` scripts** — no `test`, `lint`, or `build`. Pi loads `.ts` source directly via jiti; nothing currently validates that source compiles.
- **No release skills** — the OpenSpec skill set covers proposals/specs but offers no operational support for cutting or revoking releases.

The sibling repo `pi-agent-dashboard` has solved the same problems with a well-tested pattern: a small `ci.yml`, a tag-or-dispatch driven release workflow, and two `.pi/skills/` (`release-cut`, `release-revoke`) that walk an operator through promotion of `## [Unreleased]`, version bumping, tagging, push, and post-publish verification — with explicit guardrails (clean tree, on `develop`, up to date with origin, and AskUserQuestion-gated destructive operations).

Adopting that pattern here — adapted for the single-package, build-free shape of this repo — gives us:

- Reproducible releases with an auditable git tag per published version.
- A pre-merge safety net (`tsc --noEmit`) so the only file that ships actually compiles.
- An operator playbook (skills) so any future agent or human can cut/revoke a release without re-deriving the steps.

## What changes

Add four artifacts plus a small `tsconfig.json` to make CI meaningful.

### 1. `.github/workflows/ci.yml`

Runs on `push` to `develop` and on `pull_request` targeting `develop`. Steps:

```
- checkout
- setup-node 22                       (no `cache: npm` — no lockfile)
- npm install --no-audit --no-fund
- npx tsc --noEmit                    (uses repo tsconfig.json)
```

Tests and build deliberately omitted in this first cut — the repo has no `npm test` wired against `__tests__/` and there's no build (source ships as `.ts`). Wiring tests is tracked as out-of-scope work for a follow-up change.

### 2. `.github/workflows/release.yml`

Triggers: push of tag `v*`, **or** `workflow_dispatch` with a `version` input.

Two jobs:

- **prepare**
  - On tag push: extract version from `GITHUB_REF_NAME`.
  - On dispatch: validate semver, ensure tag does not yet exist on origin, run `npm version <v> --no-git-tag-version --allow-same-version`, run the CHANGELOG `[Unreleased]` → `[<version>] - <YYYY-MM-DD>` promotion via a small inline script, `git commit`, `git tag`, `git push origin develop`, `git push origin v<version>`.
  - Detect prerelease (suffix on the X.Y.Z core, e.g. `0.4.0-rc.1`) and emit `is_prerelease` output.
- **publish**
  - `npm ci`-equivalent (`npm install --no-audit --no-fund`, since there's no lockfile).
  - `npm publish --tag next` if prerelease, else `npm publish` (latest).
  - `gh release create v<version>`: title `v<version>`, body extracted from the matching CHANGELOG section, `--prerelease` if applicable, `--draft` so a human clicks Publish.

Drops from the dashboard version: workspace bump loop, `scripts/sync-versions.js`, lockfile regeneration, electron matrix (7 platform jobs), site sync, and Pages deploy.

### 3. `.pi/skills/release-cut/SKILL.md`

Adapted from `pi-agent-dashboard/.pi/skills/release-cut/SKILL.md`. Structurally identical (pre-flight → curate `[Unreleased]` → SemVer decision → promote section → bump version → commit → tag → push → post-push instructions). Diffs from the source:

| Section | Adaptation |
|---|---|
| Pre-flight: `npm test`, `npm run build` | **Removed** — neither exists. Pre-flight keeps clean-tree, on-`develop`, and up-to-date-with-origin checks. |
| Step 1: read last tag | Guard the "no tags yet" case (`git describe` fails on fresh repos) — fall back to `git log` with no base in Step 2. |
| Step 5: bump versions | Single `npm version <v> --no-git-tag-version`. No `--workspaces`, no `sync-versions.js`, no lockfile regen. |
| Step 6: commit | `git add CHANGELOG.md package.json` only. |
| Step 8: post-push | "1 npm package published, no electron, no site." |
| Package name everywhere | `@blackbelt-technology/pi-anthropic-messages`. |
| Repo URL | `BlackBeltTechnology/pi-anthropic-messages`. |

Guardrails (never auto-publish, AskUserQuestion before every destructive step, one version at a time, never force-push a tag) carry over verbatim.

### 4. `.pi/skills/release-revoke/SKILL.md`

Adapted from `pi-agent-dashboard/.pi/skills/release-revoke/SKILL.md`. Diffs:

| Section | Adaptation |
|---|---|
| Layers table | Drop the "Electron artifacts" row. |
| Step 6: npm deprecate | Package name → `@blackbelt-technology/pi-anthropic-messages`. |
| Step 8 footer | Drop the "Pages site still advertises…" note. |

Otherwise identical: select tag → inspect three layers (GitHub Release, git tag, npm) → confirm with full impact preview → `gh release delete` → `git push --delete` + `git tag -d` → `npm deprecate` (never `unpublish`) → optionally revert the release commit.

### 5. `tsconfig.json` (new, minimal)

Required for `tsc --noEmit` in CI to mean anything. Strict, ESM, NodeNext resolution, no emit, includes `extensions/**/*.ts` and `__tests__/**/*.ts`. Does not affect runtime (pi keeps loading `.ts` via jiti).

## Defaults applied (open questions from explore)

These were left open during exploration; the proposal picks the smallest defensible defaults. Each can be revisited in a follow-up change without unwinding this one.

1. **CI scope** → `tsc --noEmit` only. No vitest wiring yet.
2. **Lockfile** → none. Repo stays lockfile-free, matching current state.
3. **First-release UX** → `release-cut` skill explicitly handles "no tags yet".
4. **Branch model** → `develop` only, matching the dashboard convention. `master` is not used by either workflow. Retiring `master` is out of scope.

## Impact

- **Affected specs:** new `release-pipeline` capability — captures the contract that releases are tag-anchored, that `develop` is the integration branch, that CHANGELOG sections drive release notes, and that prereleases route to the `next` npm dist-tag.
- **Affected code:**
  - New: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.pi/skills/release-cut/SKILL.md`, `.pi/skills/release-revoke/SKILL.md`, `tsconfig.json`.
  - Unchanged: `extensions/`, `package.json` shape (no scripts added — CI calls `npx tsc` directly; release workflow calls `npm version` directly).
- **Affected consumers:** none at runtime. Pi continues to load `extensions/index.ts` exactly as before. Downstream npm consumers see the same tarball contents; the only externally visible change is the appearance of `v*` git tags and GitHub Releases starting from the next cut.
- **Backward compatibility:** strictly additive. No existing file is modified except by the operator running the `release-cut` skill (and only when they intend to cut a release).
- **Out of scope:**
  - Wiring `vitest` against `__tests__/` (separate change).
  - Adding a build step that produces `dist/` (separate change; would require coordinating with the `package-manifest` capability since `main` currently points at `.ts`).
  - Retiring the `master` branch and switching `origin/HEAD`.
  - Backfilling tags for already-published versions (`0.1.x` … `0.3.2`). The first tag cut by the new workflow will be the next version.
  - Any docs site, release-notes-footer, or auto-deploy.

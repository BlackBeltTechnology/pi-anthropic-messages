---
name: release-cut
description: >
  Cut a new pi-anthropic-messages release. Promotes `## [Unreleased]` in
  CHANGELOG.md to a versioned section, bumps `package.json`, commits,
  tags `v<version>`, and pushes — which triggers the Release workflow
  that publishes `@blackbelt-technology/pi-anthropic-messages` to npm
  and creates a draft GitHub Release. Use when the user says
  "cut a release", "release vX.Y.Z", "publish a new version",
  "tag a release".
license: MIT
metadata:
  author: pi-anthropic-messages
  version: "1.0"
---

# Cut a pi-anthropic-messages Release

This skill automates the local half of the release: CHANGELOG promotion,
version bump, commit, tag, push. It **stops before publishing** — the
`release.yml` workflow on GitHub runs npm publish and creates a draft
GitHub Release, and the human clicks Publish.

This repo is a **single npm package, no build, no electron, no site**.
The release shape is much simpler than `pi-agent-dashboard`'s — no
workspaces to sync, no lockfile to regenerate.

## Pre-flight (MUST pass before touching anything)

Run these in order. If any fails, **stop and report** — do not continue.

1. **Clean working tree**
   ```bash
   git status --porcelain
   ```
   Must be empty. If not, ask the user to commit or stash.

2. **On the release branch**
   ```bash
   git rev-parse --abbrev-ref HEAD
   ```
   Must be `develop`. If elsewhere, ask user to confirm before continuing.

3. **Up to date with origin**
   ```bash
   git fetch origin && git status -sb
   ```
   Branch must NOT be "behind". If behind, ask user to pull first.

4. **Type-check passes**
   ```bash
   npm install --no-audit --no-fund --no-save && npx tsc --noEmit -p tsconfig.json
   ```
   Must exit 0. This is the same gate CI enforces.

If any pre-flight step fails, stop and surface the exact error to the user.

> **Note:** `npm test` and `npm run build` are intentionally not part of
> pre-flight. The repo has no tests wired and no build (source ships as
> `.ts`). If either is added in the future, add it here.

## Step 1 — Read current state

```bash
git describe --tags --abbrev=0 2>/dev/null || echo "NO_TAGS_YET"
node -p "require('./package.json').version"
```

Three cases:

- **Tags exist and match `package.json`** (e.g. tag `v0.4.0` ↔ pkg
  `0.4.0`): normal case, proceed.
- **Tags exist but diverge from `package.json`**: surface the mismatch
  and ask the user how to proceed.
- **No tags yet** (`NO_TAGS_YET`): this is the first cut under the new
  pipeline. Earlier versions in `CHANGELOG.md` (e.g. `0.3.1`, `0.3.2`)
  were released without git tags. Proceed; in Step 2 use plain
  `git log --oneline` instead of `git log <last-tag>..HEAD`.

## Step 2 — Curate `## [Unreleased]`

1. List commits since the last release anchor:
   ```bash
   # With tags:
   git log <last-tag>..HEAD --oneline
   # First cut, no tags yet:
   git log --oneline | head -50
   ```
2. Read `CHANGELOG.md` and extract the current `## [Unreleased]` section.
3. Cross-check: every `feat:` / `fix:` commit should have a corresponding
   user-visible bullet under Added / Changed / Fixed.
4. If gaps exist, **use AskUserQuestion** to list missing items and
   confirm whether the user wants to add them now. If yes, draft bullets
   in end-user language (not commit-subject shorthand) and insert them.
5. Never invent behaviour — only summarise what the commits actually did.

## Step 3 — Decide next version (SemVer)

Propose per this decision tree, then **use AskUserQuestion to confirm**:

| `## [Unreleased]` contains                         | Bump    |
|----------------------------------------------------|---------|
| Any breaking change / removal (call it out)        | major   |
| Any `### Added` bullet (new user-visible feature)  | minor   |
| Only `### Fixed` / `### Changed` internals         | patch   |

Current version `X.Y.Z` → propose `X.(Y+1).0` for minor, etc.
**Do NOT auto-select** — always ask the user to confirm the target version
(offer the proposal as default).

For prereleases, append a SemVer suffix (e.g. `0.5.0-rc.1`). The Release
workflow will publish prereleases under the npm `next` dist-tag and mark
the GitHub Release as a prerelease.

## Step 4 — Promote `## [Unreleased]` → versioned section

In `CHANGELOG.md`:

1. Rename `## [Unreleased]` to `## [<version>] - <YYYY-MM-DD>` (use
   today's date from `date +%Y-%m-%d`, no leading `v`).
2. Insert a fresh empty `## [Unreleased]` section **above** it:

   ```markdown
   ## [Unreleased]

   ### Added

   ### Changed

   ### Fixed

   ## [<version>] - <YYYY-MM-DD>
   ...existing bullets...
   ```

Verify afterwards with:
```bash
grep -n "^## " CHANGELOG.md | head
```

The Release workflow extracts the body of `## [<version>]` verbatim as
the GitHub Release notes. If this section is empty or missing, publish
fails — don't ship an empty changelog.

## Step 5 — Bump `package.json` version

```bash
npm version <version> --no-git-tag-version --allow-same-version
```

Single package, no workspaces, no lockfile to regenerate. Verify:
```bash
git diff --stat package.json CHANGELOG.md
```

Should show two files changed: the version bump in `package.json` and
the CHANGELOG promotion. No other files.

## Step 6 — Commit

```bash
git add CHANGELOG.md package.json
git commit -m "chore(release): v<version>"
```

**Use AskUserQuestion (confirm)** before committing — show the user the
exact message + file list.

## Step 7 — Tag and push

```bash
git tag v<version>
git push origin develop
git push origin v<version>
```

**Use AskUserQuestion (confirm)** before pushing. Surface this warning:
pushing the tag triggers the Release workflow immediately. Reverting
requires `git push --delete origin v<version>` + re-tag (see the
`release-revoke` skill).

> Alternatively, if the maintainer prefers, skip Steps 5–7 locally and
> instead run the Release workflow's `workflow_dispatch` with the
> version input — the workflow performs the same bump-commit-tag-push
> on the runner. This skill defaults to local-first because it keeps
> the operator in the loop on the CHANGELOG curation.

## Step 8 — Post-push instructions (print to user)

Give the user this summary:

```
✅ Tag v<version> pushed.

Next steps (human):
1. Watch CI:  https://github.com/BlackBeltTechnology/pi-anthropic-messages/actions
   The Release workflow will:
     • publish @blackbelt-technology/pi-anthropic-messages to npm
       (latest dist-tag for stable, next for prereleases)
     • create a DRAFT GitHub Release with notes extracted from the
       CHANGELOG [<version>] section
2. Open the draft release:
   https://github.com/BlackBeltTechnology/pi-anthropic-messages/releases
3. Verify the body matches the CHANGELOG section and that the release
   is marked prerelease if and only if <version> has a `-` suffix.
4. Click "Publish release".

If something is wrong, see `.pi/skills/release-revoke/SKILL.md`.
```

## Guardrails

- **Never skip pre-flight.** A failing type-check or dirty tree means
  the release is not ready.
- **Never auto-publish.** The workflow stops at the draft release; the
  skill stops at `git push`. Two checkpoints, both human-gated.
- **Never force-push a tag.** If the tag already exists on origin,
  surface the conflict and hand off to the revoke skill.
- **One version at a time.** If the user asks to release two versions
  in a row, run this skill twice.
- **Never invoke `npm publish` directly.** That's the workflow's job —
  doing it locally bypasses the audit trail (which CI run published
  which tag) and the prerelease/dist-tag handling.

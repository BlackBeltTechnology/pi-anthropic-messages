# Release Pipeline

The release pipeline governs how `@blackbelt-technology/pi-anthropic-messages` source on `develop` becomes a published npm tarball plus a GitHub Release.

## ADDED Requirements

### Requirement: Releases anchored to a `v<semver>` git tag

Every published version of `@blackbelt-technology/pi-anthropic-messages` SHALL correspond to exactly one annotated tag of the form `v<MAJOR>.<MINOR>.<PATCH>[-<prerelease>]` on the `BlackBeltTechnology/pi-anthropic-messages` repository. The tag commit MUST be the source of truth for the contents of the published tarball; the publish workflow SHALL refuse to run if a requested version tag already exists on origin or if its CHANGELOG section is missing.

#### Scenario: Tag push triggers publish

- **GIVEN** a maintainer pushes `vX.Y.Z` to origin
- **WHEN** the `release.yml` workflow runs
- **THEN** it publishes `@blackbelt-technology/pi-anthropic-messages@X.Y.Z` to npm from that tag's commit, and creates a draft GitHub Release titled `vX.Y.Z`.

#### Scenario: Workflow dispatch creates the tag

- **GIVEN** a maintainer triggers `release.yml` via `workflow_dispatch` with input `version=X.Y.Z`
- **WHEN** the `prepare` job runs
- **THEN** it bumps `package.json` to `X.Y.Z`, promotes the `## [Unreleased]` CHANGELOG section to `## [X.Y.Z] - <today>`, commits `chore(release): vX.Y.Z`, tags `vX.Y.Z`, and pushes both the branch and the tag — after which the publish job runs against the freshly-pushed tag.

#### Scenario: Tag already exists

- **GIVEN** `vX.Y.Z` already exists on origin
- **WHEN** a maintainer triggers `workflow_dispatch` with `version=X.Y.Z`
- **THEN** the `prepare` job fails with an explicit `::error::` message and does not commit, tag, or publish anything.

---

### Requirement: `develop` is the only integration branch the workflows trust

CI and release automation SHALL run against `develop` only. Pushes and pull requests on other branches MUST NOT be gated by this pipeline and MUST NOT produce releases. The `workflow_dispatch` path of the release workflow SHALL push its version-bump commit and tag to `develop` exclusively.

#### Scenario: CI scope

- **GIVEN** a push or pull request targets `develop`
- **WHEN** `ci.yml` runs
- **THEN** it executes `tsc --noEmit` and fails the job if compilation reports any errors.

#### Scenario: Dispatch source

- **GIVEN** a `workflow_dispatch` of `release.yml`
- **WHEN** `prepare` commits and pushes the version bump
- **THEN** it pushes to `develop` (never `master` or any feature branch).

---

### Requirement: Release notes derived from `CHANGELOG.md`

The body of each GitHub Release SHALL be extracted verbatim from the matching `## [<version>]` section of `CHANGELOG.md` at the tagged commit. The pipeline MUST NOT generate notes from commit messages, and MUST fail explicitly when the expected CHANGELOG section is absent rather than creating a release with empty or fabricated notes.

#### Scenario: CHANGELOG section present

- **GIVEN** `CHANGELOG.md` at the tagged commit contains a `## [X.Y.Z] - YYYY-MM-DD` section with bullets
- **WHEN** the `publish` job creates the GitHub Release
- **THEN** the release body is exactly the content of that section (excluding the heading line itself).

#### Scenario: CHANGELOG section missing

- **GIVEN** `CHANGELOG.md` has no `## [X.Y.Z]` section at the tagged commit
- **WHEN** the `publish` job runs
- **THEN** it fails with an explicit error rather than creating a release with empty or fabricated notes.

---

### Requirement: Prereleases publish under the `next` npm dist-tag

Any version whose SemVer core (`MAJOR.MINOR.PATCH`) is followed by a `-` suffix (e.g. `0.4.0-rc.1`, `1.0.0-beta.2`) SHALL be classified as a prerelease and published with `npm publish --tag next`, and its GitHub Release MUST be marked `--prerelease`. Stable versions (no `-` suffix) SHALL publish under the default `latest` dist-tag and produce a non-prerelease GitHub Release.

#### Scenario: Prerelease classification

- **GIVEN** the resolved version is `X.Y.Z-<suffix>`
- **WHEN** the `publish` job runs `npm publish`
- **THEN** it passes `--tag next`, and the GitHub Release is created with `--prerelease`.

#### Scenario: Stable classification

- **GIVEN** the resolved version is `X.Y.Z` with no suffix
- **WHEN** the `publish` job runs `npm publish`
- **THEN** it does not pass `--tag` (npm defaults to `latest`), and the GitHub Release is created without `--prerelease`.

---

### Requirement: A human approves every release before it goes live

The publish workflow SHALL create GitHub Releases in draft state (`--draft`) and MUST NOT publish them programmatically. A maintainer MUST review the auto-attached notes and click Publish to make the release visible. npm publishing is irrevocable within 72h and is accepted as the harder commitment; the draft GitHub Release is the safety net for narrative review, not for npm rollback.

#### Scenario: Draft creation

- **GIVEN** the `publish` job has successfully published to npm
- **WHEN** it creates the GitHub Release
- **THEN** it passes `--draft`, and the release is not visible on the public Releases page until a human edits and publishes it.

#### Scenario: npm publish is not draftable

- **GIVEN** npm publishing is irrevocable within 72h and version numbers are permanently burned
- **THEN** the pipeline accepts that npm is the harder commitment and the GitHub Release draft is the safety net for narrative/notes review, not for npm rollback.

---

### Requirement: Operator skills for cut and revoke

The repo SHALL provide `.pi/skills/release-cut/SKILL.md` and `.pi/skills/release-revoke/SKILL.md` as the canonical operator interface for the release pipeline. Each skill MUST gate every destructive operation (commit, tag push, `gh release delete`, `npm deprecate`, revert) behind an explicit `AskUserQuestion` confirmation, MUST NOT invoke `npm publish` directly (that is the workflow's job), and MUST NEVER call `npm unpublish` — botched releases are revoked via `npm deprecate`.

#### Scenario: Cutting a release

- **GIVEN** an operator says "cut a release" or invokes the `release-cut` skill
- **WHEN** the skill runs
- **THEN** it executes pre-flight (clean tree, on `develop`, up to date with origin), curates `## [Unreleased]`, proposes a SemVer bump with `AskUserQuestion`, promotes the CHANGELOG section, bumps `package.json`, commits, tags, and pushes — pausing for explicit confirmation before each destructive operation, and never invoking `npm publish` directly (the workflow does that).

#### Scenario: Revoking a release

- **GIVEN** an operator says "revoke release vX.Y.Z" or invokes the `release-revoke` skill
- **WHEN** the skill runs
- **THEN** it inspects the three independent layers (GitHub Release, git tag, npm), presents a full impact preview, deletes the release and tag on confirmation, runs `npm deprecate` (never `npm unpublish`), and optionally reverts the `chore(release): vX.Y.Z` commit — with each step gated by `AskUserQuestion`.

#### Scenario: First release on a tagless repo

- **GIVEN** the repo has no `v*` tags yet
- **WHEN** the `release-cut` skill runs Step 1 (read last tag)
- **THEN** it detects the absence of prior tags and proceeds, using `git log` without a base for Step 2's commit summary instead of failing on `git describe`.

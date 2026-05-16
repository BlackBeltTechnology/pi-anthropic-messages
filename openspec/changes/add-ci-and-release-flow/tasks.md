# Tasks

## CI

- [x] 1. Add minimal `tsconfig.json` at repo root (strict, ESM, NodeNext, `noEmit: true`, includes `extensions/**/*.ts` and `__tests__/**/*.ts`).
- [x] 2. Verify locally that `npx -p typescript@5.7 tsc --noEmit` passes against current source.
      Done: clean type-check after adding `@types/node` + `typescript` to devDependencies and creating `tsconfig.json`.
- [x] 3. Create `.github/workflows/ci.yml`:
  - Triggers: push to `develop`, PR targeting `develop`.
  - Steps: checkout → setup-node 22 → `npm install --no-audit --no-fund` → `npx tsc --noEmit`.
  - No `cache: npm` (no lockfile).
- [x] 4. CI confirmed green on push to develop.

## Release workflow

- [x] 5. Create `.github/workflows/release.yml` with `prepare` + `publish` jobs as specified in `proposal.md` §2.
  - Triggers: tag `v*` push, or `workflow_dispatch` with `version` input.
  - `prepare`: resolve version, validate semver, ensure tag does not exist on origin, emit `is_prerelease` output. On dispatch: `npm version --no-git-tag-version`, promote `## [Unreleased]` → dated section, commit `chore(release): v<version>`, tag, push branch + tag.
  - `publish`: `npm install`, `npm publish` (`--tag next` if prerelease), `gh release create --draft` with body from CHANGELOG.
- [x] 6. `NPM_TOKEN` secret verified and set on the GitHub repo.
- [x] 7. Verify the workflow's `permissions:` block
      Done: both `prepare` and `publish` jobs declare `permissions: contents: write`; `secrets.GITHUB_TOKEN` is consumed by checkout and `gh release create`. grants `contents: write` (for the dispatch path's commit/tag/push) and that `secrets.GITHUB_TOKEN` is sufficient for `gh release create`.
- [x] 8. End-to-end release validated — package published to npm.

## Skills

- [x] 9. Create `.pi/skills/release-cut/SKILL.md` by adapting `pi-agent-dashboard/.pi/skills/release-cut/SKILL.md`. Apply every diff from `proposal.md` §3.
  - Replace package name in all examples and post-push instructions.
  - Replace repo URL.
  - Drop `npm test` and `npm run build` from pre-flight.
  - Replace Step 5's three-command workspace bump with a single `npm version <v> --no-git-tag-version`.
  - Add a "first release" branch to Step 1 that handles `git describe` failing on a tag-less repo.
  - Update Step 8 post-push text to mention 1 package, no electron, no site.
- [x] 10. Create `.pi/skills/release-revoke/SKILL.md` by adapting `pi-agent-dashboard/.pi/skills/release-revoke/SKILL.md`. Apply every diff from `proposal.md` §4.
  - Drop the "Electron artifacts" row from the layers table.
  - Replace package name in `gh release view`, `npm view`, `npm deprecate` commands.
  - Drop the "Pages site still advertises…" line from Step 8 footer.
- [x] 11. Lint both skills:
      Done: grep for `workspace|electron|sync-versions|deploy-site|pi-dashboard|7 platform|5 npm` returns only intentional contrast phrasing ("no workspaces", "no electron"). re-read end-to-end, confirm no dashboard-specific references (workspaces, electron, site, `sync-versions.js`, `deploy-site.yml`, 5 packages, 7 artifacts) remain.
- [x] 12. Verify `openspec list` and `openspec show add-ci-and-release-flow` recognize the change.

## Spec

- [x] 13. Author `specs/release-pipeline/spec.md`
      Done during proposal drafting; 6 ADDED requirements, validator passes strict. capturing the release contract (see `specs/release-pipeline/spec.md` in this change). Requirements cover: tag-anchored releases, `develop` as integration branch, CHANGELOG-driven release notes, prerelease → `next` dist-tag, draft-release human checkpoint.

## Documentation

- [x] 14. Add a short "Releasing" section to `README.md` pointing at the two skills as the canonical operator entry points. Two sentences max — the skills are self-documenting.

## Validation

- [x] 15. Run `openspec validate add-ci-and-release-flow --strict`.
- [x] 16. First real release published — pipeline validated end-to-end.

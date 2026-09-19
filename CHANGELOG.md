# Changelog

All notable changes to the reusable workflows. This repo follows the versioning policy in
[README.md](README.md#versioning-policy): `v1` is a moving major tag, every change also gets an
immutable `v1.x.y` tag.

## [Unreleased]

### Added

- `package-ci.yml` and `package-release.yml`: input `extra`, a JSON array of project scripts.
  Each runs as its own job after a build, on pull requests and on the release path.
- `package-ci.yml`: `build` and `preview` seed `package.json` from the latest `v*` tag when it
  has no `version`, for packages that keep the version in tags only.
- `setup` keeps a thin caller that differs from the template, and no longer needs a `version`
  in `package.json` for a package that is already on npm.
- `package-ci.yml`: job `preview` publishes every pull request commit to pkg.pr.new, and the
  new input `preview` (default `true`) turns it off. Needs the pkg.pr.new GitHub App.
- `package-ci.yml`: the `lint` job fails when `package.json` depends on a `pkg.pr.new` URL.
- `doctor` check `preview-deps`: the same rule locally, blocking in the release preflight.

### Fixed

- `moku-release release` watched the run of the release before when GitHub had not listed the
  new run yet. It now remembers the newest run before the dispatch and waits for a different one.
- The registry wait is ten minutes instead of two; the first live release needed three.
- `doctor` fetches tags before it compares them with npm. Right after a release it reported
  "npm is AHEAD of the tag" because the tag cut by CI was not local yet.

### Docs

- `v1` must be a lightweight tag (an annotated one breaks the nested `./` workflow call).
- The cross-repo OIDC publish is verified.

### Added

- `moku-release` CLI (`setup`, `doctor`, `<patch|minor|major|prerelease>`), published as
  `@moku-labs/ci`. Moved here from moku-labs/common#4. It reads `examples/package/*.yml` and
  `rulesets/main.json` from its own package instead of carrying string copies.
- `ci.yml` and `publish.yml`: this repository calls its own reusable workflows.

## [1.0.0] — 2026-09-19

Initial extraction. Consolidates seven drifted copies of `ci.yml` and six of `publish.yml`
into one central set of reusable workflows.

### Added

- `package-ci.yml` — reusable check suite (`lint`, `types`, `test`, `build` + `validate`),
  calling only the seven-script project contract.
- `package-release.yml` — reusable `check → release → package → publish` pipeline: tag-only
  release on a protected `main`, split package/publish jobs, tokenless OIDC Trusted Publishing.
  Inputs include `publish` (false = publish from a local job in the caller); outputs `tag`,
  `version`, `prev_tag`, `artifact_name`.
- `app-deploy.yml` — reusable validate + Cloudflare deploy for Layer-3 apps, with explicit
  `secrets:` and script-name inputs.
- `self-test.yml` — actionlint over this repo's workflows and examples.
- `examples/package/{ci,publish}.yml`, `examples/package/publish.local-publish.yml` (fallback
  for the cross-repo OIDC risk), `examples/app/ci.yml`.
- `rulesets/main.json` — branch ruleset payload with the reusable-workflow status-check names
  (`ci / lint`, …).

### Notes

- Every third-party action is SHA-pinned to the same SHAs the `worker` reference used.
- No `NPM_TOKEN`, no `npm install -g npm`.
- Known open risk (README → "Known risk"): npm's acceptance of a publish executed inside a
  reusable workflow owned by another repository is unverified.

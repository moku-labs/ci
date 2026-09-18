# Changelog

All notable changes to the reusable workflows. This repo follows the versioning policy in
[README.md](README.md#versioning-policy): `v1` is a moving major tag, every change also gets an
immutable `v1.x.y` tag.

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

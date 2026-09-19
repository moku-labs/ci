# Release engineering notes

The long form behind the [README](../README.md): the one open risk, every trap the workflows
already handle, and the manual first publish. Read it when a release fails, not before.

## Known risk: OIDC identity of a cross-repo publish

npm Trusted Publishing validates the workflow identity in the OIDC token. When the publish step
runs inside a reusable workflow owned by **another** repository, the token carries two claims:

| claim              | points at                                       |
| ------------------ | ----------------------------------------------- |
| `workflow_ref`     | `<owner>/<repo>/.github/workflows/publish.yml`   |
| `job_workflow_ref` | `moku-labs/ci/.github/workflows/package-release.yml` |

**npm accepts that combination: verified on 2026-09-19 by `@moku-labs/ci@1.1.1`** (run `35423961348`, provenance published). The text below is kept for the day that changes. Before that release it read: whether npm accepts that combination is unverified. npm documents matching on the workflow
filename you register; which of the two claims it matches is what decides it. The first real
release through this repo is the experiment.

**If the publish job fails auth** (and only then), switch that package to the fallback: copy
`examples/package/publish.local-publish.yml` over its `publish.yml`. It keeps check / release /
package central, passes `publish: false`, and runs a ~35-line `npm publish` job locally, so
`job_workflow_ref` points back at the package's own `publish.yml`. Nothing else changes; the
tarball is consumed from the central workflow's `artifact_name` output.

Do not pre-emptively switch everything to the fallback — the whole point is one copy of the
logic. Try the central path first on one package (`system` is the lowest-traffic), then decide.

## Gotchas encoded in these workflows

Each line: symptom → cause → what the workflow does.

- **Reusable workflow never starts, run shows 0 jobs** → the caller's `concurrency` group equals
  the group the called workflow computes (both resolve `github.workflow` to the caller), so the
  parent holds the slot while the child waits → `package-ci.yml` owns the group
  `${{ github.workflow }}-<ref>`, `package-release.yml` sets none, and the `publish.yml` caller
  uses a distinct literal `publish-<ref>`.
- **A push to main cancels a release's checks** → one shared concurrency group for CI and release
  → the group is scoped by `github.workflow`, so `CI-<ref>` and `Release-<ref>` never collide.
- **`npm version patch` finalizes an rc instead of bumping, then the tag already exists** → a
  stray prerelease tag sorted highest and became the base → `git -c versionsort.suffix='-'`
  ranks prereleases below their release.
- **Release notes repeat every past PR** → each version tag sits on a bump commit that is not an
  ancestor of the next, so `--generate-notes` cannot auto-detect the base → the previous tag is
  passed explicitly via `--notes-start-tag`.
- **An rc shows up as the repo's "Latest release"** → GitHub defaults to latest-by-date → a tag
  containing `-` gets `--prerelease --latest=false`.
- **A prerelease overwrites the `latest` dist-tag on npm** → publishing without `--tag` →
  a `-` in the version publishes to `next`.
- **Release job dies pushing to a protected `main`** → it tried to commit the version bump →
  the bump is committed locally and only `refs/tags/<tag>` is pushed; `package.json` `version`
  on main is informational, the tag and npm are the truth.
- **`npm pack --pack-destination dist-pack` fails ENOENT** → npm does not create the directory →
  `mkdir -p dist-pack` first.
- **`npm publish dist-pack/foo.tgz` tries `git ls-remote`** → npm parses a bare path as an
  `owner/repo` spec → the leading `./` is mandatory.
- **A dependency's postinstall runs with the publish credential in scope** → build and publish in
  one job → `package` (no `id-token`) builds and uploads the tarball; `publish` (`id-token: write`)
  only downloads and publishes.
- **Publish fails auth on a fresh runner** → npm older than 11.5.1 has no Trusted Publishing →
  the floor is asserted fail-closed against the npm bundled with Node 24; never
  `npm install -g npm@latest` next to a credential.
- **A dispatch publishes the OLD code under a NEW version** → the workflow releases from
  `origin/main` at run time, not from your tree → confirm the PR is **merged** and
  `HEAD == origin/main` before dispatching, then verify the tarball's contents, not just its
  version number.
- **A skipped `release` job falls through and publishes an empty version** → `always()` gating →
  the publish step fails closed on an empty ref and on a `package.json`/ref mismatch.
- **Script injection via a workflow input** → `${{ }}` interpolated into a shell → every input,
  tag and ref goes through `env:` and is read as `$VAR`.
- **Secrets are empty inside the called workflow** → reusable workflows do not inherit secrets →
  `app-deploy.yml` declares them under `secrets:` and the caller passes each one explicitly.
- **`permissions` in the called workflow are ignored** → a called workflow can never elevate →
  the caller's job grants `contents: write` + `id-token: write` as the ceiling.

Longer form, with the reasoning: `moku-labs/claude` →
`skills/moku-core/references/ci-release.md`.

## First-time npm setup (per package, once)

Trusted Publishing cannot be configured for a package that does not exist yet, so the first
publish is manual: `bun run build && npm publish --access public` (no provenance — expected),
then `git tag vX.Y.Z && git push origin vX.Y.Z`, then npmjs.com → package → **Settings → Trusted
Publisher → GitHub Actions** with **Workflow filename `publish.yml`** and a blank environment.
`package.json` `repository.url` must match the repo or provenance publishing fails `E422`.

**Never add an `NPM_TOKEN`.** Publishing here is tokenless OIDC; a token-based publish is both
exfiltratable and incompatible with provenance + Trusted Publishing. If you find one in a repo,
delete it.

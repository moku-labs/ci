<div align="center">

# @moku-labs/ci

**One CI and release pipeline for every moku package.**

Reusable GitHub workflows pinned by tag, plus the `moku-release` CLI that installs them
into a project and runs a release. A project keeps two 20-line files and seven scripts;
everything else lives here, once. Not a build tool and not a framework — it calls your
`package.json` scripts and never the tools behind them.

<br/>

[![npm](https://img.shields.io/npm/v/@moku-labs/ci?logo=npm&color=cb3837&label=npm)](https://www.npmjs.com/package/@moku-labs/ci)
[![self test](https://github.com/moku-labs/ci/actions/workflows/self-test.yml/badge.svg)](https://github.com/moku-labs/ci/actions/workflows/self-test.yml)
[![workflows](https://img.shields.io/badge/workflows-%40v1-1864ab)](#versioning)
[![node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](#requirements)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

<br/>

[Install](#install) ·
[How it works](#how-it-works) ·
[Workflows](#workflows) ·
[Project checks](#project-checks) ·
[PR previews](#pr-previews) ·
[CLI](#cli) ·
[The contract](#the-contract) ·
[Versioning](#versioning) ·
[Scripts](#scripts)

</div>

---

## Install

```sh
bun add -d @moku-labs/ci
bun run release:setup
```

`setup` writes the two workflow files, adds the missing scripts, does the first publish,
registers the trusted publisher and applies the branch ruleset. Run it again any time — it
only does what is still missing.

> [!NOTE]
> **Status: `1.x`, in use.** All eight moku packages — `core`, `common`, `web`, `worker`, `room`,
> `system`, `ai`, `native` — run `package-ci.yml` and `package-release.yml` from `@v1`, and each
> has shipped a tokenless release with provenance through them. `moku-release setup` did every
> one of those migrations live, including two first publishes behind 2FA.
> `app-deploy.yml` has no live user yet.

> [!IMPORTANT]
> Two steps are yours alone. The CLI never handles a credential, and there is no `NPM_TOKEN`
> anywhere — publishing is tokenless OIDC.
>
> ```sh
> gh auth login
> npm login
> ```

## Why @moku-labs/ci

- **One copy of the pipeline.** Eight packages had eight different `ci.yml` and eight different
  `publish.yml`. A fix now lands here and reaches every project through the `@v1` tag.
- **Scripts are the interface, not tools.** The workflows call `bun run lint`, never `biome`.
  A project with special needs changes its own script, not the central YAML.
- **The CLI and its templates are one package.** `moku-release` reads `examples/` and
  `rulesets/` from its own install. There is no second copy to drift.
- **No tokens.** npm Trusted Publishing with `id-token: write`. Build and publish run in
  separate jobs, so no dependency's postinstall ever sees the credential.
- **Not a dependency of your app.** A dev dependency with zero runtime dependencies of its
  own, so even `@moku-labs/core` can use it without a cycle.

## How it works

```mermaid
flowchart LR
  P["your project<br/>ci.yml · publish.yml<br/>7 scripts"] -->|"uses: …@v1"| W["moku-labs/ci<br/>reusable workflows"]
  C["moku-release<br/>setup · doctor · release"] -->|writes| P
  C -->|dispatches| W
  W --> N["checks on the PR<br/>tag · GitHub release · npm"]
  classDef u fill:#0b7285,stroke:#08525f,color:#fff;
  classDef m fill:#1864ab,stroke:#0d3d6e,color:#fff;
  class P,N u
  class W,C m
```

1. `release:setup` writes two thin callers into `.github/workflows/`.
2. Every PR runs `package-ci.yml`: four jobs, reported as `ci / lint`, `ci / types`,
   `ci / test`, `ci / build`.
3. `release patch` dispatches `publish.yml`, which calls `package-release.yml`:
   check → tag → pack → publish. The CLI watches the run and verifies the version on npm.

## Workflows

| Workflow | Called from | Jobs | Inputs (all optional) |
|---|---|---|---|
| [`package-ci.yml`](.github/workflows/package-ci.yml) | [`examples/package/ci.yml`](examples/package/ci.yml) | `lint` · `types` · `test` · `build` · `extra` · `preview` | `runs_on`, `bun_version`, `validate`, `preview`, `extra` |
| [`package-release.yml`](.github/workflows/package-release.yml) | [`examples/package/publish.yml`](examples/package/publish.yml) | `check` → `release` → `package` → `publish` | `release_type`, `publish`, `runs_on`, `bun_version`, `node_version`, `artifact_name`, `validate`, `extra` |
| [`app-deploy.yml`](.github/workflows/app-deploy.yml) | [`examples/app/ci.yml`](examples/app/ci.yml) | `validate` → `deploy` to Cloudflare | script names (`lint_script`, `build_script`, `deploy_script`, …) and two required secrets |
| [`self-test.yml`](.github/workflows/self-test.yml) | this repo only | `actionlint` over workflows and examples | — |

`package-release.yml` outputs `tag`, `version`, `prev_tag` and `artifact_name`.

| Other file | What it is |
|---|---|
| [`examples/package/publish.local-publish.yml`](examples/package/publish.local-publish.yml) | Fallback: publish from the project's own job. Use it only if the central publish fails npm auth. |
| [`rulesets/main.json`](rulesets/main.json) | Branch ruleset for `main`: PR only, no force-push, the four `ci / …` checks required. |

> [!TIP]
> A Layer-3 app copies `examples/app/ci.yml` by hand and needs a `deploy` script. The CLI
> sets up packages only.

## Project checks

A check the five contract scripts do not cover goes in `extra`: a JSON array of script names.
Each one is its own job, run after a build, and reported as `ci / extra (check:bundle)`.

```yaml
# .github/workflows/ci.yml
jobs:
  ci:
    uses: moku-labs/ci/.github/workflows/package-ci.yml@v1
    with:
      extra: '["check:bundle", "test:cli-e2e"]'
```

| Rule | Where |
|---|---|
| Give `publish.yml` the same `extra`, so a release waits for the same checks. | caller `publish.yml` |
| `setup` never replaces a thin caller that differs from the template. | `moku-release setup` |
| An `extra` job is not a required check until the ruleset of that repo names it. | repo ruleset |
| A check that needs its own matrix or a cron stays a separate workflow file. `doctor` and `setup` only look at `ci.yml` and `publish.yml`. | the project |

A package may keep its version in git tags only. `build` and `preview` then seed
`package.json` from the latest `v*` tag before they pack. Nothing is committed.

## PR previews

Every pull request commit is published to [pkg.pr.new](https://pkg.pr.new) by the `preview`
job. Nothing reaches npm and no token is in scope. The bot comments the install command on
the PR.

```sh
bun add https://pkg.pr.new/@moku-labs/core@42   # 42 = PR number, a commit sha works too
```

| Rule | Where |
|---|---|
| The [pkg.pr.new GitHub App](https://github.com/apps/pkg-pr-new) must be installed on the repo. | once per org |
| The package repo must be public. The consuming project may be private. | pkg.pr.new |
| A preview URL never reaches `main`: the `lint` job and `doctor` both refuse it. | `package-ci.yml`, `preview-deps` |
| `preview` is not a required check. Turn it off with `with: { preview: false }`. | caller `ci.yml` |

## CLI

| Command | When | What it does |
|---|---|---|
| `bun run release:setup` | once per project | Idempotent wizard: workflows, script contract, first publish, first tag, trusted publisher, branch ruleset, then `doctor`. `--dry-run` prints every action, changes nothing and asks nothing. `--yes` answers every confirmation for an agent or CI; a step that needs your npm OTP is then printed, not run. |
| `bun run release:doctor` | any time | Changes nothing in the project; it only runs `git fetch --tags` first. Twelve checks, one line each, and the exact `fix:` command for every red line. `--json` for machines. |
| `bun run release <patch\|minor\|major\|prerelease>` | each release | Refuses unless the tree is clean and `HEAD == origin/main`. Dispatches `publish.yml`, watches the run, verifies the version and dist-tag on npm. |

The scripts are plain aliases of the `moku-release` bin. Internals and the list of checks:
[src/README.md](src/README.md).

## The contract

A package exposes exactly these seven scripts. `setup` adds the ones that are missing;
`doctor` reports them.

| Script | Used by |
|---|---|
| `build` | `build` job, and again before `npm pack` |
| `validate` | `build` job — publint + attw |
| `lint` | `lint` job — biome check + eslint |
| `typecheck` | `types` job — `tsc --noEmit` |
| `test` | `test` job — `vitest run`, never `bun test` |
| `lint:fix` | local only |
| `format` | local only |

Project-specific work goes inside the script. `room` needs a second typecheck pass, so its
script is `"typecheck": "tsc --noEmit && tsc -p tsconfig.worker.json --noEmit"`. The central
YAML stays the same for everyone.

> [!IMPORTANT]
> Keep the caller's job id `ci` and the filename `publish.yml`. GitHub prefixes the check
> names with the job id (`ci / lint`), and npm Trusted Publishing is registered against the
> filename. Rename either and the ruleset or the publish breaks.

## Versioning

| Ref | Meaning |
|---|---|
| `@v1` | Moving major tag. Projects pin this and get fixes automatically. Moves only for backwards-compatible changes. |
| `@v1.x.y` | Immutable tag on every change. Pin it to freeze a project. |
| `@v2` | Any breaking change: a removed input, a changed default, a renamed job. `v1` stays where it was. |

> [!IMPORTANT]
> `v1` must be a **lightweight** tag. `package-release.yml` calls `./.github/workflows/package-ci.yml`
> from inside itself, and GitHub cannot resolve that relative call through an annotated tag: every
> release dies with `startup_failure` and "workflow was not found". Immutable `v1.x.y` tags may be
> annotated.
>
> ```sh
> git tag -a v1.2.0 -m "v1.2.0"
> git tag -f v1 v1.2.0^{commit}      # no -a, no -m
> git push origin v1.2.0 && git push -f origin v1
> ```

A change here runs in every moku repo with `contents: write` and `id-token: write`. Review it
like release engineering, not like config.

## When a release fails

The cross-repo OIDC publish was the open risk; npm accepted it on the first live release
(`@moku-labs/ci@1.1.1`). The fallback, should npm ever change that, and sixteen traps the
workflows already handle are in [docs/release-notes.md](docs/release-notes.md).

## Scripts

```sh
bun run build        # tsdown → dist/release.mjs
bun run validate     # publint
bun run lint         # biome check + eslint
bun run lint:fix
bun run format
bun run typecheck    # tsc --noEmit
bun run test         # vitest run
```

## Requirements

Node ≥ 24 · Bun ≥ 1.3.14 · `gh` and `npm` ≥ 11.5.1 on the machine that runs `setup` or
`release`. The CLI prints through the
[@moku-labs/common](https://github.com/moku-labs/common) brand kit, bundled at build time.

## License

[MIT](./LICENSE) © [moku-labs](https://github.com/moku-labs)

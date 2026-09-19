# release

> **Bin** — `moku-release`: the one-time setup, the read-only diagnosis, and the release trigger for every moku-family npm package.

`moku-release` removes the recurring cost of wiring CI, versioning and npm publishing for a new moku-labs package. It is a plain **Node bin** shipped by this package (`"bin": { "moku-release": "./dist/release.mjs" }`), *not* a Moku plugin: there is no `createPlugin` and nothing to register. Everything it prints goes through the family's branded `@moku-labs/common/cli` kit (bundled at build time), it adds **zero runtime dependencies**, and it never builds a shell string — every child process is an argv array through `node:child_process`.

Two things it will never do: **log you in** and **handle a credential**. `gh auth login` and `npm login` are human-only; the CLI reports the exact command and stops. `npm publish` and `npm trust` run with inherited stdio so npm — not this CLI — owns any OTP prompt. There is no `NPM_TOKEN` anywhere in the pipeline it installs: OIDC Trusted Publishing is the whole credential.

## Example

```sh
bun run release:setup      # one-time wizard (idempotent — re-runnable any time)
bun run release:doctor     # read-only diagnosis; exit 1 if anything fails
bun run release patch      # dispatch publish.yml, watch the run, verify the artifact

moku-release doctor --json # machine output
moku-release patch --dry-run
```

```text
 ▟▙ moku release  doctor                                         
 ─────────────────────────────────────────────────────────────────
  ✓ gh installed and authenticated — authenticated
  ✓ npm is logged in — logged in as alex
  ✓ npm >= 11.5.1 — npm 11.6.0
  ✗ package.json on contract — missing script `typecheck`
      fix: moku-release setup
  ⚠ branch ruleset on main — main has no branch ruleset
      fix: moku-release setup
```

## The contract

`doctor` enforces, and `setup` fills in, this `package.json` shape:

| Field | Requirement |
|---|---|
| `scripts` | `lint`, `typecheck` (`tsc --noEmit`), `test`, `build`, `validate`, plus `release:setup`, `release:doctor`, `release` |
| `publishConfig.access` | `"public"` |
| `repository.url` | matches `git remote get-url origin` (compared canonically — `git@…`, `git+https://…`, `.git` all normalize) |
| `files` | present and non-empty |
| `engines.node` | `>= 24` (the npm Trusted Publishing floor) |

Normalization is **additive and idempotent**: it fills what is absent and never rewrites a value the package already chose, so a second `setup` is a no-op report.

## Commands

| Command | Mutates | What it does |
|---|---|---|
| `setup` | yes (each step confirmed) | Verify the two human-only prerequisites → write the thin workflows → normalize `package.json` → first publish → tag + push that tag → register the trusted publisher → apply the branch ruleset → run `doctor`. |
| `doctor [--json]` | **never** | Run all 12 checks, one line each, a `fix:` line for every non-pass. Exit `0` when nothing fails, `1` otherwise. |
| `<patch\|minor\|major\|prerelease>` | yes | Strict preflight → `gh workflow run publish.yml` → `gh run watch --exit-status` → poll npm until the dist-tag actually moves → branded summary (version, tag, npm URL, release URL). |

Both `setup` and the release command accept `--dry-run`, which prints every action and mutates nothing.

## Checks

| id | Level | Checks |
|---|---|---|
| `gh-auth` | fail | `gh --version`, then `gh auth status`. |
| `npm-auth` | fail | `npm whoami`. |
| `npm-version` | fail | `npm >= 11.5.1` — the Trusted Publishing floor. |
| `package-contract` | fail | Every missing script/field, named individually. |
| `preview-deps` | fail | No dependency range is a `pkg.pr.new` preview URL; every offender named. The `lint` job refuses the same on a PR. |
| `repository-url` | fail | `repository.url` vs `git remote get-url origin`, canonically. |
| `workflows` | fail / warn | Both workflows exist (fail) and are pinned to `moku-labs/ci/…@v1` (warn: *legacy workflow, run release:setup to migrate*). |
| `npm-package` | warn | `npm view <name> version` — *first publish not done yet*. |
| `trusted-publisher` | fail / warn | `npm trust list <name>`; an npm with no `trust` command warns with *upgrade npm*. |
| `tag-sync` | warn | Newest `v*` tag (sorted with `versionsort.suffix=-`) vs npm `latest`, naming the drift direction. |
| `branch-ruleset` | warn | `gh api repos/{owner}/{repo}/rulesets`. |
| `working-tree` | warn / **fail** | Clean tree and `HEAD == origin/main`. Advisory in `doctor`, blocking in the release preflight — that is what `ctx.strict` switches. |

## Design notes

- **Two ports, no third.** Everything that reaches the outside world goes through `lib/exec.ts` (commands) or `lib/files.ts` (the tree). Every check and command takes them injected, so the entire test suite runs with canned command output and an in-memory tree — no test touches the network, git, `gh` or npm.
- **The templates are copies, not paraphrases.** `templates/*.ts` embed `moku-labs/ci`'s `examples/package/{ci,publish}.yml` and `rulesets/main.json` **byte-for-byte**. Two details there are load-bearing: the caller job id is `ci` (so the required checks read `ci / lint`, `ci / types`, `ci / test`, `ci / build`), and `ci.yml` has deliberately **no** concurrency block — a caller group equal to `github.workflow` deadlocks against its own reused child.
- **`publish.yml` is a filename contract.** npm validates the *calling* workflow's filename even when the publish itself happens inside a reusable workflow, so `npm trust github <pkg> --file publish.yml` stays correct and the file must never be renamed.
- **One definition of a fix.** `setup` registers the trusted publisher by running the `trusted-publisher` check's own `fix` string, so the command `doctor` prints and the command `setup` runs cannot drift apart.
- **Green is not shipped.** After the run goes green the CLI still polls `npm view … dist-tags` until the tag actually moves (~2 min budget). "The workflow passed" and "the version is installable" are different claims.
- **Idempotent by construction.** Every `setup` step first asks whether it is already done and prints a checkmark instead of redoing it; an existing file is only replaced after an explicit confirm, and a `.bak` is kept.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | The bin entry — build the ports, parse argv, dispatch, set the exit code. Nothing else. |
| `types.ts` | `CheckStatus`, `CheckResult`, `CheckContext`, `ReleaseCheck` — the vocabulary everything else is written in. |
| `commands/setup.ts` | The idempotent one-time wizard. |
| `commands/doctor.ts` | The read-only report (branded or `--json`), reused as the release preflight. |
| `commands/release.ts` | Preflight → dispatch → watch → registry verification → summary. |
| `checks/*.ts` | One diagnostic per file; `checks/index.ts` is the ordered registry. |
| `lib/exec.ts` · `lib/files.ts` | The two injectable ports (`capture`/`inherit`, `read`/`write`/`backup`). |
| `lib/npm.ts` · `lib/git.ts` · `lib/github.ts` | Pure parsers: semver + dist-tags, remote URLs + tags, `gh` JSON. |
| `lib/package-json.ts` | The contract table — `contractIssues` and `normalizeManifest` are two views of it. |
| `lib/templates.ts` · `templates/*.ts` | The verbatim central workflows + ruleset, and the thin-caller check. |
| `lib/argv.ts` · `lib/result.ts` | Argv grammar; the four `CheckResult` constructors. |
| `__tests__/` | Colocated unit tests + the two port doubles. |

---

<sub>Part of <strong><a href="../README.md">@moku-labs/ci</a></strong>.</sub>

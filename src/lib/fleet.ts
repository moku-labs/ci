/**
 * @file `moku-release fleet` — one GraphQL query for every repository of the organization,
 * and the pure functions that turn its answer into a status table.
 *
 * Everything a row shows comes from that one answer, except the version npm serves. The
 * checks of the newest commit on the default branch hold both pipelines: a `release / …`
 * check belongs to `publish.yml`, every other check to CI. The newest `v*` tag sits on a
 * bump commit whose parent is the commit that was released, so the distance from that
 * parent to the head is the number of commits nobody released.
 */
import { compareSemver } from "./npm";

/** Prefix GitHub puts on the jobs of `publish.yml`: the caller's job id, `release`. */
const RELEASE_PREFIX = "release / ";

/** How many commits of the default branch the query reads to measure the distance to the tag. */
export const HISTORY_DEPTH = 30;

/**
 * How many commits back CI is looked for. A commit merged by GITHUB_TOKEN (a Dependabot
 * auto-merge) starts no workflow and has no check at all, so the newest commit that has
 * checks answers for it.
 */
export const RECENT_DEPTH = 6;

/** The author name GitHub gives every Dependabot commit. */
const DEPENDABOT = "dependabot[bot]";

/** The scope every family package is published under. */
const FAMILY_SCOPE = "@moku-labs/";

/** The organization's profile repository. It holds the table itself and is not a row of it. */
const PROFILE_REPO = ".github";

/** Matches a release tag, prereleases included: `v1.2.3`, `v1.2.3-rc.0`. Not the moving `v1`. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+/;

/** Matches a dependency pinned to one exact version. A range is not a pin and is not judged. */
const EXACT_VERSION = /^\d+\.\d+\.\d+/;

/** The query `gh api graphql -F org=<org>` runs. One call answers the whole table. */
export const FLEET_QUERY = `query($org: String!) {
  organization(login: $org) {
    repositories(first: 100, isArchived: false, orderBy: { field: NAME, direction: ASC }) {
      nodes {
        name
        isPrivate
        manifest: object(expression: "HEAD:package.json") { ... on Blob { text } }
        bun: object(expression: "HEAD:.bun-version") { ... on Blob { text } }
        publish: object(expression: "HEAD:.github/workflows/publish.yml") { ... on Blob { byteSize } }
        defaultBranchRef {
          target {
            ... on Commit {
              oid
              history(first: ${HISTORY_DEPTH}) { nodes { oid author { name } } }
              statusCheckRollup { contexts(first: 100) { nodes { ... on CheckRun { name status conclusion } } } }
              recent: history(first: ${RECENT_DEPTH}) {
                nodes { statusCheckRollup { contexts(first: 100) { nodes { ... on CheckRun { name status conclusion } } } } }
              }
            }
          }
        }
        refs(refPrefix: "refs/tags/", first: 10, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
          nodes {
            name
            target {
              ... on Commit { parents(first: 1) { nodes { oid } } }
              ... on Tag { target { ... on Commit { parents(first: 1) { nodes { oid } } } } }
            }
          }
        }
        pullRequests(states: OPEN, first: 50) {
          nodes {
            number
            isDraft
            author { login }
            commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
          }
        }
      }
    }
  }
}`;

/**
 * The state of one pipeline. `none` means it has no check on the commit.
 *
 * @example
 * const state: PipelineState = "red";
 */
export type PipelineState = "green" | "red" | "running" | "none";

/**
 * One open pull request of a repository.
 *
 * @example
 * const pr: FleetPullRequest = { number: 12, bot: false, draft: false, state: "green" };
 */
export type FleetPullRequest = {
  /** The pull request number. */
  number: number;
  /** Whether a bot opened it (Dependabot). */
  bot: boolean;
  /** Whether it is a draft. */
  draft: boolean;
  /** The state of the checks of its newest commit. */
  state: PipelineState;
};

/**
 * One family dependency that is pinned below the newest released version.
 *
 * @example
 * const pin: FleetPin = { name: "@moku-labs/core", pinned: "1.7.1", latest: "1.7.2" };
 */
export type FleetPin = {
  /** The dependency name. */
  name: string;
  /** The version the repository pins. */
  pinned: string;
  /** The newest released version of that dependency. */
  latest: string;
};

/**
 * The direct dependencies of one repository that are not family packages. Dependencies of
 * dependencies are never read: only what the manifest itself names.
 *
 * @example
 * const external: FleetExternal = { runtime: { preact: "10.27.0" }, dev: { typescript: "6.0.3" } };
 */
export type FleetExternal = {
  /** `dependencies`: what a consumer installs with the package. */
  runtime: Record<string, string>;
  /** `devDependencies`, plus `bun` from `.bun-version`: the tools the repository is built with. */
  dev: Record<string, string>;
};

/**
 * One row of the table: everything known about one repository.
 *
 * @example
 * const row: FleetRepo = { name: "core", isPrivate: false, ci: "green", release: "green", pullRequests: [], pins: [] };
 */
export type FleetRepo = {
  /** The repository name, without the owner. */
  name: string;
  /** Whether the repository is private. A private row never reaches a public page. */
  isPrivate: boolean;
  /** The npm name, present only for a repository that publishes a package. */
  packageName?: string;
  /** The state of CI on the newest commit of the default branch. */
  ci: PipelineState;
  /** The state of `publish.yml` on that commit. `none` when no release ran for it. */
  release: PipelineState;
  /** The newest release tag, e.g. `v1.2.3`. */
  tag?: string;
  /** Commits on the default branch after the released one. `HISTORY_DEPTH` means that many or more. */
  unreleased?: number;
  /** The version npm serves as `latest`. Filled by the command, not by the query. */
  npm?: string;
  /** The open pull requests. */
  pullRequests: FleetPullRequest[];
  /** The family dependencies pinned below their newest release. */
  pins: FleetPin[];
  /** The exact family pins of the manifest, kept until every newest version is known. */
  pinned?: Record<string, string>;
  /** The direct dependencies from outside the family, as the manifest writes them. */
  external: FleetExternal;
};

/** One check of a commit, as the query returns it. A status context has no name. */
type RawCheck = { name?: string; status?: string; conclusion?: string | null } | null;

/** The checks of a commit, as the query returns them. Absent for a commit without checks. */
type RawRollup = { contexts?: { nodes?: RawCheck[] } } | null;

/** One commit of the default branch, as the query returns it. */
type RawCommit = { oid?: string; author?: { name?: string } | null };

/** The parents of a commit, as the query returns them. */
type RawParents = { parents?: { nodes?: { oid?: string }[] } };

/** One repository, as the query returns it. */
type RawRepo = {
  name?: string;
  isPrivate?: boolean;
  manifest?: { text?: string } | null;
  bun?: { text?: string } | null;
  publish?: { byteSize?: number } | null;
  defaultBranchRef?: {
    target?: {
      oid?: string;
      history?: { nodes?: RawCommit[] };
      statusCheckRollup?: RawRollup;
      recent?: { nodes?: { statusCheckRollup?: RawRollup }[] };
    };
  } | null;
  refs?: { nodes?: { name?: string; target?: RawParents & { target?: RawParents } }[] };
  pullRequests?: {
    nodes?: {
      number?: number;
      isDraft?: boolean;
      author?: { login?: string } | null;
      commits?: { nodes?: { commit?: { statusCheckRollup?: { state?: string } | null } }[] };
    }[];
  };
};

/** The part of a `package.json` the table reads. */
type RawManifest = {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * Fold the checks of one pipeline into one state. Red wins over running, running over green.
 *
 * @param checks - The checks that belong to the pipeline.
 * @returns The state of the pipeline.
 * @example
 * pipelineState([{ status: "COMPLETED", conclusion: "FAILURE" }]); // "red"
 */
export function pipelineState(checks: readonly NonNullable<RawCheck>[]): PipelineState {
  if (checks.length === 0) return "none";

  const done = checks.filter(check => check.status === "COMPLETED");
  const passed = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
  if (done.some(check => !passed.has(check.conclusion ?? ""))) return "red";

  return done.length === checks.length ? "green" : "running";
}

/**
 * The state of a pull request from the rollup state GitHub computes for its newest commit.
 *
 * @param state - `SUCCESS`, `FAILURE`, `ERROR`, `PENDING`, `EXPECTED`, or nothing.
 * @returns The matching pipeline state.
 * @example
 * rollupState("FAILURE"); // "red"
 */
export function rollupState(state: string | undefined): PipelineState {
  if (state === "SUCCESS") return "green";
  if (state === "FAILURE" || state === "ERROR") return "red";

  return state === undefined ? "none" : "running";
}

/**
 * Parse a manifest text, tolerating a missing or malformed file.
 *
 * @param text - The `package.json` text, when the repository has one.
 * @returns The manifest, or an empty one.
 * @example
 * parseManifest('{"name":"@moku-labs/core"}');
 */
function parseManifest(text: string | undefined): RawManifest {
  try {
    const parsed: unknown = JSON.parse(text ?? "");
    return typeof parsed === "object" && parsed !== null ? (parsed as RawManifest) : {};
  } catch {
    return {};
  }
}

/**
 * The newest release tag of a repository and the commit it released.
 *
 * @param raw - The repository, as the query returns it.
 * @returns The tag and the released commit, or nothing when no release tag exists.
 * @example
 * const newest = newestRelease(raw);
 */
function newestRelease(raw: RawRepo): { tag: string; released: string | undefined } | undefined {
  const tags = (raw.refs?.nodes ?? []).filter(node => RELEASE_TAG.test(node.name ?? ""));
  const [newest] = tags.toSorted((a, b) => compareSemver(b.name ?? "", a.name ?? ""));
  if (newest?.name === undefined) return undefined;

  // A lightweight tag points at the bump commit; an annotated one wraps it once more.
  const commit = newest.target?.parents === undefined ? newest.target?.target : newest.target;

  return { tag: newest.name, released: commit?.parents?.nodes?.[0]?.oid };
}

/**
 * The exact family pins of a manifest, from `dependencies` and `devDependencies`.
 *
 * @param manifest - The parsed manifest.
 * @returns Dependency name to pinned version, for exact `@moku-labs/*` pins only.
 * @example
 * familyPins({ dependencies: { "@moku-labs/core": "1.7.1" } }); // { "@moku-labs/core": "1.7.1" }
 */
function familyPins(manifest: RawManifest): Record<string, string> {
  const all = { ...manifest.devDependencies, ...manifest.dependencies };

  return Object.fromEntries(
    Object.entries(all).filter(
      ([name, spec]) => name.startsWith(FAMILY_SCOPE) && EXACT_VERSION.test(spec)
    )
  );
}

/**
 * Whether a check belongs to `publish.yml`.
 *
 * @param check - One check of a commit.
 * @returns `true` for a `release / …` check.
 * @example
 * isRelease({ name: "release / publish" }); // true
 */
function isRelease(check: NonNullable<RawCheck>): boolean {
  return (check.name ?? "").startsWith(RELEASE_PREFIX);
}

/**
 * How many commits of the default branch wait for a release: the ones after the released
 * commit that a person wrote. A Dependabot commit is not counted. When its bump changes the
 * published package the Dependabot job releases it, and then it is the released commit;
 * left unreleased, it moved `devDependencies` only and there is nothing to release.
 *
 * @param history - The newest commits of the default branch, newest first.
 * @param released - The commit the newest release tag was cut from.
 * @returns The count, or `HISTORY_DEPTH` when the released commit is older than the history read.
 * @example
 * unreleasedCommits([{ oid: "c2" }, { oid: "c1" }], "c1"); // 1
 */
export function unreleasedCommits(
  history: readonly RawCommit[],
  released: string | undefined
): number {
  const index = history.findIndex(commit => commit.oid === released);
  if (index === -1) return HISTORY_DEPTH;

  return history.slice(0, index).filter(commit => commit.author?.name !== DEPENDABOT).length;
}

/**
 * The checks of a commit that carry a name. A status context has none and is left out.
 *
 * @param rollup - The checks of a commit, as the query returns them.
 * @returns The named checks, or an empty list for a commit without checks.
 * @example
 * namedChecks(head.statusCheckRollup);
 */
function namedChecks(rollup: RawRollup | undefined): NonNullable<RawCheck>[] {
  return (rollup?.contexts?.nodes ?? []).filter(
    (check): check is NonNullable<RawCheck> => check?.name !== undefined
  );
}

/**
 * The state of CI on the default branch: the CI checks of the newest commit that has any.
 *
 * @param commits - The checks of the newest commits, newest first.
 * @returns The state, or `none` when no recent commit ran CI.
 * @example
 * ciState([[], [{ name: "ci / lint", status: "COMPLETED", conclusion: "SUCCESS" }]]); // "green"
 */
export function ciState(commits: readonly (readonly NonNullable<RawCheck>[])[]): PipelineState {
  const ran = commits.map(checks => checks.filter(check => !isRelease(check)));

  return pipelineState(ran.find(checks => checks.length > 0) ?? []);
}

/**
 * The state of the release of the default branch. The release checks of the newest commit
 * decide when it has them. A release dispatched by hand or by the Dependabot job leaves no
 * check on the commit, so there the tag decides: a tag on the newest commit is a release.
 *
 * @param checks - The checks of the newest commit.
 * @param released - Whether the newest release tag sits on the newest commit.
 * @returns The state, or `none` when the commit has neither a release check nor a tag.
 * @example
 * releaseState([], true); // "green"
 */
export function releaseState(
  checks: readonly NonNullable<RawCheck>[],
  released: boolean
): PipelineState {
  const state = pipelineState(checks.filter(check => isRelease(check)));

  return state === "none" && released ? "green" : state;
}

/**
 * The GitHub URL of a repository, or of a page inside it.
 *
 * @param org - The organization login.
 * @param repo - The row.
 * @param path - A path inside the repository, with the leading slash.
 * @returns The URL.
 * @example
 * repoUrl("moku-labs", row, "/pulls");
 */
function repoUrl(org: string, repo: FleetRepo, path = ""): string {
  return `https://github.com/${org}/${repo.name}${path}`;
}

/**
 * The entries of a dependency map that are not family packages.
 *
 * @param dependencies - A dependency map of a manifest, when it has one.
 * @returns The same map without `@moku-labs/*`.
 * @example
 * outsideFamily({ "@moku-labs/core": "1.7.2", preact: "10.27.0" }); // { preact: "10.27.0" }
 */
function outsideFamily(dependencies: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies ?? {}).filter(([name]) => !name.startsWith(FAMILY_SCOPE))
  );
}

/**
 * Turn one repository of the answer into a row. The pins are judged later, once the
 * newest version of every package is known.
 *
 * @param raw - The repository, as the query returns it.
 * @returns The row, with `pins` still empty and the manifest pins kept in `pinned`.
 * @example
 * const row = toRepo(raw);
 */
function toRepo(raw: RawRepo): FleetRepo {
  const manifest = parseManifest(raw.manifest?.text ?? undefined);
  const head = raw.defaultBranchRef?.target;
  const bun = raw.bun?.text?.trim();
  const checks = namedChecks(head?.statusCheckRollup);
  const recent = (head?.recent?.nodes ?? []).map(node => namedChecks(node.statusCheckRollup));
  const publishes =
    raw.publish?.byteSize !== undefined && manifest.private !== true && manifest.name !== undefined;
  const newest = publishes ? newestRelease(raw) : undefined;
  const distance = unreleasedCommits(head?.history?.nodes ?? [], newest?.released);

  return {
    name: raw.name ?? "",
    isPrivate: raw.isPrivate === true,
    ...(publishes && manifest.name !== undefined ? { packageName: manifest.name } : {}),
    ci: ciState([checks, ...recent]),
    release: releaseState(checks, newest !== undefined && distance === 0),
    ...(newest === undefined ? {} : { tag: newest.tag, unreleased: distance }),
    pullRequests: (raw.pullRequests?.nodes ?? []).map(pr => ({
      number: pr.number ?? 0,
      bot: (pr.author?.login ?? "").endsWith("[bot]") || pr.author?.login === "dependabot",
      draft: pr.isDraft === true,
      state: rollupState(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state)
    })),
    pins: [],
    pinned: familyPins(manifest),
    external: {
      runtime: outsideFamily(manifest.dependencies),
      dev: {
        ...outsideFamily(manifest.devDependencies),
        ...(bun === undefined || bun === "" ? {} : { bun })
      }
    }
  };
}

/**
 * Parse the answer of {@link FLEET_QUERY} into rows, pins judged against the newest tags.
 *
 * @param stdout - The raw `gh api graphql` output.
 * @returns One row per repository, or `undefined` when the answer is not the expected shape.
 * @example
 * const rows = parseFleet(stdout);
 */
export function parseFleet(stdout: string): FleetRepo[] | undefined {
  let nodes: unknown;
  try {
    const parsed = JSON.parse(stdout) as {
      data?: { organization?: { repositories?: { nodes?: unknown } } };
    };
    nodes = parsed.data?.organization?.repositories?.nodes;
  } catch {
    return undefined;
  }
  if (!Array.isArray(nodes)) return undefined;

  const rows = (nodes as RawRepo[])
    .filter(raw => raw.name !== PROFILE_REPO)
    .map(raw => toRepo(raw));
  const newest = new Map(
    rows.flatMap(row =>
      row.packageName !== undefined && row.tag !== undefined
        ? [[row.packageName, row.tag.slice(1)] as const]
        : []
    )
  );

  return rows.map(({ pinned = {}, ...row }) => ({
    ...row,
    pins: Object.entries(pinned).flatMap(([name, version]) => {
      const latest = newest.get(name);
      return latest !== undefined && compareSemver(version, latest) < 0
        ? [{ name, pinned: version, latest }]
        : [];
    })
  }));
}

/**
 * What waits for a person in one repository, most urgent first. An empty list is a quiet row.
 *
 * @param repo - The row.
 * @returns One short line per thing to look at.
 * @example
 * attention({ ...row, ci: "red" }); // ["CI is red on main"]
 */
export function attention(repo: FleetRepo): string[] {
  const lines: string[] = [];
  const version = repo.tag?.slice(1);

  if (repo.ci === "red") lines.push("CI is red on main");
  if (repo.release === "red") lines.push("the release of main failed");
  // A running release explains commits after the tag; anything else means nobody released them.
  if ((repo.unreleased ?? 0) > 0 && repo.release !== "running" && repo.release !== "red") {
    const count = repo.unreleased === HISTORY_DEPTH ? `${HISTORY_DEPTH}+` : `${repo.unreleased}`;
    lines.push(`${count} commit(s) on main are not released`);
  }
  if (repo.npm !== undefined && version !== undefined && repo.npm !== version) {
    lines.push(`npm serves ${repo.npm}, the tag is ${repo.tag}`);
  }

  for (const pr of repo.pullRequests.filter(open => !open.draft)) {
    if (pr.state === "red") lines.push(`PR #${pr.number} has red checks`);
    if (pr.state === "green") lines.push(`PR #${pr.number} is green and not merged`);
  }
  return lines;
}

/** The mark of each state in the Markdown table. */
const MARKS: Record<PipelineState, string> = { green: "🟢", red: "🔴", running: "🟡", none: "—" };

/**
 * The open pull requests of a row as one short cell: the count, then what stands out.
 *
 * @param repo - The row.
 * @returns E.g. `3 (1 red, 2 bot)`, or `0`.
 * @example
 * pullRequestCell(row); // "3 (1 red, 2 bot)"
 */
export function pullRequestCell(repo: FleetRepo): string {
  const open = repo.pullRequests;
  const red = open.filter(pr => pr.state === "red").length;
  const bot = open.filter(pr => pr.bot).length;
  const notes = [red > 0 ? `${red} red` : "", bot > 0 ? `${bot} bot` : ""].filter(Boolean);

  return notes.length > 0 ? `${open.length} (${notes.join(", ")})` : `${open.length}`;
}

/**
 * The "not released" cell of a row.
 *
 * @param repo - The row.
 * @returns The number of commits after the released one, or a dash for a repository without releases.
 * @example
 * unreleasedCell(row); // "0"
 */
export function unreleasedCell(repo: FleetRepo): string {
  if (repo.unreleased === undefined) return "—";

  return repo.unreleased === HISTORY_DEPTH ? `${HISTORY_DEPTH}+` : `${repo.unreleased}`;
}

/**
 * The "old pins" cell of a row: every family dependency pinned below its newest release.
 * It is a column and not a line of {@link attention}: Dependabot moves the pins by itself.
 *
 * @param repo - The row.
 * @returns E.g. `core 1.7.1, ci 1.3.0`, or a dash.
 * @example
 * pinsCell(row); // "core 1.7.1"
 */
export function pinsCell(repo: FleetRepo): string {
  if (repo.pins.length === 0) return "—";

  return repo.pins.map(pin => `${pin.name.slice(FAMILY_SCOPE.length)} ${pin.pinned}`).join(", ");
}

/**
 * Render the public rows as a Markdown table with links, and the list of what waits. A
 * private repository is left out: the page this lands on is public.
 *
 * @param org - The organization login, for the links.
 * @param repos - The rows.
 * @returns The Markdown block, without a trailing newline.
 * @example
 * renderFleetMarkdown("moku-labs", rows);
 */
export function renderFleetMarkdown(org: string, repos: readonly FleetRepo[]): string {
  const shown = repos.filter(repo => !repo.isPrivate);

  const rows = shown.map(repo =>
    [
      `[${repo.name}](${repoUrl(org, repo)})`,
      `[${MARKS[repo.ci]}](${repoUrl(org, repo, "/actions")})`,
      repo.packageName === undefined
        ? "—"
        : `[${MARKS[repo.release]}](${repoUrl(org, repo, "/actions/workflows/publish.yml")})`,
      repo.tag === undefined
        ? "—"
        : `[${repo.tag}](${repoUrl(org, repo, "/releases/tag/")}${repo.tag})`,
      repo.npm ?? "—",
      unreleasedCell(repo),
      `[${pullRequestCell(repo)}](${repoUrl(org, repo, "/pulls")})`,
      pinsCell(repo)
    ].join(" | ")
  );

  const waiting = shown.flatMap(repo =>
    attention(repo).map(line => `- [${repo.name}](${repoUrl(org, repo)}): ${line}`)
  );

  return [
    "| Repo | CI | Release | Tag | npm | Not released | PRs | Old pins |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(row => `| ${row} |`),
    "",
    waiting.length === 0 ? "Nothing waits." : "**Waits for a person**",
    ...(waiting.length === 0 ? [] : ["", ...waiting])
  ].join("\n");
}

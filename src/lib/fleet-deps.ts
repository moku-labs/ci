/**
 * @file `moku-release fleet --deps` — where the family stands on the packages it does not
 * own: the shared toolchain, and the runtime dependencies that npm has moved past.
 *
 * Only the dependencies a manifest names are read, never their own dependencies. The
 * accepted version of a tool is not written anywhere: it is the version most repositories
 * are on, so the table follows the family instead of a file that someone has to keep.
 */
import type { FleetRepo } from "./fleet";
import { compareSemver, parseSemver } from "./npm";

/** A tool counts as shared once this many repositories use it. */
const SHARED_FROM = 2;

/** Matches a dependency pinned to one exact version. */
const EXACT_VERSION = /^\d+\.\d+\.\d+/;

/** Matches a range that names a lowest version: `^1.2.3`, `~1.2.3`, `>=1.2.3`. */
const RANGE_PREFIX = /^(?:\^|~|>=)\s*(?=\d+\.\d+\.\d+)/;

/**
 * One repository that is not on the accepted version of a tool.
 *
 * @example
 * const other: ToolUse = { repo: "game", version: "2.4.2" };
 */
export type ToolUse = {
  /** The repository name. */
  repo: string;
  /** The version its manifest writes. */
  version: string;
};

/**
 * One row of the toolchain table: one tool that at least two repositories use.
 *
 * @example
 * const row: ToolRow = { name: "typescript", accepted: "6.0.3", users: 11, others: [] };
 */
export type ToolRow = {
  /** The package name, or `bun` for `.bun-version`. */
  name: string;
  /** The version most repositories are on. */
  accepted: string;
  /** How many repositories use the tool. */
  users: number;
  /** The newest version on npm. Filled by the command. */
  latest?: string;
  /** The repositories on another version. */
  others: ToolUse[];
};

/**
 * One row of the runtime table: one dependency of one repository that npm has moved past.
 *
 * @example
 * const row: RuntimeRow = { name: "preact", repo: "web", version: "10.26.0", latest: "10.27.0" };
 */
export type RuntimeRow = {
  /** The package name. */
  name: string;
  /** The repository that depends on it. */
  repo: string;
  /** The version its manifest writes. */
  version: string;
  /** The newest version on npm. */
  latest: string;
};

/**
 * Whether a written version is older than the newest one. An exact version is compared in
 * full. A range is behind only when the newest major is above its own: inside the major it
 * already takes the newest. Anything else (`*`, a tag, a URL) is not judged.
 *
 * @param spec - The version as the manifest writes it.
 * @param latest - The newest version on npm.
 * @returns `true` when the dependency is behind.
 * @example
 * isBehind("^5.1.0", "6.0.0"); // true
 */
export function isBehind(spec: string, latest: string): boolean {
  if (EXACT_VERSION.test(spec)) return compareSemver(spec, latest) < 0;
  if (!RANGE_PREFIX.test(spec)) return false;

  const lowest = spec.replace(RANGE_PREFIX, "");

  return (parseSemver(lowest).core[0] ?? 0) < (parseSemver(latest).core[0] ?? 0);
}

/**
 * Order two written versions, newest first. Two exact versions are compared as semver,
 * anything else as text, so the order is stable for a range too.
 *
 * @param left - One written version.
 * @param right - Another written version.
 * @returns Negative when `left` is the newer one.
 * @example
 * newestFirst("1.4.2", "1.3.14"); // negative
 */
function newestFirst(left: string, right: string): number {
  return EXACT_VERSION.test(left) && EXACT_VERSION.test(right)
    ? compareSemver(right, left)
    : right.localeCompare(left);
}

/**
 * The version most repositories are on. On a tie the newer version wins.
 *
 * @param versions - The version each repository writes, one entry per repository.
 * @returns The accepted version, or an empty string for an empty list.
 * @example
 * acceptedVersion(["6.0.3", "6.0.3", "7.0.2"]); // "6.0.3"
 */
export function acceptedVersion(versions: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const version of versions) counts.set(version, (counts.get(version) ?? 0) + 1);

  const [accepted = ""] = [...counts.keys()].toSorted(
    (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || newestFirst(a, b)
  );

  return accepted;
}

/**
 * The toolchain table: every dev dependency that at least two repositories use, with the
 * version most of them are on. On a tie the newer version is the accepted one.
 *
 * @param repos - The rows of the fleet.
 * @returns One row per shared tool, the ones with a repository on another version first.
 * @example
 * const tools = toolchainRows(repos);
 */
export function toolchainRows(repos: readonly FleetRepo[]): ToolRow[] {
  const uses = new Map<string, ToolUse[]>();
  for (const repo of repos) {
    for (const [name, version] of Object.entries(repo.external.dev)) {
      uses.set(name, [...(uses.get(name) ?? []), { repo: repo.name, version }]);
    }
  }

  const rows = [...uses.entries()]
    .filter(([, users]) => users.length >= SHARED_FROM)
    .map(([name, users]) => {
      const accepted = acceptedVersion(users.map(use => use.version));

      return {
        name,
        accepted,
        users: users.length,
        others: users.filter(use => use.version !== accepted)
      };
    });

  return rows.toSorted(
    (a, b) =>
      Number(b.others.length > 0) - Number(a.others.length > 0) || a.name.localeCompare(b.name)
  );
}

/**
 * Every package name whose newest version the two tables need.
 *
 * @param repos - The rows of the fleet.
 * @returns The names of the shared tools and of every runtime dependency, each once.
 * @example
 * const names = externalNames(repos);
 */
export function externalNames(repos: readonly FleetRepo[]): string[] {
  const runtime = repos.flatMap(repo => Object.keys(repo.external.runtime));

  return [...new Set([...toolchainRows(repos).map(row => row.name), ...runtime])].toSorted();
}

/**
 * The runtime table: every runtime dependency that is behind the newest version on npm.
 *
 * @param repos - The rows of the fleet.
 * @param latest - Package name to its newest version on npm.
 * @returns One row per dependency and repository, by package name.
 * @example
 * const behind = runtimeRows(repos, new Map([["preact", "10.27.0"]]));
 */
export function runtimeRows(
  repos: readonly FleetRepo[],
  latest: ReadonlyMap<string, string>
): RuntimeRow[] {
  return repos
    .flatMap(repo =>
      Object.entries(repo.external.runtime).flatMap(([name, version]) => {
        const newest = latest.get(name);
        return newest !== undefined && isBehind(version, newest)
          ? [{ name, repo: repo.name, version, latest: newest }]
          : [];
      })
    )
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.repo.localeCompare(b.repo));
}

/**
 * The "not on it" cell of a toolchain row.
 *
 * @param row - The row.
 * @returns E.g. `game 2.4.2, core 7.0.2`, or a dash when every repository is on the accepted version.
 * @example
 * othersCell(row); // "game 2.4.2"
 */
export function othersCell(row: ToolRow): string {
  if (row.others.length === 0) return "—";

  return row.others.map(use => `${use.repo} ${use.version}`).join(", ");
}

/**
 * Render both tables as two collapsed Markdown blocks, for the organization page.
 *
 * @param tools - The toolchain rows, with `latest` filled.
 * @param runtime - The runtime rows.
 * @returns The Markdown, without a trailing newline.
 * @example
 * renderDepsMarkdown(tools, runtime);
 */
export function renderDepsMarkdown(
  tools: readonly ToolRow[],
  runtime: readonly RuntimeRow[]
): string {
  const split = tools.filter(row => row.others.length > 0).length;
  const old = tools.filter(row => row.latest !== undefined && isBehind(row.accepted, row.latest));

  return [
    "<details>",
    `<summary>Toolchain: ${tools.length} shared tools, ${split} on more than one version, ${old.length} behind npm</summary>`,
    "",
    "| Tool | Accepted | npm | Used by | Not on it |",
    "| --- | --- | --- | --- | --- |",
    ...tools.map(
      row =>
        `| ${row.name} | ${row.accepted} | ${row.latest ?? "—"} | ${row.users} | ${othersCell(row)} |`
    ),
    "",
    "</details>",
    "",
    "<details>",
    `<summary>Runtime dependencies: ${runtime.length} behind npm</summary>`,
    "",
    ...(runtime.length === 0
      ? ["Every runtime dependency is on the newest version."]
      : [
          "| Package | Repo | Version | npm |",
          "| --- | --- | --- | --- |",
          ...runtime.map(row => `| ${row.name} | ${row.repo} | ${row.version} | ${row.latest} |`)
        ]),
    "",
    "</details>"
  ].join("\n");
}

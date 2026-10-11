/**
 * @file `moku-release fleet` — the state of every repository of the organization in one
 * table: CI, release, tag against npm, commits nobody released, open pull requests, pins.
 *
 * Read-only. One GraphQL call answers the table, and one `npm view` per package adds the
 * version the registry serves. `--markdown` prints the public rows for the organization
 * page; `--json` prints every row for a machine. `--deps` adds two tables about the packages
 * the family does not own, at the cost of one `npm view` per package.
 */
import type { BrandConsole } from "@moku-labs/common/cli";
import {
  attention,
  FLEET_QUERY,
  type FleetRepo,
  parseFleet,
  pinsCell,
  pullRequestCell,
  renderFleetMarkdown,
  unreleasedCell
} from "../lib/fleet";
import {
  externalNames,
  othersCell,
  type RuntimeRow,
  renderDepsMarkdown,
  runtimeRows,
  type ToolRow,
  toolchainRows
} from "../lib/fleet-deps";
import { ownerRepoFrom } from "../lib/git";
import { parseDistTags } from "../lib/npm";
import { readManifest, repositoryUrlOf } from "../lib/package-json";
import type { CheckContext } from "../types";

/**
 * How `fleet` is invoked.
 *
 * @example
 * await runFleet({ ctx, ui, markdown: true });
 */
export type FleetOptions = {
  /** The ports and flags the command runs against. */
  ctx: CheckContext;
  /** The branded console every line is printed through. */
  ui: BrandConsole;
  /** Print every row as JSON and nothing else. */
  json?: boolean;
  /** Print the public rows as a Markdown table and nothing else. */
  markdown?: boolean;
  /** Add the toolchain table and the runtime dependencies that are behind npm. */
  deps?: boolean;
};

/**
 * The organization the command reads: the owner of this checkout's remote, or of the
 * manifest's `repository` when there is no remote.
 *
 * @param ctx - The ports and flags.
 * @returns The organization login, or `undefined` when neither names a GitHub owner.
 * @example
 * const org = await organizationOf(ctx); // "moku-labs"
 */
async function organizationOf(ctx: CheckContext): Promise<string | undefined> {
  const remote = await ctx.exec.capture("git", ["remote", "get-url", "origin"]);
  const manifest = await readManifest(ctx.files);
  const declared = manifest === undefined ? undefined : repositoryUrlOf(manifest);
  const url = remote.code === 0 ? remote.stdout : declared;

  return url === undefined ? undefined : ownerRepoFrom(url)?.split("/")[0];
}

/**
 * Add the version npm serves as `latest` to every row that publishes a package.
 *
 * @param ctx - The ports and flags.
 * @param repos - The rows from the query.
 * @returns The rows, with `npm` filled where the registry answered.
 * @example
 * const rows = await withRegistry(ctx, parsed);
 */
async function withRegistry(ctx: CheckContext, repos: readonly FleetRepo[]): Promise<FleetRepo[]> {
  return Promise.all(
    repos.map(async repo => {
      if (repo.packageName === undefined) return repo;

      const view = await ctx.exec.capture("npm", ["view", repo.packageName, "dist-tags", "--json"]);
      const latest = view.code === 0 ? parseDistTags(view.stdout)?.latest : undefined;

      return latest === undefined ? repo : { ...repo, npm: latest };
    })
  );
}

/**
 * Lay one row of the terminal table out in fixed columns.
 *
 * @param row - The cells of the row.
 * @returns The padded line.
 * @example
 * cells(["core", "green"]);
 */
function cells(row: readonly string[]): string {
  return row.map((cell, index) => cell.padEnd(index === 0 ? 10 : 9)).join(" ");
}

/**
 * Print the table and the list of what waits, for a person at a terminal.
 *
 * @param ui - The branded console.
 * @param repos - The rows.
 * @example
 * renderTerminal(ui, rows);
 */
function renderTerminal(ui: BrandConsole, repos: readonly FleetRepo[]): void {
  ui.heading("Fleet");
  ui.line(cells(["repo", "ci", "release", "tag", "npm", "ahead", "prs", "old pins"]));
  for (const repo of repos) {
    ui.line(
      cells([
        repo.name,
        repo.ci,
        repo.packageName === undefined ? "—" : repo.release,
        repo.tag ?? "—",
        repo.npm ?? "—",
        unreleasedCell(repo),
        pullRequestCell(repo),
        pinsCell(repo)
      ])
    );
  }

  ui.heading("Waits for a person");
  const waiting = repos.flatMap(repo => attention(repo).map(line => `${repo.name}: ${line}`));
  if (waiting.length === 0) ui.check(true, "nothing waits");
  for (const line of waiting) ui.check(false, line);
}

/** How many `npm view` calls run at once. The registry answers each in under a second. */
const REGISTRY_BATCH = 8;

/**
 * The newest version on npm of every named package, read a few at a time.
 *
 * @param ctx - The ports and flags.
 * @param names - The package names.
 * @returns Package name to its newest version; a package the registry did not answer for is left out.
 * @example
 * const latest = await newestVersions(ctx, ["typescript", "preact"]);
 */
async function newestVersions(
  ctx: CheckContext,
  names: readonly string[]
): Promise<Map<string, string>> {
  const latest = new Map<string, string>();

  for (let start = 0; start < names.length; start += REGISTRY_BATCH) {
    const batch = names.slice(start, start + REGISTRY_BATCH);
    const views = await Promise.all(
      batch.map(name => ctx.exec.capture("npm", ["view", name, "version"]))
    );

    for (const [index, view] of views.entries()) {
      const name = batch[index];
      if (name !== undefined && view.code === 0 && view.stdout.trim() !== "") {
        latest.set(name, view.stdout.trim());
      }
    }
  }

  return latest;
}

/**
 * Build both dependency tables: the shared toolchain, and the runtime dependencies that
 * npm has moved past.
 *
 * @param ctx - The ports and flags.
 * @param repos - The rows the tables are built from.
 * @returns The toolchain rows with `latest` filled, and the runtime rows.
 * @example
 * const tables = await dependencyTables(ctx, repos);
 */
async function dependencyTables(
  ctx: CheckContext,
  repos: readonly FleetRepo[]
): Promise<{ toolchain: ToolRow[]; runtime: RuntimeRow[] }> {
  const latest = await newestVersions(ctx, externalNames(repos));

  return {
    toolchain: toolchainRows(repos).map(row => {
      const newest = latest.get(row.name);
      return newest === undefined ? row : { ...row, latest: newest };
    }),
    runtime: runtimeRows(repos, latest)
  };
}

/**
 * Print both dependency tables, for a person at a terminal.
 *
 * @param ui - The branded console.
 * @param toolchain - The toolchain rows.
 * @param runtime - The runtime rows.
 * @example
 * renderDepsTerminal(ui, toolchain, runtime);
 */
function renderDepsTerminal(
  ui: BrandConsole,
  toolchain: readonly ToolRow[],
  runtime: readonly RuntimeRow[]
): void {
  ui.heading("Toolchain");
  ui.line(["tool".padEnd(28), "accepted".padEnd(14), "npm".padEnd(14), "not on it"].join(" "));
  for (const row of toolchain) {
    ui.line(
      [
        row.name.padEnd(28),
        row.accepted.padEnd(14),
        (row.latest ?? "—").padEnd(14),
        othersCell(row)
      ].join(" ")
    );
  }

  ui.heading("Runtime dependencies behind npm");
  if (runtime.length === 0) ui.check(true, "every runtime dependency is on the newest version");
  for (const row of runtime) {
    ui.line(
      [row.name.padEnd(28), row.repo.padEnd(10), row.version.padEnd(14), row.latest].join(" ")
    );
  }
}

/** Both dependency tables, present only when `--deps` asked for them. */
type DependencyTables = { toolchain: ToolRow[]; runtime: RuntimeRow[] } | undefined;

/**
 * Print every row as JSON: the rows alone, or the rows with both dependency tables.
 *
 * @param ui - The branded console.
 * @param repos - The rows.
 * @param tables - The dependency tables, when asked for.
 * @example
 * printJson(ui, repos, tables);
 */
function printJson(ui: BrandConsole, repos: readonly FleetRepo[], tables: DependencyTables): void {
  const output = tables === undefined ? repos : { repos, ...tables };

  ui.line(JSON.stringify(output, undefined, 2));
}

/**
 * Print the public rows as Markdown, then the dependency tables as collapsed blocks.
 *
 * @param ui - The branded console.
 * @param org - The organization login.
 * @param repos - The rows.
 * @param tables - The dependency tables, when asked for.
 * @example
 * printMarkdown(ui, "moku-labs", repos, tables);
 */
function printMarkdown(
  ui: BrandConsole,
  org: string,
  repos: readonly FleetRepo[],
  tables: DependencyTables
): void {
  ui.line(renderFleetMarkdown(org, repos));
  if (tables === undefined) return;

  ui.line("");
  ui.line(renderDepsMarkdown(tables.toolchain, tables.runtime));
}

/**
 * Print the table for a terminal, then the dependency tables.
 *
 * @param ui - The branded console.
 * @param repos - The rows.
 * @param tables - The dependency tables, when asked for.
 * @example
 * printTerminal(ui, repos, tables);
 */
function printTerminal(
  ui: BrandConsole,
  repos: readonly FleetRepo[],
  tables: DependencyTables
): void {
  renderTerminal(ui, repos);
  if (tables !== undefined) renderDepsTerminal(ui, tables.toolchain, tables.runtime);
}

/**
 * Read the state of every repository of the organization and print it.
 *
 * @param options - The ports, console and output flags.
 * @returns The process exit code: `1` only when the state could not be read.
 * @example
 * const code = await runFleet({ ctx, ui });
 */
export async function runFleet(options: FleetOptions): Promise<number> {
  const { ctx, ui, json = false, markdown = false, deps = false } = options;
  const quiet = json || markdown;

  if (!quiet) ui.lockup({ wordmark: "moku release", label: "fleet" });

  const org = await organizationOf(ctx);
  if (org === undefined) {
    ui.error("no GitHub organization found", "run inside a checkout whose `origin` is on GitHub");
    return 1;
  }

  const answer = await ctx.exec.capture("gh", [
    "api",
    "graphql",
    "-F",
    `org=${org}`,
    "-f",
    `query=${FLEET_QUERY}`
  ]);
  const parsed = answer.code === 0 ? parseFleet(answer.stdout) : undefined;
  if (parsed === undefined) {
    ui.error(`could not read the repositories of ${org}`, answer.stderr.trim() || "gh auth login");
    return 1;
  }

  const repos = await withRegistry(ctx, parsed);

  // The page the Markdown lands on is public, so its dependency tables read public rows only.
  const shown = markdown ? repos.filter(repo => !repo.isPrivate) : repos;
  const tables = deps ? await dependencyTables(ctx, shown) : undefined;

  if (json) printJson(ui, repos, tables);
  else if (markdown) printMarkdown(ui, org, repos, tables);
  else printTerminal(ui, repos, tables);

  return 0;
}

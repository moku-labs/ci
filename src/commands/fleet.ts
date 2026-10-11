/**
 * @file `moku-release fleet` — the state of every repository of the organization in one
 * table: CI, release, tag against npm, commits nobody released, open pull requests, pins.
 *
 * Read-only. One GraphQL call answers the table, and one `npm view` per package adds the
 * version the registry serves. `--markdown` prints the public rows for the organization
 * page; `--json` prints every row for a machine.
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

/**
 * Read the state of every repository of the organization and print it.
 *
 * @param options - The ports, console and output flags.
 * @returns The process exit code: `1` only when the state could not be read.
 * @example
 * const code = await runFleet({ ctx, ui });
 */
export async function runFleet(options: FleetOptions): Promise<number> {
  const { ctx, ui, json = false, markdown = false } = options;
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

  if (json) ui.line(JSON.stringify(repos, undefined, 2));
  else if (markdown) ui.line(renderFleetMarkdown(org, repos));
  else renderTerminal(ui, repos);

  return 0;
}

/**
 * @file `moku-release wait` — wait for the auto-release of the commit at `HEAD`, then prove
 * the artifact landed.
 *
 * A merge to `main` ships a patch by itself, so there is nothing to dispatch here. The
 * question this command answers is the one that closes a task: "is my commit in a version
 * that npm serves?". It is asked of the tags, not of one run, because a queued run can be
 * replaced by the run of a later merge, and then that later version carries the commit.
 */
import type { BrandConsole } from "@moku-labs/common/cli";
import { latestVersionTag, ownerRepoFrom } from "../lib/git";
import { parseRuns, type RunSummary, releaseUrl } from "../lib/github";
import { npmPackageUrl } from "../lib/npm";
import { readManifest, repositoryUrlOf } from "../lib/package-json";
import { PUBLISH_WORKFLOW_PATH } from "../templates/publish";
import type { CheckContext } from "../types";

/** Workflow file whose runs are read — the one that releases on a push to main. */
const PUBLISH_WORKFLOW_FILE = PUBLISH_WORKFLOW_PATH.split("/").pop() ?? "publish.yml";

/** How long to wait for a tag that holds the commit — 120 × 10s = twenty minutes. */
const TAG_POLL_ATTEMPTS = 120;

/** How long to wait for a run to start before saying none will — 12 × 10s = two minutes. */
const RUN_START_ATTEMPTS = 12;

/** How long to keep asking the registry for the version — 60 × 10s = ten minutes. */
const REGISTRY_POLL_ATTEMPTS = 60;

/** Gap between polls of every loop here. */
const POLL_INTERVAL_MS = 10_000;

/** The `gh run list` call that reads the newest `publish.yml` runs on main. */
const RECENT_RUNS_ARGS = [
  "run",
  "list",
  "--workflow",
  PUBLISH_WORKFLOW_FILE,
  "--branch",
  "main",
  "--limit",
  "5",
  "--json",
  "databaseId,headSha,status,conclusion"
] as const;

/** Argv for the release tags that hold a commit, oldest first: the first one shipped it. */
const TAGS_WITH_HEAD_ARGS = [
  "-c",
  "versionsort.suffix=-",
  "tag",
  "--list",
  "v*",
  "--contains",
  "HEAD",
  "--sort=v:refname"
] as const;

/**
 * How `wait` is invoked. `sleep` is injected so tests exercise the polling loops instantly.
 *
 * @example
 * await runWait({ ctx, ui });
 */
export type WaitOptions = {
  /** The ports and flags the command runs against. */
  ctx: CheckContext;
  /** The branded console every line is printed through. */
  ui: BrandConsole;
  /**
   * Delay helper used by the polling loops.
   *
   * @param ms - Milliseconds to wait.
   * @returns Resolves after the delay.
   * @example
   * await sleep(1000);
   */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * The default delay helper.
 *
 * @param ms - Milliseconds to wait.
 * @returns Resolves after the delay.
 * @example
 * await defaultSleep(500);
 */
const defaultSleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * Whether `HEAD` is an ancestor of a ref, i.e. the ref holds the commit.
 *
 * @param ctx - The ports and flags.
 * @param ref - A branch, tag or sha.
 * @returns `true` when the ref holds `HEAD`.
 * @example
 * await holdsHead(ctx, "origin/main");
 */
async function holdsHead(ctx: CheckContext, ref: string): Promise<boolean> {
  const result = await ctx.exec.capture("git", ["merge-base", "--is-ancestor", "HEAD", ref]);

  return result.code === 0;
}

/**
 * The newest `publish.yml` run whose commit holds `HEAD`. A run of a later merge counts:
 * its version carries the commit too.
 *
 * @param ctx - The ports and flags.
 * @returns The run, or `undefined` when no run covers the commit yet.
 * @example
 * const run = await coveringRun(ctx);
 */
async function coveringRun(ctx: CheckContext): Promise<RunSummary | undefined> {
  const listing = await ctx.exec.capture("gh", RECENT_RUNS_ARGS);
  if (listing.code !== 0) return undefined;

  // `gh run list` prints newest first, so the first match is the newest covering run.
  for (const run of parseRuns(listing.stdout)) {
    if (await holdsHead(ctx, run.headSha)) return run;
  }

  return undefined;
}

/**
 * Wait until a release tag holds `HEAD`. Stops early when the covering run failed, or when
 * no run started at all.
 *
 * @param ctx - The ports and flags.
 * @param ui - The branded console.
 * @param sleep - The delay helper.
 * @returns The tag, or `undefined` after the reason was printed.
 * @example
 * const tag = await awaitTag(ctx, ui, defaultSleep);
 */
async function awaitTag(
  ctx: CheckContext,
  ui: BrandConsole,
  sleep: (ms: number) => Promise<void>
): Promise<string | undefined> {
  for (let attempt = 0; attempt < TAG_POLL_ATTEMPTS; attempt += 1) {
    await ctx.exec.capture("git", ["fetch", "--tags", "--prune"]);

    const tags = await ctx.exec.capture("git", TAGS_WITH_HEAD_ARGS);
    const tag = tags.code === 0 ? latestVersionTag(tags.stdout) : undefined;
    if (tag !== undefined) return tag;

    const run = await coveringRun(ctx);
    if (run === undefined && attempt >= RUN_START_ATTEMPTS) {
      ui.error(
        `no ${PUBLISH_WORKFLOW_FILE} run started for this commit`,
        `${PUBLISH_WORKFLOW_FILE} needs \`push: branches: [main]\`; a Dependabot merge needs the dispatch step of dependabot-automerge.yml`
      );
      return undefined;
    }
    if (run?.status === "completed" && run.conclusion !== "success") {
      ui.error(
        `run ${run.databaseId} ended as ${run.conclusion}`,
        `gh run view ${run.databaseId} --log-failed`
      );
      return undefined;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  ui.error("no release tag holds this commit after twenty minutes");
  return undefined;
}

/**
 * Poll the registry until it serves one exact version. The registry lags behind a
 * successful publish, so "not there yet" is expected for a while.
 *
 * @param ctx - The ports and flags.
 * @param name - The package name.
 * @param version - The version the tag names.
 * @param sleep - The delay helper.
 * @returns `true` when the registry serves the version.
 * @example
 * await awaitVersion(ctx, "@moku-labs/common", "1.2.4", defaultSleep);
 */
async function awaitVersion(
  ctx: CheckContext,
  name: string,
  version: string,
  sleep: (ms: number) => Promise<void>
): Promise<boolean> {
  for (let attempt = 0; attempt < REGISTRY_POLL_ATTEMPTS; attempt += 1) {
    const view = await ctx.exec.capture("npm", ["view", `${name}@${version}`, "version"]);
    if (view.code === 0 && view.stdout.trim() === version) return true;

    await sleep(POLL_INTERVAL_MS);
  }

  return false;
}

/**
 * Wait for the auto-release of `HEAD`: the commit is on `origin/main`, a release tag holds
 * it, and npm serves that version.
 *
 * @param options - The ports, console and delay helper.
 * @returns The process exit code.
 * @example
 * const code = await runWait({ ctx, ui });
 */
export async function runWait(options: WaitOptions): Promise<number> {
  const { ctx, ui, sleep = defaultSleep } = options;

  ui.lockup({ wordmark: "moku release", label: "wait" });

  const manifest = await readManifest(ctx.files);
  if (!manifest?.name) {
    ui.error("package.json is missing, malformed, or has no `name`");
    return 1;
  }

  // An unmerged commit is never released, so waiting for it would only time out.
  await ctx.exec.capture("git", ["fetch", "--tags", "--prune"]);
  if (!(await holdsHead(ctx, "origin/main"))) {
    ui.error("HEAD is not on origin/main", "merge the PR, then: git checkout main && git pull");
    return 1;
  }

  ui.heading("Tag");
  const tag = await awaitTag(ctx, ui, sleep);
  if (tag === undefined) return 1;
  ui.check(true, `${tag} holds this commit`);

  ui.heading("Registry");
  const version = tag.replace(/^v/, "");
  if (!(await awaitVersion(ctx, manifest.name, version, sleep))) {
    ui.error(`npm does not serve ${manifest.name}@${version} after ten minutes`);
    return 1;
  }

  const declared = repositoryUrlOf(manifest);
  const ownerRepo = declared === undefined ? undefined : ownerRepoFrom(declared);
  const lines = [
    ui.railLine(manifest.name, version, 48),
    ui.railLine("tag", tag, 48),
    ui.railLine("npm", npmPackageUrl(manifest.name, version), 48)
  ];
  if (ownerRepo !== undefined) lines.push(ui.railLine("release", releaseUrl(ownerRepo, tag), 48));

  ui.heading("Released");
  ui.box(lines);
  return 0;
}

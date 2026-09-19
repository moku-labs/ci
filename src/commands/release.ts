/**
 * @file `moku-release <patch|minor|major|prerelease>` — cut a release through the
 * repository's own `publish.yml`, then prove the artifact actually landed.
 *
 * Fails closed: the preflight is `doctor` in strict mode, so a dirty tree or a HEAD that
 * is not `origin/main` stops the run before anything is dispatched. The CLI never
 * publishes anything itself — it dispatches the workflow, watches the run, and then polls
 * the registry, because "the workflow went green" and "the version is installable" are
 * different claims and only the second one is worth printing.
 */
import type { BrandConsole } from "@moku-labs/common/cli";
import { allChecks } from "../checks";
import type { ReleaseType } from "../lib/argv";
import { ownerRepoFrom } from "../lib/git";
import { latestRunId, releaseUrl } from "../lib/github";
import { distTagFor, npmPackageUrl, parseDistTags } from "../lib/npm";
import { readManifest, repositoryUrlOf } from "../lib/package-json";
import { PUBLISH_WORKFLOW_PATH } from "../templates/publish";
import type { CheckContext } from "../types";
import { runDoctor } from "./doctor";

/** Workflow file dispatched by name — the same name npm's trusted publisher is bound to. */
const PUBLISH_WORKFLOW_FILE = PUBLISH_WORKFLOW_PATH.split("/").pop() ?? "publish.yml";

/** How long to keep asking the registry for the new version before giving up. */
const REGISTRY_POLL_ATTEMPTS = 60;

/** Gap between registry polls — 60 × 10s = ten minutes. The first live release needed three. */
const REGISTRY_POLL_INTERVAL_MS = 10_000;

/** How many times to look for the dispatched run before concluding it never started. */
const RUN_LOOKUP_ATTEMPTS = 20;

/** Gap between run lookups — GitHub takes a moment to materialize a dispatched run. */
const RUN_LOOKUP_INTERVAL_MS = 3000;

/**
 * How `release` is invoked. `sleep` is injected so tests exercise the polling loops
 * instantly.
 *
 * @example
 * await runRelease({ ctx, ui, releaseType: "patch", dryRun: true });
 */
export type ReleaseOptions = {
  /** The ports and flags the release runs against. */
  ctx: CheckContext;
  /** The branded console every line is printed through. */
  ui: BrandConsole;
  /** The semver bump to dispatch. */
  releaseType: ReleaseType;
  /** Print the plan without dispatching anything. */
  dryRun?: boolean;
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
 * Run the strict preflight and print it. Strict mode is what turns the advisory
 * working-tree check into a stop condition.
 *
 * @param ctx - The ports and flags.
 * @param ui - The branded console.
 * @returns `true` when nothing blocks the release.
 * @example
 * if (!(await preflight(ctx, ui))) return 1;
 */
async function preflight(ctx: CheckContext, ui: BrandConsole): Promise<boolean> {
  ui.heading("Preflight");

  const report = await runDoctor({ ctx: { ...ctx, strict: true }, ui, checks: allChecks });
  if (report.failed) ui.error("preflight failed — nothing was dispatched");

  return !report.failed;
}

/** The `gh run list` call that names the newest `publish.yml` run on main. */
const LATEST_RUN_ARGS = [
  "run",
  "list",
  "--workflow",
  PUBLISH_WORKFLOW_FILE,
  "--branch",
  "main",
  "--limit",
  "1",
  "--json",
  "databaseId"
] as const;

/**
 * The newest `publish.yml` run right now. Read BEFORE the dispatch, it is the run the
 * dispatch must not be confused with.
 *
 * @param ctx - The ports and flags.
 * @returns The run id, or `undefined` when the workflow never ran.
 * @example
 * const previous = await newestRun(ctx);
 */
async function newestRun(ctx: CheckContext): Promise<string | undefined> {
  const listing = await ctx.exec.capture("gh", LATEST_RUN_ARGS);

  return listing.code === 0 ? latestRunId(listing.stdout) : undefined;
}

/**
 * Find the run the dispatch just created, retrying while GitHub materializes it. The
 * newest run is only ours once it differs from `previous`: asked too early, GitHub still
 * answers with the run of the release before.
 *
 * @param ctx - The ports and flags.
 * @param previous - The newest run id from before the dispatch.
 * @param sleep - The delay helper.
 * @returns The run id, or `undefined` when no new run appeared.
 * @example
 * const runId = await findDispatchedRun(ctx, previous, defaultSleep);
 */
async function findDispatchedRun(
  ctx: CheckContext,
  previous: string | undefined,
  sleep: (ms: number) => Promise<void>
): Promise<string | undefined> {
  for (let attempt = 0; attempt < RUN_LOOKUP_ATTEMPTS; attempt += 1) {
    const runId = await newestRun(ctx);
    if (runId !== undefined && runId !== previous) return runId;

    await sleep(RUN_LOOKUP_INTERVAL_MS);
  }

  return undefined;
}

/**
 * Poll the registry until the expected dist-tag moves off `before`. The registry lags
 * behind a successful publish, so "not there yet" is expected for a while and only a
 * timeout is an error.
 *
 * @param ctx - The ports and flags.
 * @param name - The package name.
 * @param tag - The dist-tag the new version lands under.
 * @param before - The version that tag pointed at before the release.
 * @param sleep - The delay helper.
 * @returns The new version, or `undefined` when the registry never moved.
 * @example
 * await awaitPublishedVersion(ctx, "@moku-labs/common", "latest", "1.2.2", defaultSleep);
 */
async function awaitPublishedVersion(
  ctx: CheckContext,
  name: string,
  tag: string,
  before: string | undefined,
  sleep: (ms: number) => Promise<void>
): Promise<string | undefined> {
  for (let attempt = 0; attempt < REGISTRY_POLL_ATTEMPTS; attempt += 1) {
    const view = await ctx.exec.capture("npm", ["view", name, "dist-tags", "--json"]);
    const current = view.code === 0 ? parseDistTags(view.stdout)?.[tag] : undefined;
    if (current !== undefined && current !== before) return current;

    await sleep(REGISTRY_POLL_INTERVAL_MS);
  }

  return undefined;
}

/**
 * Print the closing summary: what shipped, where its tag is, and the two links a human
 * actually clicks.
 *
 * @param ui - The branded console.
 * @param name - The package name.
 * @param version - The published version.
 * @param ownerRepo - The `owner/repo` slug, when one is known.
 * @example
 * renderSummary(ui, "@moku-labs/common", "1.2.3", "moku-labs/common");
 */
function renderSummary(
  ui: BrandConsole,
  name: string,
  version: string,
  ownerRepo: string | undefined
): void {
  const tag = `v${version}`;
  const lines = [
    ui.railLine(`${name}`, version, 48),
    ui.railLine("tag", tag, 48),
    ui.railLine("npm", npmPackageUrl(name, version), 48)
  ];

  if (ownerRepo !== undefined) lines.push(ui.railLine("release", releaseUrl(ownerRepo, tag), 48));
  ui.heading("Released");
  ui.box(lines);
}

/**
 * Cut a release: preflight, dispatch `publish.yml`, watch the run, verify the artifact.
 *
 * @param options - The ports, console, bump type and flags.
 * @returns The process exit code.
 * @example
 * const code = await runRelease({ ctx, ui, releaseType: "patch" });
 */
export async function runRelease(options: ReleaseOptions): Promise<number> {
  const { ctx, ui, releaseType, dryRun = false, sleep = defaultSleep } = options;

  ui.lockup({ wordmark: "moku release", label: dryRun ? `${releaseType} · dry-run` : releaseType });

  const manifest = await readManifest(ctx.files);
  if (!manifest?.name) {
    ui.error("package.json is missing, malformed, or has no `name`");
    return 1;
  }

  // The preflight compares against the remote, so refresh it first.
  await ctx.exec.capture("git", ["fetch", "--tags", "--prune"]);
  if (!(await preflight(ctx, ui))) return 1;

  const declared = repositoryUrlOf(manifest);
  const ownerRepo = declared === undefined ? undefined : ownerRepoFrom(declared);
  const tag = distTagFor(releaseType === "prerelease" ? "0.0.0-rc.0" : "0.0.0");

  const currentTags = await ctx.exec.capture("npm", ["view", manifest.name, "dist-tags", "--json"]);
  const before = parseDistTags(currentTags.stdout)?.[tag];

  if (dryRun) {
    ui.heading("Plan");
    ui.info(`gh workflow run ${PUBLISH_WORKFLOW_FILE} -f release_type=${releaseType} --ref main`);
    ui.info(`watch the run, then wait for npm dist-tag \`${tag}\` to move from ${before ?? "—"}`);
    return 0;
  }

  ui.heading("Dispatch");
  const previousRun = await newestRun(ctx);
  const dispatched = await ctx.exec.capture("gh", [
    "workflow",
    "run",
    PUBLISH_WORKFLOW_FILE,
    "-f",
    `release_type=${releaseType}`,
    "--ref",
    "main"
  ]);
  if (dispatched.code !== 0) {
    ui.error("could not dispatch the workflow", dispatched.stderr.trim());
    return 1;
  }
  ui.check(true, `${PUBLISH_WORKFLOW_FILE} dispatched (${releaseType})`);

  const runId = await findDispatchedRun(ctx, previousRun, sleep);
  if (runId === undefined) {
    ui.error("the dispatched run never appeared — check GitHub Actions");
    return 1;
  }

  ui.heading("Run");
  const watched = await ctx.exec.inherit("gh", ["run", "watch", runId, "--exit-status"]);
  if (watched !== 0) {
    ui.error(`run ${runId} did not succeed`);
    return 1;
  }

  ui.heading("Registry");
  const version = await awaitPublishedVersion(ctx, manifest.name, tag, before, sleep);
  if (version === undefined) {
    ui.error(
      `npm dist-tag \`${tag}\` did not move in ten minutes — the run passed, so check \`npm view ${manifest.name} dist-tags\` before releasing again`
    );
    return 1;
  }

  renderSummary(ui, manifest.name, version, ownerRepo);
  return 0;
}

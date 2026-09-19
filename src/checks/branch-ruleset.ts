/**
 * @file `moku-release` — check: a branch ruleset protects the default branch.
 *
 * Advisory. The release pipeline works without it; what it buys is that main can only
 * move through a PR, so a release always describes a reviewed state.
 */
import { ownerRepoFrom } from "../lib/git";
import {
  activeBranchRulesetIds,
  hasMainBranchRuleset,
  requiredCheckContexts,
  requiredChecksDrift
} from "../lib/github";
import { readManifest, repositoryUrlOf } from "../lib/package-json";
import { pass, skip, warn } from "../lib/result";
import { renderMainRuleset } from "../lib/templates";
import type { CheckContext, CheckResult, ReleaseCheck } from "../types";

/**
 * An active branch ruleset that still requires checks the central workflows never report.
 *
 * @example
 * const stale: StaleRuleset = { id: 7, body: "{…}", legacy: ["lint"] };
 */
export type StaleRuleset = {
  /** The ruleset id. */
  id: number;
  /** The full ruleset as `gh api` printed it. */
  body: string;
  /** The required contexts that are a central check without the `ci / ` prefix. */
  legacy: string[];
};

/**
 * Find the first active branch ruleset whose required checks are not the central ones. A
 * legacy ruleset requires `lint`; the thin caller reports `ci / lint`, so no PR can merge.
 *
 * @param ctx - The injected ports.
 * @param ownerRepo - The `owner/repo` slug.
 * @param listing - Output of `gh api repos/{owner}/{repo}/rulesets`.
 * @returns The stale ruleset, or `undefined` when every ruleset is on the central checks.
 * @example
 * const stale = await findStaleRuleset(ctx, "moku-labs/system", listing.stdout);
 */
export async function findStaleRuleset(
  ctx: CheckContext,
  ownerRepo: string,
  listing: string
): Promise<StaleRuleset | undefined> {
  const central = requiredCheckContexts(renderMainRuleset());

  for (const id of activeBranchRulesetIds(listing)) {
    const detail = await ctx.exec.capture("gh", ["api", `repos/${ownerRepo}/rulesets/${id}`]);
    if (detail.code !== 0) continue;

    // A project's own required check (`ci-pass` of a matrix workflow) is not legacy
    const { legacy } = requiredChecksDrift(requiredCheckContexts(detail.stdout), central);
    if (legacy.length > 0) return { id, body: detail.stdout, legacy };
  }

  return undefined;
}

/** Verifies `gh api repos/{owner}/{repo}/rulesets` lists an active, up-to-date branch ruleset. */
export const branchRulesetCheck: ReleaseCheck = {
  id: "branch-ruleset",
  title: "branch ruleset on main",
  /**
   * List the repository's rulesets, look for an active branch-targeting one, and make sure
   * it does not require legacy check names.
   *
   * @param ctx - The injected ports.
   * @returns Pass when one exists on the central checks, warn otherwise.
   * @example
   * await branchRulesetCheck.run(ctx);
   */
  async run(ctx): Promise<CheckResult> {
    const manifest = await readManifest(ctx.files);
    const declared = manifest === undefined ? undefined : repositoryUrlOf(manifest);
    const ownerRepo = declared === undefined ? undefined : ownerRepoFrom(declared);
    if (ownerRepo === undefined) return skip("cannot derive owner/repo from repository.url");

    const rulesets = await ctx.exec.capture("gh", ["api", `repos/${ownerRepo}/rulesets`]);
    if (rulesets.code !== 0) return skip("`gh api` could not read the rulesets");

    if (!hasMainBranchRuleset(rulesets.stdout)) {
      return warn("main has no branch ruleset", "moku-release setup");
    }

    const stale = await findStaleRuleset(ctx, ownerRepo, rulesets.stdout);
    if (stale !== undefined) {
      return warn(
        `ruleset requires legacy checks: ${stale.legacy.join(", ")}`,
        "moku-release setup"
      );
    }

    return pass("active branch ruleset present");
  }
};

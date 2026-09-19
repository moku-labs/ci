/**
 * @file `moku-release` — check: a branch ruleset protects the default branch.
 *
 * Advisory. The release pipeline works without it; what it buys is that main can only
 * move through a PR, so a release always describes a reviewed state.
 */
import { ownerRepoFrom } from "../lib/git";
import { hasMainBranchRuleset } from "../lib/github";
import { readManifest, repositoryUrlOf } from "../lib/package-json";
import { pass, skip, warn } from "../lib/result";
import type { CheckResult, ReleaseCheck } from "../types";

/** Verifies `gh api repos/{owner}/{repo}/rulesets` lists an active branch ruleset. */
export const branchRulesetCheck: ReleaseCheck = {
  id: "branch-ruleset",
  title: "branch ruleset on main",
  /**
   * List the repository's rulesets and look for an active branch-targeting one.
   *
   * @param ctx - The injected ports.
   * @returns Pass when one exists, warn when none does.
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

    return pass("active branch ruleset present");
  }
};

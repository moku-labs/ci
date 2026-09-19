/**
 * @file `moku-release` — check: the GitHub CLI is installed and authenticated.
 *
 * A human-only prerequisite. The CLI never logs anyone in and never handles a token: it
 * reports the exact command the operator must run and stops there.
 */
import { fail, pass } from "../lib/result";
import type { CheckResult, ReleaseCheck } from "../types";

/** Verifies `gh` exists and holds a live session. */
export const ghAuthCheck: ReleaseCheck = {
  id: "gh-auth",
  title: "gh installed and authenticated",
  /**
   * Probe `gh --version`, then `gh auth status`.
   *
   * @param ctx - The injected ports.
   * @returns Pass when both succeed, otherwise the command the human must run.
   * @example
   * await ghAuthCheck.run(ctx);
   */
  async run(ctx): Promise<CheckResult> {
    const installed = await ctx.exec.capture("gh", ["--version"]);
    if (installed.code !== 0) return fail("`gh` is not installed", "brew install gh");

    const session = await ctx.exec.capture("gh", ["auth", "status"]);
    if (session.code !== 0) return fail("`gh` is not authenticated", "gh auth login");

    return pass("authenticated");
  }
};

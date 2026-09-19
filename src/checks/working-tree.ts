/**
 * @file `moku-release` — check: the working tree is clean and HEAD is `origin/main`.
 *
 * The only check whose severity depends on the caller: in `doctor` a dirty tree is
 * information (`warn`), in the `release` preflight it is a stop condition (`fail`) —
 * releasing from a state the remote has never seen produces a tag nobody can reproduce.
 * `ctx.strict` is the switch.
 */
import { fail, pass, skip, warn } from "../lib/result";
import type { CheckContext, CheckResult, ReleaseCheck } from "../types";

/** Ref the release is always cut from. */
const RELEASE_REF = "origin/main";

/**
 * Report a problem at the severity the calling command asked for.
 *
 * @param ctx - The injected ports, carrying the `strict` flag.
 * @param detail - What was observed.
 * @param fixLine - The command that resolves it.
 * @returns A failing result under `strict`, otherwise a warning.
 * @example
 * atSeverity(ctx, "working tree is dirty", "git status");
 */
function atSeverity(ctx: CheckContext, detail: string, fixLine: string): CheckResult {
  return ctx.strict ? fail(detail, fixLine) : warn(detail, fixLine);
}

/** Verifies there is nothing uncommitted and HEAD equals `origin/main`. */
export const workingTreeCheck: ReleaseCheck = {
  id: "working-tree",
  title: "clean tree on origin/main",
  /**
   * Compare the porcelain status and the HEAD / `origin/main` revisions.
   *
   * @param ctx - The injected ports.
   * @returns Pass when both agree; severity follows `ctx.strict` otherwise.
   * @example
   * await workingTreeCheck.run({ ...ctx, strict: true });
   */
  async run(ctx): Promise<CheckResult> {
    const status = await ctx.exec.capture("git", ["status", "--porcelain"]);
    if (status.code !== 0) return skip("not a git repository");
    if (status.stdout.trim() !== "") {
      return atSeverity(ctx, "working tree has uncommitted changes", "commit or stash them");
    }

    const head = await ctx.exec.capture("git", ["rev-parse", "HEAD"]);
    const remote = await ctx.exec.capture("git", ["rev-parse", RELEASE_REF]);
    if (head.code !== 0 || remote.code !== 0) return skip(`cannot resolve ${RELEASE_REF}`);

    if (head.stdout.trim() !== remote.stdout.trim()) {
      return atSeverity(ctx, `HEAD is not ${RELEASE_REF}`, `git pull --ff-only origin main`);
    }

    return pass(`clean, in sync with ${RELEASE_REF}`);
  }
};

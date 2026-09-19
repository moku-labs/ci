/**
 * @file `moku-release` — check: npm holds a logged-in session.
 *
 * The second human-only prerequisite. Publishing itself runs through OIDC in CI, but the
 * one-time `setup` (first publish, `npm trust`) needs a local session — and only the human
 * can create one.
 */
import { fail, pass } from "../lib/result";
import type { CheckResult, ReleaseCheck } from "../types";

/** Verifies `npm whoami` resolves to a user. */
export const npmAuthCheck: ReleaseCheck = {
  id: "npm-auth",
  title: "npm is logged in",
  /**
   * Probe `npm whoami`.
   *
   * @param ctx - The injected ports.
   * @returns Pass with the username, otherwise the login command.
   * @example
   * await npmAuthCheck.run(ctx);
   */
  async run(ctx): Promise<CheckResult> {
    const session = await ctx.exec.capture("npm", ["whoami"]);
    if (session.code !== 0) return fail("npm is not logged in", "npm login");

    return pass(`logged in as ${session.stdout.trim()}`);
  }
};

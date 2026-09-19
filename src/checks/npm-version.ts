/**
 * @file `moku-release` — check: the local npm is new enough for Trusted Publishing.
 *
 * OIDC trusted publishing (and the `npm trust` command `setup` registers the publisher
 * with) landed in npm 11.5.1. Below that floor the whole token-free pipeline is
 * unavailable, so this is a hard fail rather than an advisory.
 */
import { isAtLeast } from "../lib/npm";
import { fail, pass } from "../lib/result";
import type { CheckResult, ReleaseCheck } from "../types";

/** The npm version that introduced OIDC trusted publishing. */
export const NPM_TRUSTED_PUBLISHING_FLOOR = "11.5.1";

/** Verifies `npm --version` is at or above the Trusted Publishing floor. */
export const npmVersionCheck: ReleaseCheck = {
  id: "npm-version",
  title: `npm >= ${NPM_TRUSTED_PUBLISHING_FLOOR}`,
  /**
   * Read `npm --version` and compare it to the floor.
   *
   * @param ctx - The injected ports.
   * @returns Pass with the version, otherwise the upgrade command.
   * @example
   * await npmVersionCheck.run(ctx);
   */
  async run(ctx): Promise<CheckResult> {
    const probe = await ctx.exec.capture("npm", ["--version"]);
    if (probe.code !== 0) return fail("`npm` is not installed", "install Node 24 (bundles npm 11)");

    const version = probe.stdout.trim();
    if (!isAtLeast(version, NPM_TRUSTED_PUBLISHING_FLOOR)) {
      return fail(`npm ${version} < ${NPM_TRUSTED_PUBLISHING_FLOOR}`, "npm install -g npm@latest");
    }

    return pass(`npm ${version}`);
  }
};

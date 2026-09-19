/**
 * @file `moku-release` — check: the package exists on the registry.
 *
 * Advisory, not blocking: a brand-new package legitimately has no npm presence yet, and
 * `setup` is what performs that first publish.
 */
import { readManifest } from "../lib/package-json";
import { pass, skip, warn } from "../lib/result";
import type { CheckResult, ReleaseCheck } from "../types";

/** Verifies `npm view <name> version` resolves. */
export const npmPackageCheck: ReleaseCheck = {
  id: "npm-package",
  title: "package published on npm",
  /**
   * Ask the registry for the package's current version.
   *
   * @param ctx - The injected ports.
   * @returns Pass with the published version, or a warning that the first publish is due.
   * @example
   * await npmPackageCheck.run(ctx);
   */
  async run(ctx): Promise<CheckResult> {
    const manifest = await readManifest(ctx.files);
    if (!manifest?.name) return skip("package.json declares no `name`");

    const view = await ctx.exec.capture("npm", ["view", manifest.name, "version"]);
    if (view.code !== 0) return warn("first publish not done yet", "moku-release setup");

    return pass(`${manifest.name}@${view.stdout.trim()}`);
  }
};

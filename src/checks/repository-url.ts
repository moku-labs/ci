/**
 * @file `moku-release` — check: `repository.url` points at the real origin.
 *
 * A manifest that names the wrong repository publishes provenance for the wrong
 * repository, and npm Trusted Publishing matches on that repository — so a mismatch here
 * surfaces later as an opaque OIDC rejection.
 */
import { sameRemote } from "../lib/git";
import { readManifest, repositoryUrlOf } from "../lib/package-json";
import { fail, pass, skip } from "../lib/result";
import type { CheckResult, ReleaseCheck } from "../types";

/** Verifies the declared repository URL matches `git remote get-url origin`. */
export const repositoryUrlCheck: ReleaseCheck = {
  id: "repository-url",
  title: "repository.url matches origin",
  /**
   * Compare the manifest's repository URL with the git remote, in canonical form.
   *
   * @param ctx - The injected ports.
   * @returns Pass when both name the same repository.
   * @example
   * await repositoryUrlCheck.run(ctx);
   */
  async run(ctx): Promise<CheckResult> {
    const manifest = await readManifest(ctx.files);
    if (!manifest) return skip("package.json is missing or malformed");

    const origin = await ctx.exec.capture("git", ["remote", "get-url", "origin"]);
    if (origin.code !== 0) return skip("no `origin` remote configured");

    const declared = repositoryUrlOf(manifest);
    if (declared === undefined) {
      return fail("package.json declares no `repository.url`", "moku-release setup");
    }
    if (!sameRemote(declared, origin.stdout)) {
      return fail(
        `repository.url (${declared.trim()}) != origin (${origin.stdout.trim()})`,
        `set repository.url to "${origin.stdout.trim()}"`
      );
    }

    return pass(declared.trim());
  }
};

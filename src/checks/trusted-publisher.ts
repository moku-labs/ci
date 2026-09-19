/**
 * @file `moku-release` — check: npm knows this repo's `publish.yml` as a trusted publisher.
 *
 * Without the registration the release workflow's OIDC token is rejected and the publish
 * step fails at the very end of a run, so this is fail-level. An npm too old to even have
 * `npm trust` warns instead — the answer there is an upgrade, not a registration.
 */
import { ownerRepoFrom } from "../lib/git";
import { readManifest, repositoryUrlOf } from "../lib/package-json";
import { fail, pass, skip, warn } from "../lib/result";
import { PUBLISH_WORKFLOW_PATH } from "../templates/publish";
import type { CheckResult, ReleaseCheck } from "../types";

/** Basename npm registers the publisher against — the workflow file's name, not its path. */
const PUBLISH_WORKFLOW_FILE = PUBLISH_WORKFLOW_PATH.split("/").pop() ?? "publish.yml";

/**
 * Whether npm's output says the `trust` command itself does not exist.
 *
 * @param output - The combined stdout/stderr npm produced.
 * @returns `true` when the installed npm has no `trust` command.
 * @example
 * isUnknownCommand("Unknown command: \"trust\"");
 */
function isUnknownCommand(output: string): boolean {
  return /unknown command|did you mean|not a recognized/i.test(output);
}

/**
 * Whether npm refused the listing because nobody is logged in.
 *
 * @param output - The combined stdout/stderr npm produced.
 * @returns `true` when the failure is an authentication failure, not a missing registration.
 * @example
 * isUnauthorized("npm error code E401");
 */
function isUnauthorized(output: string): boolean {
  return /E401|ENEEDAUTH|401 Unauthorized/i.test(output);
}

/**
 * Whether npm refused the listing because the account needs a one-time password. Output is
 * captured here, so npm cannot prompt: the answer is unknown, not "missing".
 *
 * @param output - The combined stdout/stderr npm produced.
 * @returns `true` when npm asked for an OTP.
 * @example
 * isOtpRequired("npm error code EOTP");
 */
function isOtpRequired(output: string): boolean {
  return /EOTP|one-time password/i.test(output);
}

/**
 * The exact registration command for this package and repository.
 *
 * @param name - The package name.
 * @param ownerRepo - The `owner/repo` slug.
 * @returns The `npm trust github …` command line.
 * @example
 * trustCommand("@moku-labs/common", "moku-labs/common");
 */
function trustCommand(name: string, ownerRepo: string): string {
  return `npm trust github ${name} --file ${PUBLISH_WORKFLOW_FILE} --repo ${ownerRepo} --allow-publish --yes`;
}

/** Verifies a trusted publisher is registered for the package. */
export const trustedPublisherCheck: ReleaseCheck = {
  id: "trusted-publisher",
  title: "npm trusted publisher registered",
  /**
   * List the package's trusted publishers and look for this repo's `publish.yml`.
   *
   * @param ctx - The injected ports.
   * @returns Pass when registered, warn when npm is too old, skip when logged out, otherwise the exact command.
   * @example
   * await trustedPublisherCheck.run(ctx);
   */
  async run(ctx): Promise<CheckResult> {
    const manifest = await readManifest(ctx.files);
    if (!manifest?.name) return skip("package.json declares no `name`");

    const declared = repositoryUrlOf(manifest);
    const ownerRepo = declared === undefined ? undefined : ownerRepoFrom(declared);
    if (ownerRepo === undefined) return skip("cannot derive owner/repo from repository.url");

    const listing = await ctx.exec.capture("npm", ["trust", "list", manifest.name]);
    if (isUnknownCommand(`${listing.stdout}${listing.stderr}`)) {
      return warn("this npm has no `trust` command", "upgrade npm");
    }
    // Logged out, the registry refuses to list publishers: unknown is not the same as missing
    if (isUnauthorized(`${listing.stdout}${listing.stderr}`)) {
      return skip("cannot list trusted publishers without `npm login`");
    }
    // Behind 2FA the listing wants an OTP: say so instead of reporting a missing registration
    if (isOtpRequired(`${listing.stdout}${listing.stderr}`)) {
      return warn(
        "npm asks for an OTP, cannot verify from here",
        `npm trust list ${manifest.name}`
      );
    }
    if (listing.code !== 0 || !listing.stdout.includes(PUBLISH_WORKFLOW_FILE)) {
      return fail("no trusted publisher registered", trustCommand(manifest.name, ownerRepo));
    }

    return pass(`${ownerRepo} · ${PUBLISH_WORKFLOW_FILE}`);
  }
};

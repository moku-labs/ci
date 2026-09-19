/**
 * @file `moku-release` — check: package.json declares the release contract.
 *
 * Reports every gap by name (`missing script \`typecheck\``, not "scripts incomplete") so
 * the fix is mechanical, and points at the one command that closes all of them.
 */
import { contractIssues, readManifest } from "../lib/package-json";
import { fail, pass, skip } from "../lib/result";
import type { CheckResult, ReleaseCheck } from "../types";

/** Verifies the required scripts and publish fields are present. */
export const packageContractCheck: ReleaseCheck = {
  id: "package-contract",
  title: "package.json on contract",
  /**
   * Audit the manifest against the contract table.
   *
   * @param ctx - The injected ports.
   * @returns Pass when nothing is missing, otherwise every gap by name.
   * @example
   * await packageContractCheck.run(ctx);
   */
  async run(ctx): Promise<CheckResult> {
    const manifest = await readManifest(ctx.files);
    if (!manifest) return skip("package.json is missing or malformed");

    const issues = contractIssues(manifest);
    if (issues.length > 0) return fail(issues.join(", "), "moku-release setup");

    return pass("all scripts and publish fields present");
  }
};

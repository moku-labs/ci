/**
 * @file `moku-release` — check: both workflows exist and are the thin callers.
 *
 * Three outcomes, and the middle one matters most: a MISSING workflow fails, a
 * hand-written one warns ("legacy workflow, run release:setup to migrate") because the
 * repo still releases — just not through the shared pipeline — and a pinned thin caller
 * passes.
 */

import { fail, pass, warn } from "../lib/result";
import { isThinWorkflow, workflowTemplates } from "../lib/templates";
import type { CheckResult, ReleaseCheck } from "../types";

/** Advisory shown for a workflow that exists but does not call the central pipeline. */
const LEGACY_FIX = "legacy workflow, run release:setup to migrate";

/** Verifies `ci.yml` and `publish.yml` are the `@v1`-pinned thin callers. */
export const workflowsCheck: ReleaseCheck = {
  id: "workflows",
  title: "workflows are thin callers pinned to @v1",
  /**
   * Read both workflow files and classify each as missing, legacy or thin.
   *
   * @param ctx - The injected ports.
   * @returns Fail for a missing file, warn for a legacy one, pass when both are thin.
   * @example
   * await workflowsCheck.run(ctx);
   */
  async run(ctx): Promise<CheckResult> {
    const missing: string[] = [];
    const legacy: string[] = [];

    for (const template of workflowTemplates) {
      const content = await ctx.files.read(template.path);

      if (content === undefined) missing.push(template.path);
      else if (!isThinWorkflow(content, template)) legacy.push(template.path);
    }

    if (missing.length > 0) return fail(`missing ${missing.join(", ")}`, "moku-release setup");
    if (legacy.length > 0) return warn(`${legacy.join(", ")} not pinned to @v1`, LEGACY_FIX);

    return pass("ci.yml + publish.yml pinned to @v1");
  }
};

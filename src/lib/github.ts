/**
 * @file `moku-release` — parsers for the `gh` JSON surfaces the CLI reads: branch
 * rulesets, workflow runs, and the release permalink printed in the final summary.
 *
 * `gh` is invoked by the checks and commands; everything that *interprets* its output
 * lives here so the interpretation is unit-testable against captured fixtures.
 */

/** Ruleset target value GitHub uses for branch (as opposed to tag) rulesets. */
const BRANCH_TARGET = "branch";

/**
 * The subset of a GitHub ruleset the CLI reads.
 *
 * @example
 * const ruleset: RulesetSummary = { name: "main", target: "branch", enforcement: "active" };
 */
export type RulesetSummary = {
  /** The ruleset name. */
  name?: string;
  /** `"branch"` or `"tag"`. */
  target?: string;
  /** `"active"`, `"evaluate"` or `"disabled"`. */
  enforcement?: string;
};

/**
 * Parse a JSON array `gh api` printed, tolerating error text and non-array payloads.
 *
 * @param stdout - The raw `gh api` output.
 * @returns The parsed array, or an empty array when the payload is not one.
 * @example
 * parseJsonArray('[{"target":"branch"}]');
 */
function parseJsonArray(stdout: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Whether an active BRANCH ruleset protects the default branch. Tag rulesets are ignored
 * on purpose — `moku-release` pushes tags, so restricting them would block every release.
 *
 * @param stdout - Output of `gh api repos/{owner}/{repo}/rulesets`.
 * @returns `true` when at least one active branch ruleset is present.
 * @example
 * hasMainBranchRuleset('[{"target":"branch","enforcement":"active"}]'); // true
 */
export function hasMainBranchRuleset(stdout: string): boolean {
  const rulesets = parseJsonArray(stdout) as RulesetSummary[];

  // A ruleset counts only when it targets branches and is actually enforced.
  return rulesets.some(
    ruleset => ruleset.target === BRANCH_TARGET && ruleset.enforcement !== "disabled"
  );
}

/**
 * The id of the newest workflow run from `gh run list --json databaseId`.
 *
 * @param stdout - The raw `gh run list` JSON.
 * @returns The run id as a string, or `undefined` when no run was listed.
 * @example
 * latestRunId('[{"databaseId":42}]'); // "42"
 */
export function latestRunId(stdout: string): string | undefined {
  const [first] = parseJsonArray(stdout) as { databaseId?: number }[];
  if (first?.databaseId === undefined) return undefined;

  return String(first.databaseId);
}

/**
 * The permalink of a GitHub release, for the final summary.
 *
 * @param ownerRepo - The `owner/repo` slug.
 * @param tag - The release tag (`v1.2.3`).
 * @returns The canonical release URL.
 * @example
 * releaseUrl("moku-labs/common", "v1.2.3");
 */
export function releaseUrl(ownerRepo: string, tag: string): string {
  return `https://github.com/${ownerRepo}/releases/tag/${tag}`;
}

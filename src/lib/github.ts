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
  /** The ruleset id, used to read and update the full ruleset. */
  id?: number;
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

/** Rule type GitHub uses for the required status checks of a ruleset. */
const REQUIRED_CHECKS_RULE = "required_status_checks";

/** One rule of a ruleset, as far as the CLI reads it. */
type RulesetRule = {
  /** The rule type, e.g. `"pull_request"`. */
  type?: string;
  /** The rule parameters; only the required checks are read. */
  parameters?: { required_status_checks?: { context?: string }[] };
};

/**
 * Parse the `rules` of one full ruleset, tolerating error text and non-object payloads.
 *
 * @param stdout - Output of `gh api repos/{owner}/{repo}/rulesets/{id}`, or a ruleset template.
 * @returns The rules, or an empty array when the payload has none.
 * @example
 * parseRules('{"rules":[{"type":"deletion"}]}');
 */
function parseRules(stdout: string): RulesetRule[] {
  try {
    const parsed = JSON.parse(stdout) as { rules?: unknown } | null;
    return Array.isArray(parsed?.rules) ? (parsed.rules as RulesetRule[]) : [];
  } catch {
    return [];
  }
}

/**
 * The ids of every active BRANCH ruleset, in listing order.
 *
 * @param stdout - Output of `gh api repos/{owner}/{repo}/rulesets`.
 * @returns The ruleset ids; a ruleset without an id is left out.
 * @example
 * activeBranchRulesetIds('[{"id":7,"target":"branch","enforcement":"active"}]'); // [7]
 */
export function activeBranchRulesetIds(stdout: string): number[] {
  const rulesets = parseJsonArray(stdout) as RulesetSummary[];

  return rulesets
    .filter(ruleset => ruleset.target === BRANCH_TARGET && ruleset.enforcement !== "disabled")
    .flatMap(ruleset => (ruleset.id === undefined ? [] : [ruleset.id]));
}

/**
 * The status check contexts one full ruleset requires.
 *
 * @param stdout - One full ruleset as JSON.
 * @returns The required contexts, e.g. `["ci / lint"]`.
 * @example
 * requiredCheckContexts(renderMainRuleset()); // ["ci / lint", "ci / types", …]
 */
export function requiredCheckContexts(stdout: string): string[] {
  return parseRules(stdout)
    .filter(rule => rule.type === REQUIRED_CHECKS_RULE)
    .flatMap(rule => rule.parameters?.required_status_checks ?? [])
    .flatMap(check => (check.context === undefined ? [] : [check.context]));
}

/** Prefix GitHub puts on a reusable workflow's jobs: the caller's job id, `ci`. */
const CALLER_PREFIX = "ci / ";

/**
 * What is wrong with a ruleset's required checks, measured against the central ones. A
 * legacy check is a central one without the caller prefix (`lint` for `ci / lint`): the thin
 * caller never reports it. Any other context is the project's own (`ci-pass` of a matrix
 * workflow) and is none of our business.
 *
 * @param required - The contexts the ruleset requires.
 * @param central - The central contexts (`ci / lint`, …).
 * @returns The legacy contexts to drop and the central ones still missing.
 * @example
 * requiredChecksDrift(["lint", "ci-pass"], ["ci / lint"]); // { legacy: ["lint"], missing: ["ci / lint"] }
 */
export function requiredChecksDrift(
  required: readonly string[],
  central: readonly string[]
): { legacy: string[]; missing: string[] } {
  const bare = new Set(central.map(context => context.slice(CALLER_PREFIX.length)));

  return {
    legacy: required.filter(context => bare.has(context)),
    missing: central.filter(context => !required.includes(context))
  };
}

/**
 * The body that moves an existing ruleset onto the central required checks. Every other
 * rule is kept as it is, and so is every required check the project added itself.
 *
 * @param existing - The full existing ruleset as JSON.
 * @param template - The central ruleset template as JSON.
 * @returns The `PUT` body: the existing rules with the central required checks merged in.
 * @example
 * const body = withCentralRequiredChecks(existingJson, renderMainRuleset());
 */
export function withCentralRequiredChecks(existing: string, template: string): string {
  const kept = parseRules(existing).filter(rule => rule.type !== REQUIRED_CHECKS_RULE);
  const central = parseRules(template).filter(rule => rule.type === REQUIRED_CHECKS_RULE);

  // The project's own checks ride along: everything required today that is not a legacy name
  const centralContexts = requiredCheckContexts(template);
  const { legacy } = requiredChecksDrift(requiredCheckContexts(existing), centralContexts);
  const own = requiredCheckContexts(existing).filter(
    context => !legacy.includes(context) && !centralContexts.includes(context)
  );

  const merged = central.map(rule => ({
    ...rule,
    parameters: {
      ...rule.parameters,
      required_status_checks: [
        ...(rule.parameters?.required_status_checks ?? []),
        ...own.map(context => ({ context }))
      ]
    }
  }));

  return JSON.stringify({ rules: [...kept, ...merged] });
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

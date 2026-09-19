/**
 * @file `moku-release` — the four {@link CheckResult} constructors.
 *
 * Checks never build result objects by hand. With `exactOptionalPropertyTypes` a literal
 * `{ fix: undefined }` is a type error, so these constructors are also the only place that
 * knows how to omit an absent `fix`.
 */
import type { CheckResult } from "../types";

/**
 * A passing result. A pass never carries a fix — there is nothing to fix.
 *
 * @param detail - What was observed, in one line.
 * @returns The passing result.
 * @example
 * pass("npm 11.6.0");
 */
export function pass(detail: string): CheckResult {
  return { status: "pass", detail };
}

/**
 * A blocking result: the release cannot proceed until `fix` is applied.
 *
 * @param detail - What was observed, in one line.
 * @param fix - The concrete command or edit that resolves it.
 * @returns The failing result.
 * @example
 * fail("npm is not logged in", "npm login");
 */
export function fail(detail: string, fix: string): CheckResult {
  return { status: "fail", detail, fix };
}

/**
 * An advisory result: worth knowing, not blocking.
 *
 * @param detail - What was observed, in one line.
 * @param fix - The concrete command or edit that resolves it.
 * @returns The warning result.
 * @example
 * warn("no branch ruleset on main", "moku-release setup");
 */
export function warn(detail: string, fix: string): CheckResult {
  return { status: "warn", detail, fix };
}

/**
 * A skipped result: the check could not run because a prerequisite is missing.
 *
 * @param detail - Why the check was skipped.
 * @returns The skipped result.
 * @example
 * skip("package.json is unreadable");
 */
export function skip(detail: string): CheckResult {
  return { status: "skip", detail };
}

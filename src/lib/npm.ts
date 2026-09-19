/**
 * @file `moku-release` — npm semantics as pure functions: semver comparison (including
 * prerelease ordering), the minimum-version gate, the dist-tag a version belongs under,
 * and the parsers for `npm view … --json` output.
 *
 * Nothing here runs a command. Checks capture npm's output and hand the text to these
 * functions, which is what makes version and tag logic testable without a registry.
 */

/** Registry front-end the final summary links a published version to. */
const NPM_BASE_URL = "https://www.npmjs.com/package";

/** Dist-tag stable releases move. */
const LATEST_TAG = "latest";

/** Dist-tag prerelease versions are published under so they never clobber `latest`. */
const NEXT_TAG = "next";

/**
 * A semver version split into its numeric core and its prerelease identifiers.
 *
 * @example
 * const parsed: SemverParts = { core: [1, 2, 3], prerelease: ["rc", "1"] };
 */
export type SemverParts = {
  /** The `major.minor.patch` triple. */
  core: number[];
  /** The dot-separated identifiers after `-`, empty for a stable release. */
  prerelease: string[];
};

/**
 * Split a version string into comparable parts. A leading `v` and any build metadata
 * (`+…`) are dropped — neither participates in precedence.
 *
 * @param version - The version or tag to parse (`v1.2.3-rc.1`).
 * @returns The numeric core and the prerelease identifiers.
 * @example
 * parseSemver("v1.2.3-rc.1"); // { core: [1, 2, 3], prerelease: ["rc", "1"] }
 */
export function parseSemver(version: string): SemverParts {
  const [withoutBuild = ""] = version.replace(/^v/, "").split("+");

  // Only the FIRST dash separates core from prerelease — `1.0.0-rc.1-x` keeps `rc.1-x`.
  const dash = withoutBuild.indexOf("-");
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const prerelease = dash === -1 ? "" : withoutBuild.slice(dash + 1);

  return {
    core: core.split(".").map(part => Number.parseInt(part, 10) || 0),
    prerelease: prerelease === "" ? [] : prerelease.split(".")
  };
}

/**
 * Compare two prerelease identifiers by semver rules: numeric identifiers compare
 * numerically and always sort below alphanumeric ones, which compare lexically.
 *
 * @param left - The left identifier.
 * @param right - The right identifier.
 * @returns Negative, zero or positive.
 * @example
 * compareIdentifier("2", "10"); // negative — numeric, not lexical
 */
function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  // A numeric identifier always has lower precedence than an alphanumeric one.
  if (leftNumeric && !rightNumeric) return -1;
  if (!leftNumeric && rightNumeric) return 1;
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);

  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Compare the prerelease segments of two versions. A stable release outranks any
 * prerelease; otherwise identifiers compare left to right and a shorter run loses.
 *
 * @param left - The left version's prerelease identifiers.
 * @param right - The right version's prerelease identifiers.
 * @returns Negative, zero or positive.
 * @example
 * comparePrerelease(["rc", "1"], []); // negative — 1.0.0-rc.1 < 1.0.0
 */
function comparePrerelease(left: string[], right: string[]): number {
  // Stable beats prerelease; two stables are equal.
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  for (const [index, leftPart] of left.entries()) {
    const rightPart = right[index];
    if (rightPart === undefined) return 1;

    const verdict = compareIdentifier(leftPart, rightPart);
    if (verdict !== 0) return verdict;
  }

  return left.length === right.length ? 0 : -1;
}

/**
 * Compare two semver versions, prerelease ordering included.
 *
 * @param left - The left version or `v`-prefixed tag.
 * @param right - The right version or `v`-prefixed tag.
 * @returns Negative when `left` is older, `0` when equal, positive when newer.
 * @example
 * compareSemver("1.0.0-rc.2", "1.0.0"); // negative
 */
export function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);

  for (let index = 0; index < 3; index += 1) {
    const verdict = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (verdict !== 0) return verdict;
  }

  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * Whether `version` satisfies a minimum floor (used for the npm Trusted Publishing gate).
 *
 * @param version - The observed version.
 * @param minimum - The lowest acceptable version.
 * @returns `true` when `version >= minimum`.
 * @example
 * isAtLeast("11.6.0", "11.5.1"); // true
 */
export function isAtLeast(version: string, minimum: string): boolean {
  return compareSemver(version, minimum) >= 0;
}

/**
 * The dist-tag a version is published under: prereleases go to `next` so they never move
 * `latest`.
 *
 * @param version - The version being published.
 * @returns `"next"` for a prerelease, `"latest"` otherwise.
 * @example
 * distTagFor("1.0.0-rc.1"); // "next"
 */
export function distTagFor(version: string): string {
  return parseSemver(version).prerelease.length > 0 ? NEXT_TAG : LATEST_TAG;
}

/**
 * Parse `npm view <pkg> dist-tags --json` output into a plain tag → version map.
 *
 * @param stdout - The raw JSON npm printed.
 * @returns The dist-tag map, or `undefined` when the output is not a JSON object.
 * @example
 * parseDistTags('{"latest":"1.2.3"}'); // { latest: "1.2.3" }
 */
export function parseDistTags(stdout: string): Record<string, string> | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;

    return parsed as Record<string, string>;
  } catch {
    return undefined;
  }
}

/**
 * The npm front-end URL for a package version, used in the final release summary.
 *
 * @param name - The package name.
 * @param version - The published version.
 * @returns The canonical npmjs.com URL.
 * @example
 * npmPackageUrl("@moku-labs/common", "1.2.3");
 */
export function npmPackageUrl(name: string, version: string): string {
  return `${NPM_BASE_URL}/${name}/v/${version}`;
}

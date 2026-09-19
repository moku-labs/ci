/**
 * @file `moku-release` — git vocabulary as pure functions: remote-URL normalization, the
 * `owner/repo` slug, and the latest `v*` tag.
 *
 * The one piece of git *invocation* that lives here is {@link LATEST_TAG_ARGS}: the tag
 * listing must run with `versionsort.suffix=-` so `v1.0.0-rc.1` sorts BELOW `v1.0.0`
 * instead of above it. Keeping the argv next to the parser stops the two drifting apart.
 */

/** Argv for listing release tags newest-first with prereleases ordered correctly. */
export const LATEST_TAG_ARGS: readonly string[] = [
  "-c",
  "versionsort.suffix=-",
  "tag",
  "--list",
  "v*",
  "--sort=-v:refname"
];

/** Matches the `owner/repo` pair in any GitHub remote form (ssh, https, with or without `.git`). */
const OWNER_REPO_PATTERN = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/;

/**
 * Reduce any remote form to a comparable canonical one: `git+` prefix dropped, `.git`
 * suffix dropped, `git@host:owner/repo` rewritten as `https://host/owner/repo`, trailing
 * slash and surrounding whitespace removed.
 *
 * @param url - A remote URL from `package.json` or `git remote get-url`.
 * @returns The canonical `https://host/owner/repo` form.
 * @example
 * normalizeRemoteUrl("git+https://github.com/moku-labs/common.git");
 * // "https://github.com/moku-labs/common"
 */
export function normalizeRemoteUrl(url: string): string {
  const trimmed = url
    .trim()
    .replace(/^git\+/, "")
    .replace(/\/$/, "");
  const withoutSuffix = trimmed.replace(/\.git$/, "");

  return withoutSuffix.replace(/^(?:ssh:\/\/)?git@([^:/]+)[:/]/, "https://$1/");
}

/**
 * Extract the `owner/repo` slug a remote points at.
 *
 * @param url - A GitHub remote URL in any form.
 * @returns The `owner/repo` slug, or `undefined` when the URL is not a GitHub remote.
 * @example
 * ownerRepoFrom("git@github.com:moku-labs/common.git"); // "moku-labs/common"
 */
export function ownerRepoFrom(url: string): string | undefined {
  const match = OWNER_REPO_PATTERN.exec(normalizeRemoteUrl(url));
  if (!match) return undefined;

  return `${match[1]}/${match[2]}`;
}

/**
 * Whether two remote URLs point at the same repository, comparing canonical forms so
 * `git+https://…​.git` and `git@github.com:…` match.
 *
 * @param left - The first remote URL.
 * @param right - The second remote URL.
 * @returns `true` when both resolve to the same canonical URL.
 * @example
 * sameRemote("git@github.com:o/r.git", "https://github.com/o/r"); // true
 */
export function sameRemote(left: string, right: string): boolean {
  return normalizeRemoteUrl(left) === normalizeRemoteUrl(right);
}

/**
 * The newest release tag from `git tag` output produced with {@link LATEST_TAG_ARGS}.
 *
 * @param stdout - The raw tag listing.
 * @returns The first (newest) tag, or `undefined` when the repo has no release tags.
 * @example
 * latestVersionTag("v1.2.3\nv1.2.2\n"); // "v1.2.3"
 */
export function latestVersionTag(stdout: string): string | undefined {
  return stdout
    .split("\n")
    .map(line => line.trim())
    .find(line => line !== "");
}

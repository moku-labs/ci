/**
 * @file `moku-release` — check: no dependency points at a pkg.pr.new preview build.
 *
 * A preview URL is for testing an unreleased upstream change. It has no provenance and dies
 * with its pull request, so a release must never be cut with one in the manifest. The `lint`
 * job of package-ci.yml refuses the same thing on every PR; this is the local view of it.
 */
import { type PackageManifest, readManifest } from "../lib/package-json";
import { fail, pass, skip } from "../lib/result";
import type { CheckResult, ReleaseCheck } from "../types";

/** Host every pkg.pr.new install URL contains. */
const PREVIEW_HOST = "pkg.pr.new";

/** The manifest tables a preview URL can sit in. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
] as const;

/**
 * Names of every dependency whose range is a pkg.pr.new URL.
 *
 * @param manifest - The manifest to scan.
 * @returns The dependency names, in manifest order.
 * @example
 * previewDependencies({ dependencies: { "@moku-labs/core": "https://pkg.pr.new/@moku-labs/core@42" } });
 */
export function previewDependencies(manifest: PackageManifest): string[] {
  return DEPENDENCY_FIELDS.flatMap(field => {
    const table = manifest[field];
    if (typeof table !== "object" || table === null) return [];

    return Object.entries(table)
      .filter(([, range]) => typeof range === "string" && range.includes(PREVIEW_HOST))
      .map(([name]) => name);
  });
}

/** Verifies no dependency is installed from a pkg.pr.new preview. */
export const previewDepsCheck: ReleaseCheck = {
  id: "preview-deps",
  title: "no pkg.pr.new preview dependencies",
  /**
   * Scan the dependency tables for preview URLs.
   *
   * @param ctx - The injected ports.
   * @returns Pass when none is found, otherwise every preview dependency by name.
   * @example
   * await previewDepsCheck.run(ctx);
   */
  async run(ctx): Promise<CheckResult> {
    const manifest = await readManifest(ctx.files);
    if (!manifest) return skip("package.json is missing or malformed");

    const names = previewDependencies(manifest);
    if (names.length > 0) {
      return fail(
        `preview build of ${names.join(", ")}`,
        `release upstream, then: bun add ${names.join(" ")}`
      );
    }

    return pass("every dependency comes from the registry");
  }
};

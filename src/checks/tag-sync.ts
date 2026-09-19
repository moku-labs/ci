/**
 * @file `moku-release` — check: the newest git tag and npm's `latest` agree.
 *
 * The two drift in exactly two ways, and they mean opposite things: npm AHEAD of the tag
 * means a publish happened without its tag being pushed (history has lost the provenance
 * of a released version); npm BEHIND means a tag was cut whose publish never completed.
 * Both are advisory — neither blocks the next release, both want a human to look.
 */
import { LATEST_TAG_ARGS, latestVersionTag } from "../lib/git";
import { compareSemver, parseDistTags } from "../lib/npm";
import { readManifest } from "../lib/package-json";
import { pass, skip, warn } from "../lib/result";
import type { CheckResult, ReleaseCheck } from "../types";

/** Fix line shared by both drift directions — the resolution is the same investigation. */
const DRIFT_FIX = "reconcile: push the missing tag, or re-run the release that never published";

/** Verifies the latest `v*` tag equals npm's `latest` dist-tag. */
export const tagSyncCheck: ReleaseCheck = {
  id: "tag-sync",
  title: "latest git tag matches npm latest",
  /**
   * Compare the newest release tag with the registry's `latest` dist-tag.
   *
   * @param ctx - The injected ports.
   * @returns Pass when both name the same version, warn (with the direction) otherwise.
   * @example
   * await tagSyncCheck.run(ctx);
   */
  async run(ctx): Promise<CheckResult> {
    const manifest = await readManifest(ctx.files);
    if (!manifest?.name) return skip("package.json declares no `name`");

    const tags = await ctx.exec.capture("git", LATEST_TAG_ARGS);
    const tag = tags.code === 0 ? latestVersionTag(tags.stdout) : undefined;
    if (tag === undefined) return skip("no `v*` tags yet");

    const view = await ctx.exec.capture("npm", ["view", manifest.name, "dist-tags", "--json"]);
    const published = view.code === 0 ? parseDistTags(view.stdout)?.latest : undefined;
    if (published === undefined) return skip("npm has no `latest` dist-tag yet");

    const drift = compareSemver(published, tag);
    if (drift > 0) return warn(`npm ${published} is AHEAD of tag ${tag}`, DRIFT_FIX);
    if (drift < 0) return warn(`npm ${published} is BEHIND tag ${tag}`, DRIFT_FIX);

    return pass(`${tag} == npm latest`);
  }
};

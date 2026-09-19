/**
 * @file `moku-release` — the `.github/workflows/publish.yml` template.
 *
 * Read from this package's own `examples/package/publish.yml`. The FILE NAME is the
 * contract: npm Trusted Publishing validates the CALLING workflow's filename, so this file
 * must stay `publish.yml` even though the publish itself happens inside the central
 * reusable workflow. There is no `NPM_TOKEN` anywhere — `id-token: write` is the whole
 * credential.
 */
import { readCentral } from "./central";

/** Repo-relative path this template is written to. Registered with npm — never rename it. */
export const PUBLISH_WORKFLOW_PATH = ".github/workflows/publish.yml";

/**
 * The reusable workflow ref `doctor` recognizes a migrated `publish.yml` by. The
 * `publish.local-publish.yml` fallback variant calls the same ref, so it is recognized too.
 */
export const PUBLISH_WORKFLOW_REF = "moku-labs/ci/.github/workflows/package-release.yml@v1";

/** The `publish.yml` body, read from `examples/package/publish.yml`. */
export const PUBLISH_WORKFLOW = readCentral("examples/package/publish.yml");

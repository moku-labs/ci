/**
 * @file `moku-release` — the `.github/workflows/ci.yml` template.
 *
 * Read from this package's own `examples/package/ci.yml`. It is a thin caller: the
 * whole check matrix lives once in the central reusable workflow, so a pipeline change is
 * one PR there instead of one per repository. Two details are load-bearing and must not be
 * "tidied": the caller job id is `ci` (GitHub prefixes the reused jobs with it, so the
 * required checks are `ci / lint`, `ci / types`, `ci / test`, `ci / build`), and there is
 * deliberately NO concurrency block — the called workflow already groups by
 * `github.workflow`, and a caller group with the same value deadlocks against its own child.
 */
import { readCentral } from "./central";

/** Repo-relative path this template is written to. */
export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";

/** The reusable workflow ref `doctor` recognizes a migrated `ci.yml` by. */
export const CI_WORKFLOW_REF = "moku-labs/ci/.github/workflows/package-ci.yml@v1";

/** The `ci.yml` body, read from `examples/package/ci.yml`. */
export const CI_WORKFLOW = readCentral("examples/package/ci.yml");

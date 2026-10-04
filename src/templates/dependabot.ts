/**
 * @file `moku-release` — the Dependabot templates.
 *
 * Read from this package's own `examples/dependabot.yml` and
 * `examples/package/dependabot-automerge.yml`. Dependabot opens one grouped PR a day when a
 * new `@moku-labs/*` version is out; the automerge workflow merges it once the required
 * `ci / …` checks pass. The config sits outside `examples/package/` on purpose: it is not a
 * workflow, and the self-test runs actionlint on every `.yml` one folder below `examples/`.
 */
import { readCentral } from "./central";

/** Repo-relative path the Dependabot config is written to. */
export const DEPENDABOT_CONFIG_PATH = ".github/dependabot.yml";

/** The Dependabot config body, read from `examples/dependabot.yml`. */
export const DEPENDABOT_CONFIG = readCentral("examples/dependabot.yml");

/** Repo-relative path the automerge workflow is written to. */
export const DEPENDABOT_AUTOMERGE_PATH = ".github/workflows/dependabot-automerge.yml";

/** The automerge workflow body, read from `examples/package/dependabot-automerge.yml`. */
export const DEPENDABOT_AUTOMERGE = readCentral("examples/package/dependabot-automerge.yml");

/**
 * @file `moku-release` — the branch ruleset `setup` applies to `main`.
 *
 * Read from this package's own `rulesets/main.json`: PR-only main, no deletion, no
 * force-push, and the four required checks the thin `ci.yml` produces (`ci / lint`,
 * `ci / types`, `ci / test`, `ci / build`). Tags are deliberately NOT restricted — the
 * release workflow pushes `v*` tags, and a tag ruleset would block every release.
 */
import { readCentral } from "./central";

/** Name the ruleset is created under in the central definition. */
export const MAIN_RULESET_NAME = "protect-main";

/** The ruleset payload for `gh api repos/{owner}/{repo}/rulesets --input -`, read from `rulesets/main.json`. */
export const MAIN_RULESET_JSON = readCentral("rulesets/main.json");

/**
 * @file `moku-release` — the ordered check registry.
 *
 * The order is the reading order of the doctor report: tools first (nothing else is
 * meaningful without them), then the repository's own declarations, then the workflows,
 * then what the registry and GitHub say, then the tree the release would be cut from.
 */

import type { ReleaseCheck } from "../types";
import { branchRulesetCheck } from "./branch-ruleset";
import { ghAuthCheck } from "./gh-auth";
import { npmAuthCheck } from "./npm-auth";
import { npmPackageCheck } from "./npm-package";
import { npmVersionCheck } from "./npm-version";
import { packageContractCheck } from "./package-contract";
import { previewDepsCheck } from "./preview-deps";
import { repositoryUrlCheck } from "./repository-url";
import { tagSyncCheck } from "./tag-sync";
import { trustedPublisherCheck } from "./trusted-publisher";
import { workflowsCheck } from "./workflows";
import { workingTreeCheck } from "./working-tree";

/** Every diagnostic `doctor` runs, in report order. */
export const allChecks: readonly ReleaseCheck[] = [
  ghAuthCheck,
  npmAuthCheck,
  npmVersionCheck,
  packageContractCheck,
  previewDepsCheck,
  repositoryUrlCheck,
  workflowsCheck,
  npmPackageCheck,
  trustedPublisherCheck,
  tagSyncCheck,
  branchRulesetCheck,
  workingTreeCheck
];

export { branchRulesetCheck } from "./branch-ruleset";
export { ghAuthCheck } from "./gh-auth";
export { npmAuthCheck } from "./npm-auth";
export { npmPackageCheck } from "./npm-package";
export { npmVersionCheck } from "./npm-version";
export { packageContractCheck } from "./package-contract";
export { previewDepsCheck } from "./preview-deps";
export { repositoryUrlCheck } from "./repository-url";
export { tagSyncCheck } from "./tag-sync";
export { trustedPublisherCheck } from "./trusted-publisher";
export { workflowsCheck } from "./workflows";
export { workingTreeCheck } from "./working-tree";

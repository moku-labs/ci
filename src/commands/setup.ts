/**
 * @file `moku-release setup` — the one-time wizard that makes a package releasable.
 *
 * Idempotent by construction: every step first asks whether it is already done and prints
 * a checkmark instead of redoing it, so running `setup` on a configured repo is a
 * no-op report. It never authenticates anything — `gh auth login` and `npm login` are
 * human-only, and the wizard stops with the exact command rather than handling a token or
 * an OTP itself. `--dry-run` prints every action and mutates nothing.
 */
import type { BrandConsole, BrandPrompts } from "@moku-labs/common/cli";
import { branchRulesetCheck, ghAuthCheck, npmAuthCheck, trustedPublisherCheck } from "../checks";
import { findStaleRuleset } from "../checks/branch-ruleset";
import { TRUST_NEEDS_OTP, trustCommand } from "../checks/trusted-publisher";
import { LATEST_TAG_ARGS, latestVersionTag, ownerRepoFrom } from "../lib/git";
import { withCentralRequiredChecks } from "../lib/github";
import {
  formatManifest,
  MANIFEST_PATH,
  normalizeManifest,
  type PackageManifest,
  readManifest,
  repositoryUrlOf
} from "../lib/package-json";
import { isThinWorkflow, renderMainRuleset, workflowTemplates } from "../lib/templates";
import type { CheckContext, CheckResult } from "../types";
import { runDoctor } from "./doctor";

/**
 * How `setup` is invoked. `prompts` is injected so a test drives every confirmation
 * without a TTY.
 *
 * @example
 * await runSetup({ ctx, ui, prompts, dryRun: true });
 */
export type SetupOptions = {
  /** The ports and flags the wizard works through. */
  ctx: CheckContext;
  /** The branded console every line is printed through. */
  ui: BrandConsole;
  /** The branded prompts every confirmation goes through. */
  prompts: BrandPrompts;
  /** Print actions without performing any mutation. */
  dryRun?: boolean;
};

/** The wizard's resolved state, threaded through every step. */
type SetupRun = Required<SetupOptions>;

/**
 * Announce a mutation under `--dry-run`. Every step calls this before acting; a `true`
 * answer means "already reported, do nothing".
 *
 * @param setup - The wizard state.
 * @param description - The mutation, phrased as an infinitive ("write .github/…").
 * @returns `true` when the run is a dry run and the caller must not act.
 * @example
 * if (deferred(setup, "write .github/workflows/ci.yml")) return;
 */
function deferred(setup: SetupRun, description: string): boolean {
  if (!setup.dryRun) return false;

  setup.ui.info(`would ${description}`);
  return true;
}

/**
 * Verify the two human-only prerequisites. Nothing else in the wizard can run without
 * them, and neither can be automated — the wizard prints the command and stops.
 *
 * @param setup - The wizard state.
 * @returns `true` when both `gh` and npm are authenticated.
 * @example
 * if (!(await ensurePrerequisites(setup))) return 1;
 */
async function ensurePrerequisites(setup: SetupRun): Promise<boolean> {
  setup.ui.heading("Prerequisites");

  for (const check of [ghAuthCheck, npmAuthCheck]) {
    const result = await check.run(setup.ctx);
    setup.ui.check(result.status === "pass", `${check.title} — ${result.detail}`, result.fix);

    // Human-only: no token is ever requested, read or stored by this CLI.
    if (result.status === "fail") {
      setup.ui.error(`run this yourself, then re-run setup: ${result.fix}`);
      return false;
    }
  }

  return true;
}

/**
 * Whether git already holds this exact file: tracked, and with no uncommitted change.
 *
 * @param setup - The wizard state.
 * @param path - Repo-relative path of the file.
 * @returns `true` when `git checkout -- <path>` would bring the current content back.
 * @example
 * await isCommittedUnchanged(setup, ".github/workflows/ci.yml");
 */
async function isCommittedUnchanged(setup: SetupRun, path: string): Promise<boolean> {
  const tracked = await setup.ctx.exec.capture("git", ["ls-files", "--error-unmatch", path]);
  if (tracked.code !== 0) return false;

  const status = await setup.ctx.exec.capture("git", ["status", "--porcelain", "--", path]);
  return status.code === 0 && status.stdout.trim() === "";
}

/**
 * Ask before replacing an existing workflow, and keep the original: in git when it is
 * committed and unmodified, in a `.bak` copy otherwise.
 *
 * @param setup - The wizard state.
 * @param template - The central workflow about to be written.
 * @param existing - The current contents of the file.
 * @returns `true` when the caller may write the template now.
 * @example
 * if (!(await clearExistingWorkflow(setup, template, existing))) continue;
 */
async function clearExistingWorkflow(
  setup: SetupRun,
  template: (typeof workflowTemplates)[number],
  existing: string
): Promise<boolean> {
  const kind = isThinWorkflow(existing, template) ? "differs" : "is a legacy workflow";

  // A committed, unmodified file is already kept by git: a `.bak` would only litter the tree
  const committed = await isCommittedUnchanged(setup, template.path);
  const safety = committed ? "git keeps the original" : "a .bak copy is kept";

  if (!(await setup.prompts.confirm(`${template.path} ${kind}. Replace it (${safety})?`))) {
    setup.ui.check(false, `${template.path} left unchanged`);
    return false;
  }
  if (deferred(setup, `${committed ? "replace" : "back up and replace"} ${template.path}`)) {
    return false;
  }

  if (!committed) await setup.ctx.files.backup(template.path);
  return true;
}

/**
 * Write the two thin workflows. A file that already calls the pinned central workflow is
 * left alone; a differing file is only replaced after an explicit confirm, and a `.bak`
 * copy is kept unless git already holds the original.
 *
 * @param setup - The wizard state.
 * @returns Nothing.
 * @example
 * await writeWorkflows(setup);
 */
async function writeWorkflows(setup: SetupRun): Promise<void> {
  setup.ui.heading("Workflows");

  for (const template of workflowTemplates) {
    const existing = await setup.ctx.files.read(template.path);

    if (existing === template.content) {
      setup.ui.check(true, `${template.path} up to date`);
      continue;
    }

    // An existing file is someone's work — never replace one without asking.
    const cleared =
      existing === undefined
        ? !deferred(setup, `write ${template.path}`)
        : await clearExistingWorkflow(setup, template, existing);
    if (!cleared) continue;

    await setup.ctx.files.write(template.path, template.content);
    setup.ui.check(true, `${template.path} written`);
  }
}

/**
 * Bring `package.json` onto the release contract. The change summary is printed first and
 * applied only after a confirm; an already-compliant manifest is a checkmark.
 *
 * @param setup - The wizard state.
 * @param manifest - The manifest read at the start of the run.
 * @returns Nothing.
 * @example
 * await normalizeContract(setup, manifest);
 */
async function normalizeContract(setup: SetupRun, manifest: PackageManifest): Promise<void> {
  setup.ui.heading("package.json");

  const origin = await setup.ctx.exec.capture("git", ["remote", "get-url", "origin"]);
  const remoteUrl = origin.code === 0 ? origin.stdout.trim() : undefined;
  const { manifest: next, changes } = normalizeManifest(manifest, remoteUrl);

  if (changes.length === 0) {
    setup.ui.check(true, "already on contract");
    return;
  }

  for (const change of changes) setup.ui.line(`      ${setup.ui.palette.dim(change)}`);
  if (!(await setup.prompts.confirm(`Apply ${changes.length} change(s) to package.json?`))) {
    setup.ui.check(false, "package.json left unchanged");
    return;
  }
  if (deferred(setup, `write ${MANIFEST_PATH}`)) return;

  const source = await setup.ctx.files.read(MANIFEST_PATH);
  await setup.ctx.files.write(MANIFEST_PATH, formatManifest(next, source));
  setup.ui.check(true, `${MANIFEST_PATH} normalized`);
}

/**
 * Perform the very first publish, if the package has no registry presence yet. Stdio is
 * inherited so npm — not this CLI — prompts for an OTP.
 *
 * @param setup - The wizard state.
 * @param name - The package name.
 * @param version - The version about to be published.
 * @returns `true` when the package exists on npm after this step.
 * @example
 * await firstPublish(setup, "@moku-labs/common", "0.2.0");
 */
async function firstPublish(setup: SetupRun, name: string, version: string): Promise<boolean> {
  setup.ui.heading("First publish");

  const view = await setup.ctx.exec.capture("npm", ["view", name, "version"]);
  if (view.code === 0) {
    setup.ui.check(true, `${name}@${view.stdout.trim()} already on npm`);
    return true;
  }

  if (!(await setup.prompts.confirm(`Publish ${name}@${version} to npm now?`))) {
    setup.ui.check(false, "first publish skipped");
    return false;
  }
  if (deferred(setup, `run bun run build && npm publish --access public`)) return false;

  const built = await setup.ctx.exec.inherit("bun", ["run", "build"]);
  if (built !== 0) {
    setup.ui.error("build failed — not publishing");
    return false;
  }

  const published = await setup.ctx.exec.inherit("npm", ["publish", "--access", "public"]);
  setup.ui.check(published === 0, `npm publish ${name}@${version}`);
  return published === 0;
}

/**
 * Tag the published version and push ONLY that tag — the branch is never written from
 * here.
 *
 * @param setup - The wizard state.
 * @param version - The version that was published.
 * @returns Nothing.
 * @example
 * await pushVersionTag(setup, "0.2.0");
 */
async function pushVersionTag(setup: SetupRun, version: string): Promise<void> {
  setup.ui.heading("Tag");

  // A released package keeps its version in tags; `package.json` on main goes stale there,
  // so tagging its version would push a tag that was never a release
  const listing = await setup.ctx.exec.capture("git", [...LATEST_TAG_ARGS]);
  const latest = latestVersionTag(listing.stdout);
  if (latest !== undefined) {
    setup.ui.check(true, `release tags exist, latest is ${latest}`);
    return;
  }

  const tag = `v${version}`;
  const existing = await setup.ctx.exec.capture("git", ["tag", "--list", tag]);
  if (existing.stdout.trim() !== "") {
    setup.ui.check(true, `${tag} already exists`);
    return;
  }
  if (deferred(setup, `tag ${tag} and push it`)) return;

  await setup.ctx.exec.capture("git", ["tag", "-a", tag, "-m", tag]);
  const pushed = await setup.ctx.exec.capture("git", ["push", "origin", `refs/tags/${tag}`]);
  setup.ui.check(pushed.code === 0, `${tag} pushed`, pushed.code === 0 ? undefined : pushed.stderr);
}

/**
 * Register this repository's `publish.yml` as npm's trusted publisher, so the release
 * workflow publishes over OIDC and no `NPM_TOKEN` ever exists.
 *
 * @param setup - The wizard state.
 * @returns Nothing.
 * @example
 * await registerTrustedPublisher(setup);
 */
async function registerTrustedPublisher(setup: SetupRun): Promise<void> {
  setup.ui.heading("Trusted publisher");

  const result = await trustedPublisherCheck.run(setup.ctx);
  if (result.status === "pass") {
    setup.ui.check(true, result.detail);
    return;
  }

  // The check's fix IS the registration command — one definition, no drift.
  const behindOtp = result.detail === TRUST_NEEDS_OTP;
  const registration = behindOtp ? await registrationBehindOtp(setup) : failFix(result);
  if (registration === undefined) {
    setup.ui.check(false, result.detail, result.fix);
    return;
  }
  if (deferred(setup, registration)) return;

  const [command = "npm", ...args] = registration.split(" ");
  const code = await setup.ctx.exec.inherit(command, args);
  setup.ui.check(code === 0, "trusted publisher registered", `verify: ${result.fix}`);
}

/**
 * The fix of a failing result. A warn or a skip is not something the wizard may act on.
 *
 * @param result - The check result.
 * @returns The fix command when the result is a failure.
 * @example
 * failFix({ status: "fail", detail: "…", fix: "npm trust github …" });
 */
function failFix(result: CheckResult): string | undefined {
  return result.status === "fail" ? result.fix : undefined;
}

/**
 * The registration command for an account behind 2FA. There the listing needs an OTP, so
 * the check cannot tell "missing" from "registered"; the wizard asks, and npm — with stdio
 * inherited — prompts for the OTP itself and refuses a duplicate.
 *
 * @param setup - The wizard state.
 * @returns The command to run, or `undefined` when it cannot be built or was declined.
 * @example
 * const registration = await registrationBehindOtp(setup);
 */
async function registrationBehindOtp(setup: SetupRun): Promise<string | undefined> {
  const manifest = await readManifest(setup.ctx.files);
  const declared = manifest === undefined ? undefined : repositoryUrlOf(manifest);
  const ownerRepo = declared === undefined ? undefined : ownerRepoFrom(declared);
  if (!manifest?.name || ownerRepo === undefined) return undefined;

  const approved = await setup.prompts.confirm(
    "npm needs an OTP to list trusted publishers. Register publish.yml now?"
  );
  return approved ? trustCommand(manifest.name, ownerRepo) : undefined;
}

/**
 * Apply the PR-only branch ruleset to the default branch. Tags stay unrestricted — the
 * release workflow pushes them.
 *
 * @param setup - The wizard state.
 * @param ownerRepo - The `owner/repo` slug.
 * @returns Nothing.
 * @example
 * await applyBranchRuleset(setup, "moku-labs/common");
 */
async function applyBranchRuleset(setup: SetupRun, ownerRepo: string): Promise<void> {
  setup.ui.heading("Branch ruleset");

  const result = await branchRulesetCheck.run(setup.ctx);
  if (result.status === "pass") {
    setup.ui.check(true, result.detail);
    return;
  }

  // A legacy ruleset requires `lint`; the thin caller reports `ci / lint`. Move it over.
  const listing = await setup.ctx.exec.capture("gh", ["api", `repos/${ownerRepo}/rulesets`]);
  const stale = await findStaleRuleset(setup.ctx, ownerRepo, listing.stdout);
  if (stale !== undefined) {
    if (deferred(setup, `move ruleset ${stale.id} on ${ownerRepo} to the ci / … checks`)) return;

    const updated = await setup.ctx.exec.capture(
      "gh",
      ["api", `repos/${ownerRepo}/rulesets/${stale.id}`, "--method", "PUT", "--input", "-"],
      { input: withCentralRequiredChecks(stale.body, renderMainRuleset()) }
    );
    setup.ui.check(
      updated.code === 0,
      "branch ruleset updated",
      updated.stderr.trim() || undefined
    );
    return;
  }

  if (deferred(setup, `create the PR-only branch ruleset on ${ownerRepo}`)) return;

  const created = await setup.ctx.exec.capture(
    "gh",
    ["api", `repos/${ownerRepo}/rulesets`, "--method", "POST", "--input", "-"],
    { input: renderMainRuleset() }
  );
  setup.ui.check(created.code === 0, "branch ruleset applied", created.stderr.trim() || undefined);
}

/**
 * Run the whole wizard. Every step is skippable, idempotent, and re-runnable; the last one
 * is always `doctor`, so the wizard's own verdict is the same report the operator gets
 * from `release:doctor`.
 *
 * @param options - The ports, console, prompts and dry-run flag.
 * @returns The process exit code (`0` when the final doctor run is clean).
 * @example
 * const code = await runSetup({ ctx, ui, prompts });
 */
export async function runSetup(options: SetupOptions): Promise<number> {
  const setup: SetupRun = { dryRun: false, ...options };
  const { ui } = setup;

  ui.lockup({ wordmark: "moku release", label: setup.dryRun ? "setup · dry-run" : "setup" });
  if (!(await ensurePrerequisites(setup))) return 1;

  const manifest = await readManifest(setup.ctx.files);
  if (!manifest?.name || !manifest.version) {
    ui.error(`${MANIFEST_PATH} is missing, malformed, or has no name/version`);
    return 1;
  }

  await writeWorkflows(setup);
  await normalizeContract(setup, manifest);
  await firstPublish(setup, manifest.name, manifest.version);
  await pushVersionTag(setup, manifest.version);
  await registerTrustedPublisher(setup);

  // The ruleset is the only step that needs a resolvable GitHub slug.
  const declared = repositoryUrlOf(manifest);
  const ownerRepo = declared === undefined ? undefined : ownerRepoFrom(declared);
  if (ownerRepo === undefined) ui.warn("no GitHub owner/repo — skipping the branch ruleset");
  else await applyBranchRuleset(setup, ownerRepo);

  ui.heading("Doctor");
  const report = await runDoctor({ ctx: setup.ctx, ui });
  return report.failed ? 1 : 0;
}

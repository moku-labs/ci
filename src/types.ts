/**
 * @file `moku-release` — the shared vocabulary every command and check is written in.
 *
 * Three concepts and nothing else: a {@link CheckResult} (what one diagnostic found), a
 * {@link ReleaseCheck} (a named diagnostic that produces one), and a {@link CheckContext}
 * (the ports a check is allowed to touch — a command runner and a file store, both
 * injectable so the whole suite runs offline in tests).
 */
import type { Executor } from "./lib/exec";
import type { FileStore } from "./lib/files";

/**
 * The outcome of a single check. `warn` is "worth knowing, not blocking"; `skip` means the
 * check could not run because an earlier prerequisite is missing.
 *
 * @example
 * const status: CheckStatus = "warn";
 */
export type CheckStatus = "pass" | "fail" | "warn" | "skip";

/**
 * What a check found: a status, a one-line human detail, and — for every non-pass — a
 * concrete `fix` the operator can copy into their terminal.
 *
 * @example
 * const result: CheckResult = { status: "fail", detail: "npm is not logged in", fix: "npm login" };
 */
export type CheckResult = {
  /** The outcome of the check. */
  status: CheckStatus;
  /** One line describing what was observed. */
  detail: string;
  /** The concrete command or edit that resolves a non-pass result. */
  fix?: string;
};

/**
 * The ports a check may use. Everything that reaches the outside world goes through
 * `exec` or `files`, so a test drives a check with canned command output and an in-memory
 * tree. `strict` flips the working-tree check from warn-level (doctor) to fail-level
 * (release preflight).
 *
 * @example
 * const ctx: CheckContext = { cwd: "/repo", exec, files, strict: false };
 */
export type CheckContext = {
  /** Absolute path of the package root the checks run against. */
  readonly cwd: string;
  /** The injectable command runner. */
  readonly exec: Executor;
  /** The injectable file store, rooted at `cwd`. */
  readonly files: FileStore;
  /** Whether advisory checks are promoted to fail-level (release preflight). */
  readonly strict: boolean;
};

/**
 * A named diagnostic. `id` is the stable machine name (`--json` output, preflight
 * selection); `title` is the human label printed in the report.
 *
 * @example
 * const check: ReleaseCheck = { id: "npm-auth", title: "npm is logged in", run: async () => pass("ok") };
 */
export type ReleaseCheck = {
  /** Stable machine identifier, kebab-case. */
  readonly id: string;
  /** Human-readable label shown in the doctor report. */
  readonly title: string;
  /**
   * Run the diagnostic against the injected ports.
   *
   * @param ctx - The ports and flags the check may use.
   * @returns The check outcome.
   * @example
   * await check.run(ctx);
   */
  run(ctx: CheckContext): Promise<CheckResult>;
};

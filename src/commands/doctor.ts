/**
 * @file `moku-release doctor` — run every check, print one line each, never mutate.
 *
 * Read-only by construction: `doctor` only ever calls `ctx.files.read` and capturing
 * commands. It is also the shared reporting surface — `setup` ends with it and `release`
 * reuses {@link runDoctor} as its preflight, so there is exactly one definition of "is this
 * repository releasable".
 */
import type { BrandConsole } from "@moku-labs/common/cli";
import { allChecks } from "../checks";
import type { CheckContext, CheckResult, CheckStatus, ReleaseCheck } from "../types";

/**
 * One check's outcome, flattened for reporting and for `--json`.
 *
 * @example
 * const entry: DoctorEntry = { id: "npm-auth", title: "npm is logged in", status: "pass", detail: "ok" };
 */
export type DoctorEntry = CheckResult & {
  /** The check's stable machine id. */
  id: string;
  /** The check's human label. */
  title: string;
};

/**
 * The full diagnosis: every entry in report order plus whether anything blocks a release.
 *
 * @example
 * const report: DoctorReport = await runDoctor({ ctx, ui });
 * process.exitCode = report.failed ? 1 : 0;
 */
export type DoctorReport = {
  /** Every check's outcome, in registry order. */
  entries: DoctorEntry[];
  /** Whether at least one check failed. */
  failed: boolean;
};

/**
 * How `doctor` is invoked. `checks` is injectable so the release preflight and the tests
 * can run a subset without a second reporting path.
 *
 * @example
 * await runDoctor({ ctx, ui, json: true });
 */
export type DoctorOptions = {
  /** The ports and flags the checks run against. */
  ctx: CheckContext;
  /** The branded console every line is printed through. */
  ui: BrandConsole;
  /** Emit machine-readable JSON instead of the branded report. */
  json?: boolean;
  /** The checks to run. Defaults to the full registry. */
  checks?: readonly ReleaseCheck[];
};

/** Glyphs for the two statuses the branded `check` row cannot express on its own. */
const STATUS_GLYPH: Readonly<Record<Extract<CheckStatus, "warn" | "skip">, string>> = {
  warn: "⚠",
  skip: "–"
};

/**
 * Print one entry: pass/fail through the branded check row, warn/skip as their own glyph
 * so a warning never reads as a failure.
 *
 * @param ui - The branded console.
 * @param entry - The check outcome to render.
 * @example
 * renderEntry(ui, { id: "npm-auth", title: "npm is logged in", status: "pass", detail: "ok" });
 */
function renderEntry(ui: BrandConsole, entry: DoctorEntry): void {
  const label = `${entry.title} — ${entry.detail}`;
  const hint = entry.fix === undefined ? undefined : `fix: ${entry.fix}`;

  if (entry.status === "pass" || entry.status === "fail") {
    ui.check(entry.status === "pass", label, hint);
    return;
  }

  const glyph = STATUS_GLYPH[entry.status];
  ui.line(`  ${ui.palette.yellow(glyph)} ${label}`);
  if (hint !== undefined) ui.line(`      ${ui.palette.dim(hint)}`);
}

/**
 * Run one check, turning an unexpected throw into a failing entry rather than a crash —
 * a broken diagnostic must never hide the other ten.
 *
 * @param check - The check to run.
 * @param ctx - The ports and flags.
 * @returns The flattened entry.
 * @example
 * await evaluate(npmAuthCheck, ctx);
 */
async function evaluate(check: ReleaseCheck, ctx: CheckContext): Promise<DoctorEntry> {
  try {
    return { id: check.id, title: check.title, ...(await check.run(ctx)) };
  } catch (error) {
    return {
      id: check.id,
      title: check.title,
      status: "fail",
      detail: `check threw: ${String(error)}`,
      fix: "report this as a moku-release bug"
    };
  }
}

/**
 * Run every check in order and report. Checks run sequentially on purpose: the report is
 * read top to bottom, and the tools they shell out to are not all concurrency-safe.
 *
 * @param options - The ports, console, and output mode.
 * @returns The entries and whether anything failed.
 * @example
 * const report = await runDoctor({ ctx, ui });
 */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const { ctx, ui, json = false, checks = allChecks } = options;
  const entries: DoctorEntry[] = [];

  for (const check of checks) entries.push(await evaluate(check, ctx));
  const failed = entries.some(entry => entry.status === "fail");

  // `--json` is the whole output — no banner, no rail, nothing to strip downstream.
  if (json) {
    ui.line(JSON.stringify({ failed, checks: entries }, undefined, 2));
    return { entries, failed };
  }

  for (const entry of entries) renderEntry(ui, entry);
  return { entries, failed };
}

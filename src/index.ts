#!/usr/bin/env node
/**
 * @file `moku-release` — the CLI entry: build the ports, parse argv, dispatch, exit.
 *
 * Deliberately thin. It owns exactly three things — the branded console, the two injected
 * ports ({@link createExecutor} / {@link createFileStore}), and the exit code — so that
 * every decision worth testing lives in a command, a check, or a pure lib function, none
 * of which know that a process exists.
 */
import { type BrandPrompts, createBrandConsole, createBrandPrompts } from "@moku-labs/common/cli";
import { runDoctor } from "./commands/doctor";
import { runRelease } from "./commands/release";
import { runSetup } from "./commands/setup";
import { type ParsedArgv, parseArgv, RELEASE_TYPES } from "./lib/argv";
import { createExecutor } from "./lib/exec";
import { createFileStore } from "./lib/files";
import type { CheckContext } from "./types";

/** The usage block, printed for `help`, for a bare invocation, and for a rejected one. */
const USAGE = [
  "  moku-release setup              one-time wizard: workflows, contract, first publish",
  "  moku-release doctor [--json]    read-only diagnosis of the release setup",
  `  moku-release <${RELEASE_TYPES.join("|")}>`,
  "",
  "  --dry-run                       print every action, mutate nothing, ask nothing",
  "  --yes, -y                       answer every setup confirmation with yes",
  "",
  "  Two steps are yours alone — this CLI never handles a credential:",
  "    gh auth login",
  "    npm login"
].join("\n");

/** Prompts that never read stdin: every confirmation is a yes, every menu its first entry. */
const ASSENTING_PROMPTS: BrandPrompts = {
  /**
   * Answer a confirmation with yes.
   *
   * @returns Always `true`.
   * @example
   * await ASSENTING_PROMPTS.confirm("Replace ci.yml?"); // true
   */
  confirm: async () => true,
  /**
   * Pick the first entry of a menu.
   *
   * @returns Always `0`.
   * @example
   * await ASSENTING_PROMPTS.select("Bump?", ["patch", "minor"]); // 0
   */
  select: async () => 0
};

/**
 * Dispatch a parsed invocation to its command.
 *
 * @param parsed - The parsed argument vector.
 * @param ctx - The ports and flags every command runs against.
 * @param ui - The branded console.
 * @returns The process exit code.
 * @example
 * await dispatch(parseArgv(["doctor"]), ctx, ui);
 */
async function dispatch(
  parsed: ParsedArgv,
  ctx: CheckContext,
  ui: ReturnType<typeof createBrandConsole>
): Promise<number> {
  if (parsed.command === "doctor") {
    if (!parsed.json) ui.lockup({ wordmark: "moku release", label: "doctor" });
    const report = await runDoctor({ ctx, ui, json: parsed.json });
    return report.failed ? 1 : 0;
  }

  if (parsed.command === "setup") {
    // A dry run mutates nothing, so it has nothing to ask; `--yes` is for agents and CI,
    // where there is no TTY to answer on.
    const prompts = parsed.yes || parsed.dryRun ? ASSENTING_PROMPTS : createBrandPrompts();
    return runSetup({ ctx, ui, prompts, dryRun: parsed.dryRun, unattended: parsed.yes });
  }

  if (parsed.command === "release" && parsed.releaseType !== undefined) {
    return runRelease({ ctx, ui, releaseType: parsed.releaseType, dryRun: parsed.dryRun });
  }

  // `help`, and the bare invocation that lands here too.
  if (parsed.error !== undefined) ui.error(parsed.error);
  ui.lockup({ wordmark: "moku release", label: "usage" });
  ui.line(USAGE);
  return parsed.error === undefined ? 0 : 1;
}

/**
 * Build the ports from the current working directory and run the requested command.
 *
 * @returns The process exit code.
 * @example
 * process.exitCode = await main();
 */
async function main(): Promise<number> {
  const cwd = process.cwd();
  const ui = createBrandConsole();
  const ctx: CheckContext = {
    cwd,
    exec: createExecutor(cwd),
    files: createFileStore(cwd),
    strict: false
  };

  return dispatch(parseArgv(process.argv.slice(2)), ctx, ui);
}

process.exitCode = await main();

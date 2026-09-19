/**
 * @file `moku-release` — the injectable command runner, the CLI's only door to the shell.
 *
 * Two shapes, because release work needs both: `capture` reads a command's output (every
 * check), `inherit` hands the terminal to the child so `npm publish` can prompt for an OTP
 * and `gh run watch` can redraw. Arguments are always passed as an argv array through
 * `execFile`/`spawn` — never a shell string, so nothing interpolated can be re-parsed by a
 * shell. Tests inject a stub {@link Executor} and therefore never touch git, gh or npm.
 */
import { execFile, spawn } from "node:child_process";

/** Exit code POSIX shells use for "command not found" — what a missing binary reports. */
const COMMAND_NOT_FOUND = 127;

/**
 * The result of a captured command. A non-zero `code` is data, not an exception: checks
 * branch on it instead of wrapping every call in try/catch.
 *
 * @example
 * const output: CommandOutput = { code: 0, stdout: "11.6.0\n", stderr: "" };
 */
export type CommandOutput = {
  /** Process exit code (`127` when the binary does not exist). */
  code: number;
  /** Everything the command wrote to stdout. */
  stdout: string;
  /** Everything the command wrote to stderr. */
  stderr: string;
};

/**
 * Per-call overrides for a command invocation.
 *
 * @example
 * await exec.capture("git", ["status"], { cwd: "/repo" });
 */
export type ExecOptions = {
  /** Working directory for the child process. Defaults to the executor's root. */
  cwd?: string;
  /** Text piped to the child's stdin — how a JSON body reaches `gh api --input -`. */
  input?: string;
};

/**
 * The command port. Every check and command depends on this type rather than on
 * `node:child_process`, which is what keeps the test suite offline.
 *
 * @example
 * const exec: Executor = createExecutor("/repo");
 */
export type Executor = {
  /**
   * Run a command and capture its output.
   *
   * @param command - The binary to run (never a shell string).
   * @param args - The argument vector.
   * @param options - Optional per-call overrides.
   * @returns The exit code and captured streams.
   * @example
   * await exec.capture("npm", ["whoami"]);
   */
  capture(command: string, args: readonly string[], options?: ExecOptions): Promise<CommandOutput>;
  /**
   * Run a command with the parent's stdio, so it can prompt and redraw.
   *
   * @param command - The binary to run (never a shell string).
   * @param args - The argument vector.
   * @param options - Optional per-call overrides.
   * @returns The exit code.
   * @example
   * await exec.inherit("npm", ["publish", "--access", "public"]);
   */
  inherit(command: string, args: readonly string[], options?: ExecOptions): Promise<number>;
};

/**
 * Normalize a failed `execFile` call into a {@link CommandOutput}. A non-zero exit carries
 * `code` and both streams; a missing binary carries an `ENOENT`-style string code, no exit
 * status and no output, so the error text stands in for stderr.
 *
 * @param error - The error `execFile` passed to its callback.
 * @param stdout - What the child wrote to stdout before it failed.
 * @param stderr - What the child wrote to stderr before it failed.
 * @returns The equivalent captured output.
 * @example
 * fromExecError({ code: 1 }, "", "not logged in");
 */
function fromExecError(error: unknown, stdout: string, stderr: string): CommandOutput {
  const shape = error as { code?: number | string };
  const code = typeof shape.code === "number" ? shape.code : COMMAND_NOT_FOUND;

  // The callback form of `execFile` hands the streams over as arguments, not on the error.
  // Checks read them to tell "npm has no such command" from "nothing is registered".
  return { code, stdout, stderr: stderr === "" && stdout === "" ? String(error) : stderr };
}

/**
 * Create the real {@link Executor}, rooted at `cwd`.
 *
 * @param cwd - Default working directory for every child process.
 * @returns An executor bound to that directory.
 * @example
 * const exec = createExecutor(process.cwd());
 * const { stdout } = await exec.capture("git", ["rev-parse", "HEAD"]);
 */
export function createExecutor(cwd: string): Executor {
  /**
   * Run a command and capture both streams, turning failures into data.
   *
   * @param command - The binary to run.
   * @param args - The argument vector.
   * @param options - Optional per-call overrides.
   * @returns The exit code and captured streams.
   * @example
   * await capture("npm", ["--version"]);
   */
  const capture = (
    command: string,
    args: readonly string[],
    options: ExecOptions = {}
  ): Promise<CommandOutput> =>
    new Promise(resolve => {
      const child = execFile(
        command,
        [...args],
        { cwd: options.cwd ?? cwd },
        (error, stdout, stderr) => {
          if (error) return resolve(fromExecError(error, stdout, stderr));
          resolve({ code: 0, stdout, stderr });
        }
      );

      // A body for `--input -` is written once and the pipe closed, or the child hangs.
      if (options.input !== undefined) child.stdin?.end(options.input);
    });

  /**
   * Run a command attached to the parent's stdio so it can prompt and redraw.
   *
   * @param command - The binary to run.
   * @param args - The argument vector.
   * @param options - Optional per-call overrides.
   * @returns The exit code (`127` when the binary is missing).
   * @example
   * await inherit("npm", ["login"]);
   */
  const inherit = (
    command: string,
    args: readonly string[],
    options: ExecOptions = {}
  ): Promise<number> =>
    new Promise(resolve => {
      const child = spawn(command, [...args], { cwd: options.cwd ?? cwd, stdio: "inherit" });

      child.on("error", () => resolve(COMMAND_NOT_FOUND));
      child.on("close", code => resolve(code ?? 1));
    });

  return { capture, inherit };
}

/**
 * @file Test doubles for the two `moku-release` ports.
 *
 * Every test in this folder drives the CLI through these: canned command output instead of
 * git/gh/npm, a plain object instead of a working tree. Nothing here touches the network,
 * the filesystem, or a real process.
 */
import type { CommandOutput, ExecOptions, Executor } from "../../lib/exec";
import type { FileStore } from "../../lib/files";

/** A canned reply, or just the stdout string when the command is expected to succeed. */
export type StubReply = string | Partial<CommandOutput>;

/** A stub executor plus the transcript of what was asked of it. */
export type StubExecutor = Executor & {
  /** Every captured command line, in call order. */
  captured: string[];
  /** Every stdio-inherited command line, in call order. */
  inherited: string[];
  /** Every stdin body passed alongside a captured command. */
  inputs: string[];
};

/** Reply used for any command the test did not stub — a plain, silent failure. */
const UNKNOWN_COMMAND: CommandOutput = { code: 1, stdout: "", stderr: "stub: no reply" };

/**
 * Normalize a canned reply into a full command output.
 *
 * @param reply - The stubbed value.
 * @returns The command output it stands for.
 */
function toOutput(reply: StubReply): CommandOutput {
  if (typeof reply === "string") return { code: 0, stdout: reply, stderr: "" };

  return { code: reply.code ?? 0, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
}

/**
 * Build an {@link Executor} backed by a table of command lines. A key matches when the
 * invoked command line starts with it, so tests stub `npm view` without repeating every
 * argument.
 *
 * @param replies - Command-line prefix to canned reply.
 * @param inheritCodes - Exit codes for stdio-inherited commands, same prefix matching.
 * @returns The stub executor and its transcript.
 */
export function stubExecutor(
  replies: Record<string, StubReply> = {},
  inheritCodes: Record<string, number> = {}
): StubExecutor {
  const captured: string[] = [];
  const inherited: string[] = [];
  const inputs: string[] = [];

  const lookup = <T>(table: Record<string, T>, line: string): T | undefined => {
    const key = Object.keys(table)
      .toSorted((a, b) => b.length - a.length)
      .find(candidate => line.startsWith(candidate));

    return key === undefined ? undefined : table[key];
  };

  return {
    captured,
    inherited,
    inputs,
    async capture(command: string, args: readonly string[], options: ExecOptions = {}) {
      const line = [command, ...args].join(" ");
      captured.push(line);
      if (options.input !== undefined) inputs.push(options.input);

      const reply = lookup(replies, line);
      return reply === undefined ? UNKNOWN_COMMAND : toOutput(reply);
    },
    async inherit(command: string, args: readonly string[]) {
      const line = [command, ...args].join(" ");
      inherited.push(line);

      return lookup(inheritCodes, line) ?? 0;
    }
  };
}

/** A memory-backed file store plus the tree it holds. */
export type MemoryFiles = FileStore & {
  /** The current tree, keyed by repo-relative path. */
  tree: Record<string, string>;
  /** Every path written, in call order. */
  written: string[];
};

/**
 * Build a {@link FileStore} backed by a plain object.
 *
 * @param seed - The initial tree, keyed by repo-relative path.
 * @returns The memory file store and its transcript.
 */
export function memoryFiles(seed: Record<string, string> = {}): MemoryFiles {
  const tree: Record<string, string> = { ...seed };
  const written: string[] = [];

  return {
    tree,
    written,
    async read(path: string) {
      return tree[path];
    },
    async write(path: string, content: string) {
      tree[path] = content;
      written.push(path);
    },
    async backup(path: string) {
      const target = `${path}.bak`;
      tree[target] = tree[path] ?? "";
      return target;
    }
  };
}

/**
 * Build a console capture: a {@link import("@moku-labs/common/cli").BrandConsole} option bag
 * that records every line instead of printing it.
 *
 * @returns The captured lines and the options to pass to `createBrandConsole`.
 */
export function captureConsole(): {
  lines: string[];
  options: { write: (line: string) => void; writeError: (line: string) => void; color: false };
} {
  const lines: string[] = [];

  return {
    lines,
    options: {
      write: (line: string) => lines.push(line),
      writeError: (line: string) => lines.push(line),
      color: false
    }
  };
}

/**
 * Build prompts that answer every question the same way, recording what was asked.
 *
 * @param answer - The answer every `confirm` resolves to.
 * @returns The stub prompts and the questions asked.
 */
export function stubPrompts(answer: boolean): {
  asked: string[];
  prompts: { confirm(question: string): Promise<boolean>; select(): Promise<number> };
} {
  const asked: string[] = [];

  return {
    asked,
    prompts: {
      async confirm(question: string) {
        asked.push(question);
        return answer;
      },
      async select() {
        return 0;
      }
    }
  };
}

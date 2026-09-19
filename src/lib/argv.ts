/**
 * @file `moku-release` — argv parsing, kept out of the entry so the entry stays a
 * dispatcher.
 *
 * The grammar is deliberately tiny: one positional (a command name, or a semver bump that
 * implies the `release` command) plus four flags. Anything unrecognized resolves to
 * `help` with an `error` set — the CLI never guesses what an operator meant.
 */

/** The semver bumps `moku-release <type>` accepts, in menu order. */
export const RELEASE_TYPES = ["patch", "minor", "major", "prerelease"] as const;

/** Every flag the CLI accepts, besides `--help`. */
const KNOWN_FLAGS: ReadonlySet<string> = new Set(["--json", "--dry-run", "--yes", "-y"]);

/**
 * A semver bump the release workflow understands.
 *
 * @example
 * const type: ReleaseType = "patch";
 */
export type ReleaseType = (typeof RELEASE_TYPES)[number];

/**
 * The command the entry dispatches to.
 *
 * @example
 * const command: CommandName = "doctor";
 */
export type CommandName = "doctor" | "setup" | "release" | "help";

/**
 * The parsed invocation. `error` is set only when `command` is `help`, and then the entry
 * prints usage and exits non-zero.
 *
 * @example
 * const parsed: ParsedArgv = { command: "release", releaseType: "patch", json: false, dryRun: false, yes: false };
 */
export type ParsedArgv = {
  /** The command to run. */
  command: CommandName;
  /** The semver bump, present only for the `release` command. */
  releaseType?: ReleaseType;
  /** Whether `--json` machine output was requested. */
  json: boolean;
  /** Whether `--dry-run` was requested (no mutation is performed). */
  dryRun: boolean;
  /** Whether `--yes` was requested: every confirmation is answered yes, for agents and CI. */
  yes: boolean;
  /** Why the invocation was rejected, when it was. */
  error?: string;
};

/**
 * Whether a positional argument is one of the semver bumps.
 *
 * @param value - The positional to test.
 * @returns `true` when it names a release type.
 * @example
 * isReleaseType("patch"); // true
 */
function isReleaseType(value: string): value is ReleaseType {
  return (RELEASE_TYPES as readonly string[]).includes(value);
}

/**
 * Build a `help` result carrying the reason the invocation was rejected.
 *
 * @param error - The message shown above the usage block.
 * @returns The rejecting parse result.
 * @example
 * rejected("unknown flag `--force`");
 */
function rejected(error: string): ParsedArgv {
  return { command: "help", json: false, dryRun: false, yes: false, error };
}

/**
 * Parse the argument vector (without `node` and the script path).
 *
 * @param argv - The raw arguments, e.g. `process.argv.slice(2)`.
 * @returns What to run, and with which flags.
 * @example
 * parseArgv(["patch", "--dry-run"]);
 * // { command: "release", releaseType: "patch", json: false, dryRun: true, yes: false }
 */
export function parseArgv(argv: readonly string[]): ParsedArgv {
  const flags = argv.filter(argument => argument.startsWith("-"));
  const positionals = argv.filter(argument => !argument.startsWith("-"));

  // Help wins over everything: `--help` must never be read as a rejected invocation.
  if (flags.includes("--help") || flags.includes("-h")) {
    return { command: "help", json: false, dryRun: false, yes: false };
  }

  // Flags are an exact allowlist — a typo must not silently become a no-op.
  const unknownFlag = flags.find(flag => !KNOWN_FLAGS.has(flag));
  if (unknownFlag) return rejected(`unknown flag \`${unknownFlag}\``);
  if (positionals.length > 1) return rejected(`unexpected argument \`${positionals[1]}\``);

  const json = flags.includes("--json");
  const dryRun = flags.includes("--dry-run");
  const yes = flags.includes("--yes") || flags.includes("-y");

  // No positional: print usage, successfully — `bun run release` with no bump lands here.
  const [first] = positionals;
  if (first === undefined) return { command: "help", json, dryRun, yes };

  if (first === "doctor" || first === "setup") return { command: first, json, dryRun, yes };
  if (first === "help") return { command: "help", json, dryRun, yes };
  if (isReleaseType(first)) return { command: "release", releaseType: first, json, dryRun, yes };

  return rejected(`unknown command \`${first}\``);
}

/**
 * @file `moku-release` — the package.json contract: what a releasable moku-labs package
 * must declare, how to report what is missing, and how to fill the gaps.
 *
 * {@link contractIssues} and {@link normalizeManifest} are two views of ONE table
 * ({@link REQUIRED_SCRIPTS} plus the field rules), so `doctor` can never report a gap
 * `setup` does not close. Normalization is additive and idempotent: it fills what is
 * absent and never rewrites a value the package already chose.
 */
import type { FileStore } from "./files";

/** Repo-relative path of the manifest every command reads. */
export const MANIFEST_PATH = "package.json";

/** Lowest Node major a releasable package may declare — the npm Trusted Publishing floor. */
const MINIMUM_NODE_MAJOR = 24;

/** Value `engines.node` is set to when the field is missing or too low. */
const NODE_ENGINE_RANGE = ">=24.0.0";

/** Default `files` entry when a package declares none — the build output. */
const DEFAULT_FILES = ["dist"];

/** The scripts a releasable package must expose, mapped to the value `setup` fills in. */
export const REQUIRED_SCRIPTS: Readonly<Record<string, string>> = {
  lint: "biome check . && eslint .",
  typecheck: "tsc --noEmit",
  test: "vitest run",
  build: "tsdown",
  validate: "publint && attw --pack . --profile node16",
  "release:setup": "moku-release setup",
  "release:doctor": "moku-release doctor",
  release: "moku-release"
};

/**
 * The slice of a `package.json` this CLI reads and writes. Unknown keys survive a
 * round-trip untouched, which is why the index signature is part of the type.
 *
 * @example
 * const manifest: PackageManifest = { name: "@moku-labs/common", version: "1.0.0" };
 */
export type PackageManifest = {
  /** The package name. */
  name?: string;
  /** The current version. */
  version?: string;
  /** The npm scripts table. */
  scripts?: Record<string, string>;
  /** Publish-time overrides — `access` must be `"public"` for a scoped package. */
  publishConfig?: { access?: string; [key: string]: unknown };
  /** The repository, in either the object or the shorthand string form. */
  repository?: { type?: string; url?: string } | string;
  /** The allowlist of published files. */
  files?: string[];
  /** Runtime engine ranges. */
  engines?: { node?: string; [key: string]: unknown };
  /** Everything else, preserved verbatim. */
  [key: string]: unknown;
};

/**
 * The outcome of a normalization pass: the manifest to write and the human summary of
 * what changed. An empty `changes` array means the file is already on contract.
 *
 * @example
 * const { changes } = normalizeManifest(manifest, remoteUrl);
 * if (changes.length === 0) ui.check(true, "package.json already on contract");
 */
export type NormalizeResult = {
  /** The normalized manifest (a copy — the input is never mutated). */
  manifest: PackageManifest;
  /** One line per applied change, in the order they were applied. */
  changes: string[];
};

/**
 * Parse `package.json` text, treating malformed or non-object content as absent.
 *
 * @param text - The raw file contents, or `undefined` when the file is missing.
 * @returns The manifest, or `undefined` when it cannot be read as an object.
 * @example
 * parseManifest('{"name":"x"}');
 */
export function parseManifest(text: string | undefined): PackageManifest | undefined {
  if (text === undefined) return undefined;

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;

    return parsed as PackageManifest;
  } catch {
    return undefined;
  }
}

/**
 * Read and parse the package manifest from a file store.
 *
 * @param files - The file port to read through.
 * @returns The manifest, or `undefined` when it is missing or malformed.
 * @example
 * const manifest = await readManifest(ctx.files);
 */
export async function readManifest(files: FileStore): Promise<PackageManifest | undefined> {
  return parseManifest(await files.read(MANIFEST_PATH));
}

/**
 * Render a manifest the way npm itself writes one: two-space JSON with a trailing newline.
 *
 * @param manifest - The manifest to serialize.
 * @returns The file contents to write.
 * @example
 * await files.write("package.json", formatManifest(manifest));
 */
export function formatManifest(manifest: PackageManifest): string {
  return `${JSON.stringify(manifest, undefined, 2)}\n`;
}

/**
 * The repository URL a manifest declares, in either the object or shorthand string form.
 *
 * @param manifest - The manifest to read.
 * @returns The declared URL, or `undefined` when the field is absent.
 * @example
 * repositoryUrlOf({ repository: { url: "git+https://github.com/o/r.git" } });
 */
export function repositoryUrlOf(manifest: PackageManifest): string | undefined {
  const { repository } = manifest;
  if (typeof repository === "string") return repository;

  return repository?.url;
}

/**
 * Whether an `engines.node` range admits Node 24 or newer. Only the first number in the
 * range is read — enough to separate `>=24`/`^24` from `>=20`, and it never mistakes a
 * richer range for a violation.
 *
 * @param range - The declared range, or `undefined`.
 * @returns `true` when the range's floor is Node 24 or newer.
 * @example
 * satisfiesNodeFloor(">=24.0.0"); // true
 */
export function satisfiesNodeFloor(range: string | undefined): boolean {
  if (range === undefined) return false;

  const match = /(\d+)/.exec(range);
  if (!match?.[1]) return false;

  return Number.parseInt(match[1], 10) >= MINIMUM_NODE_MAJOR;
}

/**
 * Every way a manifest falls short of the release contract, one line per gap, each naming
 * the exact script or field. An empty array means the manifest is on contract.
 *
 * @param manifest - The manifest to audit.
 * @returns The list of gaps, in reporting order.
 * @example
 * contractIssues({ name: "x" }); // ["missing script `lint`", …]
 */
export function contractIssues(manifest: PackageManifest): string[] {
  const issues: string[] = [];
  const scripts = manifest.scripts ?? {};

  // Scripts first — they are the bulk of the contract and the most common gap.
  for (const name of Object.keys(REQUIRED_SCRIPTS)) {
    if (!scripts[name]) issues.push(`missing script \`${name}\``);
  }

  // Then the publish-shaped fields.
  if (manifest.publishConfig?.access !== "public")
    issues.push("`publishConfig.access` is not `public`");
  if (repositoryUrlOf(manifest) === undefined) issues.push("missing `repository.url`");
  if (!manifest.files || manifest.files.length === 0) issues.push("missing `files`");
  if (!satisfiesNodeFloor(manifest.engines?.node)) issues.push("`engines.node` is below `>=24`");

  return issues;
}

/**
 * Bring a manifest onto the contract without overwriting anything it already chose: fill
 * missing scripts, force `publishConfig.access`, adopt the git remote as `repository.url`
 * when absent, add a default `files` allowlist, and raise `engines.node` to the floor.
 *
 * Running it twice produces no further changes — `setup` relies on that to stay idempotent.
 *
 * @param manifest - The manifest to normalize (never mutated).
 * @param remoteUrl - The `git remote get-url origin` value, when one is known.
 * @returns The normalized copy and the list of applied changes.
 * @example
 * const { manifest: next, changes } = normalizeManifest(current, "git@github.com:o/r.git");
 */
export function normalizeManifest(manifest: PackageManifest, remoteUrl?: string): NormalizeResult {
  const next: PackageManifest = structuredClone(manifest);
  const changes: string[] = [];

  // Scripts: add the ones that are absent, keep every value the package already chose.
  const scripts = { ...next.scripts };
  for (const [name, command] of Object.entries(REQUIRED_SCRIPTS)) {
    if (scripts[name]) continue;

    scripts[name] = command;
    changes.push(`+ scripts.${name} = "${command}"`);
  }
  next.scripts = scripts;

  // publishConfig.access is not a preference — a scoped package is private without it.
  if (next.publishConfig?.access !== "public") {
    next.publishConfig = { ...next.publishConfig, access: "public" };
    changes.push('+ publishConfig.access = "public"');
  }

  // repository.url: adopt the real remote only when the manifest declares none.
  if (repositoryUrlOf(next) === undefined && remoteUrl !== undefined) {
    next.repository = { type: "git", url: remoteUrl };
    changes.push(`+ repository.url = "${remoteUrl}"`);
  }

  // files: publishing without an allowlist ships the whole working tree.
  if (!next.files || next.files.length === 0) {
    next.files = [...DEFAULT_FILES];
    changes.push(`+ files = ${JSON.stringify(DEFAULT_FILES)}`);
  }

  // engines.node: the Trusted Publishing floor, raised only when it is too low.
  if (!satisfiesNodeFloor(next.engines?.node)) {
    next.engines = { ...next.engines, node: NODE_ENGINE_RANGE };
    changes.push(`+ engines.node = "${NODE_ENGINE_RANGE}"`);
  }

  return { manifest: next, changes };
}

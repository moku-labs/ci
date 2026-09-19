/**
 * @file `moku-release` — read a central definition from this package's own files.
 *
 * The CLI ships in the same package as `examples/` and `rulesets/`, so a template is read
 * from disk instead of being copied into a string. One file, one version, nothing to drift.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** A file that only exists at the package root, used to find it from `src/` and from `dist/`. */
const ROOT_MARKER = path.join("rulesets", "main.json");

/**
 * The package root: the closest parent directory that holds `rulesets/main.json`.
 *
 * @returns The absolute path of the package root.
 * @throws {Error} When no parent directory holds the marker, which means a broken install.
 * @example
 * path.join(packageRoot(), "examples");
 */
function packageRoot(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));

  while (!existsSync(path.join(directory, ROOT_MARKER))) {
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error(`moku-release: ${ROOT_MARKER} not found above ${import.meta.url}`);
    directory = parent;
  }

  return directory;
}

/**
 * Read one central definition, for example `examples/package/ci.yml`.
 *
 * @param relativePath - The path inside the package.
 * @returns The file contents.
 * @example
 * readCentral("rulesets/main.json");
 */
export function readCentral(relativePath: string): string {
  return readFileSync(path.join(packageRoot(), relativePath), "utf8");
}

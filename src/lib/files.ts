/**
 * @file `moku-release` — the injectable file port, rooted at the package directory.
 *
 * The second (and last) door to the outside world. Checks only ever `read`; `setup` also
 * `write`s and takes a `.bak` before it replaces anything it did not author. Paths are
 * always repo-relative POSIX paths, so a test can back the whole CLI with a plain object.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";

/** Suffix given to the copy `setup` keeps before overwriting a file it did not author. */
const BACKUP_SUFFIX = ".bak";

/**
 * The file port. Missing files read as `undefined` rather than throwing, so callers stay
 * in guard-clause style instead of wrapping every read.
 *
 * @example
 * const files: FileStore = createFileStore("/repo");
 */
export type FileStore = {
  /**
   * Read a repo-relative file as UTF-8 text.
   *
   * @param path - Repo-relative path.
   * @returns The contents, or `undefined` when the file does not exist.
   * @example
   * await files.read("package.json");
   */
  read(path: string): Promise<string | undefined>;
  /**
   * Write a repo-relative file as UTF-8 text, creating parent directories.
   *
   * @param path - Repo-relative path.
   * @param content - The text to write.
   * @returns Nothing.
   * @example
   * await files.write(".github/workflows/ci.yml", yaml);
   */
  write(path: string, content: string): Promise<void>;
  /**
   * Copy a repo-relative file to `<path>.bak`.
   *
   * @param path - Repo-relative path of the file to preserve.
   * @returns The repo-relative path of the backup.
   * @example
   * await files.backup(".github/workflows/ci.yml");
   */
  backup(path: string): Promise<string>;
};

/**
 * Create the real {@link FileStore}, rooted at `root`.
 *
 * @param root - Absolute path every relative path resolves against.
 * @returns A file store bound to that directory.
 * @example
 * const files = createFileStore(process.cwd());
 * const manifest = await files.read("package.json");
 */
export function createFileStore(root: string): FileStore {
  /**
   * Resolve a repo-relative path against the store root.
   *
   * @param relative - Repo-relative path.
   * @returns The absolute path.
   * @example
   * absolute("package.json");
   */
  const absolute = (relative: string): string => nodePath.resolve(root, relative);

  /**
   * Read a repo-relative file, mapping "missing" to `undefined`.
   *
   * @param path - Repo-relative path.
   * @returns The contents, or `undefined`.
   * @example
   * await read("package.json");
   */
  const read = async (path: string): Promise<string | undefined> => {
    try {
      return await readFile(absolute(path), "utf8");
    } catch {
      return undefined;
    }
  };

  /**
   * Write a repo-relative file, creating parent directories first.
   *
   * @param path - Repo-relative path.
   * @param content - The text to write.
   * @returns Nothing.
   * @example
   * await write("README.md", "# hi");
   */
  const write = async (path: string, content: string): Promise<void> => {
    const target = absolute(path);

    await mkdir(nodePath.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  };

  /**
   * Copy a repo-relative file next to itself with a `.bak` suffix.
   *
   * @param path - Repo-relative path of the file to preserve.
   * @returns The repo-relative path of the backup.
   * @example
   * await backup(".github/workflows/ci.yml");
   */
  const backup = async (path: string): Promise<string> => {
    const target = `${path}${BACKUP_SUFFIX}`;

    await copyFile(absolute(path), absolute(target));
    return target;
  };

  return { read, write, backup };
}

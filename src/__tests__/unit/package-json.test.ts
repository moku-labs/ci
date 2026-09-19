import { describe, expect, it } from "vitest";
import {
  contractIssues,
  formatManifest,
  normalizeManifest,
  type PackageManifest,
  parseManifest,
  REQUIRED_SCRIPTS,
  repositoryUrlOf,
  satisfiesNodeFloor
} from "../../lib/package-json";

const REMOTE = "git+https://github.com/moku-labs/common.git";

const onContract = (): PackageManifest => ({
  name: "@moku-labs/common",
  version: "1.0.0",
  scripts: { ...REQUIRED_SCRIPTS },
  publishConfig: { access: "public" },
  repository: { type: "git", url: REMOTE },
  files: ["dist"],
  engines: { node: ">=24.0.0" }
});

describe("parseManifest", () => {
  it("parses an object and rejects anything else", () => {
    expect(parseManifest('{"name":"x"}')).toEqual({ name: "x" });
    expect(parseManifest("[]")).toBeUndefined();
    expect(parseManifest("nope")).toBeUndefined();
    expect(parseManifest(undefined)).toBeUndefined();
  });
});

describe("repositoryUrlOf", () => {
  it("reads both the object and the shorthand form", () => {
    expect(repositoryUrlOf({ repository: { url: REMOTE } })).toBe(REMOTE);
    expect(repositoryUrlOf({ repository: REMOTE })).toBe(REMOTE);
    expect(repositoryUrlOf({})).toBeUndefined();
  });
});

describe("satisfiesNodeFloor", () => {
  it("gates on the Node 24 floor", () => {
    expect(satisfiesNodeFloor(">=24.0.0")).toBe(true);
    expect(satisfiesNodeFloor("^24")).toBe(true);
    expect(satisfiesNodeFloor(">=20.0.0")).toBe(false);
    expect(satisfiesNodeFloor(undefined)).toBe(false);
  });
});

describe("contractIssues", () => {
  it("is empty for a manifest on contract", () => {
    expect(contractIssues(onContract())).toEqual([]);
  });

  it("names every missing script individually", () => {
    const issues = contractIssues({ ...onContract(), scripts: { build: "tsdown" } });

    expect(issues).toContain("missing script `lint`");
    expect(issues).toContain("missing script `typecheck`");
    expect(issues).toContain("missing script `release:doctor`");
    expect(issues).not.toContain("missing script `build`");
  });

  it("names every missing publish field individually", () => {
    const issues = contractIssues({ name: "x", version: "1.0.0" });

    expect(issues).toContain("`publishConfig.access` is not `public`");
    expect(issues).toContain("missing `repository.url`");
    expect(issues).toContain("missing `files`");
    expect(issues).toContain("`engines.node` is below `>=24`");
  });

  it("requires the three release scripts the contract names", () => {
    expect(REQUIRED_SCRIPTS["release:setup"]).toBe("moku-release setup");
    expect(REQUIRED_SCRIPTS["release:doctor"]).toBe("moku-release doctor");
    expect(REQUIRED_SCRIPTS.release).toBe("moku-release");
    expect(REQUIRED_SCRIPTS.typecheck).toBe("tsc --noEmit");
  });
});

describe("normalizeManifest", () => {
  it("closes every gap contractIssues reports", () => {
    const { manifest, changes } = normalizeManifest({ name: "x", version: "1.0.0" }, REMOTE);

    expect(contractIssues(manifest)).toEqual([]);
    expect(changes.length).toBeGreaterThan(0);
  });

  it("is idempotent — a second pass changes nothing", () => {
    const first = normalizeManifest({ name: "x", version: "1.0.0" }, REMOTE);
    const second = normalizeManifest(first.manifest, REMOTE);

    expect(second.changes).toEqual([]);
    expect(second.manifest).toEqual(first.manifest);
  });

  it("reports nothing for a manifest that is already on contract", () => {
    expect(normalizeManifest(onContract(), REMOTE).changes).toEqual([]);
  });

  it("never overwrites a script or a repository URL the package already chose", () => {
    const current: PackageManifest = {
      name: "x",
      version: "1.0.0",
      scripts: { test: "bun test" },
      repository: { type: "git", url: "https://github.com/other/repo.git" }
    };

    const { manifest } = normalizeManifest(current, REMOTE);

    expect(manifest.scripts?.test).toBe("bun test");
    expect(repositoryUrlOf(manifest)).toBe("https://github.com/other/repo.git");
  });

  it("does not mutate its input", () => {
    const current: PackageManifest = { name: "x", version: "1.0.0" };
    normalizeManifest(current, REMOTE);

    expect(current).toEqual({ name: "x", version: "1.0.0" });
  });

  it("preserves unknown keys through a round-trip", () => {
    const { manifest } = normalizeManifest({ name: "x", keywords: ["a"] }, REMOTE);

    expect(manifest.keywords).toEqual(["a"]);
  });
});

describe("formatManifest", () => {
  it("writes two-space JSON with a trailing newline, the way npm does", () => {
    const text = formatManifest({ name: "x" });

    expect(text).toBe('{\n  "name": "x"\n}\n');
  });
});

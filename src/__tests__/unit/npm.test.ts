import { describe, expect, it } from "vitest";
import {
  compareSemver,
  distTagFor,
  isAtLeast,
  npmPackageUrl,
  parseDistTags,
  parseSemver
} from "../../lib/npm";

describe("parseSemver", () => {
  it("drops a leading v and build metadata", () => {
    expect(parseSemver("v1.2.3+build.5")).toEqual({ core: [1, 2, 3], prerelease: [] });
  });

  it("keeps every prerelease identifier after the first dash", () => {
    expect(parseSemver("1.0.0-rc.1").prerelease).toEqual(["rc", "1"]);
    expect(parseSemver("1.0.0-alpha.0.beta").prerelease).toEqual(["alpha", "0", "beta"]);
  });
});

describe("compareSemver", () => {
  it("orders the numeric core", () => {
    expect(compareSemver("1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compareSemver("1.2.3", "1.10.0")).toBeLessThan(0);
    expect(compareSemver("v2.0.0", "2.0.0")).toBe(0);
  });

  it("ranks a prerelease below its own stable release", () => {
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
  });

  it("compares numeric prerelease identifiers numerically, not lexically", () => {
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
  });

  it("ranks a numeric identifier below an alphanumeric one", () => {
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
  });

  it("ranks a shorter prerelease run below a longer one with the same prefix", () => {
    expect(compareSemver("1.0.0-rc", "1.0.0-rc.1")).toBeLessThan(0);
  });
});

describe("isAtLeast", () => {
  it("gates on the npm trusted-publishing floor", () => {
    expect(isAtLeast("11.5.1", "11.5.1")).toBe(true);
    expect(isAtLeast("11.6.0", "11.5.1")).toBe(true);
    expect(isAtLeast("11.5.0", "11.5.1")).toBe(false);
    expect(isAtLeast("10.9.9", "11.5.1")).toBe(false);
  });
});

describe("distTagFor", () => {
  it("routes prereleases to next and stables to latest", () => {
    expect(distTagFor("1.0.0")).toBe("latest");
    expect(distTagFor("1.0.0-rc.1")).toBe("next");
  });
});

describe("parseDistTags", () => {
  it("parses the registry payload", () => {
    expect(parseDistTags('{"latest":"1.2.3","next":"1.3.0-rc.1"}')).toEqual({
      latest: "1.2.3",
      next: "1.3.0-rc.1"
    });
  });

  it("returns undefined for anything that is not a JSON object", () => {
    expect(parseDistTags("not json")).toBeUndefined();
    expect(parseDistTags("[]")).toBeUndefined();
  });
});

describe("npmPackageUrl", () => {
  it("links the exact published version", () => {
    expect(npmPackageUrl("@moku-labs/common", "1.2.3")).toBe(
      "https://www.npmjs.com/package/@moku-labs/common/v/1.2.3"
    );
  });
});

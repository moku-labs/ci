import { describe, expect, it } from "vitest";
import {
  LATEST_TAG_ARGS,
  latestVersionTag,
  normalizeRemoteUrl,
  ownerRepoFrom,
  sameRemote
} from "../../lib/git";

describe("LATEST_TAG_ARGS", () => {
  it("sorts prereleases below their stable release", () => {
    // Without `versionsort.suffix=-` git ranks v1.0.0-rc.1 ABOVE v1.0.0.
    expect(LATEST_TAG_ARGS).toContain("versionsort.suffix=-");
    expect(LATEST_TAG_ARGS).toContain("--sort=-v:refname");
  });
});

describe("normalizeRemoteUrl", () => {
  it.each([
    ["git+https://github.com/moku-labs/common.git"],
    ["https://github.com/moku-labs/common"],
    ["https://github.com/moku-labs/common/"],
    ["git@github.com:moku-labs/common.git"],
    ["ssh://git@github.com/moku-labs/common.git"],
    ["  https://github.com/moku-labs/common.git \n"]
  ])("reduces %s to the canonical https form", url => {
    expect(normalizeRemoteUrl(url)).toBe("https://github.com/moku-labs/common");
  });
});

describe("ownerRepoFrom", () => {
  it("extracts the slug from every remote form", () => {
    expect(ownerRepoFrom("git@github.com:moku-labs/common.git")).toBe("moku-labs/common");
    expect(ownerRepoFrom("git+https://github.com/moku-labs/common.git")).toBe("moku-labs/common");
  });

  it("returns undefined for a non-GitHub remote", () => {
    expect(ownerRepoFrom("https://gitlab.com/x/y.git")).toBeUndefined();
  });
});

describe("sameRemote", () => {
  it("compares canonical forms, not strings", () => {
    expect(sameRemote("git@github.com:o/r.git", "https://github.com/o/r")).toBe(true);
    expect(sameRemote("https://github.com/o/r", "https://github.com/o/other")).toBe(false);
  });
});

describe("latestVersionTag", () => {
  it("takes the first line of the sorted listing", () => {
    expect(latestVersionTag("v1.2.3\nv1.2.2\nv1.0.0\n")).toBe("v1.2.3");
  });

  it("returns undefined when there are no tags", () => {
    expect(latestVersionTag("\n  \n")).toBeUndefined();
  });
});

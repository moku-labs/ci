import { describe, expect, it } from "vitest";
import { hasMainBranchRuleset, latestRunId, releaseUrl } from "../../lib/github";

describe("hasMainBranchRuleset", () => {
  it("accepts an active branch ruleset", () => {
    const payload = JSON.stringify([{ name: "main", target: "branch", enforcement: "active" }]);

    expect(hasMainBranchRuleset(payload)).toBe(true);
  });

  it("ignores tag rulesets — moku-release pushes tags", () => {
    const payload = JSON.stringify([{ name: "tags", target: "tag", enforcement: "active" }]);

    expect(hasMainBranchRuleset(payload)).toBe(false);
  });

  it("ignores a disabled ruleset", () => {
    const payload = JSON.stringify([{ target: "branch", enforcement: "disabled" }]);

    expect(hasMainBranchRuleset(payload)).toBe(false);
  });

  it("treats unparseable output as no ruleset", () => {
    expect(hasMainBranchRuleset("gh: Not Found")).toBe(false);
    expect(hasMainBranchRuleset("[]")).toBe(false);
  });
});

describe("latestRunId", () => {
  it("reads the newest run id", () => {
    expect(latestRunId('[{"databaseId":42},{"databaseId":41}]')).toBe("42");
  });

  it("returns undefined when nothing was listed", () => {
    expect(latestRunId("[]")).toBeUndefined();
    expect(latestRunId("nope")).toBeUndefined();
  });
});

describe("releaseUrl", () => {
  it("links the tag", () => {
    expect(releaseUrl("moku-labs/common", "v1.2.3")).toBe(
      "https://github.com/moku-labs/common/releases/tag/v1.2.3"
    );
  });
});

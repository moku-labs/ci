import { describe, expect, it } from "vitest";
import {
  activeBranchRulesetIds,
  hasMainBranchRuleset,
  latestRunId,
  releaseUrl,
  requiredCheckContexts,
  withCentralRequiredChecks
} from "../../lib/github";

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

describe("activeBranchRulesetIds", () => {
  it("lists only active branch rulesets that carry an id", () => {
    const payload = JSON.stringify([
      { id: 1, target: "branch", enforcement: "active" },
      { id: 2, target: "tag", enforcement: "active" },
      { id: 3, target: "branch", enforcement: "disabled" },
      { target: "branch", enforcement: "active" }
    ]);

    expect(activeBranchRulesetIds(payload)).toEqual([1]);
  });
});

describe("requiredCheckContexts", () => {
  it("reads the required contexts of one ruleset", () => {
    const payload = JSON.stringify({
      rules: [
        { type: "deletion" },
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "lint" }, { context: "ci / test" }] }
        }
      ]
    });

    expect(requiredCheckContexts(payload)).toEqual(["lint", "ci / test"]);
  });

  it("treats unparseable output as no required checks", () => {
    expect(requiredCheckContexts("gh: Not Found")).toEqual([]);
  });
});

describe("withCentralRequiredChecks", () => {
  it("keeps the other rules and swaps in the central required checks", () => {
    const existing = JSON.stringify({
      rules: [
        { type: "deletion" },
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "lint" }] }
        }
      ]
    });
    const template = JSON.stringify({
      rules: [
        { type: "pull_request" },
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "ci / lint" }] }
        }
      ]
    });

    expect(JSON.parse(withCentralRequiredChecks(existing, template))).toEqual({
      rules: [
        { type: "deletion" },
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "ci / lint" }] }
        }
      ]
    });
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

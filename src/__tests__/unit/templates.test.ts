import { describe, expect, it } from "vitest";
import { isThinWorkflow, renderMainRuleset, workflowTemplates } from "../../lib/templates";
import { CI_WORKFLOW, CI_WORKFLOW_PATH } from "../../templates/ci";
import { PUBLISH_WORKFLOW, PUBLISH_WORKFLOW_PATH } from "../../templates/publish";

const [ciTemplate, publishTemplate] = workflowTemplates;
if (!ciTemplate || !publishTemplate) throw new Error("expected both workflow templates");

describe("workflow templates", () => {
  it("writes exactly the two workflows, at their contract paths", () => {
    expect(workflowTemplates).toHaveLength(2);
    expect(ciTemplate?.path).toBe(".github/workflows/ci.yml");
    // npm validates the CALLING workflow's filename — renaming this breaks OIDC publishing.
    expect(publishTemplate?.path).toBe(".github/workflows/publish.yml");
  });

  it("pins both callers to the central reusable workflows at @v1", () => {
    expect(CI_WORKFLOW).toContain("uses: moku-labs/ci/.github/workflows/package-ci.yml@v1");
    expect(PUBLISH_WORKFLOW).toContain(
      "uses: moku-labs/ci/.github/workflows/package-release.yml@v1"
    );
  });

  it("never mentions a publish token — id-token is the whole credential", () => {
    for (const template of workflowTemplates) {
      expect(template.content).not.toContain("NPM_TOKEN");
      expect(template.content).not.toContain("NODE_AUTH_TOKEN");
      expect(template.content).not.toContain("secrets.");
    }
    expect(PUBLISH_WORKFLOW).toContain("id-token: write");
  });

  it("names the ci caller job `ci`, so required checks read `ci / lint`", () => {
    expect(CI_WORKFLOW).toContain("jobs:\n  ci:\n");
  });

  it("leaves ci.yml without a concurrency block on purpose", () => {
    // A caller group equal to github.workflow deadlocks against its own reused child.
    expect(CI_WORKFLOW).not.toContain("concurrency:");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting on GitHub Actions expression syntax.
    expect(PUBLISH_WORKFLOW).toContain("group: publish-${{ github.ref }}");
    expect(PUBLISH_WORKFLOW).toContain("cancel-in-progress: false");
  });

  it("offers the four release types on the dispatch input", () => {
    expect(PUBLISH_WORKFLOW).toContain("options: [patch, minor, major, prerelease]");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting on GitHub Actions expression syntax.
    expect(PUBLISH_WORKFLOW).toContain("release_type: ${{ inputs.release_type }}");
  });

  it("exposes each body at its own path constant", () => {
    expect(CI_WORKFLOW_PATH).toBe(ciTemplate?.path);
    expect(PUBLISH_WORKFLOW_PATH).toBe(publishTemplate?.path);
  });
});

describe("isThinWorkflow", () => {
  it("accepts a file pinned to the central workflow", () => {
    expect(isThinWorkflow(CI_WORKFLOW, ciTemplate)).toBe(true);
    expect(isThinWorkflow(PUBLISH_WORKFLOW, publishTemplate)).toBe(true);
  });

  it("accepts the local-publish fallback variant, which calls the same ref", () => {
    const fallback = `name: Release\njobs:\n  release:\n    uses: ${publishTemplate?.ref}\n`;

    expect(isThinWorkflow(fallback, publishTemplate)).toBe(true);
  });

  it("rejects a hand-written legacy pipeline", () => {
    const legacy = "name: CI\njobs:\n  lint:\n    runs-on: ubuntu-latest\n";

    expect(isThinWorkflow(legacy, ciTemplate)).toBe(false);
  });
});

describe("renderMainRuleset", () => {
  it("is PR-only main with the four required checks, and leaves tags alone", () => {
    const ruleset = JSON.parse(renderMainRuleset()) as {
      target: string;
      rules: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[];
    };

    expect(ruleset.target).toBe("branch");
    expect(ruleset.rules.map(rule => rule.type)).toContain("pull_request");
    expect(ruleset.rules.map(rule => rule.type)).toContain("non_fast_forward");

    const checks = ruleset.rules.find(rule => rule.type === "required_status_checks");
    expect(checks?.parameters?.required_status_checks?.map(entry => entry.context)).toEqual([
      "ci / lint",
      "ci / types",
      "ci / test",
      "ci / build"
    ]);
  });
});

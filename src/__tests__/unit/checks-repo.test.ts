import { describe, expect, it } from "vitest";
import {
  branchRulesetCheck,
  packageContractCheck,
  repositoryUrlCheck,
  tagSyncCheck,
  workflowsCheck,
  workingTreeCheck
} from "../../checks";
import { LATEST_TAG_ARGS } from "../../lib/git";
import { REQUIRED_SCRIPTS } from "../../lib/package-json";
import { workflowTemplates } from "../../lib/templates";
import type { CheckContext } from "../../types";
import { memoryFiles, type StubReply, stubExecutor } from "../helpers/ports";

const REMOTE = "git+https://github.com/moku-labs/common.git";
const TAG_COMMAND = ["git", ...LATEST_TAG_ARGS].join(" ");

const MANIFEST = JSON.stringify({
  name: "@moku-labs/common",
  version: "1.0.0",
  scripts: { ...REQUIRED_SCRIPTS },
  publishConfig: { access: "public" },
  repository: { type: "git", url: REMOTE },
  files: ["dist"],
  engines: { node: ">=24.0.0" }
});

const contextWith = (
  replies: Record<string, StubReply>,
  tree: Record<string, string> = {},
  strict = false
): CheckContext => ({
  cwd: "/repo",
  exec: stubExecutor(replies),
  files: memoryFiles({ "package.json": MANIFEST, ...tree }),
  strict
});

const withTagAndNpm = (tag: string, latest: string): CheckContext =>
  contextWith({
    [TAG_COMMAND]: `${tag}\n`,
    "npm view @moku-labs/common dist-tags --json": JSON.stringify({ latest })
  });

const thinWorkflows = (): Record<string, string> =>
  Object.fromEntries(workflowTemplates.map(template => [template.path, template.content]));

describe("packageContractCheck", () => {
  it("passes for a manifest on contract", async () => {
    const result = await packageContractCheck.run(contextWith({}));

    expect(result.status).toBe("pass");
  });

  it("fails naming each gap, and points at setup", async () => {
    const context = contextWith({}, { "package.json": JSON.stringify({ name: "x" }) });
    const result = await packageContractCheck.run(context);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("missing script `typecheck`");
    expect(result.detail).toContain("missing `files`");
    expect(result.fix).toBe("moku-release setup");
  });

  it("skips when package.json is unreadable", async () => {
    const result = await packageContractCheck.run(contextWith({}, { "package.json": "{" }));

    expect(result.status).toBe("skip");
  });
});

describe("repositoryUrlCheck", () => {
  it("passes when the declared URL and origin are the same repository", async () => {
    const result = await repositoryUrlCheck.run(
      contextWith({ "git remote get-url origin": "git@github.com:moku-labs/common.git\n" })
    );

    expect(result.status).toBe("pass");
  });

  it("fails on a mismatch and quotes the value to set", async () => {
    const result = await repositoryUrlCheck.run(
      contextWith({ "git remote get-url origin": "https://github.com/other/repo.git\n" })
    );

    expect(result.status).toBe("fail");
    expect(result.fix).toContain("https://github.com/other/repo.git");
  });

  it("skips when there is no origin remote", async () => {
    const result = await repositoryUrlCheck.run(contextWith({}));

    expect(result.status).toBe("skip");
  });
});

describe("workflowsCheck", () => {
  it("passes when both files are the pinned thin callers", async () => {
    const result = await workflowsCheck.run(contextWith({}, thinWorkflows()));

    expect(result.status).toBe("pass");
  });

  it("fails when a workflow is missing", async () => {
    const [ci] = workflowTemplates;
    if (!ci) throw new Error("expected a ci template");
    const result = await workflowsCheck.run(contextWith({}, { [ci.path]: ci.content }));

    expect(result.status).toBe("fail");
    expect(result.detail).toContain(".github/workflows/publish.yml");
  });

  it("warns for a hand-written legacy workflow, with the migrate hint", async () => {
    const tree = { ...thinWorkflows(), ".github/workflows/ci.yml": "name: CI\njobs:\n  lint:\n" };
    const result = await workflowsCheck.run(contextWith({}, tree));

    expect(result.status).toBe("warn");
    expect(result.fix).toBe("legacy workflow, run release:setup to migrate");
  });
});

describe("tagSyncCheck", () => {
  it("passes when the newest tag and npm latest agree", async () => {
    const result = await tagSyncCheck.run(withTagAndNpm("v1.2.3", "1.2.3"));

    expect(result.status).toBe("pass");
  });

  it("warns when npm is ahead of the tag, and says so", async () => {
    const result = await tagSyncCheck.run(withTagAndNpm("v1.2.3", "1.2.4"));

    expect(result.status).toBe("warn");
    expect(result.detail).toBe("npm 1.2.4 is AHEAD of tag v1.2.3");
  });

  it("warns when npm is behind the tag", async () => {
    const result = await tagSyncCheck.run(withTagAndNpm("v1.3.0", "1.2.4"));

    expect(result.status).toBe("warn");
    expect(result.detail).toBe("npm 1.2.4 is BEHIND tag v1.3.0");
  });

  it("treats a prerelease tag as older than its stable release", async () => {
    const result = await tagSyncCheck.run(withTagAndNpm("v1.0.0-rc.1", "1.0.0"));

    expect(result.detail).toBe("npm 1.0.0 is AHEAD of tag v1.0.0-rc.1");
  });

  it("skips when there are no tags yet", async () => {
    const result = await tagSyncCheck.run(contextWith({ [TAG_COMMAND]: "" }));

    expect(result.status).toBe("skip");
  });
});

describe("branchRulesetCheck", () => {
  it("passes when an active branch ruleset exists", async () => {
    const result = await branchRulesetCheck.run(
      contextWith({
        "gh api repos/moku-labs/common/rulesets": JSON.stringify([
          { name: "protect-main", target: "branch", enforcement: "active" }
        ])
      })
    );

    expect(result.status).toBe("pass");
  });

  it("warns when main is unprotected", async () => {
    const result = await branchRulesetCheck.run(
      contextWith({ "gh api repos/moku-labs/common/rulesets": "[]" })
    );

    expect(result).toEqual({
      status: "warn",
      detail: "main has no branch ruleset",
      fix: "moku-release setup"
    });
  });
});

describe("workingTreeCheck", () => {
  const clean = {
    "git status --porcelain": "",
    "git rev-parse HEAD": "abc123\n",
    "git rev-parse origin/main": "abc123\n"
  };

  it("passes on a clean tree in sync with origin/main", async () => {
    const result = await workingTreeCheck.run(contextWith(clean));

    expect(result.status).toBe("pass");
  });

  it("warns on a dirty tree in doctor", async () => {
    const result = await workingTreeCheck.run(
      contextWith({ ...clean, "git status --porcelain": " M src/a.ts\n" })
    );

    expect(result.status).toBe("warn");
  });

  it("fails on the same dirty tree in the strict release preflight", async () => {
    const result = await workingTreeCheck.run(
      contextWith({ ...clean, "git status --porcelain": " M src/a.ts\n" }, {}, true)
    );

    expect(result.status).toBe("fail");
    expect(result.fix).toBe("commit or stash them");
  });

  it("fails in strict mode when HEAD is not origin/main", async () => {
    const result = await workingTreeCheck.run(
      contextWith({ ...clean, "git rev-parse origin/main": "def456\n" }, {}, true)
    );

    expect(result.status).toBe("fail");
    expect(result.detail).toBe("HEAD is not origin/main");
  });
});

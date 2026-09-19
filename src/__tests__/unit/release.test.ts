import { createBrandConsole } from "@moku-labs/common/cli";
import { describe, expect, it } from "vitest";
import { runRelease } from "../../commands/release";
import { LATEST_TAG_ARGS } from "../../lib/git";
import { REQUIRED_SCRIPTS } from "../../lib/package-json";
import { workflowTemplates } from "../../lib/templates";
import type { CheckContext } from "../../types";
import {
  captureConsole,
  memoryFiles,
  type StubExecutor,
  type StubReply,
  stubExecutor
} from "../helpers/ports";

const REMOTE = "git+https://github.com/moku-labs/common.git";
const TAG_COMMAND = ["git", ...LATEST_TAG_ARGS].join(" ");
const DIST_TAGS = "npm view @moku-labs/common dist-tags --json";

const MANIFEST = JSON.stringify({
  name: "@moku-labs/common",
  version: "1.2.3",
  scripts: { ...REQUIRED_SCRIPTS },
  publishConfig: { access: "public" },
  repository: { type: "git", url: REMOTE },
  files: ["dist"],
  engines: { node: ">=24.0.0" }
});

/** Every reply a fully releasable repository produces — the preflight passes on these. */
const RELEASABLE: Record<string, StubReply> = {
  "gh --version": "gh version 2.60.0",
  "gh auth status": "Logged in",
  "npm whoami": "alex\n",
  "npm --version": "11.6.0\n",
  "git remote get-url origin": `${REMOTE}\n`,
  "npm view @moku-labs/common version": "1.2.3\n",
  "npm trust list @moku-labs/common": "github moku-labs/common publish.yml\n",
  [TAG_COMMAND]: "v1.2.3\n",
  [DIST_TAGS]: JSON.stringify({ latest: "1.2.3" }),
  "gh api repos/moku-labs/common/rulesets": JSON.stringify([
    { target: "branch", enforcement: "active" }
  ]),
  "git status --porcelain": "",
  "git rev-parse HEAD": "abc123\n",
  "git rev-parse origin/main": "abc123\n",
  "git fetch": "",
  "gh workflow run": "",
  "gh run list": JSON.stringify([{ databaseId: 77 }])
};

const harness = (
  replies: Record<string, StubReply> = RELEASABLE
): {
  ctx: CheckContext;
  exec: StubExecutor;
  lines: string[];
  ui: ReturnType<typeof createBrandConsole>;
} => {
  const exec = stubExecutor(replies);
  const tree = Object.fromEntries(
    workflowTemplates.map(template => [template.path, template.content])
  );
  const { lines, options } = captureConsole();

  return {
    ctx: {
      cwd: "/repo",
      exec,
      files: memoryFiles({ "package.json": MANIFEST, ...tree }),
      strict: false
    },
    exec,
    lines,
    ui: createBrandConsole(options)
  };
};

const instantly = async (): Promise<void> => undefined;

/** A stub whose dist-tag reply moves to `after` once the workflow has been dispatched. */
const movingRegistry = (after: string): StubExecutor => {
  const base = stubExecutor(RELEASABLE);

  return {
    ...base,
    async capture(command, args, options) {
      const line = [command, ...args].join(" ");
      const dispatched = base.captured.some(entry => entry.startsWith("gh workflow run"));

      if (line === DIST_TAGS && dispatched) {
        base.captured.push(line);
        return { code: 0, stdout: JSON.stringify({ latest: after }), stderr: "" };
      }

      return base.capture(command, args, options);
    }
  };
};

describe("runRelease — preflight", () => {
  it("fetches before comparing HEAD with origin/main", async () => {
    const test = harness();

    await runRelease({ ctx: test.ctx, ui: test.ui, releaseType: "patch", dryRun: true });

    expect(test.exec.captured[0]).toBe("git fetch --tags --prune");
  });

  it("fails closed on a dirty tree and dispatches nothing", async () => {
    const test = harness({ ...RELEASABLE, "git status --porcelain": " M src/a.ts\n" });

    const code = await runRelease({
      ctx: test.ctx,
      ui: test.ui,
      releaseType: "patch",
      sleep: instantly
    });

    expect(code).toBe(1);
    expect(test.exec.captured.some(line => line.startsWith("gh workflow run"))).toBe(false);
    expect(test.lines.join("\n")).toContain("preflight failed");
  });

  it("fails closed when a tool prerequisite is missing", async () => {
    const test = harness({ ...RELEASABLE, "npm whoami": { code: 1 } });

    const code = await runRelease({
      ctx: test.ctx,
      ui: test.ui,
      releaseType: "patch",
      sleep: instantly
    });

    expect(code).toBe(1);
  });
});

describe("runRelease --dry-run", () => {
  it("prints the plan and dispatches nothing", async () => {
    const test = harness();

    const code = await runRelease({
      ctx: test.ctx,
      ui: test.ui,
      releaseType: "minor",
      dryRun: true
    });

    expect(code).toBe(0);
    expect(test.exec.captured.some(line => line.startsWith("gh workflow run"))).toBe(false);
    expect(test.lines.join("\n")).toContain(
      "gh workflow run publish.yml -f release_type=minor --ref main"
    );
  });

  it("names the dist-tag a prerelease would land under", async () => {
    const test = harness();

    await runRelease({ ctx: test.ctx, ui: test.ui, releaseType: "prerelease", dryRun: true });

    expect(test.lines.join("\n")).toContain("`next`");
  });
});

describe("runRelease — dispatch and verification", () => {
  it("dispatches, watches the run, then reports the version the registry actually serves", async () => {
    const exec = movingRegistry("1.2.4");
    const tree = Object.fromEntries(
      workflowTemplates.map(template => [template.path, template.content])
    );
    const { lines, options } = captureConsole();
    const ctx: CheckContext = {
      cwd: "/repo",
      exec,
      files: memoryFiles({ "package.json": MANIFEST, ...tree }),
      strict: false
    };

    const code = await runRelease({
      ctx,
      ui: createBrandConsole(options),
      releaseType: "patch",
      sleep: instantly
    });

    expect(code).toBe(0);
    expect(exec.captured).toContain("gh workflow run publish.yml -f release_type=patch --ref main");
    expect(exec.inherited).toContain("gh run watch 77 --exit-status");

    const output = lines.join("\n");
    expect(output).toContain("1.2.4");
    expect(output).toContain("https://www.npmjs.com/package/@moku-labs/common/v/1.2.4");
    expect(output).toContain("https://github.com/moku-labs/common/releases/tag/v1.2.4");
  });

  it("fails when the run went green but the registry never moved", async () => {
    const test = harness();

    const code = await runRelease({
      ctx: test.ctx,
      ui: test.ui,
      releaseType: "patch",
      sleep: instantly
    });

    expect(code).toBe(1);
    expect(test.lines.join("\n")).toContain("did not move");
  });

  it("fails when the dispatched run never appears", async () => {
    const test = harness({ ...RELEASABLE, "gh run list": "[]" });

    const code = await runRelease({
      ctx: test.ctx,
      ui: test.ui,
      releaseType: "patch",
      sleep: instantly
    });

    expect(code).toBe(1);
    expect(test.lines.join("\n")).toContain("never appeared");
  });
});

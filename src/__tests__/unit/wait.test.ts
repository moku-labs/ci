import { createBrandConsole } from "@moku-labs/common/cli";
import { describe, expect, it } from "vitest";
import { runWait } from "../../commands/wait";
import type { CheckContext } from "../../types";
import { captureConsole, memoryFiles, type StubReply, stubExecutor } from "../helpers/ports";

const MANIFEST = JSON.stringify({
  name: "@moku-labs/common",
  repository: { type: "git", url: "git+https://github.com/moku-labs/common.git" }
});

const TAGS = "git -c versionsort.suffix=- tag --list v* --contains HEAD --sort=v:refname";
const ON_MAIN = "git merge-base --is-ancestor HEAD origin/main";
const run = (conclusion: string, status = "completed"): string =>
  JSON.stringify([{ databaseId: 77, headSha: "abc123", status, conclusion }]);

/** Every reply of a commit that main holds and that the auto-release already shipped. */
const RELEASED: Record<string, StubReply> = {
  "git fetch": "",
  [ON_MAIN]: "",
  [TAGS]: "v1.2.4\nv1.2.5\n",
  "npm view @moku-labs/common@1.2.4 version": "1.2.4\n"
};

const instantly = async (): Promise<void> => undefined;

const waitWith = async (
  replies: Record<string, StubReply>
): Promise<{ code: number; output: string; captured: string[] }> => {
  const exec = stubExecutor(replies);
  const { lines, options } = captureConsole();
  const ctx: CheckContext = {
    cwd: "/repo",
    exec,
    files: memoryFiles({ "package.json": MANIFEST }),
    strict: false
  };

  const code = await runWait({ ctx, ui: createBrandConsole(options), sleep: instantly });

  return { code, output: lines.join("\n"), captured: exec.captured };
};

describe("runWait", () => {
  it("reports the first version that holds the commit once npm serves it", async () => {
    const result = await waitWith(RELEASED);

    expect(result.code).toBe(0);
    expect(result.output).toContain("v1.2.4 holds this commit");
    expect(result.output).toContain("https://github.com/moku-labs/common/releases/tag/v1.2.4");
  });

  it("refuses a commit that main does not hold, before any waiting", async () => {
    const result = await waitWith({ ...RELEASED, [ON_MAIN]: { code: 1 } });

    expect(result.code).toBe(1);
    expect(result.output).toContain("HEAD is not on origin/main");
    expect(result.captured).not.toContain(TAGS);
  });

  it("stops on a failed run of this commit and names the log command", async () => {
    const result = await waitWith({
      ...RELEASED,
      [TAGS]: "",
      "gh run list": run("failure"),
      "git merge-base --is-ancestor HEAD abc123": ""
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("run 77 ended as failure");
    expect(result.output).toContain("gh run view 77 --log-failed");
  });

  it("ignores a failed run of an older commit and says when no run started", async () => {
    const result = await waitWith({
      ...RELEASED,
      [TAGS]: "",
      "gh run list": run("failure"),
      "git merge-base --is-ancestor HEAD abc123": { code: 1 }
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("no publish.yml run started for this commit");
  });

  it("times out when the run stays in progress and no tag appears", async () => {
    const result = await waitWith({
      ...RELEASED,
      [TAGS]: "",
      "gh run list": run("", "in_progress"),
      "git merge-base --is-ancestor HEAD abc123": ""
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("no release tag holds this commit");
  });

  it("fails when the tag exists and npm never serves the version", async () => {
    const result = await waitWith({
      ...RELEASED,
      "npm view @moku-labs/common@1.2.4 version": { code: 1 }
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("npm does not serve @moku-labs/common@1.2.4");
  });
});

import { createBrandConsole } from "@moku-labs/common/cli";
import { describe, expect, it } from "vitest";
import { runSetup } from "../../commands/setup";
import { LATEST_TAG_ARGS } from "../../lib/git";
import { REQUIRED_SCRIPTS } from "../../lib/package-json";
import { workflowTemplates } from "../../lib/templates";
import type { CheckContext } from "../../types";
import {
  captureConsole,
  type MemoryFiles,
  memoryFiles,
  type StubExecutor,
  type StubReply,
  stubExecutor,
  stubPrompts
} from "../helpers/ports";

const REMOTE = "git+https://github.com/moku-labs/common.git";
const LEGACY_CI = "name: CI\njobs:\n  lint:\n";

const [ciTemplate] = workflowTemplates;
if (!ciTemplate) throw new Error("expected a ci workflow template");

const MANIFEST = JSON.stringify(
  {
    name: "@moku-labs/common",
    version: "1.0.0",
    scripts: { ...REQUIRED_SCRIPTS },
    publishConfig: { access: "public" },
    repository: { type: "git", url: REMOTE },
    files: ["dist"],
    engines: { node: ">=24.0.0" }
  },
  undefined,
  2
);

/** Replies that get `setup` past the two human-only prerequisites. */
const AUTHENTICATED: Record<string, StubReply> = {
  "gh --version": "gh version 2.60.0",
  "gh auth status": "Logged in",
  "npm whoami": "alex\n",
  "npm --version": "11.6.0\n",
  "git remote get-url origin": `${REMOTE}\n`
};

const harness = (
  replies: Record<string, StubReply> = AUTHENTICATED,
  tree: Record<string, string> = {},
  answer = true
): {
  ctx: CheckContext;
  exec: StubExecutor;
  files: MemoryFiles;
  lines: string[];
  asked: string[];
  ui: ReturnType<typeof createBrandConsole>;
  prompts: ReturnType<typeof stubPrompts>["prompts"];
} => {
  const exec = stubExecutor(replies);
  const files = memoryFiles({ "package.json": MANIFEST, ...tree });
  const { lines, options } = captureConsole();
  const { asked, prompts } = stubPrompts(answer);

  return {
    ctx: { cwd: "/repo", exec, files, strict: false },
    exec,
    files,
    lines,
    asked,
    ui: createBrandConsole(options),
    prompts
  };
};

describe("runSetup — human-only prerequisites", () => {
  it("stops with the exact command when gh is not authenticated, and mutates nothing", async () => {
    const test = harness({ "gh --version": "gh version 2.60.0", "gh auth status": { code: 1 } });

    const code = await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(code).toBe(1);
    expect(test.files.written).toEqual([]);
    expect(test.exec.inherited).toEqual([]);
    expect(test.lines.join("\n")).toContain("gh auth login");
  });

  it("stops with `npm login` rather than handling a token itself", async () => {
    const test = harness({ ...AUTHENTICATED, "npm whoami": { code: 1 } });

    const code = await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(code).toBe(1);
    expect(test.lines.join("\n")).toContain("npm login");
  });
});

describe("runSetup --dry-run", () => {
  it("mutates nothing: no file written, no command inherited", async () => {
    const test = harness();

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts, dryRun: true });

    expect(test.files.written).toEqual([]);
    expect(test.exec.inherited).toEqual([]);
  });

  it("announces the workflow writes it would perform", async () => {
    const test = harness();

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts, dryRun: true });

    const output = test.lines.join("\n");
    for (const template of workflowTemplates)
      expect(output).toContain(`would write ${template.path}`);
  });

  it("is idempotent — a second dry run reports exactly the same plan", async () => {
    const first = harness();
    await runSetup({ ctx: first.ctx, ui: first.ui, prompts: first.prompts, dryRun: true });

    const second = harness();
    await runSetup({ ctx: second.ctx, ui: second.ui, prompts: second.prompts, dryRun: true });

    expect(second.lines).toEqual(first.lines);
    expect(second.files.tree).toEqual(first.files.tree);
  });
});

describe("runSetup — workflows", () => {
  it("writes both thin workflows without asking when neither exists", async () => {
    const test = harness();

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    for (const template of workflowTemplates) {
      expect(test.files.tree[template.path]).toBe(template.content);
    }
    expect(test.asked.some(question => question.includes("Replace"))).toBe(false);
  });

  it("re-running writes nothing — the second pass is checkmarks", async () => {
    const tree = Object.fromEntries(
      workflowTemplates.map(template => [template.path, template.content])
    );
    const test = harness(AUTHENTICATED, tree);

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.files.written).toEqual([]);
    expect(test.lines.join("\n")).toContain(".github/workflows/ci.yml up to date");
  });

  it("asks before replacing a legacy workflow, and keeps a .bak", async () => {
    const test = harness(AUTHENTICATED, { [ciTemplate.path]: LEGACY_CI });

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.asked.some(question => question.includes("legacy workflow"))).toBe(true);
    expect(test.files.tree[`${ciTemplate.path}.bak`]).toBe(LEGACY_CI);
    expect(test.files.tree[ciTemplate.path]).toBe(ciTemplate.content);
  });

  it("keeps no .bak when git already holds the original", async () => {
    const test = harness(
      {
        ...AUTHENTICATED,
        [`git ls-files --error-unmatch ${ciTemplate.path}`]: `${ciTemplate.path}\n`,
        [`git status --porcelain -- ${ciTemplate.path}`]: ""
      },
      { [ciTemplate.path]: LEGACY_CI }
    );

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.asked.some(question => question.includes("git keeps the original"))).toBe(true);
    expect(test.files.tree[`${ciTemplate.path}.bak`]).toBeUndefined();
    expect(test.files.tree[ciTemplate.path]).toBe(ciTemplate.content);
  });

  it("leaves a differing workflow alone when the answer is no", async () => {
    const test = harness(AUTHENTICATED, { [ciTemplate.path]: LEGACY_CI }, false);

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.files.tree[ciTemplate.path]).toBe(LEGACY_CI);
    expect(test.files.tree[`${ciTemplate.path}.bak`]).toBeUndefined();
  });
});

describe("runSetup — package.json", () => {
  it("reports an already-compliant manifest without rewriting it", async () => {
    const test = harness();

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.files.written).not.toContain("package.json");
    expect(test.lines.join("\n")).toContain("already on contract");
  });

  it("shows the change summary and applies it only after a confirm", async () => {
    const bare = JSON.stringify({ name: "@moku-labs/common", version: "1.0.0" });
    const test = harness(AUTHENTICATED, { "package.json": bare });

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.lines.join("\n")).toContain("+ scripts.typecheck");
    expect(test.files.written).toContain("package.json");
  });

  it("leaves package.json untouched when the confirm is declined", async () => {
    const bare = JSON.stringify({ name: "@moku-labs/common", version: "1.0.0" });
    const test = harness(AUTHENTICATED, { "package.json": bare }, false);

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.files.tree["package.json"]).toBe(bare);
  });
});

describe("runSetup — publish, tag, trust, ruleset", () => {
  it("skips the first publish when the package is already on npm", async () => {
    const test = harness({
      ...AUTHENTICATED,
      "npm view @moku-labs/common version": "1.0.0\n"
    });

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.exec.inherited).not.toContain("npm publish --access public");
    expect(test.lines.join("\n")).toContain("already on npm");
  });

  it("builds before publishing, with stdio inherited so npm owns the OTP prompt", async () => {
    const test = harness();

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.exec.inherited).toContain("bun run build");
    expect(test.exec.inherited).toContain("npm publish --access public");
  });

  it("says the registry may lag right after a first publish", async () => {
    const test = harness();

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.lines.join("\n")).toContain("published just now");
  });

  it("says nothing about lag when the package was already on npm", async () => {
    const test = harness({ ...AUTHENTICATED, "npm view @moku-labs/common version": "1.0.0\n" });

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.lines.join("\n")).not.toContain("published just now");
  });

  it("pushes only the version tag, never the branch", async () => {
    const test = harness();

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.exec.captured).toContain("git push origin refs/tags/v1.0.0");
    expect(test.exec.captured.some(line => line.startsWith("git push origin main"))).toBe(false);
  });

  it("leaves an existing tag alone", async () => {
    const test = harness({ ...AUTHENTICATED, "git tag --list v1.0.0": "v1.0.0\n" });

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.exec.captured).not.toContain("git tag -a v1.0.0 -m v1.0.0");
  });

  it("tags nothing when release tags exist, because package.json is stale there", async () => {
    const test = harness({
      ...AUTHENTICATED,
      [["git", ...LATEST_TAG_ARGS].join(" ")]: "v0.8.0\nv0.7.0\n"
    });

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.exec.captured).not.toContain("git tag -a v1.0.0 -m v1.0.0");
    expect(test.lines.join("\n")).toContain("latest is v0.8.0");
  });

  it("registers the trusted publisher with the check's own fix command", async () => {
    const test = harness();

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.exec.inherited).toContain(
      "npm trust github @moku-labs/common --file publish.yml --repo moku-labs/common --allow-publish --yes"
    );
  });

  it("registers behind 2FA too: asks, then lets npm prompt for the OTP", async () => {
    const test = harness({
      ...AUTHENTICATED,
      "npm trust list @moku-labs/common": { code: 1, stderr: "npm error code EOTP" }
    });

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.asked.some(question => question.includes("needs an OTP"))).toBe(true);
    expect(test.exec.inherited).toContain(
      "npm trust github @moku-labs/common --file publish.yml --repo moku-labs/common --allow-publish --yes"
    );
  });

  it("unattended: prints the OTP steps instead of running them, so --yes never hangs", async () => {
    const test = harness({
      ...AUTHENTICATED,
      "npm trust list @moku-labs/common": { code: 1, stderr: "npm error code EOTP" }
    });

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts, unattended: true });

    expect(test.exec.inherited).not.toContain("npm publish --access public");
    expect(test.exec.inherited.some(line => line.startsWith("npm trust github"))).toBe(false);
    expect(test.lines.join("\n")).toContain("first publish needs your OTP");
    expect(test.lines.join("\n")).toContain("trusted publisher registration needs your OTP");
  });

  it("does not register behind 2FA when the answer is no", async () => {
    const test = harness(
      {
        ...AUTHENTICATED,
        "npm trust list @moku-labs/common": { code: 1, stderr: "npm error code EOTP" }
      },
      {},
      false
    );

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.exec.inherited.some(line => line.startsWith("npm trust github"))).toBe(false);
  });

  it("applies the central branch ruleset through gh api, piped on stdin", async () => {
    const test = harness();

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.exec.captured).toContain(
      "gh api repos/moku-labs/common/rulesets --method POST --input -"
    );
    expect(test.exec.inputs.join("")).toContain('"name": "protect-main"');
  });

  it("moves a legacy ruleset to the central checks with PUT, keeping its other rules", async () => {
    const test = harness({
      ...AUTHENTICATED,
      "gh api repos/moku-labs/common/rulesets": JSON.stringify([
        { id: 7, name: "protect-main", target: "branch", enforcement: "active" }
      ]),
      "gh api repos/moku-labs/common/rulesets/7": JSON.stringify({
        rules: [
          { type: "deletion" },
          {
            type: "required_status_checks",
            parameters: { required_status_checks: [{ context: "lint" }] }
          }
        ]
      })
    });

    await runSetup({ ctx: test.ctx, ui: test.ui, prompts: test.prompts });

    expect(test.exec.captured).toContain(
      "gh api repos/moku-labs/common/rulesets/7 --method PUT --input -"
    );
    expect(test.exec.captured).not.toContain(
      "gh api repos/moku-labs/common/rulesets --method POST --input -"
    );

    const body = JSON.parse(test.exec.inputs.at(-1) ?? "{}") as { rules: { type: string }[] };
    expect(body.rules.map(rule => rule.type)).toEqual(["deletion", "required_status_checks"]);
    expect(test.exec.inputs.at(-1)).toContain("ci / lint");
  });
});

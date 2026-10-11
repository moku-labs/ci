import { createBrandConsole } from "@moku-labs/common/cli";
import { describe, expect, it } from "vitest";
import { runFleet } from "../../commands/fleet";
import { type FleetRepo, parseFleet } from "../../lib/fleet";
import {
  acceptedVersion,
  externalNames,
  isBehind,
  renderDepsMarkdown,
  runtimeRows,
  toolchainRows
} from "../../lib/fleet-deps";
import type { CheckContext } from "../../types";
import { captureConsole, memoryFiles, type StubReply, stubExecutor } from "../helpers/ports";

const repo = (
  name: string,
  dev: Record<string, string>,
  runtime: Record<string, string> = {}
): FleetRepo => ({
  name,
  isPrivate: false,
  ci: "green",
  release: "none",
  pullRequests: [],
  pins: [],
  external: { dev, runtime }
});

const FLEET = [
  repo("core", { typescript: "7.0.2", publint: "0.3.17", lefthook: "2.1.1" }),
  repo("web", { typescript: "6.0.3", publint: "0.3.21" }, { preact: "10.26.0", shiki: "^3.2.0" }),
  repo("room", { typescript: "6.0.3", publint: "0.3.21" }, { preact: "10.27.0", trystero: "*" })
];

describe("isBehind", () => {
  it("compares an exact version in full", () => {
    expect(isBehind("1.2.3", "1.2.4")).toBe(true);
    expect(isBehind("1.2.4", "1.2.4")).toBe(false);
  });

  it("calls a range behind only when the newest major is above its own", () => {
    expect(isBehind("^5.1.0", "5.9.0")).toBe(false);
    expect(isBehind("^5.1.0", "6.0.0")).toBe(true);
    expect(isBehind(">=1.0.0", "2.0.0")).toBe(true);
  });

  it("does not judge a version it cannot read", () => {
    expect(isBehind("*", "2.0.0")).toBe(false);
    expect(isBehind("9", "10.0.0")).toBe(false);
    expect(isBehind("https://pkg.pr.new/x@1", "2.0.0")).toBe(false);
  });
});

describe("acceptedVersion", () => {
  it("is the version most repositories are on, the newer one on a tie", () => {
    expect(acceptedVersion(["6.0.3", "6.0.3", "7.0.2"])).toBe("6.0.3");
    expect(acceptedVersion(["1.3.14", "1.4.2"])).toBe("1.4.2");
    expect(acceptedVersion([])).toBe("");
  });
});

describe("toolchainRows", () => {
  it("lists a tool two repositories share, and names who is on another version", () => {
    const rows = toolchainRows(FLEET);

    expect(rows.map(row => row.name)).toEqual(["publint", "typescript"]);
    expect(rows[1]).toEqual({
      name: "typescript",
      accepted: "6.0.3",
      users: 3,
      others: [{ repo: "core", version: "7.0.2" }]
    });
  });

  it("leaves out a tool only one repository uses", () => {
    expect(toolchainRows(FLEET).some(row => row.name === "lefthook")).toBe(false);
  });
});

describe("runtimeRows", () => {
  it("asks for the shared tools and every runtime dependency, each once", () => {
    expect(externalNames(FLEET)).toEqual(["preact", "publint", "shiki", "trystero", "typescript"]);
  });

  it("lists only the dependencies npm has moved past", () => {
    const latest = new Map([
      ["preact", "10.27.0"],
      ["shiki", "4.5.0"],
      ["trystero", "9.0.0"]
    ]);

    expect(runtimeRows(FLEET, latest)).toEqual([
      { name: "preact", repo: "web", version: "10.26.0", latest: "10.27.0" },
      { name: "shiki", repo: "web", version: "^3.2.0", latest: "4.5.0" }
    ]);
  });
});

describe("renderDepsMarkdown", () => {
  it("renders two collapsed blocks with the counts in their summaries", () => {
    const tools = toolchainRows(FLEET).map(row => ({ ...row, latest: "7.0.2" }));
    const markdown = renderDepsMarkdown(tools, []);

    expect(markdown).toContain("<summary>Toolchain: 2 shared tools, 2 on more than one version");
    expect(markdown).toContain("| typescript | 6.0.3 | 7.0.2 | 3 | core 7.0.2 |");
    expect(markdown).toContain("<summary>Runtime dependencies: 0 behind npm</summary>");
    expect(markdown).toContain("Every runtime dependency is on the newest version.");
  });
});

describe("parseFleet — external dependencies", () => {
  it("keeps the direct dependencies outside the family, and Bun from .bun-version", () => {
    const manifest = {
      name: "@moku-labs/web",
      dependencies: { preact: "10.27.0", "@moku-labs/core": "1.7.2" },
      devDependencies: { typescript: "6.0.3", "@moku-labs/ci": "1.5.2" }
    };
    const node = {
      name: "web",
      manifest: { text: JSON.stringify(manifest) },
      bun: { text: "1.4.3\n" }
    };
    const [row] =
      parseFleet(JSON.stringify({ data: { organization: { repositories: { nodes: [node] } } } })) ??
      [];

    expect(row?.external).toEqual({
      runtime: { preact: "10.27.0" },
      dev: { typescript: "6.0.3", bun: "1.4.3" }
    });
  });
});

describe("runFleet --deps", () => {
  const node = (name: string, version: string): object => ({
    name,
    manifest: {
      text: JSON.stringify({
        devDependencies: { typescript: version },
        dependencies: { preact: "10.26.0" }
      })
    }
  });
  const REPLIES: Record<string, StubReply> = {
    "git remote get-url origin": "https://github.com/moku-labs/ci.git\n",
    "gh api graphql": JSON.stringify({
      data: {
        organization: { repositories: { nodes: [node("web", "6.0.3"), node("room", "7.0.2")] } }
      }
    }),
    "npm view typescript version": "7.0.2\n",
    "npm view preact version": "10.27.0\n"
  };

  const fleetWith = async (flags: { markdown?: boolean; deps?: boolean }) => {
    const exec = stubExecutor(REPLIES);
    const { lines, options } = captureConsole();
    const ctx: CheckContext = { cwd: "/repo", exec, files: memoryFiles({}), strict: false };

    await runFleet({ ctx, ui: createBrandConsole(options), ...flags });

    return { output: lines.join("\n"), captured: exec.captured };
  };

  it("asks npm for no external package without --deps", async () => {
    const result = await fleetWith({});

    expect(result.captured.some(line => line.startsWith("npm view typescript"))).toBe(false);
    expect(result.output).not.toContain("Toolchain");
  });

  it("prints both tables after the status with --deps", async () => {
    const result = await fleetWith({ deps: true });

    expect(result.output).toMatch(/typescript\s+7\.0\.2\s+7\.0\.2\s+web 6\.0\.3/);
    expect(result.output).toMatch(/preact\s+room\s+10\.26\.0\s+10\.27\.0/);
  });

  it("adds the collapsed blocks to the Markdown with --deps", async () => {
    const result = await fleetWith({ deps: true, markdown: true });

    expect(result.output).toContain("| Repo | CI |");
    expect(result.output).toContain("<summary>Runtime dependencies: 2 behind npm</summary>");
  });
});

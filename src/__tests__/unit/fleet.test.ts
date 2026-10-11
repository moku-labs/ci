import { createBrandConsole } from "@moku-labs/common/cli";
import { describe, expect, it } from "vitest";
import { runFleet } from "../../commands/fleet";
import {
  attention,
  HISTORY_DEPTH,
  parseFleet,
  pinsCell,
  pipelineState,
  pullRequestCell,
  renderFleetMarkdown,
  rollupState
} from "../../lib/fleet";
import type { CheckContext } from "../../types";
import { captureConsole, memoryFiles, type StubReply, stubExecutor } from "../helpers/ports";

/** GitHub answers with JSON `null` for an absent value; the parser must take it. */
const NOTHING: unknown = JSON.parse("null");

const check = (name: string, conclusion = "SUCCESS"): object => ({
  name,
  status: conclusion === "" ? "IN_PROGRESS" : "COMPLETED",
  conclusion: conclusion === "" ? NOTHING : conclusion
});

const pr = (number: number, login: string, state?: string): object => ({
  number,
  isDraft: false,
  author: { login },
  commits: { nodes: [{ commit: { statusCheckRollup: state === undefined ? NOTHING : { state } } }] }
});

/** A package whose newest tag released `released`, with `head` as the newest commit of main. */
const packageRepo = (
  name: string,
  options: {
    head?: string;
    released?: string;
    tag?: string;
    checks?: object[];
    prs?: object[];
    deps?: Record<string, string>;
    isPrivate?: boolean;
  } = {}
): object => ({
  name,
  isPrivate: options.isPrivate ?? false,
  manifest: {
    text: JSON.stringify({ name: `@moku-labs/${name}`, devDependencies: options.deps ?? {} })
  },
  publish: { byteSize: 900 },
  defaultBranchRef: {
    target: {
      oid: options.head ?? "c3",
      history: { nodes: [{ oid: "c3" }, { oid: "c2" }, { oid: "c1" }] },
      statusCheckRollup: {
        contexts: { nodes: options.checks ?? [check("ci / lint"), check("release / publish")] }
      }
    }
  },
  refs: {
    nodes: [
      { name: "v1", target: { parents: { nodes: [{ oid: "c1" }] } } },
      { name: "v1.2.0-rc.0", target: { parents: { nodes: [{ oid: "c1" }] } } },
      {
        name: options.tag ?? "v1.2.0",
        target: { parents: { nodes: [{ oid: options.released ?? "c3" }] } }
      },
      { name: "v1.1.9", target: { parents: { nodes: [{ oid: "c1" }] } } }
    ]
  },
  pullRequests: { nodes: options.prs ?? [] }
});

const app = {
  name: "site",
  isPrivate: false,
  manifest: { text: '{"private":true}' },
  publish: NOTHING
};

const answer = (...nodes: object[]): string =>
  JSON.stringify({ data: { organization: { repositories: { nodes } } } });

const only = (stdout: string) => {
  const [row] = parseFleet(stdout) ?? [];
  if (!row) throw new Error("expected one row");

  return row;
};

describe("pipelineState", () => {
  it("is none without checks, red on a failure, running until all are done", () => {
    expect(pipelineState([])).toBe("none");
    expect(pipelineState([{ status: "COMPLETED", conclusion: "SUCCESS" }])).toBe("green");
    expect(pipelineState([{ status: "COMPLETED", conclusion: "SKIPPED" }])).toBe("green");
    expect(pipelineState([{ status: "IN_PROGRESS" }])).toBe("running");
    expect(
      pipelineState([{ status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "FAILURE" }])
    ).toBe("red");
  });

  it("maps the rollup state of a pull request", () => {
    expect(rollupState("SUCCESS")).toBe("green");
    expect(rollupState("ERROR")).toBe("red");
    expect(rollupState("PENDING")).toBe("running");
    expect(rollupState(undefined)).toBe("none");
  });
});

describe("parseFleet", () => {
  it("returns undefined for an answer that is not the query's shape", () => {
    expect(parseFleet("not json")).toBeUndefined();
    expect(parseFleet('{"errors":[{"message":"bad credentials"}]}')).toBeUndefined();
  });

  it("leaves the organization's profile repository out", () => {
    const rows = parseFleet(answer({ ...app, name: ".github" }, app));

    expect(rows?.map(row => row.name)).toEqual(["site"]);
  });

  it("splits the checks of main into CI and release", () => {
    const row = only(
      answer(
        packageRepo("core", { checks: [check("ci / lint", "FAILURE"), check("release / publish")] })
      )
    );

    expect(row.ci).toBe("red");
    expect(row.release).toBe("green");
  });

  it("takes the newest semver tag, not the moving major tag or an older prerelease", () => {
    expect(only(answer(packageRepo("core"))).tag).toBe("v1.2.0");
  });

  it("counts the commits of main after the released one", () => {
    expect(only(answer(packageRepo("core"))).unreleased).toBe(0);
    expect(only(answer(packageRepo("core", { released: "c1" }))).unreleased).toBe(2);
    expect(only(answer(packageRepo("core", { released: "gone" }))).unreleased).toBe(HISTORY_DEPTH);
  });

  it("gives a repository without publish.yml no package, tag or release", () => {
    const row = only(answer(app));

    expect(row.packageName).toBeUndefined();
    expect(row.tag).toBeUndefined();
    expect(row.release).toBe("none");
  });

  it("reports an exact family pin below the newest tag, and ignores a range", () => {
    const rows = parseFleet(
      answer(
        packageRepo("core", { tag: "v1.7.2" }),
        packageRepo("web", {
          deps: { "@moku-labs/core": "1.7.1", "@moku-labs/web": "^0.1.0", typescript: "5.0.0" }
        })
      )
    );

    expect(rows?.[0]?.pins).toEqual([]);
    expect(rows?.[1]?.pins).toEqual([
      { name: "@moku-labs/core", pinned: "1.7.1", latest: "1.7.2" }
    ]);
    expect(pinsCell(rows?.[1] ?? only(answer(app)))).toBe("core 1.7.1");
  });
});

describe("attention", () => {
  it("is empty for a quiet repository", () => {
    expect(attention(only(answer(packageRepo("core"))))).toEqual([]);
  });

  it("names red CI, a failed release, unreleased commits and an npm that lags", () => {
    const red = only(
      answer(
        packageRepo("core", {
          released: "c2",
          checks: [check("ci / test", "FAILURE"), check("release / publish", "FAILURE")]
        })
      )
    );
    const idle = only(
      answer(packageRepo("core", { released: "c2", checks: [check("ci / test")] }))
    );

    expect(attention(red)).toEqual(["CI is red on main", "the release of main failed"]);
    expect(attention({ ...idle, npm: "1.1.9" })).toEqual([
      "1 commit(s) on main are not released",
      "npm serves 1.1.9, the tag is v1.2.0"
    ]);
  });

  it("does not call commits unreleased while their release is running", () => {
    const row = only(
      answer(packageRepo("core", { released: "c2", checks: [check("release / publish", "")] }))
    );

    expect(attention(row)).toEqual([]);
  });

  it("lists a red pull request and a green one that nobody merged, not a pin", () => {
    const row = only(
      answer(
        packageRepo("core", {
          tag: "v1.7.2",
          deps: { "@moku-labs/core": "1.7.1" },
          prs: [
            pr(7, "alex", "FAILURE"),
            pr(8, "dependabot[bot]", "SUCCESS"),
            pr(9, "alex", "PENDING")
          ]
        })
      )
    );

    expect(attention(row)).toEqual(["PR #7 has red checks", "PR #8 is green and not merged"]);
    expect(pullRequestCell(row)).toBe("3 (1 red, 1 bot)");
  });
});

describe("renderFleetMarkdown", () => {
  it("links every cell and leaves a private repository out", () => {
    const rows = parseFleet(
      answer(packageRepo("core"), packageRepo("secret", { isPrivate: true }))
    );
    const markdown = renderFleetMarkdown("moku-labs", rows ?? []);

    expect(markdown).toContain("| [core](https://github.com/moku-labs/core) |");
    expect(markdown).toContain("https://github.com/moku-labs/core/releases/tag/v1.2.0");
    expect(markdown).not.toContain("secret");
    expect(markdown).toContain("Nothing waits.");
  });
});

describe("runFleet", () => {
  const REPLIES: Record<string, StubReply> = {
    "git remote get-url origin": "https://github.com/moku-labs/ci.git\n",
    "gh api graphql -F org=moku-labs": answer(packageRepo("core"), app),
    "npm view @moku-labs/core dist-tags --json": JSON.stringify({ latest: "1.1.9" })
  };

  const fleetWith = async (
    replies: Record<string, StubReply>,
    flags: { json?: boolean; markdown?: boolean } = {}
  ): Promise<{ code: number; output: string }> => {
    const { lines, options } = captureConsole();
    const ctx: CheckContext = {
      cwd: "/repo",
      exec: stubExecutor(replies),
      files: memoryFiles({}),
      strict: false
    };

    const code = await runFleet({ ctx, ui: createBrandConsole(options), ...flags });

    return { code, output: lines.join("\n") };
  };

  it("prints the table and what waits, with the version npm serves", async () => {
    const result = await fleetWith(REPLIES);

    expect(result.code).toBe(0);
    expect(result.output).toMatch(/core\s+green\s+green\s+v1\.2\.0\s+1\.1\.9/);
    expect(result.output).toContain("core: npm serves 1.1.9, the tag is v1.2.0");
  });

  it("prints only Markdown with --markdown and only JSON with --json", async () => {
    const markdown = await fleetWith(REPLIES, { markdown: true });
    const json = await fleetWith(REPLIES, { json: true });

    expect(markdown.output.startsWith("| Repo |")).toBe(true);
    expect(JSON.parse(json.output)).toHaveLength(2);
  });

  it("fails when the organization cannot be read, with the reason gh gave", async () => {
    const result = await fleetWith({
      ...REPLIES,
      "gh api graphql -F org=moku-labs": { code: 1, stderr: "HTTP 401: Bad credentials" }
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("could not read the repositories of moku-labs");
  });
});

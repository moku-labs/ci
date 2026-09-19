import { createBrandConsole } from "@moku-labs/common/cli";
import { describe, expect, it } from "vitest";
import { runDoctor } from "../../commands/doctor";
import { fail, pass, skip, warn } from "../../lib/result";
import type { CheckContext, ReleaseCheck } from "../../types";
import { captureConsole, memoryFiles, stubExecutor } from "../helpers/ports";

const context: CheckContext = {
  cwd: "/repo",
  exec: stubExecutor(),
  files: memoryFiles(),
  strict: false
};

const check = (id: string, result: Awaited<ReturnType<ReleaseCheck["run"]>>): ReleaseCheck => ({
  id,
  title: id,
  async run() {
    return result;
  }
});

describe("runDoctor", () => {
  it("reports every check in registry order", async () => {
    const { lines, options } = captureConsole();
    const checks = [check("a", pass("fine")), check("b", warn("meh", "do x"))];

    const report = await runDoctor({ ctx: context, ui: createBrandConsole(options), checks });

    expect(report.entries.map(entry => entry.id)).toEqual(["a", "b"]);
    expect(lines[0]).toContain("a — fine");
  });

  it("fetches tags before the first check, so a tag cut by CI is already here", async () => {
    const exec = stubExecutor();
    const seen: string[] = [];
    const probe: ReleaseCheck = {
      id: "probe",
      title: "probe",
      async run() {
        seen.push(...exec.captured);
        return pass("fine");
      }
    };
    const { options } = captureConsole();

    await runDoctor({
      ctx: { ...context, exec },
      ui: createBrandConsole(options),
      checks: [probe]
    });

    expect(seen).toEqual(["git fetch --tags --prune"]);
  });

  it("still reports when the fetch fails, as it does offline", async () => {
    const exec = stubExecutor({
      "git fetch": { code: 128, stdout: "", stderr: "could not resolve host" }
    });
    const { options } = captureConsole();

    const report = await runDoctor({
      ctx: { ...context, exec },
      ui: createBrandConsole(options),
      checks: [check("a", pass("fine"))]
    });

    expect(report.failed).toBe(false);
    expect(report.entries).toHaveLength(1);
  });

  it("is clean when nothing fails — warn and skip do not block", async () => {
    const { options } = captureConsole();
    const checks = [check("a", warn("meh", "do x")), check("b", skip("n/a"))];

    const report = await runDoctor({ ctx: context, ui: createBrandConsole(options), checks });

    expect(report.failed).toBe(false);
  });

  it("prints a `fix:` line for every non-pass", async () => {
    const { lines, options } = captureConsole();
    const checks = [check("a", fail("broken", "run this"))];

    const report = await runDoctor({ ctx: context, ui: createBrandConsole(options), checks });

    expect(report.failed).toBe(true);
    expect(lines.join("\n")).toContain("fix: run this");
  });

  it("renders a warning with its own glyph, not the failure glyph", async () => {
    const { lines, options } = captureConsole();
    const checks = [check("a", warn("meh", "do x"))];

    await runDoctor({ ctx: context, ui: createBrandConsole(options), checks });

    expect(lines[0]).toContain("⚠");
    expect(lines[0]).not.toContain("✗");
  });

  it("turns a throwing check into a failure instead of crashing the report", async () => {
    const { options } = captureConsole();
    const exploding: ReleaseCheck = {
      id: "boom",
      title: "boom",
      async run() {
        throw new Error("nope");
      }
    };

    const report = await runDoctor({
      ctx: context,
      ui: createBrandConsole(options),
      checks: [exploding, check("a", pass("fine"))]
    });

    expect(report.failed).toBe(true);
    expect(report.entries).toHaveLength(2);
  });

  it("emits JSON and nothing else under --json", async () => {
    const { lines, options } = captureConsole();
    const checks = [check("a", fail("broken", "run this"))];

    await runDoctor({ ctx: context, ui: createBrandConsole(options), checks, json: true });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      failed: true,
      checks: [{ id: "a", title: "a", status: "fail", detail: "broken", fix: "run this" }]
    });
  });
});

import { describe, expect, it } from "vitest";
import { createExecutor } from "../../lib/exec";

const exec = createExecutor(process.cwd());

describe("capture", () => {
  it("keeps both streams of a command that exits non-zero", async () => {
    // npm prints `Unknown command: "trust"` on stdout and exits 1: the check must see the text.
    const script = "console.log('Unknown command'); console.error('details'); process.exit(3)";

    const output = await exec.capture(process.execPath, ["-e", script]);

    expect(output.code).toBe(3);
    expect(output.stdout).toContain("Unknown command");
    expect(output.stderr).toContain("details");
  });

  it("reports a missing binary as 127 with the error text", async () => {
    const output = await exec.capture("moku-no-such-binary", []);

    expect(output.code).toBe(127);
    expect(output.stderr).toContain("ENOENT");
  });

  it("returns the output of a command that succeeds", async () => {
    const output = await exec.capture(process.execPath, ["-e", "console.log('ok')"]);

    expect(output).toEqual({ code: 0, stdout: "ok\n", stderr: "" });
  });
});

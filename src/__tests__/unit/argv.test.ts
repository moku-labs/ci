import { describe, expect, it } from "vitest";
import { parseArgv, RELEASE_TYPES } from "../../lib/argv";

describe("parseArgv", () => {
  it("treats a bare invocation as help, without an error", () => {
    expect(parseArgv([])).toEqual({ command: "help", json: false, dryRun: false, yes: false });
  });

  it("parses the two named commands", () => {
    expect(parseArgv(["doctor"]).command).toBe("doctor");
    expect(parseArgv(["setup"]).command).toBe("setup");
    expect(parseArgv(["help"]).command).toBe("help");
  });

  it.each(RELEASE_TYPES)("parses `%s` as the release command", type => {
    expect(parseArgv([type])).toEqual({
      command: "release",
      releaseType: type,
      json: false,
      dryRun: false,
      yes: false
    });
  });

  it("parses --yes and -y, for agents and CI with no TTY", () => {
    expect(parseArgv(["setup", "--yes"]).yes).toBe(true);
    expect(parseArgv(["setup", "-y"]).yes).toBe(true);
    expect(parseArgv(["setup"]).yes).toBe(false);
  });

  it("parses the flags in any position", () => {
    expect(parseArgv(["--json", "doctor"])).toMatchObject({ command: "doctor", json: true });
    expect(parseArgv(["patch", "--dry-run"])).toMatchObject({
      command: "release",
      releaseType: "patch",
      dryRun: true
    });
  });

  it("treats --help and -h as the help command, never as an unknown flag", () => {
    expect(parseArgv(["--help"])).toEqual({
      command: "help",
      json: false,
      dryRun: false,
      yes: false
    });
    expect(parseArgv(["doctor", "-h"]).command).toBe("help");
  });

  it("rejects an unknown flag instead of ignoring it", () => {
    const parsed = parseArgv(["doctor", "--force"]);

    expect(parsed.command).toBe("help");
    expect(parsed.error).toBe("unknown flag `--force`");
  });

  it("rejects an unknown command", () => {
    expect(parseArgv(["publish"]).error).toBe("unknown command `publish`");
  });

  it("rejects a second positional", () => {
    expect(parseArgv(["doctor", "patch"]).error).toBe("unexpected argument `patch`");
  });
});

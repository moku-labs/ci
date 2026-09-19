import { describe, expect, it } from "vitest";
import {
  ghAuthCheck,
  npmAuthCheck,
  npmPackageCheck,
  npmVersionCheck,
  trustedPublisherCheck
} from "../../checks";
import { NPM_TRUSTED_PUBLISHING_FLOOR } from "../../checks/npm-version";
import type { CheckContext } from "../../types";
import { memoryFiles, type StubReply, stubExecutor } from "../helpers/ports";

const MANIFEST = JSON.stringify({
  name: "@moku-labs/common",
  version: "1.0.0",
  repository: { type: "git", url: "git+https://github.com/moku-labs/common.git" }
});

const contextWith = (replies: Record<string, StubReply>, manifest = MANIFEST): CheckContext => ({
  cwd: "/repo",
  exec: stubExecutor(replies),
  files: memoryFiles({ "package.json": manifest }),
  strict: false
});

describe("ghAuthCheck", () => {
  it("passes when gh exists and holds a session", async () => {
    const result = await ghAuthCheck.run(
      contextWith({ "gh --version": "gh version 2.60.0", "gh auth status": "Logged in" })
    );

    expect(result.status).toBe("pass");
  });

  it("fails with the install command when gh is missing", async () => {
    const result = await ghAuthCheck.run(contextWith({}));

    expect(result).toEqual({
      status: "fail",
      detail: "`gh` is not installed",
      fix: "brew install gh"
    });
  });

  it("fails with the login command — never logging in itself", async () => {
    const result = await ghAuthCheck.run(
      contextWith({ "gh --version": "gh version 2.60.0", "gh auth status": { code: 1 } })
    );

    expect(result.status).toBe("fail");
    expect(result.fix).toBe("gh auth login");
  });
});

describe("npmAuthCheck", () => {
  it("passes with the username", async () => {
    const result = await npmAuthCheck.run(contextWith({ "npm whoami": "alex\n" }));

    expect(result).toEqual({ status: "pass", detail: "logged in as alex" });
  });

  it("fails with `npm login` — never handling a token", async () => {
    const result = await npmAuthCheck.run(contextWith({ "npm whoami": { code: 1 } }));

    expect(result.status).toBe("fail");
    expect(result.fix).toBe("npm login");
  });
});

describe("npmVersionCheck", () => {
  it("passes at the trusted-publishing floor", async () => {
    const result = await npmVersionCheck.run(
      contextWith({ "npm --version": `${NPM_TRUSTED_PUBLISHING_FLOOR}\n` })
    );

    expect(result.status).toBe("pass");
  });

  it("fails below the floor and says how to upgrade", async () => {
    const result = await npmVersionCheck.run(contextWith({ "npm --version": "10.9.0\n" }));

    expect(result.status).toBe("fail");
    expect(result.detail).toBe(`npm 10.9.0 < ${NPM_TRUSTED_PUBLISHING_FLOOR}`);
    expect(result.fix).toBe("npm install -g npm@latest");
  });
});

describe("npmPackageCheck", () => {
  it("passes with the published version", async () => {
    const result = await npmPackageCheck.run(
      contextWith({ "npm view @moku-labs/common version": "1.0.0\n" })
    );

    expect(result).toEqual({ status: "pass", detail: "@moku-labs/common@1.0.0" });
  });

  it("warns — not fails — before the first publish", async () => {
    const result = await npmPackageCheck.run(contextWith({}));

    expect(result).toEqual({
      status: "warn",
      detail: "first publish not done yet",
      fix: "moku-release setup"
    });
  });

  it("skips when the manifest has no name", async () => {
    const result = await npmPackageCheck.run(contextWith({}, "{}"));

    expect(result.status).toBe("skip");
  });
});

describe("trustedPublisherCheck", () => {
  it("passes when publish.yml is registered for this repo", async () => {
    const result = await trustedPublisherCheck.run(
      contextWith({
        "npm trust list @moku-labs/common": "github moku-labs/common publish.yml\n"
      })
    );

    expect(result.status).toBe("pass");
  });

  it("fails with the exact registration command when nothing is registered", async () => {
    const result = await trustedPublisherCheck.run(
      contextWith({ "npm trust list @moku-labs/common": "" })
    );

    expect(result.status).toBe("fail");
    expect(result.fix).toBe(
      "npm trust github @moku-labs/common --file publish.yml --repo moku-labs/common --allow-publish --yes"
    );
  });

  it("warns (not fails) when npm asks for an OTP, because the registration is unknown", async () => {
    const result = await trustedPublisherCheck.run(
      contextWith({
        "npm trust list @moku-labs/common": {
          code: 1,
          stderr: "npm error code EOTP\nnpm error This operation requires a one-time password."
        }
      })
    );

    expect(result).toEqual({
      status: "warn",
      detail: "npm asks for an OTP, cannot verify from here",
      fix: "npm trust list @moku-labs/common"
    });
  });

  it("skips (not fails) when npm is logged out, because the listing needs auth", async () => {
    const result = await trustedPublisherCheck.run(
      contextWith({
        "npm trust list @moku-labs/common": {
          code: 1,
          stderr:
            "npm error code E401\nnpm error 401 Unauthorized - GET https://registry.npmjs.org/-/package/x/trust"
        }
      })
    );

    expect(result.status).toBe("skip");
    expect(result.detail).toContain("npm login");
  });

  it("warns (not fails) when this npm has no `trust` command", async () => {
    const result = await trustedPublisherCheck.run(
      contextWith({
        "npm trust list @moku-labs/common": { code: 1, stderr: 'Unknown command: "trust"' }
      })
    );

    expect(result).toEqual({
      status: "warn",
      detail: "this npm has no `trust` command",
      fix: "upgrade npm"
    });
  });

  it("skips when no owner/repo can be derived", async () => {
    const result = await trustedPublisherCheck.run(contextWith({}, JSON.stringify({ name: "x" })));

    expect(result.status).toBe("skip");
  });
});

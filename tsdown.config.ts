import { defineConfig } from "tsdown";

export default defineConfig({
  // The `moku-release` bin. ESM-only (a Node 24 executable, never imported) and no `.d.ts`.
  // `@moku-labs/common` is a dev dependency and is bundled in, so the published package has
  // no runtime dependencies and `@moku-labs/core` can install it without a cycle.
  entry: { release: "src/index.ts" },
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: false,
  noExternal: [/^@moku-labs\//],
  tsconfig: "tsconfig.build.json"
});

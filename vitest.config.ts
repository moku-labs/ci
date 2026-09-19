import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/unit/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      // `src/index.ts` is the bin: importing it runs the CLI, so it is measured by running
      // the commands it dispatches to, never by loading the entry itself.
      exclude: ["src/**/types.ts", "src/**/__tests__/**", "src/index.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 }
    }
  }
});

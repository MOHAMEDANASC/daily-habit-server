import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    // Tests share one database, so files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});


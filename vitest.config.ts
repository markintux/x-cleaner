import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    maxWorkers: 4,
    testTimeout: 30_000,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "tests/**", "**/*.config.ts"]
    }
  }
});

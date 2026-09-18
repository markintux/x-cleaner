import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    restoreMocks: true,
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "tests/**", "**/*.config.ts"]
    }
  }
});

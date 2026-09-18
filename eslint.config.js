import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".harness/**",
      ".phases/**",
      ".x-cleaner/**",
      "x-cleaner-data/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "browser-profile/**",
      "screenshots/**",
      "traces/**",
      "videos/**",
      "reports/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error"
    }
  }
);

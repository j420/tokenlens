import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/e2e/**", // Exclude Playwright E2E tests
      "**/*.spec.ts", // Playwright tests use .spec.ts
    ],
    include: ["**/*.test.ts"],
  },
});

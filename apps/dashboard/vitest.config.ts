import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig `@/*` path alias so API routes that import
      // `@/lib/...` resolve under vitest (Next resolves this natively).
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
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

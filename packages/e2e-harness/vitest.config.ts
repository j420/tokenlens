import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Harness test config.
 *
 * Two aliases make the real product source loadable headlessly:
 *  - `@`      → apps/dashboard/src, so the dashboard route handlers' `@/lib/...`
 *              imports resolve exactly as they do under Next (mirrors the
 *              dashboard's own vitest.config.ts).
 *  - `vscode` → a no-op stub, insurance for the (unused, normally elided) vscode
 *              import in apps/extension/src/token-saver.ts so esbuild can't choke
 *              on a bare specifier with no runtime module.
 *
 * `globalSetup` redirects HOME into a throwaway dir so any default `~/.prune/*`
 * path written by a transcript-reading handler lands in tmp, never the real home.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../apps/dashboard/src", import.meta.url)),
      vscode: fileURLToPath(new URL("./src/_vscode-stub.ts", import.meta.url)),
    },
  },
  test: {
    globalSetup: ["./src/_global-setup.ts"],
    include: ["src/**/*.test.ts"],
    // The dashboard scenario shares an in-process module-level store across
    // route handlers; keep a single worker so module state is deterministic and
    // child-process hook spawns aren't oversubscribed.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

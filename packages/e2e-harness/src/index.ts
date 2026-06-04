/**
 * @prune/e2e-harness — public surface (build target).
 *
 * Only re-exports the rootDir-safe, @prune-only modules so `tsc` emits a clean
 * dist. The scenario/driver code that imports foreign source (apps/extension,
 * apps/dashboard) is exercised by the vitest suites and the tsx demo, never by
 * this build (see tsconfig `exclude`). This package is PRIVATE and dev-only;
 * nothing in the product imports it.
 */

export type { ScenarioResult, Step, StepStatus } from "./types";
export { step, findStep } from "./types";
export { renderReport } from "./report";
export { buildSession, type SessionFixture } from "./fixtures/session";
export { runHook, makeHookEnv, isBlock, additionalContextOf } from "./drivers/hook-driver";
export { mcp } from "./drivers/mcp-driver";

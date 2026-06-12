/**
 * @prune/outcome-bench — Benchmark v2: outcomes, not tokens.
 *
 * Paired A/B harness proving (or refuting) "same task success rate, N%
 * cheaper" with oracle-graded tasks, provider-reported usage, pre-registered
 * statistics, and a signed attestation. Dry-run (fixture) mode exercises the
 * entire pipeline with zero model spend.
 */

export * from "./types.js";
export * from "./manifest.js";
export * from "./accounting.js";
export * from "./workspace.js";
export * from "./arm-setup.js";
export * from "./brief.js";
export * from "./citeback.js";
export * from "./runner.js";
export * from "./stats.js";
export * from "./report.js";
export * from "./fixtures.js";

/**
 * @prune/reward-integrity — F14, the Reward-Integrity Interlock.
 *
 * Public surface:
 *   - evaluateRewardIntegrity(write, config) → the top-level report for a write
 *   - compareInventories(before, after)      → the structural verdict
 *   - inventoryAssertions(code, scriptKind)  → the raw AST census
 *   - path + hash helpers for the calling hook
 *
 * Everything is deterministic (AST + content hash), fail-safe, and never calls
 * a model or fabricates a number.
 */

export * from "./types.js";
export { inventoryAssertions } from "./assertions.js";
export {
  compareInventories,
  evaluateRewardIntegrity,
  maxSeverity,
} from "./integrity.js";
export {
  isGraderPath,
  isTestFilePath,
  normalizePath,
  scriptKindForPath,
  segments,
} from "./paths.js";
export { hashContent, sameContent } from "./hash.js";

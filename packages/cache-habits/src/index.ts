/**
 * @prune/cache-habits (E3)
 *
 * Pre-action cache-habits linter. Inspects a typed `ProposedAction` (what the
 * user is about to send) against the prior `SessionSnapshot` and emits stable
 * deterministic `LintFinding`s for any of 14 documented prompt-cache-killer
 * patterns. Composes with `@prune/intelligence` reactive analyzers
 * (`diagnoseCacheBust`, `analyzeCacheCoPilot`) which operate post-hoc.
 *
 * Discipline:
 *   - No regex (typed field walks only)
 *   - No model call (deterministic predicates)
 *   - Deterministic messages (test-pinned)
 *   - Stable rule IDs (CH-NNN), never renumbered once shipped
 *   - Returns null when a rule does not fire; never fabricates cost
 *
 * Public surface: types, rule registry, linter runner, and `quality_proof`
 * schema for sink integration. Hook scripts and the MCP server consume
 * these; downstream packages should not reach into source modules.
 */

export * from "./types.js";
export * from "./cache-econ.js";
export {
  CACHE_HABIT_RULES,
  getRule,
  modelFamilyOf,
} from "./rules.js";
export {
  lint,
  listRules,
} from "./linter.js";
export {
  buildQualityProof,
  CACHE_HABITS_FEATURE_ID,
  QUALITY_PROOF_SCHEMA_VERSION,
  type CacheHabitsQualityProof,
} from "./quality-proof.js";

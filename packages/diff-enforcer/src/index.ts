/**
 * @prune/diff-enforcer
 *
 * Phase-8 Tier-1 "Diff-vs-Rewrite Enforcer". Given a proposed change to a file,
 * decides whether sending a line-level unified DIFF or a FULL REWRITE costs
 * fewer REAL tokens (@prune/tokenizer), and guarantees the recommended diff is
 * sound by round-tripping the serialized diff back to `proposed`.
 *
 * The diff is computed with a textbook LCS dynamic program over lines (O(n*m),
 * bounded) — not regex, not a third-party diff library.
 */

export { diffEnforce } from "./enforcer.js";
export type {
  Decision,
  DiffEnforceOptions,
  Recommendation,
} from "./enforcer.js";

// Lower-level primitives, exported for reuse/testing.
export {
  computeLineEdits,
  splitLinesKeepingEol,
  type EditOp,
} from "./lcs.js";
export {
  buildHunks,
  renderUnifiedDiff,
  applyUnifiedDiff,
  type Hunk,
} from "./unified.js";

/**
 * @prune/replay-cost (E2)
 *
 * What-If Deterministic Replay Engine. Distinct from @prune/replay-vault (which
 * is the tamper-evident COMPLIANCE log): this package is the cost-iteration
 * engine for prompt engineering. Canonicalize a session into hash-chained
 * segments, mutate one segment, and the engine computes — purely and
 * deterministically — the byte-identical shared prefix, the divergence point,
 * and the dollar delta between a naive cold re-run and a cache-replayed run.
 *
 * The economics (see cost-model.ts) fall straight out of the algebra: changing
 * only the last prompt leaves nearly the whole session as a shared prefix that
 * re-serves at the cache-read tier, so the per-iteration cost of a
 * prompt-engineering loop collapses by the shared-prefix fraction.
 *
 * Discipline:
 *   - No regex; no model call in the planner (the optional TailReplayer is the
 *     only model surface, supplied by the caller).
 *   - Caller-supplied token counts; never fabricated.
 *   - Deterministic: same baseline + mutation ⇒ same plan ⇒ same hashes.
 *   - Reuses @prune/replay-vault canonicalization + @prune/equivalence gate.
 *
 * Public surface consumed by hooks / MCP server / dashboard; downstream
 * packages should not reach into source modules directly.
 */

export * from "./types.js";
export {
  GENESIS_HASH,
  segmentContentHash,
  chainPrefixHash,
  buildTimeline,
  rehash,
  type BuildTimelineInput,
} from "./segment.js";
export {
  computeDivergence,
  timelinesIdentical,
} from "./divergence.js";
export {
  computeReplayCost,
  aggregateIterations,
} from "./cost-model.js";
export {
  applyMutation,
  planReplay,
  WhatIfEngine,
  type TailReplayer,
} from "./whatif.js";
export { compareOutputs } from "./equivalence-gate.js";
export {
  buildQualityProof,
  REPLAY_COST_FEATURE_ID,
  QUALITY_PROOF_SCHEMA_VERSION,
  type ReplayCostQualityProof,
} from "./quality-proof.js";

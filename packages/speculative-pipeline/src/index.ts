/**
 * @prune/speculative-pipeline (E5)
 *
 * Speculative Tool Pipeline — PASTE (Parallel-Apply Speculative Tool
 * Execution). While the agent generates the next tool call, the pipeline
 * predicts the likely next READ-ONLY calls (a transparent transition model plus
 * caller-supplied candidates), the host runs them in parallel against a
 * sandboxed worktree, and the pipeline reconciles the real call against the
 * batch by canonical-input byte-equality. A hit serves an already-computed
 * result and reports the round-trip latency saved; a miss costs only host CPU.
 *
 * The secondary token-side win (cache-window preservation) is modeled in
 * latency-model.ts: shorter wall-clock keeps more turns inside the prompt-cache
 * TTL, so prefixes re-serve at the 0.10× read tier instead of being re-written.
 *
 * Safety: eligibility-gated to pure-read tools, deterministic byte-equality
 * reconciliation, byte-equality result verification (verify.ts), budget +
 * circuit-breaker (budget.ts). No regex; the only model surface is the
 * caller-supplied executor.
 *
 * Public surface consumed by hooks / MCP server; downstream packages should not
 * reach into source modules.
 */

export * from "./types.js";
export {
  SPECULATABLE_TOOLS,
  isSpeculatable,
} from "./eligibility.js";
export {
  speculationKey,
  sameCall,
} from "./canonical-input.js";
export {
  TransitionPredictor,
} from "./predictor.js";
export {
  SpeculationBudget,
  type SpeculationBudgetOptions,
  type BudgetVerdict,
  type BudgetDecision,
} from "./budget.js";
export {
  summarizeLatency,
  estimateCacheWindowPreservation,
  TTL_WINDOW_MS,
  type LatencyOutcome,
  type CacheWindowEstimate,
} from "./latency-model.js";
export {
  verifyResult,
  type VerificationResult,
} from "./verify.js";
export {
  SpeculativePipeline,
  type SpeculativePipelineOptions,
} from "./pipeline.js";
export {
  buildQualityProof,
  SPECULATIVE_PIPELINE_FEATURE_ID,
  QUALITY_PROOF_SCHEMA_VERSION,
  type SpeculativePipelineProof,
} from "./quality-proof.js";
export {
  SpeculativeHost,
  type ExecutorOutput,
  type ToolExecutor,
  type Clock,
  type SpeculativeHostOptions,
  type ServeMode,
  type ResolveSource,
  type ResolveResult,
  type TurnSpeculationReport,
  type AsyncVerificationReport,
  type HostLatencyLedger,
} from "./host.js";
export {
  FakeExecutor,
  ManualClock,
  flushMicrotasks,
  type PendingExecution,
} from "./test-harness.js";

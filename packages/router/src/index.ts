/**
 * @prune/router
 *
 * Deterministic three-tier routing for coding agents. v0.1 ships the
 * explainable rule layer (classifier + policy) plus a ledger that
 * tracks actual-vs-baseline savings call-by-call. v0.2 adds a local
 * triage model (Qwen3-Coder-Next or DeepSeek-V4-Pro) that runs the
 * classifier with neural backup; the rule audit trail stays.
 *
 * Reference: Skywork.ai's documented production saving was 66%
 * ($3.2k → $1.1k monthly) via a 3-tier classification → generation →
 * complex-reasoning pipeline. Source:
 * https://www.mindstudio.ai/blog/best-ai-model-routers-multi-provider-llm-cost-011e6
 */

export {
  classifyRequest,
  type Classification,
  type ClassificationInput,
  type ClassificationSignal,
  type IntentKind,
  type DifficultyTier,
} from "./classifier.js";

export {
  route,
  DEFAULT_TIER_MAP,
  type RoutingDecision,
  type Tier,
  type TierModelMap,
  type PolicyOptions,
} from "./policy.js";

export {
  RoutingLedger,
  type LedgerCall,
  type LedgerEntry,
  type LedgerSummary,
} from "./ledger.js";

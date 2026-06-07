/**
 * @prune/cost-security — "Defend the bill"
 * ========================================
 * Deterministic, fail-open defenses that treat the token BILL as an attack
 * surface. Where sentinel guards correctness/secrets and slo/budget-gate enforce
 * global caps, these catch an adversary (or a runaway agent) INFLATING spend:
 *
 *   - guardToolResult       — token-bomb & expansion-bomb quarantine + bounding
 *                             of a single oversized tool result (also the
 *                             tool-output-bounding saver).
 *   - detectThrash          — file-state oscillation (A->B->A edit loops).
 *   - attributeDownstreamCost — per-source cost amplification (cost-driving
 *                             injection that steers a read-everything cascade).
 *   - assessNavigationRatio   — post-localization over-exploration (read-only
 *                             stalls that re-visit files with zero edits).
 *   - assessToolErrorRate     — sustained tool-error-rate degeneration (the
 *                             mechanical failure facet loop-breaker misses).
 *
 * Every function is pure/deterministic, never throws on bad input, fabricates no
 * numbers (real token counts; USD null on unpriced model), and is advisory —
 * it returns a verdict + a safe replacement/finding, never a hard block.
 */

export {
  guardToolResult,
  type GuardVerdict,
  type GuardSignal,
  type GuardOptions,
  type GuardResult,
} from "./guard.js";

export {
  detectThrash,
  type FileEditEvent,
  type ThrashOptions,
  type ThrashFinding,
  type ThrashReport,
} from "./thrash.js";

export {
  attributeDownstreamCost,
  type SourceKind,
  type LedgerSource,
  type LedgerAction,
  type CostLedger,
  type AttributionOptions,
  type AttributionFinding,
  type AttributionReport,
} from "./attribution.js";

export {
  forecastTurnRisk,
  type TurnRiskInput,
  type TurnRiskFactor,
  type RiskBand,
  type TurnRiskOptions,
  type RiskWeights,
  type TurnRiskReport,
} from "./forecast.js";

export {
  assessEditAmplification,
  type AmplificationOptions,
  type AmplificationReport,
} from "./amplification.js";

export {
  assessFanoutAcceleration,
  type FanoutOptions,
  type FanoutReport,
} from "./fanout.js";

export {
  assessNavigationRatio,
  type NavToolCall,
  type NavTurn,
  type NavigationOptions,
  type NavigationReport,
} from "./navigation.js";

export {
  assessToolErrorRate,
  type ToolResultSignal,
  type ToolErrorOptions,
  type ToolErrorReport,
} from "./tool-error.js";

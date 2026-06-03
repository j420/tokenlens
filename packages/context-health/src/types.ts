/**
 * Public types for @prune/context-health (F6).
 *
 * These are the shapes that flow between (a) the algorithm core, (b) the
 * Claude Code hook stdout, (c) the MCP `context_health_report` tool, and
 * (d) the `EventRow.quality_proof` bundle persisted by @prune/persistence.
 *
 * Keep this file free of runtime dependencies — it is loaded by the hook
 * runtime, which must stay <50ms p95 cold-start.
 */

/**
 * Regime classification for a single turn (or, in cumulative form, for the
 * session as of a given turn). The detector is a state machine over these.
 *
 * Pinned to Chroma 2026 context-rot research:
 *  - "healthy"           — ECF safely below the warning floor (k+ = 0.50)
 *  - "warning"           — ECF has trended past 50% (Chroma's measured
 *                          retrieval-precision inflection); user-visible advisory
 *  - "critical"          — ECF has trended past 75% (coherence inflection);
 *                          stronger user-visible advisory recommending /compact
 *                          or a fresh session
 *  - "insufficient_data" — fewer than 2 turns, or the model's window is
 *                          unknown / corrupted. NEVER emit an advisory in
 *                          this state.
 */
export type Regime = "healthy" | "warning" | "critical" | "insufficient_data";

/**
 * Source attribution for an ECF or report value. Mirrors the
 * tokenizer's `source: "exact" | "estimated"` discipline so callers can
 * always distinguish a measured value from a fall-through.
 */
export type EcfSource =
  /** All inputs present, window known, math is fully real. */
  | "exact"
  /** Fewer than 2 turns observed — cannot detect trends. */
  | "insufficient_data"
  /** Model's context window is missing from @prune/shared/pricing. */
  | "unknown_window";

/**
 * A single ECF observation tied to one turn.
 *
 * `attendedInput` + `discountedCacheRead` + `committedOutput` is the
 * raw numerator; `contextWindow` is the denominator. The clamped ratio
 * is `ecf`. We keep all four numerator components so the report can
 * surface a primary cause without re-deriving them.
 */
export interface EcfSample {
  turnNumber: number;
  attendedInput: number;
  discountedCacheRead: number;
  committedOutput: number;
  contextWindow: number;
  /** clamp01((attendedInput + discountedCacheRead + committedOutput) / contextWindow) */
  ecf: number;
  source: EcfSource;
}

/**
 * Streaming CUSUM state — two one-sided detectors (warning + critical).
 * Constant memory, monotone-step semantics: see ./cusum.ts.
 */
export interface CusumState {
  /** Cumulative excess over k+ = 0.50 (warning threshold). */
  sPlus: number;
  /** Cumulative excess over k- = 0.75 (critical threshold). */
  sMinus: number;
  /** Last turn number observed (-1 ⇒ never observed). */
  lastTurnNumber: number;
  /** The regime as of `lastTurnNumber`. */
  regime: Regime;
  /** Turn where the most recent regime *upgrade* fired (-1 ⇒ none). */
  regimeChangedAtTurn: number;
}

/**
 * Secondary signals for diagnosis. None of these promote the regime on
 * their own; they enrich the advisory and the report.
 */
export interface SecondarySignals {
  /**
   * Slope of cache-hit rate over the rolling window. Negative slope ⇒
   * volatile prefix; prefix is being busted turn-over-turn. NaN-safe.
   */
  cacheHitTrend: number;
  /**
   * Slope of distinct-file-paths-touched per turn over the rolling
   * window. Strict monotone increase ⇒ scope drift.
   */
  scopeDriftSlope: number;
  /**
   * Most recent turn whose largest single tool result exceeded
   * `LARGE_TOOL_RESULT_FRACTION × contextWindow`. null ⇒ no such burst.
   */
  largeToolResultCause: {
    turnNumber: number;
    toolName: string;
    toolResultTokenEstimate: number;
  } | null;
}

/**
 * One detector observation result. The detector emits one of these
 * per `observe()` call; the hook + MCP tool aggregate these into a
 * report.
 */
export interface DetectorObservation {
  turnNumber: number;
  ecfSample: EcfSample;
  cusum: CusumState;
  signals: SecondarySignals;
  /**
   * Was this turn ignored? Set when the turn is malformed (NaN / negative
   * tokens) or when the model is unknown. Detector still advances its
   * internal turn counter but does not update CUSUM state.
   */
  skipped: boolean;
  skipReason?: "malformed_usage" | "unknown_window" | "subagent_boundary" | "compaction_reset";
}

/**
 * Snapshot returned by the MCP tool and consumed by the
 * EventRow.quality_proof field. Cheap to JSON-stringify — no functions,
 * no circular refs.
 */
export interface ContextHealthReport {
  regime: Regime;
  source: EcfSource;
  ecfCurrent: number | null;
  ecfSeries: EcfSample[];
  cusum: CusumState;
  signals: SecondarySignals;
  modelWindow: number | null;
  model: string | null;
  totalTurns: number;
  observedTurns: number;
  skippedTurns: number;
  /**
   * The primary inflection cause when regime !== "healthy". One of
   * "rising_ecf" | "volatile_prefix" | "large_tool_result" | "scope_drift".
   * null when regime is healthy or insufficient_data.
   */
  primaryCause: PrimaryCause | null;
}

export type PrimaryCause =
  | "rising_ecf"
  | "volatile_prefix"
  | "large_tool_result"
  | "scope_drift";

/**
 * Advisory string produced by the advisor. Deterministic w.r.t. inputs.
 * `text` is what the hook injects via `additionalContext`. The hook only
 * emits this when the feature flag is in `general` / `canary` mode.
 */
export interface ContextHealthAdvisory {
  regime: "warning" | "critical";
  text: string;
  primaryCause: PrimaryCause;
  suggestedAction: "compact" | "fresh_session" | "trim_context";
}

/**
 * Tunable constants. Defaults are pinned in `./constants.ts` and used
 * everywhere unless an env override is set. Exposed here so tests can
 * pin alternate values without monkey-patching.
 */
export interface ContextHealthConfig {
  /** Cache fidelity factor α (default 0.5). Discounts cache_read in ECF. */
  alpha: number;
  /** Warning threshold k+ (default 0.50). */
  kWarn: number;
  /** Critical threshold k− (default 0.75). */
  kCrit: number;
  /** CUSUM warning trigger h_warn (default 0.05). */
  hWarn: number;
  /** CUSUM critical trigger h_crit (default 0.10). */
  hCrit: number;
  /** Rolling-window length for cacheHitTrend / scopeDriftSlope (default 5). */
  rollingWindow: number;
  /** Single-tool-result fraction-of-window threshold (default 0.15). */
  largeToolResultFraction: number;
}

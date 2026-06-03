/**
 * @prune/speculative-pipeline — typed surface.
 *
 * The pipeline speculatively executes the agent's LIKELY next read-only tool
 * call while the model is still generating it. When the real call lands and
 * byte-matches a speculation, the result is already in hand — the round-trip
 * latency collapses to ~0. A miss is discarded; it cost host CPU, never tokens.
 *
 * Safety model (three independent guarantees):
 *   1. ELIGIBILITY. Only pure-read tools are ever speculated. A write/edit can
 *      never be speculatively executed — `isSpeculatable` excludes it and there
 *      is no code path that runs an ineligible tool.
 *   2. DETERMINISTIC RECONCILIATION. A speculation matches the real call only
 *      on byte-identical canonical input (RFC-8785 + SHA-256). No fuzzy match.
 *   3. RESULT VERIFICATION. When the host later runs the real tool out of band
 *      (shadow), the speculated result is gated against it by @prune/equivalence
 *      byte-equality before it can ever be treated as authoritative.
 *
 * Discipline: no regex; the only model surface is the caller-supplied executor;
 * all accounting is pure and deterministic.
 */

/** A tool invocation the agent makes (or the pipeline speculates). */
export interface ToolCall {
  /** Tool name, e.g. "Read", "Grep". */
  name: string;
  /** The tool input arguments (JSON-canonicalizable). */
  input: Record<string, unknown>;
}

/** A candidate speculation the pipeline may execute ahead of the agent. */
export interface Speculation {
  /** The predicted call. */
  call: ToolCall;
  /** Canonical-input key (RFC-8785 + SHA-256). Identity for reconciliation. */
  key: string;
  /** Predicted probability the agent issues this exact call next, in [0,1]. */
  probability: number;
  /** Where the candidate came from: the transition model or the host. */
  source: "transition-model" | "caller-candidate";
}

/** The result of executing a speculation (host-supplied executor output). */
export interface SpeculationResult {
  key: string;
  /** The tool result text the speculative execution produced. */
  result: string;
  /** Wall-clock ms the speculative execution took (for the latency model). */
  elapsedMs: number;
}

/** Outcome of reconciling the agent's real call against in-flight speculations. */
export interface ReconcileOutcome {
  /** Did the real call byte-match a completed speculation? */
  hit: boolean;
  /** The matched speculation key, when hit. */
  key: string | null;
  /** The cached result to serve, when hit AND the speculation had completed. */
  result: string | null;
  /**
   * The completed speculation's measured elapsed time (ms) — i.e. the GROSS,
   * UPPER-BOUND latency a host could save by serving this result without
   * re-running the tool. It is NOT the realized net saving: whether the agent
   * actually avoids this wall-clock depends entirely on the host's serve mode.
   *
   *   • A host that serves the speculative result immediately and verifies
   *     OUT OF BAND (async) genuinely saves this whole figure.
   *   • A host that verifies SYNCHRONOUSLY (runs a fresh shadow execution on the
   *     critical path before serving) saves ~0 net — the agent waited the shadow
   *     run anyway. See `SpeculativeHost.resolve` and `ResolveResult.latencySavedMs`
   *     for the honest, mode-aware NET accounting.
   *
   * 0 on a miss / in-flight-incomplete.
   */
  speculativeElapsedMs: number;
  /** Classification for the accounting ledger. */
  classification: "hit" | "miss" | "ineligible" | "in_flight_incomplete";
}

/** Rolling accounting over the session. */
export interface PipelineStats {
  speculationsIssued: number;
  hits: number;
  misses: number;
  /** Speculations that matched but hadn't finished when the real call arrived. */
  inFlightIncomplete: number;
  /**
   * Sum of `speculativeElapsedMs` over all hits — the GROSS, upper-bound
   * latency that could be saved. This is the speculations' own elapsed time, NOT
   * the realized net saving (which is mode-dependent; see `ReconcileOutcome`).
   * The host tracks the realized net figure separately.
   */
  totalSpeculativeElapsedMs: number;
  /** hits / (hits + misses), or 0 when none resolved. */
  hitRate: number;
  /** Speculations executed that never matched (wasted CPU). */
  wastedSpeculations: number;
}

/** Configuration for the predictor + pipeline. */
export interface PipelineOptions {
  /** Max speculations to issue per turn. Default 3. */
  maxSpeculationsPerTurn?: number;
  /** Minimum predicted probability to bother speculating. Default 0.2. */
  minProbability?: number;
  /**
   * Additive (Laplace) smoothing for the transition model. Default 1. Higher
   * values trust the global frequency prior more vs the local transitions.
   */
  smoothing?: number;
}

/**
 * Pre-Turn Risk Forecaster  (Cost-Security / value-per-token)
 * ===========================================================
 * The most expensive event in an agentic session is a fully-paid turn that
 * produces nothing usable — a vague request that loops, a retry on a stale
 * approach, a turn fired into an already-overfull context. `forecastTurnRisk`
 * scores that risk BEFORE the turn is spent, from signals available at prompt
 * submission, so the agent/user can reframe a few hundred tokens instead of
 * burning a whole turn.
 *
 * HONESTY (load-bearing): the output is a TRANSPARENT HEURISTIC RISK INDEX in
 * [0,1], assembled from explicit, caller-tunable factor weights — NOT a learned
 * or calibrated probability. Every point of risk is attributed to a named factor
 * the caller can inspect. It never fabricates a "P(success)". It is advisory and
 * deterministic; the same inputs always yield the same score.
 */

// ============================================================================
// Types
// ============================================================================

export interface TurnRiskInput {
  /** Length of the user prompt in characters. */
  promptChars?: number;
  /** Does the prompt reference a concrete file path / symbol / code token? */
  namesConcreteTarget?: boolean;
  /** A vague demand ("fix it", "still broken") with no concrete target. */
  vagueDemand?: boolean;
  /** Consecutive low-ROI turns immediately preceding this one. */
  priorLowRoiStreak?: number;
  /** Effective context fullness 0..100, or null when unknown (never guessed). */
  contextFullnessPct?: number | null;
  /** How many turns in a row the same error has recurred. */
  unresolvedErrorRepeats?: number;
}

export interface TurnRiskFactor {
  name: string;
  /** Risk contributed by this factor, in [0,1]. */
  contribution: number;
  detail: string;
}

export type RiskBand = "low" | "elevated" | "high";

export interface TurnRiskOptions {
  /** Band thresholds. Defaults: elevated >= 0.35, high >= 0.6. */
  elevatedAt?: number;
  highAt?: number;
  /** Per-factor weights (override individually). */
  weights?: Partial<RiskWeights>;
}

export interface RiskWeights {
  vagueDemand: number;
  shortPrompt: number;
  noConcreteTarget: number;
  lowRoiPerStep: number;
  lowRoiCap: number;
  contextFullness: number;
  errorRepeatPerStep: number;
  errorRepeatCap: number;
}

const DEFAULT_WEIGHTS: RiskWeights = {
  vagueDemand: 0.3,
  shortPrompt: 0.15,
  noConcreteTarget: 0.15,
  lowRoiPerStep: 0.12,
  lowRoiCap: 0.36,
  contextFullness: 0.25,
  errorRepeatPerStep: 0.1,
  errorRepeatCap: 0.3,
};

export interface TurnRiskReport {
  /** Heuristic risk index in [0,1]. NOT a calibrated probability. */
  risk: number;
  band: RiskBand;
  /** Active factors, sorted by contribution desc. */
  factors: TurnRiskFactor[];
  /** A concrete reframe suggestion when band !== "low"; null otherwise. */
  recommend: string | null;
}

// ============================================================================
// forecastTurnRisk
// ============================================================================

export function forecastTurnRisk(input: TurnRiskInput, options: TurnRiskOptions = {}): TurnRiskReport {
  const opts = options && typeof options === "object" ? options : {};
  const inp: TurnRiskInput = input && typeof input === "object" ? input : {};
  const w: RiskWeights = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const elevatedAt = num(opts.elevatedAt, 0.35);
  const highAt = num(opts.highAt, 0.6);

  const promptChars = nonNegInt(inp.promptChars, 0);
  const namesTarget = inp.namesConcreteTarget === true;
  const vague = inp.vagueDemand === true;
  const lowRoi = nonNegInt(inp.priorLowRoiStreak, 0);
  const fullness =
    typeof inp.contextFullnessPct === "number" && Number.isFinite(inp.contextFullnessPct)
      ? clamp(inp.contextFullnessPct, 0, 100)
      : null;
  const errorRepeats = nonNegInt(inp.unresolvedErrorRepeats, 0);

  const factors: TurnRiskFactor[] = [];

  if (vague && !namesTarget) {
    factors.push({
      name: "vague_demand",
      contribution: w.vagueDemand,
      detail: "request restates a failure ('fix it' / 'still broken') with no concrete target",
    });
  }
  if (promptChars > 0 && promptChars < 25) {
    factors.push({
      name: "short_prompt",
      contribution: w.shortPrompt,
      detail: `prompt is only ${promptChars} chars — likely under-specified`,
    });
  }
  if (!namesTarget) {
    factors.push({
      name: "no_concrete_target",
      contribution: w.noConcreteTarget,
      detail: "no file path / symbol / code token referenced",
    });
  }
  if (lowRoi > 0) {
    const c = Math.min(w.lowRoiCap, lowRoi * w.lowRoiPerStep);
    factors.push({
      name: "low_roi_streak",
      contribution: c,
      detail: `${lowRoi} prior turn(s) made little progress`,
    });
  }
  if (fullness !== null && fullness >= 80) {
    // Ramp from 80% (0) to 100% (full weight).
    const c = Math.round(((fullness - 80) / 20) * w.contextFullness * 1000) / 1000;
    if (c > 0) {
      factors.push({
        name: "context_pressure",
        contribution: c,
        detail: `context ~${Math.round(fullness)}% full — compaction risk, weaker recall`,
      });
    }
  }
  if (errorRepeats > 0) {
    const c = Math.min(w.errorRepeatCap, errorRepeats * w.errorRepeatPerStep);
    factors.push({
      name: "error_repeat",
      contribution: c,
      detail: `same error recurred ${errorRepeats} turn(s) in a row`,
    });
  }

  factors.sort((a, b) => b.contribution - a.contribution);
  const risk = clamp(
    Math.round(factors.reduce((s, f) => s + f.contribution, 0) * 1000) / 1000,
    0,
    1
  );
  const band: RiskBand = risk >= highAt ? "high" : risk >= elevatedAt ? "elevated" : "low";

  return { risk, band, factors, recommend: band === "low" ? null : recommendFor(factors[0]) };
}

// ============================================================================
// Helpers
// ============================================================================

function recommendFor(top: TurnRiskFactor | undefined): string {
  switch (top?.name) {
    case "vague_demand":
    case "no_concrete_target":
      return "Name the specific file/symbol and the expected behaviour before sending.";
    case "low_roi_streak":
      return "Recent turns made little progress — change approach or ask for guidance instead of repeating.";
    case "context_pressure":
      return "Context is nearly full — compact or split into a focused sub-task to preserve recall.";
    case "error_repeat":
      return "The same error keeps recurring — re-read it once and form a new hypothesis, don't re-run the same fix.";
    case "short_prompt":
      return "Add detail: the target file, the symptom, and what 'done' looks like.";
    default:
      return "Add specifics (target + expected outcome) before spending a full turn.";
  }
}

function num(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}
function nonNegInt(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : dflt;
}
function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

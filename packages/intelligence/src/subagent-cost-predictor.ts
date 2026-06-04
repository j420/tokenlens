/**
 * N6 — Pre-spawn subagent cost predictor (pure decision layer).
 *
 * The subagent-warden BLOCKS runaway fan-out by COUNT (concurrency, burst,
 * lifetime). It says nothing about the dollar cost of a spawn. N6 is the
 * complement: before the agent spawns N subagents, project what they will
 * likely COST, from the observed cost of subagents already completed this
 * session.
 *
 * Discipline (load-bearing):
 *   - CALLER-SUPPLIED numbers only. The predictor never parses a transcript and
 *     never invents a token count — the host supplies per-subagent usage samples
 *     (it alone can attribute tokens to a subagent). Same inputs ⇒ same output.
 *   - STRICT PRICING. A USD figure is produced only when the model is in the
 *     pricing table OR the sample carries an explicit costUsd. An unpriced model
 *     yields `priced: false` and null USD — NEVER a default rate.
 *   - HONEST ABSENCE. With no usable history the basis is "insufficient_data"
 *     and every projection is null. We surface uncertainty (p50 AND p90), never
 *     a single point estimate dressed up as a guarantee.
 *   - NO side effects, no clock, no I/O.
 */

import {
  calculateCost,
  detectProvider,
  MODEL_PRICING,
  type Provider,
} from "@prune/shared";

/** One completed subagent's observed usage. Caller-supplied. */
export interface SubagentCostSample {
  tokensIn: number;
  tokensOut: number;
  tokensCached?: number;
  /**
   * Pre-computed cost in USD, if the host already knows it. When present it is
   * used verbatim (most faithful). When absent, cost is derived from the model
   * price — but only if the model is priced.
   */
  costUsd?: number;
}

export interface SubagentCostPredictionInput {
  /** Observed costs of subagents completed this session. */
  history: SubagentCostSample[];
  /** How many subagents the agent is about to spawn (>= 1). */
  proposedCount: number;
  /** Model the proposed subagents will run on (for pricing the history). */
  model: string;
  /** Provider hint; inferred from the model name when omitted. */
  provider?: Provider;
}

/** A trio of order statistics over a sample — uncertainty made explicit. */
export interface CostQuantiles {
  p50: number;
  p90: number;
  mean: number;
}

export interface SubagentCostPrediction {
  /** "session-history" when at least one sample was usable; else insufficient. */
  basis: "session-history" | "insufficient_data";
  /** Number of history samples folded in. */
  sampleSize: number;
  /** Whether USD figures could be produced (model priced or costUsd supplied). */
  priced: boolean;
  model: string;
  proposedCount: number;
  /** Per-subagent total tokens (in + out). null when no samples. */
  perSubagentTokens: CostQuantiles | null;
  /** Per-subagent USD. null when unpriced and no explicit costUsd. */
  perSubagentUsd: CostQuantiles | null;
  /** perSubagentTokens scaled by proposedCount. null when no samples. */
  projectedTotalTokens: CostQuantiles | null;
  /** perSubagentUsd scaled by proposedCount. null when unpriced. */
  projectedTotalUsd: CostQuantiles | null;
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function nonNeg(n: number): number {
  return n > 0 ? n : 0;
}

/** Nearest-rank percentile over an already-sorted ascending array. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  // Nearest-rank: rank = ceil(p/100 * N), clamped to [1, N].
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length, Math.max(1, rank)) - 1;
  return sortedAsc[idx];
}

function quantiles(values: number[]): CostQuantiles | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    mean,
  };
}

function scale(q: CostQuantiles | null, factor: number): CostQuantiles | null {
  if (!q) return null;
  return { p50: q.p50 * factor, p90: q.p90 * factor, mean: q.mean * factor };
}

/** Is this model present in the pricing table (strict — no default fallback)? */
export function isModelPriced(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_PRICING, model);
}

/**
 * Project the cost of a proposed subagent fan-out from observed session
 * history. Pure & total: any input (empty history, unpriced model, garbage
 * samples) yields a well-formed prediction. Never throws.
 */
export function predictSubagentCost(
  input: SubagentCostPredictionInput
): SubagentCostPrediction {
  const model = typeof input?.model === "string" ? input.model : "";
  const proposedCount =
    isFiniteNum(input?.proposedCount) && input.proposedCount > 0
      ? Math.trunc(input.proposedCount)
      : 1;
  const provider: Provider = input?.provider ?? detectProvider(model);
  const priced = isModelPriced(model);

  const history = Array.isArray(input?.history) ? input.history : [];

  const tokenSamples: number[] = [];
  const usdSamples: number[] = [];

  for (const s of history) {
    if (!s || typeof s !== "object") continue;
    const tin = isFiniteNum(s.tokensIn) ? nonNeg(s.tokensIn) : 0;
    const tout = isFiniteNum(s.tokensOut) ? nonNeg(s.tokensOut) : 0;
    const tcached = isFiniteNum(s.tokensCached) ? nonNeg(s.tokensCached) : 0;
    // A sample with no tokens AND no explicit cost carries no signal — skip it.
    const hasTokens = tin > 0 || tout > 0;
    const hasExplicitCost = isFiniteNum(s.costUsd);
    if (!hasTokens && !hasExplicitCost) continue;

    if (hasTokens) tokenSamples.push(tin + tout);

    if (hasExplicitCost) {
      usdSamples.push(nonNeg(s.costUsd as number));
    } else if (priced && hasTokens) {
      // Derive from the pricing table only when the model is actually priced.
      usdSamples.push(calculateCost(provider, model, tin, tout, tcached));
    }
    // else: unpriced model + no explicit cost ⇒ contributes tokens but no USD.
  }

  const perSubagentTokens = quantiles(tokenSamples);
  const perSubagentUsd = quantiles(usdSamples);
  const sampleSize = tokenSamples.length;

  return {
    basis: sampleSize > 0 || usdSamples.length > 0 ? "session-history" : "insufficient_data",
    sampleSize,
    priced: usdSamples.length > 0,
    model,
    proposedCount,
    perSubagentTokens,
    perSubagentUsd,
    projectedTotalTokens: scale(perSubagentTokens, proposedCount),
    projectedTotalUsd: scale(perSubagentUsd, proposedCount),
  };
}

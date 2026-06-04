/**
 * Cost accountant — wraps @prune/shared pricing so the gate can speak
 * in dollars from either a recorded usage object (post-call truth) or
 * a pre-call estimate (input only known).
 *
 * Hard rule from CLAUDE.md: never present an estimate as exact. Every
 * function here returns a `source: "exact" | "estimated"` discriminator
 * so callers (and the audit log) can attribute uncertainty correctly.
 */

import {
  calculateCost,
  detectProvider,
  isModelPriced,
  type Provider,
} from "@prune/shared";

export interface RecordedUsage {
  model: string;
  provider?: Provider;
  tokensIn: number;
  tokensOut: number;
  /**
   * Anthropic cache-read tokens (priced at 0.1× input). For OpenAI auto-cache
   * the cached-input tokens go here too. For Gemini cachedContents, same.
   */
  tokensCached?: number;
  /**
   * Anthropic cache-creation tokens (priced at 1.25× / 2× input for 5m/1h).
   * Captured for audit; cost is computed by `calculateCost` which already
   * accounts for the read discount.
   */
  tokensCacheCreation?: number;
}

export interface CostEstimateRequest {
  model: string;
  provider?: Provider;
  /** Best-known input-token count (counted, not guessed). */
  estimatedTokensIn: number;
  /**
   * Optional caller-supplied output-token estimate. If absent, the
   * accountant uses a deliberately-conservative heuristic
   * (`max(500, in * 0.3)`) and the returned `source` is `"estimated"`.
   */
  estimatedTokensOut?: number;
}

export interface CostResult {
  costUsd: number;
  provider: Provider;
  model: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  source: "exact" | "estimated";
  /**
   * Whether `costUsd` was computed from a RATE that genuinely exists in the
   * price table for this (provider, model). When false, the numeric cost is a
   * `DEFAULT_PRICING` fallback — recorded so the NON-NULL `cost_usd` column
   * still gets a number, but flagged so no reader mistakes it for an exact
   * rate. This is independent of `source`: `source` is about token-count
   * certainty (recorded vs estimated), `pricedExact` is about RATE certainty.
   */
  pricedExact: boolean;
  /**
   * Human-readable note present ONLY when `pricedExact` is false, explaining
   * that the cost used a fallback rate. Absent (undefined) when the rate is
   * genuinely from the table — so its mere presence flags an unpriced charge.
   */
  pricingNote?: string;
}

const DEFAULT_OUT_FLOOR = 500;
const DEFAULT_OUT_FRACTION = 0.3;

const UNPRICED_NOTE =
  "default fallback rate; model not in price table";

function resolveProvider(model: string, override?: Provider): Provider {
  return override ?? detectProvider(model);
}

/**
 * Resolve the rate-confidence for a (provider, model) pair using the STRICT
 * pricing API. `isModelPriced` is the single source of truth — it checks the
 * table directly with no DEFAULT_PRICING fallback, so an unknown model yields
 * `pricedExact: false` and a note, never a silently-exact rate.
 */
function pricingConfidence(provider: Provider, model: string): {
  pricedExact: boolean;
  pricingNote?: string;
} {
  return isModelPriced(provider, model)
    ? { pricedExact: true }
    : { pricedExact: false, pricingNote: UNPRICED_NOTE };
}

export function computeRecordedCost(usage: RecordedUsage): CostResult {
  const provider = resolveProvider(usage.model, usage.provider);
  const cost = calculateCost(
    provider,
    usage.model,
    usage.tokensIn,
    usage.tokensOut,
    usage.tokensCached ?? 0
  );
  return {
    costUsd: cost,
    provider,
    model: usage.model,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    tokensCached: usage.tokensCached ?? 0,
    source: "exact",
    ...pricingConfidence(provider, usage.model),
  };
}

export function estimateUpcomingCost(req: CostEstimateRequest): CostResult {
  const provider = resolveProvider(req.model, req.provider);
  const estOut =
    req.estimatedTokensOut ??
    Math.max(DEFAULT_OUT_FLOOR, Math.ceil(req.estimatedTokensIn * DEFAULT_OUT_FRACTION));
  const cost = calculateCost(provider, req.model, req.estimatedTokensIn, estOut);
  return {
    costUsd: cost,
    provider,
    model: req.model,
    tokensIn: req.estimatedTokensIn,
    tokensOut: estOut,
    tokensCached: 0,
    source: req.estimatedTokensOut === undefined ? "estimated" : "exact",
    ...pricingConfidence(provider, req.model),
  };
}

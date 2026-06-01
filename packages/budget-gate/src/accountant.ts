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
}

const DEFAULT_OUT_FLOOR = 500;
const DEFAULT_OUT_FRACTION = 0.3;

function resolveProvider(model: string, override?: Provider): Provider {
  return override ?? detectProvider(model);
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
  };
}

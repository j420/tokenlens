/**
 * @prune/tokenizer
 * Token counting for OpenAI and Anthropic models.
 *
 * OpenAI:   uses `gpt-tokenizer` locally — `source: "exact"` for known models,
 *           `"estimated"` for unknown families.
 * Anthropic: synchronous path estimates via the GPT tokenizer (`"estimated"`).
 *           For exact counts, use `countTokensAsync` with the Anthropic
 *           Messages `count_tokens` API (see ./anthropic.ts).
 */

import { encode } from "gpt-tokenizer";
import {
  MODEL_PRICING,
  estimateCost as sharedEstimateCost,
  formatTokens,
  formatCost,
  detectProvider,
  getModelPricingByName,
  type ModelPricing,
} from "@prune/shared";
import { anthropicCountTokens } from "./anthropic.js";

// ============================================================================
// Types
// ============================================================================

export type TokenSource = "exact" | "estimated";

export interface TokenCount {
  tokens: number;
  model: string;
  cost: number;
  source: TokenSource;
}

export interface BatchTokenCount {
  files: Array<{
    path: string;
    tokens: number;
    cost: number;
    source: TokenSource;
  }>;
  total: {
    tokens: number;
    cost: number;
  };
  model: string;
  source: TokenSource;
}

export type { ModelPricing };

// Models whose tokenization gpt-tokenizer reproduces exactly.
const EXACT_OPENAI_PREFIXES = ["gpt-4", "gpt-3.5", "o1", "o3", "o4"];

function openAISource(model: string): TokenSource {
  return EXACT_OPENAI_PREFIXES.some((p) => model.startsWith(p))
    ? "exact"
    : "estimated";
}

// ============================================================================
// Core
// ============================================================================

export { detectProvider };

/**
 * Count tokens synchronously. Anthropic counts are approximations — for exact
 * Anthropic counts (network call) use `countTokensAsync`.
 */
export function countTokens(text: string, model: string = "gpt-4o"): TokenCount {
  const provider = detectProvider(model);
  const tokens = encode(text).length;
  const cost = sharedEstimateCost(tokens, model, "input");
  const source: TokenSource =
    provider === "openai" ? openAISource(model) : "estimated";
  return { tokens, model, cost, source };
}

/**
 * Count tokens with the most accurate available method.
 *
 * - OpenAI: uses gpt-tokenizer (exact for known families).
 * - Anthropic: calls /v1/messages/count_tokens when ANTHROPIC_API_KEY is set.
 *   Falls back to gpt-tokenizer with `source: "estimated"` on missing key or
 *   network failure — failures are never surfaced as exact.
 */
export async function countTokensAsync(
  text: string,
  model: string = "gpt-4o"
): Promise<TokenCount> {
  const provider = detectProvider(model);
  if (provider !== "anthropic") {
    return countTokens(text, model);
  }
  const result = await anthropicCountTokens({
    model,
    messages: [{ role: "user", content: text }],
  });
  return {
    tokens: result.input_tokens,
    model,
    cost: sharedEstimateCost(result.input_tokens, model, "input"),
    source: result.source,
  };
}

export async function init(): Promise<void> {
  return Promise.resolve();
}

export function isReady(): boolean {
  return true;
}

export function countTokensBatch(
  files: Array<{ path: string; content: string }>,
  model: string = "gpt-4o"
): BatchTokenCount {
  const results = files.map(({ path, content }) => {
    const { tokens, cost, source } = countTokens(content, model);
    return { path, tokens, cost, source };
  });

  const total = results.reduce(
    (acc, file) => ({
      tokens: acc.tokens + file.tokens,
      cost: acc.cost + file.cost,
    }),
    { tokens: 0, cost: 0 }
  );

  const source: TokenSource = results.every((r) => r.source === "exact")
    ? "exact"
    : "estimated";

  return { files: results, total, model, source };
}

export function estimateCost(
  tokens: number,
  model: string,
  type: "input" | "output" = "input"
): number {
  return sharedEstimateCost(tokens, model, type);
}

export function getModelPricing(model: string): ModelPricing {
  return getModelPricingByName(model);
}

export function isLargeContext(
  text: string,
  model: string = "gpt-4o",
  threshold: number = 10000
): boolean {
  const { tokens } = countTokens(text, model);
  return tokens > threshold;
}

export function analyzeContent(
  text: string,
  model: string = "gpt-4o",
  threshold: number = 10000
): {
  tokens: number;
  cost: number;
  isLarge: boolean;
  recommendation: "proceed" | "squeeze" | "abort";
  source: TokenSource;
  formatted: {
    tokens: string;
    cost: string;
  };
} {
  const { tokens, cost, source } = countTokens(text, model);
  const isLarge = tokens > threshold;

  let recommendation: "proceed" | "squeeze" | "abort";
  if (tokens < threshold) {
    recommendation = "proceed";
  } else if (tokens < threshold * 5) {
    recommendation = "squeeze";
  } else {
    recommendation = "abort";
  }

  return {
    tokens,
    cost,
    isLarge,
    recommendation,
    source,
    formatted: {
      tokens: formatTokens(tokens),
      cost: formatCost(cost),
    },
  };
}

export function cleanup(): void {
  // no-op
}

export { formatTokens, formatCost, MODEL_PRICING };
export { anthropicCountTokens } from "./anthropic.js";

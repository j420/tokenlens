import type { Provider } from "./schemas/event.js";

// Pricing per million tokens.
// Format: { input, output, cached_input? } — cached_input is the Anthropic
// cache-read price tier (≈10% of input for ephemeral 5-minute TTL).
export interface ModelPricing {
  input: number;
  output: number;
  cached_input?: number;
}

const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  // Claude 4 Opus
  "claude-opus-4-20250514": { input: 15, output: 75, cached_input: 1.875 },
  "claude-opus-4-5-20251101": { input: 15, output: 75, cached_input: 1.875 },
  // Claude 4 Sonnet
  "claude-sonnet-4-20250514": { input: 3, output: 15, cached_input: 0.375 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, cached_input: 0.375 },
  // Claude 3.5 Sonnet
  "claude-3-5-sonnet-20241022": { input: 3, output: 15, cached_input: 0.375 },
  "claude-3-5-sonnet-20240620": { input: 3, output: 15, cached_input: 0.375 },
  // Claude 3.5 Haiku
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4, cached_input: 0.08 },
  // Claude 3 Opus
  "claude-3-opus-20240229": { input: 15, output: 75, cached_input: 1.875 },
  // Claude 3 Sonnet
  "claude-3-sonnet-20240229": { input: 3, output: 15, cached_input: 0.375 },
  // Claude 3 Haiku
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25, cached_input: 0.03 },

  // Family-name aliases (stable identifiers used across the codebase before
  // dated model IDs were introduced). Each alias points at current pricing
  // for that family tier.
  "claude-opus-4": { input: 15, output: 75, cached_input: 1.875 },
  "claude-sonnet-4": { input: 3, output: 15, cached_input: 0.375 },
  "claude-haiku-3.5": { input: 0.8, output: 4, cached_input: 0.08 },
  "claude-3-opus": { input: 15, output: 75, cached_input: 1.875 },
  "claude-3-sonnet": { input: 3, output: 15, cached_input: 0.375 },
  "claude-3-haiku": { input: 0.25, output: 1.25, cached_input: 0.03 },
};

const OPENAI_PRICING: Record<string, ModelPricing> = {
  // GPT-4o
  "gpt-4o": { input: 2.5, output: 10, cached_input: 1.25 },
  "gpt-4o-2024-11-20": { input: 2.5, output: 10, cached_input: 1.25 },
  "gpt-4o-2024-08-06": { input: 2.5, output: 10, cached_input: 1.25 },
  "gpt-4o-2024-05-13": { input: 5, output: 15 },
  // GPT-4o mini
  "gpt-4o-mini": { input: 0.15, output: 0.6, cached_input: 0.075 },
  "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6, cached_input: 0.075 },
  // GPT-4 Turbo
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4-turbo-2024-04-09": { input: 10, output: 30 },
  // GPT-4
  "gpt-4": { input: 30, output: 60 },
  "gpt-4-0613": { input: 30, output: 60 },
  // GPT-3.5 Turbo
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "gpt-3.5-turbo-0125": { input: 0.5, output: 1.5 },
  // o1 models
  "o1": { input: 15, output: 60, cached_input: 7.5 },
  "o1-2024-12-17": { input: 15, output: 60, cached_input: 7.5 },
  "o1-preview": { input: 15, output: 60 },
  "o1-mini": { input: 3, output: 12, cached_input: 1.5 },
  "o1-mini-2024-09-12": { input: 3, output: 12 },
  // o3-mini
  "o3-mini": { input: 1.1, output: 4.4, cached_input: 0.55 },
  "o3-mini-2025-01-31": { input: 1.1, output: 4.4, cached_input: 0.55 },
};

const GOOGLE_PRICING: Record<string, ModelPricing> = {
  // Gemini 2.0 Flash
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-exp": { input: 0, output: 0 }, // Free tier
  // Gemini 1.5 Pro
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-pro-latest": { input: 1.25, output: 5 },
  // Gemini 1.5 Flash
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "gemini-1.5-flash-latest": { input: 0.075, output: 0.3 },
  // Gemini 1.0 Pro
  "gemini-1.0-pro": { input: 0.5, output: 1.5 },
};

export const PRICING_BY_PROVIDER: Record<Provider, Record<string, ModelPricing>> = {
  anthropic: ANTHROPIC_PRICING,
  openai: OPENAI_PRICING,
  google: GOOGLE_PRICING,
};

// Flat lookup used by legacy callers (model id → pricing, no provider hint).
// Order matters for conflict resolution: anthropic shadows openai shadows google,
// but in practice the keys are disjoint.
export const FLAT_PRICING: Record<string, ModelPricing> = {
  ...GOOGLE_PRICING,
  ...OPENAI_PRICING,
  ...ANTHROPIC_PRICING,
};

// Default pricing for unknown models (conservative estimate).
export const DEFAULT_PRICING: ModelPricing = { input: 3, output: 15 };

const ANTHROPIC_PREFIXES = ["claude", "anthropic"];
const GOOGLE_PREFIXES = ["gemini", "google"];

export function detectProvider(model: string): Provider {
  const m = model.toLowerCase();
  if (ANTHROPIC_PREFIXES.some((p) => m.startsWith(p))) return "anthropic";
  if (GOOGLE_PREFIXES.some((p) => m.startsWith(p))) return "google";
  return "openai";
}

export function getModelPricing(
  provider: Provider,
  model: string
): ModelPricing {
  const providerPricing = PRICING_BY_PROVIDER[provider];
  return providerPricing[model] ?? DEFAULT_PRICING;
}

export function getModelPricingByName(model: string): ModelPricing {
  return FLAT_PRICING[model] ?? DEFAULT_PRICING;
}

export function calculateCost(
  provider: Provider,
  model: string,
  tokensIn: number,
  tokensOut: number,
  tokensCached: number = 0
): number {
  const pricing = getModelPricing(provider, model);
  const nonCachedInput = Math.max(0, tokensIn - tokensCached);
  const inputCost = (nonCachedInput / 1_000_000) * pricing.input;
  const cachedCost =
    (tokensCached / 1_000_000) * (pricing.cached_input ?? pricing.input);
  const outputCost = (tokensOut / 1_000_000) * pricing.output;
  return inputCost + cachedCost + outputCost;
}

export function estimateCost(
  tokens: number,
  model: string,
  type: "input" | "output" = "input"
): number {
  // Legacy single-arg-by-name lookup. Falls back to gpt-4o for unknown models
  // (the historical default before pricing was split per provider).
  const pricing = FLAT_PRICING[model] ?? FLAT_PRICING["gpt-4o"];
  const rate = type === "input" ? pricing.input : pricing.output;
  return (tokens / 1_000_000) * rate;
}

export function formatCost(costUsd: number): string {
  if (!Number.isFinite(costUsd)) return "$0.00";
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(4)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens)) return "0";
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return Math.trunc(tokens).toString();
}

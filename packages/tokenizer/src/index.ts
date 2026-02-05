/**
 * @prune/tokenizer
 * Local token counting for OpenAI and Anthropic models
 *
 * No API calls required. All counting happens locally.
 * Uses pure JavaScript tokenizers (no WASM) for VS Code compatibility.
 */

import { encode, decode } from "gpt-tokenizer";
import {
  MODEL_PRICING,
  estimateCost as sharedEstimateCost,
  formatTokens,
  formatCost,
  type ModelPricing
} from "@prune/shared";

// ============================================================================
// Types
// ============================================================================

export interface TokenCount {
  tokens: number;
  model: string;
  cost: number;
}

export interface BatchTokenCount {
  files: Array<{
    path: string;
    tokens: number;
    cost: number;
  }>;
  total: {
    tokens: number;
    cost: number;
  };
  model: string;
}

type Provider = "openai" | "anthropic";

// ============================================================================
// Model Detection
// ============================================================================

const ANTHROPIC_MODELS = new Set([
  "claude-opus-4",
  "claude-sonnet-4",
  "claude-haiku-3.5",
  "claude-3-opus",
  "claude-3-sonnet",
  "claude-3-haiku",
  "claude-3-5-sonnet",
  "claude-3-5-haiku",
]);

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Detect provider from model name
 */
export function detectProvider(model: string): Provider {
  if (ANTHROPIC_MODELS.has(model) || model.startsWith("claude")) {
    return "anthropic";
  }
  return "openai";
}

/**
 * Count tokens in text for a specific model
 * Uses gpt-tokenizer (pure JS, no WASM) for OpenAI models
 * Uses character-based estimation for Claude (close approximation)
 */
export function countTokens(text: string, model: string = "gpt-4o"): TokenCount {
  const provider = detectProvider(model);
  let tokens: number;

  if (provider === "anthropic") {
    // Claude uses a similar tokenizer to GPT-4
    // This gives a close approximation
    tokens = encode(text).length;
  } else {
    // OpenAI models - use gpt-tokenizer
    tokens = encode(text).length;
  }

  const cost = sharedEstimateCost(tokens, model, "input");

  return {
    tokens,
    model,
    cost,
  };
}

/**
 * Async version (for API compatibility, but runs synchronously)
 */
export async function countTokensAsync(text: string, model: string = "gpt-4o"): Promise<TokenCount> {
  return countTokens(text, model);
}

/**
 * Initialize tokenizers (no-op for pure JS implementation)
 */
export async function init(): Promise<void> {
  // Pure JS tokenizer - no initialization needed
  return Promise.resolve();
}

/**
 * Check if tokenizers are ready (always true for pure JS)
 */
export function isReady(): boolean {
  return true;
}

/**
 * Count tokens for multiple files
 */
export function countTokensBatch(
  files: Array<{ path: string; content: string }>,
  model: string = "gpt-4o"
): BatchTokenCount {
  const results = files.map(({ path, content }) => {
    const { tokens, cost } = countTokens(content, model);
    return { path, tokens, cost };
  });

  const total = results.reduce(
    (acc, file) => ({
      tokens: acc.tokens + file.tokens,
      cost: acc.cost + file.cost,
    }),
    { tokens: 0, cost: 0 }
  );

  return {
    files: results,
    total,
    model,
  };
}

/**
 * Estimate cost for a given token count
 */
export function estimateCost(
  tokens: number,
  model: string,
  type: "input" | "output" = "input"
): number {
  return sharedEstimateCost(tokens, model, type);
}

/**
 * Get pricing for a model
 */
export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? MODEL_PRICING["gpt-4o"];
}

/**
 * Quick check: is this content "large" (>threshold tokens)?
 */
export function isLargeContext(
  text: string,
  model: string = "gpt-4o",
  threshold: number = 10000
): boolean {
  const { tokens } = countTokens(text, model);
  return tokens > threshold;
}

/**
 * Analyze content and provide recommendation
 */
export function analyzeContent(
  text: string,
  model: string = "gpt-4o",
  threshold: number = 10000
): {
  tokens: number;
  cost: number;
  isLarge: boolean;
  recommendation: "proceed" | "squeeze" | "abort";
  formatted: {
    tokens: string;
    cost: string;
  };
} {
  const { tokens, cost } = countTokens(text, model);
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
    formatted: {
      tokens: formatTokens(tokens),
      cost: formatCost(cost),
    },
  };
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Cleanup (no-op for pure JS implementation)
 */
export function cleanup(): void {
  // Nothing to clean up with pure JS tokenizer
}

// Re-export utilities
export { formatTokens, formatCost, MODEL_PRICING };

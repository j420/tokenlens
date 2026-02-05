/**
 * @prune/tokenizer
 * Local token counting for OpenAI and Anthropic models
 * 
 * No API calls required. All counting happens locally.
 */

import { encoding_for_model, Tiktoken, TiktokenModel } from "tiktoken";
import { countTokens as countAnthropicTokens } from "@anthropic-ai/tokenizer";
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
// Model Mappings
// ============================================================================

const TIKTOKEN_MODEL_MAP: Record<string, TiktokenModel> = {
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini", 
  "gpt-4-turbo": "gpt-4-turbo",
  "gpt-4": "gpt-4",
  "gpt-3.5-turbo": "gpt-3.5-turbo",
  "o1": "o1-preview",
  "o1-mini": "o1-mini",
  "o3-mini": "gpt-4o", // Use gpt-4o encoding as fallback
};

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
// Encoder Cache (for performance)
// ============================================================================

const encoderCache = new Map<string, Tiktoken>();

function getEncoder(model: string): Tiktoken {
  const tiktokenModel = TIKTOKEN_MODEL_MAP[model] || "gpt-4o";
  
  if (!encoderCache.has(tiktokenModel)) {
    encoderCache.set(tiktokenModel, encoding_for_model(tiktokenModel));
  }
  
  return encoderCache.get(tiktokenModel)!;
}

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
 */
export function countTokens(text: string, model: string = "gpt-4o"): TokenCount {
  const provider = detectProvider(model);
  let tokens: number;

  if (provider === "anthropic") {
    tokens = countAnthropicTokens(text);
  } else {
    const encoder = getEncoder(model);
    tokens = encoder.encode(text).length;
  }

  const cost = sharedEstimateCost(tokens, model, "input");

  return {
    tokens,
    model,
    cost,
  };
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
 * Free all cached encoders (call on extension deactivation)
 */
export function cleanup(): void {
  for (const encoder of encoderCache.values()) {
    encoder.free();
  }
  encoderCache.clear();
}

// Re-export utilities
export { formatTokens, formatCost, MODEL_PRICING };

/**
 * @prune/tokenizer
 * Local token counting for OpenAI and Anthropic models
 *
 * No API calls required. All counting happens locally.
 * Uses lazy loading to prevent blocking extension activation.
 */

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

// Lazy-loaded module types
type TiktokenModule = typeof import("tiktoken");
type AnthropicTokenizerModule = typeof import("@anthropic-ai/tokenizer");
type Tiktoken = import("tiktoken").Tiktoken;
type TiktokenModel = import("tiktoken").TiktokenModel;

// ============================================================================
// Lazy Loading State
// ============================================================================

let tiktokenModule: TiktokenModule | null = null;
let anthropicModule: AnthropicTokenizerModule | null = null;
let tiktokenLoading: Promise<TiktokenModule> | null = null;
let anthropicLoading: Promise<AnthropicTokenizerModule> | null = null;

async function loadTiktoken(): Promise<TiktokenModule> {
  if (tiktokenModule) return tiktokenModule;
  if (tiktokenLoading) return tiktokenLoading;

  tiktokenLoading = import("tiktoken").then(mod => {
    tiktokenModule = mod;
    return mod;
  });

  return tiktokenLoading;
}

async function loadAnthropicTokenizer(): Promise<AnthropicTokenizerModule> {
  if (anthropicModule) return anthropicModule;
  if (anthropicLoading) return anthropicLoading;

  anthropicLoading = import("@anthropic-ai/tokenizer").then(mod => {
    anthropicModule = mod;
    return mod;
  });

  return anthropicLoading;
}

// ============================================================================
// Model Mappings
// ============================================================================

const TIKTOKEN_MODEL_MAP: Record<string, string> = {
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

async function getEncoder(model: string): Promise<Tiktoken> {
  const tiktoken = await loadTiktoken();
  const tiktokenModel = TIKTOKEN_MODEL_MAP[model] || "gpt-4o";

  if (!encoderCache.has(tiktokenModel)) {
    encoderCache.set(tiktokenModel, tiktoken.encoding_for_model(tiktokenModel as TiktokenModel));
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
 * Count tokens in text for a specific model (async version)
 */
export async function countTokensAsync(text: string, model: string = "gpt-4o"): Promise<TokenCount> {
  const provider = detectProvider(model);
  let tokens: number;

  if (provider === "anthropic") {
    const anthropic = await loadAnthropicTokenizer();
    tokens = anthropic.countTokens(text);
  } else {
    const encoder = await getEncoder(model);
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
 * Count tokens in text for a specific model (sync version - requires init first)
 */
export function countTokens(text: string, model: string = "gpt-4o"): TokenCount {
  const provider = detectProvider(model);
  let tokens: number;

  if (provider === "anthropic") {
    if (!anthropicModule) {
      // Fallback: rough estimate if not loaded yet
      tokens = Math.ceil(text.length / 4);
    } else {
      tokens = anthropicModule.countTokens(text);
    }
  } else {
    if (!tiktokenModule) {
      // Fallback: rough estimate if not loaded yet
      tokens = Math.ceil(text.length / 4);
    } else {
      const tiktokenModel = TIKTOKEN_MODEL_MAP[model] || "gpt-4o";
      if (!encoderCache.has(tiktokenModel)) {
        encoderCache.set(tiktokenModel, tiktokenModule.encoding_for_model(tiktokenModel as TiktokenModel));
      }
      const encoder = encoderCache.get(tiktokenModel)!;
      tokens = encoder.encode(text).length;
    }
  }

  const cost = sharedEstimateCost(tokens, model, "input");

  return {
    tokens,
    model,
    cost,
  };
}

/**
 * Initialize tokenizers (call this early, non-blocking)
 */
export async function init(): Promise<void> {
  await Promise.all([
    loadTiktoken(),
    loadAnthropicTokenizer(),
  ]);
}

/**
 * Check if tokenizers are loaded
 */
export function isReady(): boolean {
  return tiktokenModule !== null && anthropicModule !== null;
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

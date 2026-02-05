/**
 * @prune/shared
 * Shared types and utilities for Prune
 */

// ============================================================================
// Model Types
// ============================================================================

export type Provider = "openai" | "anthropic" | "google";

export type OpenAIModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4-turbo"
  | "o1"
  | "o1-mini"
  | "o3-mini";

export type AnthropicModel =
  | "claude-opus-4"
  | "claude-sonnet-4"
  | "claude-haiku-3.5"
  | "claude-3-opus"
  | "claude-3-sonnet"
  | "claude-3-haiku";

export type Model = OpenAIModel | AnthropicModel;

// ============================================================================
// Pricing (per 1M tokens)
// ============================================================================

export interface ModelPricing {
  input: number;
  output: number;
  cached?: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
  "o1": { input: 15.0, output: 60.0 },
  "o1-mini": { input: 3.0, output: 12.0 },
  "o3-mini": { input: 1.1, output: 4.4 },

  // Anthropic
  "claude-opus-4": { input: 15.0, output: 75.0 },
  "claude-sonnet-4": { input: 3.0, output: 15.0 },
  "claude-haiku-3.5": { input: 0.8, output: 4.0 },
  "claude-3-opus": { input: 15.0, output: 75.0 },
  "claude-3-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
};

// ============================================================================
// Squeeze Types
// ============================================================================

export type SqueezeTier = "lossless" | "structural" | "telegraphic";

export interface SqueezeResult {
  originalCode: string;
  compressedCode: string;
  originalTokens: number;
  compressedTokens: number;
  savings: number;
  savingsPercent: number;
  diffSummary: string;
  isValid: boolean;
}

export interface SqueezeOptions {
  tier: SqueezeTier;
  preserveTodos?: boolean;
  preserveTypeHints?: boolean;
  activeFile?: string;
}

// ============================================================================
// Token Analysis Types
// ============================================================================

export interface TokenAnalysis {
  totalTokens: number;
  estimatedCost: number;
  model: string;
  files: FileTokenInfo[];
  recommendation: "proceed" | "squeeze" | "abort";
  bloatWarnings: string[];
}

export interface FileTokenInfo {
  path: string;
  tokens: number;
  percentage: number;
}

// ============================================================================
// Usage Types (from Cursor state)
// ============================================================================

export interface CursorUsage {
  requestsRemaining: number;
  requestsUsed: number;
  requestsLimit: number;
  resetDate: Date;
  plan: "free" | "pro" | "business";
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface PruneConfig {
  defaultTier: SqueezeTier;
  autoSqueezeThreshold: number;
  showStatusBar: boolean;
  showPreflightWarnings: boolean;
  preserveTodos: boolean;
  preserveTypeHints: boolean;
}

export const DEFAULT_CONFIG: PruneConfig = {
  defaultTier: "structural",
  autoSqueezeThreshold: 10000,
  showStatusBar: true,
  showPreflightWarnings: true,
  preserveTodos: true,
  preserveTypeHints: true,
};

// ============================================================================
// Language Support
// ============================================================================

export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "cpp"
  | "c";

export const LANGUAGE_EXTENSIONS: Record<string, SupportedLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".c": "c",
  ".h": "c",
};

// ============================================================================
// Utility Functions
// ============================================================================

export function estimateCost(
  tokens: number,
  model: string,
  type: "input" | "output" = "input"
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["gpt-4o"];
  const rate = type === "input" ? pricing.input : pricing.output;
  return (tokens / 1_000_000) * rate;
}

export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return "$" + (cost * 100).toFixed(2) + "c";
  }
  return "$" + cost.toFixed(2);
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return (tokens / 1_000_000).toFixed(1) + "M";
  }
  if (tokens >= 1_000) {
    return (tokens / 1_000).toFixed(1) + "K";
  }
  return tokens.toString();
}

export function getLanguageFromPath(filePath: string): SupportedLanguage | null {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return LANGUAGE_EXTENSIONS[ext] ?? null;
}

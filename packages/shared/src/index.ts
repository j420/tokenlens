/**
 * @prune/shared
 * Shared types and utilities for Prune.
 *
 * Pricing and cost math live in ./pricing.ts (single source of truth).
 * Event schemas live in ./schemas/event.ts.
 */

// ============================================================================
// Re-exports
// ============================================================================

export * from "./pricing.js";
export * from "./schemas/event.js";
export * from "./feature-flags.js";

// Convenience re-export: a flat model→pricing map for legacy call sites.
// New code should prefer getModelPricing(provider, model).
export { FLAT_PRICING as MODEL_PRICING } from "./pricing.js";

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
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
};

export function getLanguageFromPath(filePath: string): SupportedLanguage | null {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return LANGUAGE_EXTENSIONS[ext] ?? null;
}

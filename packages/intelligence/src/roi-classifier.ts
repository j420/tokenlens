/**
 * ROI (Return on Investment) Classifier
 *
 * Classifies tokens as productive or recursive by analyzing:
 * - Productive signals: code appears in file writes, tests pass, errors resolved
 * - Recursive signals: >80% similarity to previous turn, same error without progress
 *
 * ROI Score = productive_tokens / total_tokens
 */

import { estimateTokenCount } from "./tokenizer.js";

// Model pricing table ($ per 1M tokens input / output)
export const MODEL_PRICING: Record<
  string,
  { input: number; output: number; provider: string }
> = {
  // Anthropic
  "claude-opus-4-5-20251101": { input: 15, output: 75, provider: "anthropic" },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, provider: "anthropic" },
  "claude-sonnet-4-20250514": { input: 3, output: 15, provider: "anthropic" },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15, provider: "anthropic" },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4, provider: "anthropic" },
  "claude-3-opus-20240229": { input: 15, output: 75, provider: "anthropic" },
  "claude-3-sonnet-20240229": { input: 3, output: 15, provider: "anthropic" },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25, provider: "anthropic" },

  // OpenAI
  "gpt-4o": { input: 2.5, output: 10, provider: "openai" },
  "gpt-4o-mini": { input: 0.15, output: 0.6, provider: "openai" },
  "gpt-4-turbo": { input: 10, output: 30, provider: "openai" },
  "gpt-4": { input: 30, output: 60, provider: "openai" },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5, provider: "openai" },
  "o1-preview": { input: 15, output: 60, provider: "openai" },
  "o1-mini": { input: 3, output: 12, provider: "openai" },

  // Google
  "gemini-1.5-pro": { input: 1.25, output: 5, provider: "google" },
  "gemini-1.5-flash": { input: 0.075, output: 0.3, provider: "google" },
  "gemini-2.0-flash": { input: 0.1, output: 0.4, provider: "google" },
};

// Cheaper model suggestions for each model tier
export const CHEAPER_MODEL_SUGGESTIONS: Record<
  string,
  { model: string; savingsPercent: number }
> = {
  // High-end models → mid-tier
  "claude-opus-4-5-20251101": { model: "claude-sonnet-4-5-20250929", savingsPercent: 80 },
  "claude-3-opus-20240229": { model: "claude-3-5-sonnet-20241022", savingsPercent: 80 },
  "gpt-4": { model: "gpt-4o", savingsPercent: 92 },
  "gpt-4-turbo": { model: "gpt-4o", savingsPercent: 75 },
  "o1-preview": { model: "o1-mini", savingsPercent: 80 },

  // Mid-tier models → budget tier
  "claude-sonnet-4-5-20250929": { model: "claude-3-5-haiku-20241022", savingsPercent: 73 },
  "claude-sonnet-4-20250514": { model: "claude-3-5-haiku-20241022", savingsPercent: 73 },
  "claude-3-5-sonnet-20241022": { model: "claude-3-5-haiku-20241022", savingsPercent: 73 },
  "claude-3-sonnet-20240229": { model: "claude-3-haiku-20240307", savingsPercent: 92 },
  "gpt-4o": { model: "gpt-4o-mini", savingsPercent: 94 },
  "gemini-1.5-pro": { model: "gemini-1.5-flash", savingsPercent: 94 },
};

export interface TurnData {
  turnNumber: number;
  responseContent: string;
  filesWritten: string[];
  filesRead: string[];
  testsPassed: boolean | null;
  errorsPresent: string[];
  tokensIn: number;
  tokensOut: number;
  timestamp: Date;
}

export interface ROIAnalysis {
  turnNumber: number;
  classification: "productive" | "recursive" | "unknown";
  roiScore: number; // 0-1
  productiveTokens: number;
  recursiveTokens: number;
  signals: {
    productive: string[];
    recursive: string[];
  };
}

export interface SessionROI {
  cumulativeRoiScore: number;
  totalProductiveTokens: number;
  totalRecursiveTokens: number;
  totalTokens: number;
  consecutiveLowRoiTurns: number;
  lowRoiStreak: TurnData[];
}

/**
 * Calculate Jaccard similarity between two strings (based on word tokens)
 */
function jaccardSimilarity(str1: string, str2: string): number {
  const tokens1 = new Set(
    str1
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2)
  );
  const tokens2 = new Set(
    str2
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2)
  );

  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  const intersection = new Set([...tokens1].filter((t) => tokens2.has(t)));
  const union = new Set([...tokens1, ...tokens2]);

  return intersection.size / union.size;
}

/**
 * Calculate line-based diff similarity (for code comparison)
 */
function lineSimilarity(str1: string, str2: string): number {
  const lines1 = str1.split("\n").filter((l) => l.trim().length > 0);
  const lines2 = str2.split("\n").filter((l) => l.trim().length > 0);

  if (lines1.length === 0 || lines2.length === 0) return 0;

  const set1 = new Set(lines1.map((l) => l.trim()));
  const set2 = new Set(lines2.map((l) => l.trim()));

  const intersection = [...set1].filter((l) => set2.has(l)).length;
  const union = new Set([...set1, ...set2]).size;

  return intersection / union;
}

/**
 * Calculate combined similarity score between two responses
 */
export function calculateSimilarity(response1: string, response2: string): number {
  const jaccard = jaccardSimilarity(response1, response2);
  const lines = lineSimilarity(response1, response2);

  // Weight line similarity higher for code
  return jaccard * 0.3 + lines * 0.7;
}

/**
 * Extract error patterns from response content
 */
function extractErrors(content: string): string[] {
  const errors: string[] = [];

  // Common error patterns
  const errorPatterns = [
    /error:\s*(.+?)(?:\n|$)/gi,
    /Error:\s*(.+?)(?:\n|$)/gi,
    /failed:\s*(.+?)(?:\n|$)/gi,
    /Failed:\s*(.+?)(?:\n|$)/gi,
    /exception:\s*(.+?)(?:\n|$)/gi,
    /Exception:\s*(.+?)(?:\n|$)/gi,
    /TypeError:\s*(.+?)(?:\n|$)/gi,
    /SyntaxError:\s*(.+?)(?:\n|$)/gi,
    /ReferenceError:\s*(.+?)(?:\n|$)/gi,
    /assertion\s+failed/gi,
    /test\s+failed/gi,
  ];

  for (const pattern of errorPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const error = match[1]?.trim() || match[0].trim();
      if (error && !errors.includes(error)) {
        errors.push(error);
      }
    }
  }

  return errors;
}

/**
 * Check if an error was resolved between turns
 */
function isErrorResolved(previousErrors: string[], currentErrors: string[]): boolean {
  if (previousErrors.length === 0) return false;

  // Check if any previous errors are no longer present
  for (const prevError of previousErrors) {
    const stillPresent = currentErrors.some(
      (curr) => calculateSimilarity(prevError, curr) > 0.7
    );
    if (!stillPresent) return true;
  }

  return false;
}

/**
 * Classify a single turn's ROI
 */
export function classifyTurnROI(
  currentTurn: TurnData,
  previousTurns: TurnData[]
): ROIAnalysis {
  const signals = {
    productive: [] as string[],
    recursive: [] as string[],
  };

  const totalTokens = currentTurn.tokensIn + currentTurn.tokensOut;
  let productiveTokens = 0;
  let recursiveTokens = 0;

  // Get previous turn for comparison
  const previousTurn = previousTurns.length > 0 ? previousTurns[previousTurns.length - 1] : null;

  // === PRODUCTIVE SIGNALS ===

  // Signal 1: Files written (code appears in file write)
  if (currentTurn.filesWritten.length > 0) {
    signals.productive.push(`Files written: ${currentTurn.filesWritten.join(", ")}`);
    productiveTokens += totalTokens * 0.4; // 40% weight for file writes
  }

  // Signal 2: Tests passed
  if (currentTurn.testsPassed === true) {
    signals.productive.push("Tests passed");
    productiveTokens += totalTokens * 0.3; // 30% weight for passing tests
  }

  // Signal 3: Error resolved from previous turn
  if (previousTurn) {
    const previousErrors = extractErrors(previousTurn.responseContent);
    const currentErrors = extractErrors(currentTurn.responseContent);
    if (isErrorResolved(previousErrors, currentErrors)) {
      signals.productive.push("Error resolved from previous turn");
      productiveTokens += totalTokens * 0.3; // 30% weight for resolving errors
    }
  }

  // === RECURSIVE SIGNALS ===

  if (previousTurn) {
    // Signal 1: High similarity to previous response (>80%)
    const similarity = calculateSimilarity(
      currentTurn.responseContent,
      previousTurn.responseContent
    );

    if (similarity > 0.8) {
      signals.recursive.push(`${Math.round(similarity * 100)}% similar to previous turn`);
      recursiveTokens += totalTokens * 0.5; // 50% weight for high similarity
    }

    // Signal 2: Same file targeted without progress
    const sameFilesWritten = currentTurn.filesWritten.filter((f) =>
      previousTurn.filesWritten.includes(f)
    );
    if (sameFilesWritten.length > 0 && similarity > 0.5) {
      signals.recursive.push(
        `Same files targeted: ${sameFilesWritten.join(", ")}`
      );
      recursiveTokens += totalTokens * 0.3;
    }

    // Signal 3: Same error without resolution
    const previousErrors = extractErrors(previousTurn.responseContent);
    const currentErrors = extractErrors(currentTurn.responseContent);
    const sameErrors = currentErrors.filter((curr) =>
      previousErrors.some((prev) => calculateSimilarity(prev, curr) > 0.7)
    );
    if (sameErrors.length > 0) {
      signals.recursive.push("Same errors present without resolution");
      recursiveTokens += totalTokens * 0.2;
    }
  }

  // Signal 4: Redundant file reads (same files read multiple times in session)
  const recentReads = previousTurns.flatMap((t) => t.filesRead);
  const redundantReads = currentTurn.filesRead.filter((f) =>
    recentReads.filter((r) => r === f).length >= 2
  );
  if (redundantReads.length > 0) {
    signals.recursive.push(`Redundant reads: ${redundantReads.join(", ")}`);
    recursiveTokens += estimateTokenCount(redundantReads.join("\n"), true);
  }

  // Cap at total tokens
  productiveTokens = Math.min(productiveTokens, totalTokens);
  recursiveTokens = Math.min(recursiveTokens, totalTokens);

  // Ensure they don't overlap
  if (productiveTokens + recursiveTokens > totalTokens) {
    const ratio = totalTokens / (productiveTokens + recursiveTokens);
    productiveTokens = Math.floor(productiveTokens * ratio);
    recursiveTokens = Math.floor(recursiveTokens * ratio);
  }

  // Calculate ROI score
  const roiScore =
    totalTokens > 0
      ? Math.max(0, Math.min(1, productiveTokens / totalTokens))
      : 0;

  // Determine classification
  let classification: "productive" | "recursive" | "unknown" = "unknown";
  if (roiScore >= 0.5) {
    classification = "productive";
  } else if (recursiveTokens > productiveTokens) {
    classification = "recursive";
  }

  return {
    turnNumber: currentTurn.turnNumber,
    classification,
    roiScore,
    productiveTokens,
    recursiveTokens,
    signals,
  };
}

/**
 * Update cumulative session ROI after a turn
 */
export function updateSessionROI(
  sessionROI: SessionROI,
  turnAnalysis: ROIAnalysis,
  turnData: TurnData
): SessionROI {
  const turnTokens = turnData.tokensIn + turnData.tokensOut;

  const newTotalProductiveTokens =
    sessionROI.totalProductiveTokens + turnAnalysis.productiveTokens;
  const newTotalRecursiveTokens =
    sessionROI.totalRecursiveTokens + turnAnalysis.recursiveTokens;
  const newTotalTokens = sessionROI.totalTokens + turnTokens;

  const newCumulativeRoiScore =
    newTotalTokens > 0 ? newTotalProductiveTokens / newTotalTokens : 0;

  // Track consecutive low ROI turns (< 30%)
  let consecutiveLowRoiTurns = sessionROI.consecutiveLowRoiTurns;
  let lowRoiStreak = [...sessionROI.lowRoiStreak];

  if (turnAnalysis.roiScore < 0.3) {
    consecutiveLowRoiTurns++;
    lowRoiStreak.push(turnData);
  } else {
    consecutiveLowRoiTurns = 0;
    lowRoiStreak = [];
  }

  return {
    cumulativeRoiScore: newCumulativeRoiScore,
    totalProductiveTokens: newTotalProductiveTokens,
    totalRecursiveTokens: newTotalRecursiveTokens,
    totalTokens: newTotalTokens,
    consecutiveLowRoiTurns,
    lowRoiStreak,
  };
}

/**
 * Get model routing suggestion for low ROI situations
 */
export function getModelRoutingSuggestion(
  currentModel: string,
  consecutiveLowRoiTurns: number
): {
  shouldSuggest: boolean;
  suggestedModel: string | null;
  savingsPercent: number;
  message: string;
} | null {
  // Only suggest after 3+ consecutive low ROI turns
  if (consecutiveLowRoiTurns < 3) {
    return null;
  }

  const suggestion = CHEAPER_MODEL_SUGGESTIONS[currentModel];
  if (!suggestion) {
    // No cheaper model available
    return {
      shouldSuggest: true,
      suggestedModel: null,
      savingsPercent: 0,
      message:
        "Consider rephrasing your prompt or breaking the task into smaller pieces.",
    };
  }

  return {
    shouldSuggest: true,
    suggestedModel: suggestion.model,
    savingsPercent: suggestion.savingsPercent,
    message: `Consider switching to ${suggestion.model} — similar tasks show equivalent results at ${suggestion.savingsPercent}% lower cost.`,
  };
}

/**
 * Initialize empty session ROI state
 */
export function createEmptySessionROI(): SessionROI {
  return {
    cumulativeRoiScore: 1, // Start optimistic
    totalProductiveTokens: 0,
    totalRecursiveTokens: 0,
    totalTokens: 0,
    consecutiveLowRoiTurns: 0,
    lowRoiStreak: [],
  };
}

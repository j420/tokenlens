/**
 * Context Analyzer - Analyzes context attached to prompts and generates prune suggestions
 */

import { estimateTokenCount, isCodeFile } from "./tokenizer.js";
import { scoreRelevance, type RelevanceScore } from "./relevance.js";

export interface CodeBlock {
  content: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  tokens: number;
  isCode: boolean;
}

export interface AnalyzedBlock extends CodeBlock {
  relevance: RelevanceScore;
}

export interface ContextAnalysis {
  totalTokens: number;
  relevantTokens: number;
  peripheralTokens: number;
  noiseTokens: number;
  blocks: AnalyzedBlock[];
  relevantRanges: Array<{ file: string; start_line: number; end_line: number }>;
  irrelevantSummary: string;
  confidence: number;
  shouldSuggestPrune: boolean;
}

export interface PruneSuggestion {
  type: "prune_suggestion";
  request_id: string;
  total_tokens: number;
  relevant_tokens: number;
  relevant_ranges: Array<{ file: string; start_line: number; end_line: number }>;
  irrelevant_summary: string;
  estimated_savings_usd: number;
  confidence: number;
  auto_dismiss_seconds: number;
}

// Cost per 1K tokens (average for Claude Sonnet 4.5)
const COST_PER_1K_TOKENS = 0.003; // $3 per million input tokens

// Configuration
const CONFIDENCE_THRESHOLD = 0.75;
const NOISE_THRESHOLD = 0.5; // Suggest prune if >50% tokens are noise
const MIN_SAVINGS_USD = 0.05; // Don't suggest for savings under $0.05
const AUTO_DISMISS_CLI = 5;
const AUTO_DISMISS_VSCODE = 8;

/**
 * Parse context into code blocks
 * Handles common formats: file attachments, code fences, etc.
 */
export function parseContextBlocks(context: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];

  // Pattern 1: File attachments like "// filename.ts\ncontent..."
  const fileAttachmentRegex = /(?:^|\n)(?:\/\/|#|--)\s*([^\n]+\.[a-zA-Z0-9]+)\s*\n([\s\S]*?)(?=(?:\n(?:\/\/|#|--)\s*[^\n]+\.[a-zA-Z0-9]+\s*\n)|$)/g;

  let lastIndex = 0;
  let match;

  while ((match = fileAttachmentRegex.exec(context)) !== null) {
    // Add any text before this match as a generic block
    if (match.index > lastIndex) {
      const beforeText = context.slice(lastIndex, match.index).trim();
      if (beforeText) {
        blocks.push({
          content: beforeText,
          tokens: estimateTokenCount(beforeText, false),
          isCode: false,
        });
      }
    }

    const filename = match[1].trim();
    const content = match[2].trim();

    if (content) {
      const isCode = isCodeFile(filename);
      // Try to detect line numbers
      const lines = content.split("\n");
      blocks.push({
        content,
        file: filename,
        startLine: 1,
        endLine: lines.length,
        tokens: estimateTokenCount(content, isCode),
        isCode,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Pattern 2: Markdown code fences
  const codeFenceRegex = /```(\w+)?(?:\s+([^\n]+))?\n([\s\S]*?)```/g;
  let contextCopy = context;

  // Reset and try code fences if no file attachments found
  if (blocks.length === 0) {
    while ((match = codeFenceRegex.exec(contextCopy)) !== null) {
      const language = match[1] || "";
      const filename = match[2]?.trim();
      const content = match[3].trim();

      if (content) {
        const isCode = language.length > 0 || (filename ? isCodeFile(filename) : false);
        blocks.push({
          content,
          file: filename,
          tokens: estimateTokenCount(content, isCode),
          isCode,
        });
      }
    }
  }

  // If still no blocks, treat the entire context as one block
  if (blocks.length === 0 && context.trim()) {
    blocks.push({
      content: context.trim(),
      tokens: estimateTokenCount(context, false),
      isCode: false,
    });
  }

  return blocks;
}

/**
 * Analyze context and generate prune analysis
 */
export function analyzeContext(prompt: string, context: string): ContextAnalysis {
  const blocks = parseContextBlocks(context);
  const analyzedBlocks: AnalyzedBlock[] = [];

  let totalTokens = 0;
  let relevantTokens = 0;
  let peripheralTokens = 0;
  let noiseTokens = 0;

  const relevantRanges: Array<{ file: string; start_line: number; end_line: number }> = [];
  const noiseDescriptions: string[] = [];

  for (const block of blocks) {
    const relevance = scoreRelevance(prompt, block.content, block.isCode);

    analyzedBlocks.push({
      ...block,
      relevance,
    });

    totalTokens += block.tokens;

    switch (relevance.category) {
      case "relevant":
        relevantTokens += block.tokens;
        if (block.file && block.startLine !== undefined && block.endLine !== undefined) {
          relevantRanges.push({
            file: block.file,
            start_line: block.startLine,
            end_line: block.endLine,
          });
        }
        break;
      case "peripheral":
        peripheralTokens += block.tokens;
        break;
      case "noise":
        noiseTokens += block.tokens;
        if (block.file) {
          noiseDescriptions.push(block.file);
        } else if (block.content.length > 50) {
          // Try to identify what the noise content is
          const preview = block.content.slice(0, 50).replace(/\s+/g, " ");
          noiseDescriptions.push(`"${preview}..."`);
        }
        break;
    }
  }

  // Calculate confidence based on consistency of scores
  const scores = analyzedBlocks.map((b) => b.relevance.score);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance =
    scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length;

  // Higher variance = more confident separation between relevant and noise
  // Lower variance with low scores = confident everything is noise
  // Lower variance with high scores = confident everything is relevant
  let confidence: number;
  if (variance > 0.1) {
    // Good separation between relevant and noise
    confidence = Math.min(0.95, 0.7 + variance);
  } else if (avgScore < 0.3) {
    // Consistently low scores - confident noise
    confidence = 0.85;
  } else if (avgScore > 0.7) {
    // Consistently high scores - confident relevant
    confidence = 0.85;
  } else {
    // Ambiguous scores
    confidence = 0.5;
  }

  // Should we suggest pruning?
  const noiseRatio = noiseTokens / totalTokens;
  const shouldSuggestPrune =
    noiseRatio > NOISE_THRESHOLD &&
    confidence >= CONFIDENCE_THRESHOLD &&
    totalTokens > 1000; // Only for substantial contexts

  // Generate irrelevant summary
  let irrelevantSummary: string;
  if (noiseDescriptions.length === 0) {
    irrelevantSummary = "various unrelated content";
  } else if (noiseDescriptions.length <= 3) {
    irrelevantSummary = noiseDescriptions.join(", ");
  } else {
    irrelevantSummary = `${noiseDescriptions.slice(0, 3).join(", ")} and ${noiseDescriptions.length - 3} other files`;
  }

  return {
    totalTokens,
    relevantTokens,
    peripheralTokens,
    noiseTokens,
    blocks: analyzedBlocks,
    relevantRanges,
    irrelevantSummary,
    confidence,
    shouldSuggestPrune,
  };
}

/**
 * Generate a prune suggestion event if analysis warrants it
 */
export function generatePruneSuggestion(
  requestId: string,
  analysis: ContextAnalysis,
  clientType: "cli" | "vscode" = "vscode"
): PruneSuggestion | null {
  if (!analysis.shouldSuggestPrune) {
    return null;
  }

  const savingsTokens = analysis.noiseTokens + analysis.peripheralTokens * 0.5;
  const estimatedSavings = (savingsTokens / 1000) * COST_PER_1K_TOKENS;

  // Don't suggest for tiny savings
  if (estimatedSavings < MIN_SAVINGS_USD) {
    return null;
  }

  return {
    type: "prune_suggestion",
    request_id: requestId,
    total_tokens: analysis.totalTokens,
    relevant_tokens: analysis.relevantTokens,
    relevant_ranges: analysis.relevantRanges,
    irrelevant_summary: analysis.irrelevantSummary,
    estimated_savings_usd: Math.round(estimatedSavings * 100) / 100,
    confidence: Math.round(analysis.confidence * 100) / 100,
    auto_dismiss_seconds: clientType === "cli" ? AUTO_DISMISS_CLI : AUTO_DISMISS_VSCODE,
  };
}

/**
 * Apply pruning to context based on analysis
 * Returns the pruned context with only relevant content
 */
export function applyPruning(context: string, analysis: ContextAnalysis): string {
  // Only keep blocks that are relevant or peripheral with high scores
  const keptBlocks = analysis.blocks.filter(
    (block) =>
      block.relevance.category === "relevant" ||
      (block.relevance.category === "peripheral" && block.relevance.score >= 0.5)
  );

  // Reconstruct context
  const prunedParts: string[] = [];

  for (const block of keptBlocks) {
    if (block.file) {
      // Add file header
      prunedParts.push(`// ${block.file}`);
    }
    prunedParts.push(block.content);
  }

  return prunedParts.join("\n\n");
}

/**
 * Quick analysis for pre-flight check
 * Returns in <50ms or null if it would take longer
 */
export async function quickAnalyze(
  prompt: string,
  context: string,
  timeoutMs = 50
): Promise<ContextAnalysis | null> {
  const start = Date.now();

  // Quick check: if context is small, don't bother
  const estimatedContextTokens = estimateTokenCount(context, true);
  if (estimatedContextTokens < 2000) {
    return null; // Not worth analyzing small contexts
  }

  // Run analysis
  const analysis = analyzeContext(prompt, context);

  // Check if we exceeded timeout
  if (Date.now() - start > timeoutMs) {
    return null; // Took too long, skip suggestion
  }

  return analysis;
}

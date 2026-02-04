// Token utilities
export {
  estimateTokenCount,
  isCodeFile,
  tokenize,
  extractCodeTerms,
} from "./tokenizer.js";

// Relevance scoring
export {
  scoreRelevance,
  scoreCodeBlocks,
  type RelevanceScore,
} from "./relevance.js";

// Context analyzer
export {
  parseContextBlocks,
  analyzeContext,
  generatePruneSuggestion,
  applyPruning,
  quickAnalyze,
  type CodeBlock,
  type AnalyzedBlock,
  type ContextAnalysis,
  type PruneSuggestion,
} from "./analyzer.js";

// ROI Classification
export {
  MODEL_PRICING,
  CHEAPER_MODEL_SUGGESTIONS,
  calculateSimilarity,
  classifyTurnROI,
  updateSessionROI,
  getModelRoutingSuggestion,
  createEmptySessionROI,
  type TurnData,
  type ROIAnalysis,
  type SessionROI,
} from "./roi-classifier.js";

// Compaction Auditor
export {
  MessageBuffer,
  extractEntities,
  createMessageSummary,
  analyzeCompaction,
  detectCompaction,
  getSessionBuffer,
  clearSessionBuffer,
  type EntityCategory,
  type TrackedEntity,
  type MessageSummary,
  type LostReference,
  type CompactionDiff,
} from "./compaction-auditor.js";

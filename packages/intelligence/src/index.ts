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

// Session Tracker (Phase 2: loop circuit-breaker)
export {
  replaySession,
  evaluateLoopBlock,
  formatLoopBlockMessage,
  type SessionROIWalk,
  type LoopBlockDecision,
  type LoopBlockOptions,
} from "./session-tracker.js";

// Cache Analyzer
export {
  computeCacheMetrics,
  diagnoseCacheBust,
  type CacheTurnInput,
  type CacheTTL,
  type CacheMetrics,
  type CacheCost,
  type CacheBustSignal,
  type CacheBustDiagnosis,
  type DiagnoseInput,
} from "./cache-analyzer.js";

// Cost Predictor
export {
  MIN_EVENTS_FOR_PREDICTION,
  setModelWeights,
  getModelWeights,
  hasEnoughDataForPrediction,
  predictCost,
  trainModel,
  formatPrediction,
  type TaskType,
  type PredictionInput,
  type PredictionResult,
  type ModelWeights,
  type TrainingDataPoint,
} from "./cost-predictor.js";

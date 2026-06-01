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
  appendToSession,
  serializeWalk,
  deserializeWalk,
  evaluateLoopBlock,
  formatLoopBlockMessage,
  type SessionROIWalk,
  type SerializedSessionROIWalk,
  type LoopBlockDecision,
  type LoopBlockOptions,
} from "./session-tracker.js";

// Cache Analyzer
export {
  computeCacheMetrics,
  diagnoseCacheBust,
  detectSilentCacheFailures,
  detectTTLPenalty,
  analyzeCacheCoPilot,
  type CacheTurnInput,
  type CacheTTL,
  type CacheMetrics,
  type CacheCost,
  type CacheBustSignal,
  type CacheBustDiagnosis,
  type DiagnoseInput,
  type SilentCacheFailure,
  type TTLPenalty,
  type CoPilotInput,
  type CacheCoPilotReport,
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

// Subagent activity + policy (Phase 5+: subagent budget enforcer)
export {
  analyzeSubagents,
  SUBAGENT_CONSTANTS,
  type SubagentWalkTurn,
  type SubagentInvocation,
  type SubagentBurst,
  type SubagentActivity,
  type AnalyzeSubagentsOptions,
} from "./subagent-walk.js";

export {
  evaluateSubagentBlock,
  formatSubagentBlockMessage,
  type SubagentBlockDecision,
  type SubagentPattern,
  type SubagentPolicyOptions,
} from "./subagent-policy.js";

// F2 — Tool-Definition Auditor (TCRP)
export {
  auditToolDefinitions,
  buildUsageWindow,
  DEFAULT_CRITICAL_ALLOWLIST,
  type ToolDefinitionInfo,
  type ToolUsageWindow,
  type ToolUtility,
  type ToolAuditEntry,
  type ToolAuditReport,
  type ToolAuditOptions,
  type SessionToolObservation,
} from "./tool-def-auditor.js";

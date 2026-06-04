/**
 * @prune/tab-auditor
 *
 * IDE Open-Tab Auditor (Phase-8 Tier-1). Editors auto-attach open tabs to the
 * AI context; many are irrelevant and silently waste tokens. This package
 * scores each open tab's relevance to the current task from structural signals
 * (active-adjacency via import-graph BFS or path distance, access recency, task
 * keyword overlap, and a size penalty) and recommends which tabs to DROP from
 * auto-context — with honest, null-aware token savings.
 *
 * Entry point: `auditOpenTabs(input, options?) => AuditReport`.
 */

export {
  auditOpenTabs,
  DEFAULT_DROP_THRESHOLD,
  type OpenTab,
  type ImportEdge,
  type AuditInput,
  type AuditOptions,
  type Recommendation,
  type TabVerdict,
  type AuditReport,
} from "./auditor.js";

// Scoring model internals — exported for transparency, tuning, and testing.
export {
  DEFAULT_WEIGHTS,
  blend,
  clamp01,
  sizeKeepSignal,
  type ScoringWeights,
  type SignalSet,
  type Signal,
} from "./scoring.js";

// Structural tokenization (regex-free) — exported so callers can preview how
// paths/keywords are split.
export {
  tokenizePath,
  tokenizeKeywords,
  pathComponents,
  jaccard,
} from "./tokenize.js";

// Graph proximity utilities.
export {
  buildAdjacency,
  bfsDistances,
  hopProximity,
  pathProximity,
} from "./graph.js";

// Derive the import graph from REAL source (via @prune/repo-map), so relevance
// reflects how the codebase is actually wired — not only caller-supplied edges.
export {
  buildImportEdges,
  type SourceFile,
} from "./graph-from-source.js";

/**
 * auditOpenTabs — the public entry point of the IDE Open-Tab Auditor.
 *
 * Given a snapshot of open editor tabs and a little task context, it scores
 * each tab's relevance to the current work and recommends which tabs should be
 * DROPPED from the AI's auto-attached context, with honest token savings.
 *
 * ── Scoring model (delegated to scoring.ts / graph.ts) ──────────────────────
 * Four structural signals, each in [0,1], blended with renormalized weights:
 *
 *   activeAdjacency  Import-graph BFS proximity to the active file when edges
 *                    are supplied (proximity = 1/2^hops, undirected); otherwise
 *                    shared-leading-path-component proximity. Graph beats path
 *                    whenever edges connect the tab to the active file.
 *   recency          Rank of lastAccessedAt across tabs that HAVE a timestamp:
 *                    newest → 1, oldest → 0, single timestamp → 1. Tabs with a
 *                    NULL timestamp get a NEUTRAL 0.5 (never fabricated).
 *   taskMatch        Jaccard overlap of the tab's structural path tokens with
 *                    the task-keyword tokens. OMITTED (→ weight renormalized
 *                    away) when no keywords are supplied.
 *   sizePenalty      A keep-priority from token count (small→1, large→0). So a
 *                    large file lowers keep-priority. OMITTED when tokenCount
 *                    is unknown — we never invent a size.
 *
 * ── Hard invariants ─────────────────────────────────────────────────────────
 *   1. The active file is ALWAYS kept (never dropped), whatever it scores.
 *   2. A dirty tab is ALWAYS kept (protect unsaved work).
 *   3. "drop" only when relevance < dropThreshold AND no invariant protects it.
 *   4. totalDroppableTokens sums ONLY known token counts of dropped tabs; a tab
 *      dropped with an unknown count contributes nothing and is surfaced via a
 *      "savings unknown" reason and the droppedWithUnknownSavings counter.
 *
 * Pure, deterministic (stable tie-break by path), bounded, never throws.
 */

import { buildAdjacency, bfsDistances, hopProximity, pathProximity } from "./graph.js";
import {
  DEFAULT_WEIGHTS,
  type ScoringWeights,
  type SignalSet,
  blend,
  clamp01,
  sizeKeepSignal,
} from "./scoring.js";
import { tokenizeKeywords, tokenizePath, jaccard } from "./tokenize.js";

export interface OpenTab {
  path: string;
  tokenCount?: number | null;
  lastAccessedAt?: string | null;
  isDirty?: boolean;
}

export interface ImportEdge {
  from: string;
  to: string;
}

export interface AuditInput {
  tabs: OpenTab[];
  activeFile: string;
  taskKeywords?: string[];
  importEdges?: ImportEdge[];
}

export type Recommendation = "keep" | "drop";

export interface TabVerdict {
  path: string;
  relevanceScore: number;
  recommendation: Recommendation;
  reasons: string[];
}

export interface AuditReport {
  tabs: TabVerdict[];
  totalDroppableTokens: number;
  droppedWithUnknownSavings: number;
  keptCount: number;
  droppedCount: number;
}

export interface AuditOptions {
  /** Override any subset of signal weights. Missing keys use defaults. */
  weights?: Partial<ScoringWeights>;
  /** Tabs with relevance strictly below this become drop candidates. */
  dropThreshold?: number;
  /** Token count treated as "medium" for the size signal curve. */
  sizeMidpoint?: number;
}

export const DEFAULT_DROP_THRESHOLD = 0.35;

/** Parse an ISO timestamp to epoch ms, or null if unparseable. No throw. */
function parseTime(ts: string | null | undefined): number | null {
  if (typeof ts !== "string" || ts.length === 0) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Compute a recency signal per tab by RANKING the known timestamps.
 * Returns a map keyed by array index (stable, handles duplicate paths).
 *
 *  - Tabs with a null/unparseable timestamp → 0.5 (neutral, not fabricated).
 *  - With ≥2 distinct known timestamps: linear rank, newest→1, oldest→0.
 *  - With exactly 1 known timestamp (or all equal): that/those → 1.
 */
function recencySignals(tabs: OpenTab[]): (number | null)[] {
  const times: (number | null)[] = tabs.map((t) => parseTime(t?.lastAccessedAt));
  const known = times.filter((t): t is number => t !== null);
  if (known.length === 0) {
    // No temporal info at all → omit the signal entirely (null).
    return times.map(() => null);
  }
  let min = known[0];
  let max = known[0];
  for (const v of known) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  return times.map((t) => {
    if (t === null) return 0.5; // neutral for unknown
    if (span === 0) return 1; // all known equal (or single) → most recent
    return (t - min) / span; // newest → 1, oldest → 0
  });
}

/**
 * Active-adjacency signal for a tab. Graph BFS proximity when the active file
 * is in the graph AND the tab is reachable from it; otherwise path proximity.
 * Returns the score plus a tag for the reasons string.
 */
function adjacencySignal(
  activeFile: string,
  tabPath: string,
  graphDist: Map<string, number> | null,
): { value: number; via: "graph" | "path" } {
  if (graphDist && graphDist.has(tabPath)) {
    return { value: hopProximity(graphDist.get(tabPath)!), via: "graph" };
  }
  return { value: pathProximity(activeFile, tabPath), via: "path" };
}

function resolveWeights(override?: Partial<ScoringWeights>): ScoringWeights {
  if (!override) return { ...DEFAULT_WEIGHTS };
  return {
    activeAdjacency:
      typeof override.activeAdjacency === "number"
        ? override.activeAdjacency
        : DEFAULT_WEIGHTS.activeAdjacency,
    recency:
      typeof override.recency === "number"
        ? override.recency
        : DEFAULT_WEIGHTS.recency,
    taskMatch:
      typeof override.taskMatch === "number"
        ? override.taskMatch
        : DEFAULT_WEIGHTS.taskMatch,
    sizePenalty:
      typeof override.sizePenalty === "number"
        ? override.sizePenalty
        : DEFAULT_WEIGHTS.sizePenalty,
  };
}

export function auditOpenTabs(
  input: AuditInput,
  options: AuditOptions = {},
): AuditReport {
  // ── Defensive normalization (never throw on garbage) ─────────────────────
  const safeInput: AuditInput =
    input && typeof input === "object" ? input : ({} as AuditInput);
  const tabs: OpenTab[] = Array.isArray(safeInput.tabs)
    ? safeInput.tabs.filter(
        (t): t is OpenTab => !!t && typeof t.path === "string",
      )
    : [];
  const activeFile =
    typeof safeInput.activeFile === "string" ? safeInput.activeFile : "";
  const taskKeywords: string[] = Array.isArray(safeInput.taskKeywords)
    ? safeInput.taskKeywords.filter((k): k is string => typeof k === "string")
    : [];
  const importEdges = Array.isArray(safeInput.importEdges)
    ? safeInput.importEdges
    : undefined;

  const weights = resolveWeights(options.weights);
  const dropThreshold =
    typeof options.dropThreshold === "number" &&
    Number.isFinite(options.dropThreshold)
      ? options.dropThreshold
      : DEFAULT_DROP_THRESHOLD;
  const sizeMidpoint =
    typeof options.sizeMidpoint === "number" && options.sizeMidpoint > 0
      ? options.sizeMidpoint
      : 2000;

  // ── Precompute shared structures ─────────────────────────────────────────
  const keywordTokens = tokenizeKeywords(taskKeywords);
  const hasKeywords = keywordTokens.size > 0;

  let graphDist: Map<string, number> | null = null;
  if (importEdges && importEdges.length > 0) {
    const adj = buildAdjacency(importEdges);
    graphDist = bfsDistances(adj, activeFile);
  }

  const recency = recencySignals(tabs);

  // ── Score each tab ───────────────────────────────────────────────────────
  // We keep the verdict paired with its originating tab so aggregation reads
  // the EXACT token count of each dropped tab — correct even when two tabs
  // share a path but report different counts.
  const scored = tabs.map((tab, i): { verdict: TabVerdict; tab: OpenTab } => {
    const reasons: string[] = [];
    const isActive = tab.path === activeFile;
    const isDirty = tab.isDirty === true;

    // Signals
    const adj = adjacencySignal(activeFile, tab.path, graphDist);
    reasons.push(
      adj.via === "graph"
        ? `adjacency via import graph (${adj.value.toFixed(2)})`
        : `adjacency via path distance (${adj.value.toFixed(2)})`,
    );

    const recencySignal = recency[i];

    let taskSignal: number | null = null;
    if (hasKeywords) {
      taskSignal = jaccard(tokenizePath(tab.path), keywordTokens);
      reasons.push(`task keyword overlap ${taskSignal.toFixed(2)}`);
    } else {
      reasons.push("task keywords absent (signal omitted)");
    }

    const hasToken =
      typeof tab.tokenCount === "number" &&
      Number.isFinite(tab.tokenCount) &&
      tab.tokenCount >= 0;
    const sizeSignal = hasToken ? sizeKeepSignal(tab.tokenCount, sizeMidpoint) : null;
    if (hasToken) {
      reasons.push(`size keep-priority ${(sizeSignal as number).toFixed(2)} (${tab.tokenCount} tok)`);
    } else {
      reasons.push("token count unknown (size signal omitted)");
    }

    const signals: SignalSet = {
      activeAdjacency: adj.value,
      recency: recencySignal,
      taskMatch: taskSignal,
      sizePenalty: sizeSignal,
    };

    const { score } = blend(signals, weights);
    const relevanceScore = clamp01(score);

    // ── Recommendation with invariants ────────────────────────────────────
    let recommendation: Recommendation = "keep";
    if (isActive) {
      recommendation = "keep";
      reasons.push("KEPT: active file (always kept)");
    } else if (isDirty) {
      recommendation = "keep";
      reasons.push("KEPT: dirty/unsaved (always kept)");
    } else if (relevanceScore < dropThreshold) {
      recommendation = "drop";
      reasons.push(
        `DROP: relevance ${relevanceScore.toFixed(2)} < threshold ${dropThreshold.toFixed(2)}`,
      );
      if (!hasToken) {
        reasons.push("savings unknown (no token count supplied)");
      } else {
        reasons.push(`savings ${tab.tokenCount} tokens`);
      }
    } else {
      reasons.push(
        `KEPT: relevance ${relevanceScore.toFixed(2)} >= threshold ${dropThreshold.toFixed(2)}`,
      );
    }

    return { verdict: { path: tab.path, relevanceScore, recommendation, reasons }, tab };
  });

  // ── Aggregate (null-aware savings), reading each tab's own count ─────────
  let totalDroppableTokens = 0;
  let droppedWithUnknownSavings = 0;
  let keptCount = 0;
  let droppedCount = 0;

  for (const { verdict, tab } of scored) {
    if (verdict.recommendation === "drop") {
      droppedCount++;
      const tc = tab.tokenCount;
      if (typeof tc === "number" && Number.isFinite(tc) && tc >= 0) {
        totalDroppableTokens += tc;
      } else {
        droppedWithUnknownSavings++;
      }
    } else {
      keptCount++;
    }
  }

  // ── Deterministic order: highest relevance first, ties broken by path ────
  const verdicts: TabVerdict[] = scored.map((s) => s.verdict);
  verdicts.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return 0;
  });

  return {
    tabs: verdicts,
    totalDroppableTokens,
    droppedWithUnknownSavings,
    keptCount,
    droppedCount,
  };
}

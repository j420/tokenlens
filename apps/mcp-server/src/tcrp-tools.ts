/**
 * MCP tool handlers for the TCRP cost-reduction features (F2, F4, F6).
 *
 * Pure functions that parse the tool args, call the tested package cores, and
 * shape a JSON response. Kept out of index.ts (whose top-level main() starts
 * the stdio server) so they can be unit-tested directly, including the safety
 * guarantees surviving the MCP boundary.
 */

import {
  auditToolDefinitions,
  type ToolDefinitionInfo,
  type ToolUsageWindow,
} from "@prune/intelligence";
import {
  classifyPareto,
  recommendForCluster,
  type ModelAggregate,
} from "@prune/qpd-bench";
import { loadCachedSessionView } from "@prune/telemetry";
import {
  buildReport,
  resolveConfig,
  type ContextHealthReport,
} from "@prune/context-health";
import {
  runReplayHarness,
  type F1ShadowEvent,
} from "@prune/trajectory-diet";
import {
  SemanticCache,
  contentShaFreshness,
  type SerializedSemanticCache,
} from "@prune/semantic-cache";

export interface ToolAuditArgs {
  tools: ToolDefinitionInfo[];
  usage: ToolUsageWindow;
  critical_allowlist?: string[];
}

export function handleToolAudit(args: ToolAuditArgs): string {
  if (!Array.isArray(args.tools) || !args.usage) {
    return JSON.stringify({ error: "tool_audit requires `tools` and `usage`." });
  }
  const report = auditToolDefinitions(args.tools, args.usage, {
    criticalAllowlist: args.critical_allowlist,
  });
  return JSON.stringify(
    {
      windowDays: report.windowDays,
      sessionsInWindow: report.sessionsInWindow,
      totalDefinitionTokens: report.totalDefinitionTokens,
      recoverableTokensPerWeek: Math.round(report.recoverableTokensPerWeek),
      recommendationCount: report.recommendationCount,
      newInstallGuardActive: report.newInstallGuardActive,
      entries: report.entries.map((e) => ({
        name: e.name,
        server: e.server,
        utility: e.utility,
        invocations: e.invocations,
        invocationsPerWeek: Number(e.invocationsPerWeek.toFixed(2)),
        wastedTokensPerWeek: Math.round(e.wastedTokensPerWeek),
        recommendRemoval: e.recommendRemoval,
        rationale: e.rationale,
      })),
    },
    null,
    2
  );
}

export interface QpdReportArgs {
  baseline: ModelAggregate;
  candidates: ModelAggregate[];
  ar_margin?: number;
  cost_dominance_ratio?: number;
}

export function handleQpdReport(args: QpdReportArgs): string {
  if (!args.baseline || !Array.isArray(args.candidates)) {
    return JSON.stringify({
      error: "qpd_report requires `baseline` and `candidates` aggregates.",
    });
  }
  const rec = recommendForCluster(args.baseline, args.candidates, {
    arMargin: args.ar_margin,
    costDominanceRatio: args.cost_dominance_ratio,
  });
  const frontier = classifyPareto(
    [args.baseline, ...args.candidates].map((m) => ({
      model: m.model,
      cost: m.meanCost,
      quality: m.acceptanceRate,
    }))
  );
  return JSON.stringify(
    {
      clusterId: rec.clusterId,
      baselineModel: rec.baselineModel,
      best: rec.best
        ? {
            model: rec.best.model,
            projectedSavingsPct: Number(rec.best.projectedSavingsPct.toFixed(1)),
            qpdRelative: Number(rec.best.qpdRelative.toFixed(2)),
          }
        : null,
      paretoFrontier: frontier.filter((p) => p.onFrontier).map((p) => p.model),
      recommendations: rec.recommendations.map((r) => ({
        model: r.model,
        recommended: r.recommended,
        costRatio: Number.isFinite(r.costRatio)
          ? Number(r.costRatio.toFixed(3))
          : null,
        projectedSavingsPct: Number(r.projectedSavingsPct.toFixed(1)),
        gates: {
          ar: r.arGate.passed,
          tpr: r.tprGate.passed,
          cost: r.costGate.passed,
          sampleSize: r.sampleSizeGate.passed,
        },
        arDetail: r.arGate.detail,
      })),
    },
    null,
    2
  );
}

export interface ContextHealthReportArgs {
  transcript_path: string;
  /**
   * Optional max number of recent turns to include in the report's
   * `ecfSeries`. Defaults to "all turns". Out-of-range values are
   * silently clamped.
   */
  window_turns?: number;
}

/**
 * F6 — Context-Health Report. Streams the transcript via SessionCache,
 * computes the ECF series and CUSUM regime, and returns a single JSON
 * payload that's safe to JSON-stringify (no functions, no circular
 * refs). The MCP boundary takes the JSON; the hook (which writes
 * advisories to additionalContext) uses a different entry-point.
 */
export async function handleContextHealthReport(
  args: ContextHealthReportArgs
): Promise<string> {
  if (!args || typeof args.transcript_path !== "string" || args.transcript_path.length === 0) {
    return JSON.stringify({
      error: "context_health_report requires a non-empty `transcript_path`.",
    });
  }
  const config = resolveConfig(process.env);
  const view = await loadCachedSessionView(args.transcript_path);

  // Apply window_turns if supplied — clamp non-finite / negative values.
  const all = view.turns;
  const window =
    typeof args.window_turns === "number" &&
    Number.isFinite(args.window_turns) &&
    args.window_turns > 0
      ? Math.min(Math.trunc(args.window_turns), all.length)
      : all.length;
  const turns = window === all.length ? all : all.slice(all.length - window);

  const report: ContextHealthReport = buildReport(turns, { config });
  return JSON.stringify(report, null, 2);
}

export interface TrajectoryReplayArgs {
  /**
   * F1 shadow events to evaluate. Caller (extension or a CI job)
   * sources these from the local persistence sink where
   * `feature_id = "f1"`, projecting `quality_proof` into the shape
   * expected by F1ShadowEvent.
   */
  events: F1ShadowEvent[];
  num_bins?: number;
  min_pairs_for_gate?: number;
  /** Optional margins override (acceptanceRate, testPassRate, alpha). */
  margins?: {
    acceptanceRate?: number;
    testPassRate?: number;
    alpha?: number;
  };
}

/**
 * F1 v2 — Trajectory Replay Report. Computes calibration metrics and
 * the NI-gate verdict over a set of shadow-mode F1 events. Stateless;
 * the caller provides the events. Never throws on malformed input —
 * out-of-range events are reported under `malformedEvents`.
 */
export function handleTrajectoryReplay(args: TrajectoryReplayArgs): string {
  if (!args || !Array.isArray(args.events)) {
    return JSON.stringify({
      error: "trajectory_replay_report requires `events` (F1ShadowEvent[]).",
    });
  }
  const margins =
    args.margins && typeof args.margins === "object"
      ? {
          acceptanceRate: args.margins.acceptanceRate ?? 0.01,
          testPassRate: args.margins.testPassRate ?? 0.005,
          alpha: args.margins.alpha ?? 0.05,
        }
      : undefined;
  const report = runReplayHarness(args.events, {
    numBins:
      typeof args.num_bins === "number" && args.num_bins > 0
        ? Math.trunc(args.num_bins)
        : undefined,
    minPairsForGate:
      typeof args.min_pairs_for_gate === "number" && args.min_pairs_for_gate > 0
        ? Math.trunc(args.min_pairs_for_gate)
        : undefined,
    margins,
  });
  return JSON.stringify(report, null, 2);
}

export interface SemanticCacheProbeArgs {
  /** Optional persisted cache state (from SemanticCache.toJSON()). */
  state?: SerializedSemanticCache;
  /** A list of queries to probe; each must carry its freshness parts. */
  probes: Array<{
    query: string;
    freshness_parts: string[];
  }>;
}

/**
 * F7 — Semantic Cache Probe. Stateless. Hydrates a cache from the
 * supplied serialized state, runs `decide()` over each probe, and
 * returns the hit/miss verdicts with similarity. Never throws on
 * malformed input.
 */
export function handleSemanticCacheProbe(
  args: SemanticCacheProbeArgs
): string {
  if (!args || !Array.isArray(args.probes)) {
    return JSON.stringify({
      error: "semantic_cache_probe requires `probes: [{ query, freshness_parts }]`.",
    });
  }
  const cache = args.state
    ? SemanticCache.fromJSON(args.state)
    : new SemanticCache();
  const verdicts = args.probes.map((p) => {
    if (
      !p ||
      typeof p.query !== "string" ||
      !Array.isArray(p.freshness_parts)
    ) {
      return { error: "malformed probe", query: null, decision: null };
    }
    const fresh = contentShaFreshness(
      ...p.freshness_parts.filter((s) => typeof s === "string")
    );
    const d = cache.decide(p.query, fresh);
    return {
      query: p.query,
      decision: d,
    };
  });
  return JSON.stringify(
    {
      cacheSize: cache.size,
      modelName: cache.modelName,
      verdicts,
    },
    null,
    2
  );
}

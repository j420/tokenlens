/**
 * MCP tool handlers for the TCRP cost-reduction features (F2, F4).
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

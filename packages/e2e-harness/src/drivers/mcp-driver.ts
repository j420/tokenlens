/**
 * Thin async wrappers over the REAL MCP tool handlers (the same functions
 * `apps/mcp-server/src/index.ts` dispatches to). Each returns the parsed JSON
 * the tool emits across the wire. Imported via the package's `./tools` subpath
 * so we never touch the package root (whose `dist/index.js` auto-starts the
 * stdio server).
 */

import {
  handleCacheHabitsFromTranscript,
  handleContextHealthReport,
  handleQpdReport,
  handleReasoningEffortRoute,
  handleMaxTokensCalibrate,
  handleSubagentCostPredict,
  handleResultPrune,
  handleDiffVsRewrite,
  handleOpenTabAudit,
  handleToolAudit,
  handleMcpProxyTrim,
  handleReplayCostPlan,
  handleSemanticCacheProbe,
  handleCacheHabits,
} from "@prune/mcp-server/tools";

export type Json = Record<string, unknown>;

async function parse(result: string | Promise<string>): Promise<Json> {
  const s = await result;
  return JSON.parse(s) as Json;
}

export const mcp = {
  cacheHabitsFromTranscript: (args: Parameters<typeof handleCacheHabitsFromTranscript>[0]) =>
    parse(handleCacheHabitsFromTranscript(args)),
  contextHealthReport: (args: Parameters<typeof handleContextHealthReport>[0]) =>
    parse(handleContextHealthReport(args)),
  qpdReport: (args: Parameters<typeof handleQpdReport>[0]) =>
    parse(handleQpdReport(args)),
  reasoningEffortRoute: (args: Parameters<typeof handleReasoningEffortRoute>[0]) =>
    parse(handleReasoningEffortRoute(args)),
  maxTokensCalibrate: (args: Parameters<typeof handleMaxTokensCalibrate>[0]) =>
    parse(handleMaxTokensCalibrate(args)),
  subagentCostPredict: (args: Parameters<typeof handleSubagentCostPredict>[0]) =>
    parse(handleSubagentCostPredict(args)),
  resultPrune: (args: Parameters<typeof handleResultPrune>[0]) =>
    parse(handleResultPrune(args)),
  diffVsRewrite: (args: Parameters<typeof handleDiffVsRewrite>[0]) =>
    parse(handleDiffVsRewrite(args)),
  openTabAudit: (args: Parameters<typeof handleOpenTabAudit>[0]) =>
    parse(handleOpenTabAudit(args)),
  toolAudit: (args: Parameters<typeof handleToolAudit>[0]) =>
    parse(handleToolAudit(args)),
  mcpProxyTrim: (args: Parameters<typeof handleMcpProxyTrim>[0]) =>
    parse(handleMcpProxyTrim(args)),
  replayCostPlan: (args: Parameters<typeof handleReplayCostPlan>[0]) =>
    parse(handleReplayCostPlan(args)),
  semanticCacheProbe: (args: Parameters<typeof handleSemanticCacheProbe>[0]) =>
    parse(handleSemanticCacheProbe(args)),
  cacheHabits: (args: Parameters<typeof handleCacheHabits>[0]) =>
    parse(handleCacheHabits(args)),
};

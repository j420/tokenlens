/**
 * Flow B — the AI consulting Prune via the real MCP tool handlers. Each call
 * uses fixture-derived typed inputs. We also COLLECT the real `quality_proof`
 * bundles the rich-decoder tools emit (f2/f4/f9/f10/f11) so Flow E can forward
 * and roll them up — the dashboard numbers are literally this flow's output.
 */

import { mcp } from "../drivers/mcp-driver";
import { step, type ScenarioResult, type Step } from "../types";
import { SWITCH_MODEL, type SessionFixture } from "../fixtures/session";

export interface CollectedProof {
  featureId: string;
  qualityProof: Record<string, unknown>;
}

export interface McpScenarioOutput {
  result: ScenarioResult;
  proofs: CollectedProof[];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function runMcpScenario(fx: SessionFixture): Promise<McpScenarioOutput> {
  const steps: Step[] = [];
  const proofs: CollectedProof[] = [];

  // f9 — cache_habits_from_transcript: propose an Opus switch → CH-001 fires.
  const ch = await mcp.cacheHabitsFromTranscript({
    transcript_path: fx.transcriptPath,
    proposed_action: { model: SWITCH_MODEL },
  });
  const findings = (ch.findings as Array<{ ruleId: string }>) ?? [];
  const ch001 = findings.find((f) => f.ruleId === "CH-001");
  steps.push(
    step(
      "cache_habits_from_transcript (→ Opus)",
      ch.verdict === "warn" || ch.verdict === "block" ? "warn" : "ok",
      `verdict=${ch.verdict}; ${ch001 ? "CH-001 mid-session model switch flagged" : "no model-switch finding"}; derived model ${(ch.derived as { currentModel?: string } | undefined)?.currentModel}`,
      { verdict: ch.verdict, firedCH001: Boolean(ch001), derived: ch.derived }
    )
  );
  if (ch.quality_proof) proofs.push({ featureId: "f9", qualityProof: ch.quality_proof as Record<string, unknown> });

  // f6 — context_health_report from the transcript.
  const health = await mcp.contextHealthReport({ transcript_path: fx.transcriptPath });
  steps.push(
    step("context_health_report", "info", `regime=${health.regime ?? health.status ?? "n/a"}`, {
      keys: Object.keys(health),
    })
  );

  // f2 — tool_audit: flag unused, heavyweight tool defs.
  const audit = await mcp.toolAudit({ tools: fx.toolDefs, usage: fx.toolUsage });
  steps.push(
    step("tool_audit", "ok", summarize(audit), { keys: Object.keys(audit) })
  );
  if (audit.quality_proof) proofs.push({ featureId: "f2", qualityProof: audit.quality_proof as Record<string, unknown> });

  // f4 — qpd_report: find a cheaper, quality-equivalent tier.
  const qpd = await mcp.qpdReport({ baseline: fx.qpdBaseline, candidates: fx.qpdCandidates });
  steps.push(step("qpd_report", "ok", summarize(qpd), { keys: Object.keys(qpd) }));
  if (qpd.quality_proof) proofs.push({ featureId: "f4", qualityProof: qpd.quality_proof as Record<string, unknown> });

  // f10 — mcp_proxy_trim: keep only debug-intent tools.
  const proxy = await mcp.mcpProxyTrim({
    intent: "debug",
    tools: fx.proxyTools,
    include_fallback: true,
  } as Parameters<typeof mcp.mcpProxyTrim>[0]);
  const audited = proxy.audit as { savedTokens?: number; fullCatalogTokens?: number; shippedTokens?: number } | undefined;
  steps.push(
    step("mcp_proxy_trim (intent=debug)", "ok", `saved ${audited?.savedTokens ?? "?"} schema tokens (full ${audited?.fullCatalogTokens ?? "?"} → shipped ${audited?.shippedTokens ?? "?"})`, {
      savedTokens: num(audited?.savedTokens),
    })
  );
  if (proxy.quality_proof) proofs.push({ featureId: "f10", qualityProof: proxy.quality_proof as Record<string, unknown> });

  // f11 — replay_cost_plan: what-if a tool-read diverges.
  const replay = await mcp.replayCostPlan({
    model: fx.activeModel,
    segments: fx.replaySegments,
    mutation: fx.replayMutation,
  } as Parameters<typeof mcp.replayCostPlan>[0]);
  const cost = replay.cost as { savedUsd?: number; naiveCostUsd?: number; replayCostUsd?: number } | undefined;
  steps.push(
    step("replay_cost_plan", "ok", `replay saves $${cost?.savedUsd ?? "?"} vs cold re-run ($${cost?.naiveCostUsd ?? "?"} → $${cost?.replayCostUsd ?? "?"})`, {
      savedUsd: num(cost?.savedUsd),
    })
  );
  if (replay.quality_proof) proofs.push({ featureId: "f11", qualityProof: replay.quality_proof as Record<string, unknown> });

  // Phase-8 output-side tools.
  const prune = await mcp.resultPrune({ text: fx.largeToolResult });
  steps.push(
    step("result_prune", "ok", `tool result ${prune.originalTokens ?? "?"} → ${prune.prunedTokens ?? prune.compressedTokens ?? "?"} tok (lossless=${prune.lossless})`, {
      originalTokens: num(prune.originalTokens),
      savedTokens: num(prune.savedTokens),
      lossless: prune.lossless,
    })
  );

  const cal = await mcp.maxTokensCalibrate({ samples: fx.outputSamples });
  steps.push(step("max_tokens_calibrate", "ok", summarize(cal), { keys: Object.keys(cal) }));

  const small = await mcp.diffVsRewrite({ original: fx.smallEdit.original, proposed: fx.smallEdit.proposed });
  const big = await mcp.diffVsRewrite({ original: fx.bigRewrite.original, proposed: fx.bigRewrite.proposed });
  steps.push(
    step("diff_vs_rewrite (tiny edit)", "ok", `recommend=${small.recommendation ?? small.decision ?? "?"}`, {
      recommendation: small.recommendation ?? small.decision ?? null,
    })
  );
  steps.push(
    step("diff_vs_rewrite (near-total rewrite)", "ok", `recommend=${big.recommendation ?? big.decision ?? "?"}`, {
      recommendation: big.recommendation ?? big.decision ?? null,
    })
  );

  const effort = await mcp.reasoningEffortRoute({
    current_effort: "high",
    outcomes: fx.effortOutcomes,
  } as Parameters<typeof mcp.reasoningEffortRoute>[0]);
  steps.push(
    step("reasoning_effort_route", "ok", `recommend=${effort.recommendedEffort ?? effort.recommendation ?? "?"} (decision=${effort.decision ?? "?"})`, {
      recommendedEffort: effort.recommendedEffort ?? effort.recommendation ?? null,
      decision: effort.decision ?? null,
    })
  );

  const sub = await mcp.subagentCostPredict({
    history: fx.subagentHistory,
    proposed_count: 3,
    model: fx.activeModel,
  });
  steps.push(step("subagent_cost_predict (×3)", "ok", summarize(sub), { keys: Object.keys(sub) }));

  const tabs = await mcp.openTabAudit({
    tabs: fx.tabs,
    activeFile: "src/auth/service.ts",
    task_keywords: ["login", "auth"],
    import_edges: fx.importEdges,
  });
  steps.push(step("open_tab_audit", "ok", summarize(tabs), { keys: Object.keys(tabs) }));

  const cache = await mcp.semanticCacheProbe({
    probes: [{ query: "fix the login bug", freshness_parts: ["src/auth/service.ts@v1"] }],
  });
  steps.push(step("semantic_cache_probe (cold)", "info", `cacheSize=${cache.cacheSize}; cold cache → miss verdicts`, { cacheSize: num(cache.cacheSize) }));

  return {
    result: {
      flow: "MCP",
      summary: "The AI consults the real MCP tool handlers; rich-decoder proofs (f2/f4/f9/f10/f11) are collected for the dashboard loop.",
      steps,
    },
    proofs,
  };
}

function summarize(o: Record<string, unknown>): string {
  if (typeof o.error === "string") return `error: ${o.error}`;
  const keys = Object.keys(o).filter((k) => k !== "quality_proof");
  return keys.slice(0, 5).map((k) => `${k}=${render(o[k])}`).join(", ");
}
function render(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "object") return Array.isArray(v) ? `[${v.length}]` : "{…}";
  return String(v);
}

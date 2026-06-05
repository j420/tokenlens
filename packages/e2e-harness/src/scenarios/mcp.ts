/**
 * Flow B — the AI consulting Prune via the real MCP tool handlers. Each step
 * records real input/output, invariant checks, and (for transform tools) a
 * quality/degradation signal. Collects the rich-decoder proofs (f2/f4/f9/f10/f11)
 * for the dashboard loop.
 */

import { mcp } from "../drivers/mcp-driver";
import type { ScenarioResult, Step } from "../types";
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
function noError(o: Record<string, unknown>): boolean {
  return typeof o.error !== "string";
}

export async function runMcpScenario(fx: SessionFixture): Promise<McpScenarioOutput> {
  const steps: Step[] = [];
  const proofs: CollectedProof[] = [];

  // f9 — cache_habits_from_transcript: propose an Opus switch → CH-001 fires.
  const chInput = { transcript_path: fx.transcriptPath, proposed_action: { model: SWITCH_MODEL } };
  const ch = await mcp.cacheHabitsFromTranscript(chInput);
  const findings = (ch.findings as Array<{ ruleId: string }>) ?? [];
  const ch001 = findings.find((f) => f.ruleId === "CH-001");
  steps.push({
    name: "cache_habits_from_transcript (→ Opus)",
    status: ch.verdict === "warn" || ch.verdict === "block" ? "warn" : "ok",
    detail: `verdict=${ch.verdict}; ${ch001 ? "CH-001 mid-session model switch flagged" : "no model-switch finding"}`,
    input: chInput,
    output: { verdict: ch.verdict, findings: ch.findings, derived: ch.derived },
    checks: [
      { label: "no handler error", passed: noError(ch) },
      { label: "CH-001 fired on the model switch", passed: Boolean(ch001) },
      { label: "verdict is warn", passed: ch.verdict === "warn" },
    ],
    quality: null,
  });
  if (ch.quality_proof) proofs.push({ featureId: "f9", qualityProof: ch.quality_proof as Record<string, unknown> });

  // f6 — context_health_report.
  const health = await mcp.contextHealthReport({ transcript_path: fx.transcriptPath });
  steps.push({
    name: "context_health_report",
    status: "info",
    detail: `regime=${health.regime ?? health.status ?? "n/a"}`,
    input: { transcript_path: fx.transcriptPath },
    output: health,
    checks: [{ label: "no handler error", passed: noError(health) }],
    quality: null,
  });

  // f2 — tool_audit.
  const auditInput = { tools: fx.toolDefs, usage: fx.toolUsage };
  const audit = await mcp.toolAudit(auditInput);
  steps.push({
    name: "tool_audit",
    status: "ok",
    detail: summarize(audit),
    input: auditInput,
    output: audit,
    checks: [{ label: "no handler error", passed: noError(audit) }],
    quality: null,
  });
  if (audit.quality_proof) proofs.push({ featureId: "f2", qualityProof: audit.quality_proof as Record<string, unknown> });

  // f4 — qpd_report.
  const qpdInput = { baseline: fx.qpdBaseline, candidates: fx.qpdCandidates };
  const qpd = await mcp.qpdReport(qpdInput);
  steps.push({
    name: "qpd_report",
    status: "ok",
    detail: summarize(qpd),
    input: qpdInput,
    output: qpd,
    checks: [{ label: "no handler error", passed: noError(qpd) }],
    quality: null,
  });
  if (qpd.quality_proof) proofs.push({ featureId: "f4", qualityProof: qpd.quality_proof as Record<string, unknown> });

  // f10 — mcp_proxy_trim.
  const proxyInput = { intent: "debug", tools: fx.proxyTools, include_fallback: true };
  const proxy = await mcp.mcpProxyTrim(proxyInput as Parameters<typeof mcp.mcpProxyTrim>[0]);
  const audited = proxy.audit as { savedTokens?: number; fullCatalogTokens?: number; shippedTokens?: number } | undefined;
  steps.push({
    name: "mcp_proxy_trim (intent=debug)",
    status: "ok",
    detail: `saved ${audited?.savedTokens ?? "?"} schema tokens (full ${audited?.fullCatalogTokens ?? "?"} → shipped ${audited?.shippedTokens ?? "?"})`,
    input: proxyInput,
    output: proxy,
    checks: [
      { label: "no handler error", passed: noError(proxy) },
      { label: "savedTokens is a non-negative number", passed: typeof audited?.savedTokens === "number" && (audited?.savedTokens ?? -1) >= 0 },
    ],
    quality: null,
  });
  if (proxy.quality_proof) proofs.push({ featureId: "f10", qualityProof: proxy.quality_proof as Record<string, unknown> });

  // f11 — replay_cost_plan.
  const replayInput = { model: fx.activeModel, segments: fx.replaySegments, mutation: fx.replayMutation };
  const replay = await mcp.replayCostPlan(replayInput as Parameters<typeof mcp.replayCostPlan>[0]);
  const cost = replay.cost as { savedUsd?: number; naiveCostUsd?: number; replayCostUsd?: number } | undefined;
  steps.push({
    name: "replay_cost_plan",
    status: "ok",
    detail: `replay saves $${cost?.savedUsd ?? "?"} vs cold re-run ($${cost?.naiveCostUsd ?? "?"} → $${cost?.replayCostUsd ?? "?"})`,
    input: replayInput,
    output: replay,
    checks: [{ label: "no handler error", passed: noError(replay) }],
    quality: null,
  });
  if (replay.quality_proof) proofs.push({ featureId: "f11", qualityProof: replay.quality_proof as Record<string, unknown> });

  // P8a — result_prune: quality = lossless flag.
  const prune = await mcp.resultPrune({ text: fx.largeToolResult });
  const lossless = prune.lossless === true;
  steps.push({
    name: "result_prune",
    status: "ok",
    detail: `tool result ${prune.originalTokens ?? "?"} → ${prune.prunedTokens ?? "?"} tok (saved ${prune.savedTokens}; lossless=${prune.lossless})`,
    input: { textChars: fx.largeToolResult.length, preview: fx.largeToolResult.slice(0, 120) },
    output: { originalTokens: prune.originalTokens, prunedTokens: prune.prunedTokens, savedTokens: prune.savedTokens, lossless: prune.lossless, manifest: prune.manifest },
    checks: [
      { label: "no handler error", passed: noError(prune) },
      { label: "meaningfully shrank a repetitive dump", passed: Number(prune.savedTokens) > 0 },
    ],
    quality: {
      // Intentional, fully-accounted reduction — correctness-degradation is N/A
      // (the dedicated equivalence proof in Edge Cases is the real no-degradation
      // gate). We surface the honest lossless flag + manifest size in the detail.
      label: "intentional reduction (manifest-accounted)",
      preserved: null,
      detail: `lossless=${lossless}; every removed byte is recorded in a ${Array.isArray(prune.manifest) ? (prune.manifest as unknown[]).length : 0}-entry manifest`,
    },
    data: { savedTokens: prune.savedTokens },
  });

  // P8c — diff_vs_rewrite: quality = diffVerified (sound round-trip).
  const small = await mcp.diffVsRewrite({ original: fx.smallEdit.original, proposed: fx.smallEdit.proposed });
  const big = await mcp.diffVsRewrite({ original: fx.bigRewrite.original, proposed: fx.bigRewrite.proposed });
  steps.push({
    name: "diff_vs_rewrite (tiny edit)",
    status: "ok",
    detail: `recommend=${small.recommendation}; diffVerified=${small.diffVerified}`,
    input: { kind: "one-line bug fix" },
    output: { recommendation: small.recommendation, diffVerified: small.diffVerified, tokenCountMethod: small.tokenCountMethod },
    checks: [
      { label: "no handler error", passed: noError(small) },
      { label: "returned a recommendation", passed: Boolean(small.recommendation) },
      { label: "recommended the diff for a tiny edit", passed: small.recommendation === "diff" },
    ],
    quality: {
      label: "sound round-trip (diffVerified)",
      preserved: small.diffVerified === true,
      detail: "the recommended diff was verified to reproduce the proposed output byte-for-byte; an unsound diff is never recommended",
    },
  });
  steps.push({
    name: "diff_vs_rewrite (near-total rewrite)",
    status: "ok",
    detail: `recommend=${big.recommendation}; diffVerified=${big.diffVerified}`,
    input: { kind: "almost everything changed" },
    output: { recommendation: big.recommendation, diffVerified: big.diffVerified },
    checks: [
      { label: "no handler error", passed: noError(big) },
      { label: "recommended a full rewrite when the diff isn't worth it", passed: big.recommendation === "rewrite" },
    ],
    quality: { label: "sound round-trip (diffVerified)", preserved: big.diffVerified === true || big.recommendation === "rewrite", detail: "rewrite path needs no diff verification" },
  });

  // P8b — max_tokens_calibrate.
  const cal = await mcp.maxTokensCalibrate({ samples: fx.outputSamples });
  steps.push({
    name: "max_tokens_calibrate",
    status: "ok",
    detail: summarize(cal),
    input: { samples: fx.outputSamples },
    output: cal,
    checks: [
      { label: "no handler error", passed: noError(cal) },
      { label: "recommended a cap from sufficient samples", passed: cal.status === "ok" && typeof cal.recommendedMaxTokens === "number" },
    ],
    quality: null,
  });

  // P8d — reasoning_effort_route.
  const effort = await mcp.reasoningEffortRoute({
    current_effort: "high",
    outcomes: fx.effortOutcomes,
  } as Parameters<typeof mcp.reasoningEffortRoute>[0]);
  steps.push({
    name: "reasoning_effort_route",
    status: "ok",
    detail: `recommend=${effort.recommendedEffort} (hold=${effort.hold})`,
    input: { current_effort: "high", outcomes: fx.effortOutcomes },
    output: effort,
    checks: [
      { label: "no handler error", passed: noError(effort) },
      { label: "down-routed to standard (non-inferior + cheaper)", passed: effort.recommendedEffort === "standard" },
    ],
    quality: null,
  });

  // N6 — subagent_cost_predict.
  const sub = await mcp.subagentCostPredict({ history: fx.subagentHistory, proposed_count: 3, model: fx.activeModel });
  steps.push({
    name: "subagent_cost_predict (×3)",
    status: "ok",
    detail: summarize(sub),
    input: { proposed_count: 3, model: fx.activeModel, history: fx.subagentHistory },
    output: sub,
    checks: [{ label: "no handler error", passed: noError(sub) }],
    quality: null,
  });

  // P8e — open_tab_audit.
  const tabsInput = { tabs: fx.tabs, activeFile: "src/auth/service.ts", task_keywords: ["login", "auth"], import_edges: fx.importEdges };
  const tabs = await mcp.openTabAudit(tabsInput);
  steps.push({
    name: "open_tab_audit",
    status: "ok",
    detail: summarize(tabs),
    input: tabsInput,
    output: tabs,
    checks: [{ label: "no handler error", passed: noError(tabs) }],
    quality: null,
  });

  // f7 — semantic_cache_probe (cold).
  const cache = await mcp.semanticCacheProbe({ probes: [{ query: "fix the login bug", freshness_parts: ["src/auth/service.ts@v1"] }] });
  steps.push({
    name: "semantic_cache_probe (cold)",
    status: "info",
    detail: `cacheSize=${cache.cacheSize}; cold cache → miss verdicts`,
    input: { probes: [{ query: "fix the login bug" }] },
    output: cache,
    checks: [{ label: "no handler error", passed: noError(cache) }],
    quality: null,
  });

  return {
    result: {
      flow: "MCP",
      summary: "The AI consults the real MCP tool handlers; transform tools report their quality gates (lossless, diffVerified); rich proofs feed the dashboard loop.",
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

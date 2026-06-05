/**
 * Flow X — the discipline matrix + independent no-degradation proofs. Beyond each
 * feature's own gate, this re-checks correctness with @prune/equivalence: a
 * "lossless" prune must be byte-identical, and a comment-stripping squeeze must be
 * AST-equivalent — degradation proven absent by an INDEPENDENT relation.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { equivalent } from "@prune/equivalence";
import { mcp } from "../drivers/mcp-driver";
import { extension } from "../drivers/extension-driver";
import { seedFeatureEvents, seedPlainEvent, runForwardOnce, type DashboardLib } from "../drivers/dashboard-driver";
import type { EventRow, FetchLike } from "@prune/persistence";
import type { ScenarioResult, Step } from "../types";
import { ACTIVE_MODEL, UNPRICED_MODEL, type SessionFixture } from "../fixtures/session";

function captureFetch(opts: { failOnAttempt?: number } = {}) {
  const ids: string[] = [];
  let attempt = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    attempt += 1;
    if (opts.failOnAttempt && attempt === opts.failOnAttempt) return { ok: false, status: 503 };
    const body = JSON.parse(init.body) as { id?: unknown };
    ids.push(String(body.id));
    return { ok: true, status: 200 };
  };
  return { fetchImpl, ids, attempts: () => attempt };
}

function eventRow(featureId: string | null, qualityProof: Record<string, unknown> | null, id: string): EventRow {
  return {
    event_id: id, session_id: "edge", user_id: "local", team_id: null,
    timestamp: "2026-06-04T00:00:00Z", provider: "anthropic", tool: "prune-edge",
    model: ACTIVE_MODEL, tokens_in: 0, tokens_out: 0, tokens_cached: 0, latency_ms: 0,
    estimated_cost_usd: 0, cumulative_session_cost_usd: 0, tool_calls: [], files_referenced: [],
    compaction_triggered: false, context_size_before: 0, context_size_after: 0, waste_flags: [],
    classification: "unknown", roi_score: 0, task_metadata: { type: "feature", repo: null, branch: null },
    feature_id: featureId, quality_proof: qualityProof,
  };
}

export async function runEdgeCaseScenario(fx: SessionFixture, lib: DashboardLib): Promise<ScenarioResult> {
  const steps: Step[] = [];

  // ===== Independent no-degradation proofs (@prune/equivalence) =====

  // (A) A "lossless" prune must be byte-identical to its input.
  const cleanText = "function add(a, b) { return a + b; }\nconst x = 1;\nexport { add };\n";
  const cleanPrune = await mcp.resultPrune({ text: cleanText });
  const prunedText = String((cleanPrune as { pruned?: unknown }).pruned ?? "");
  const eqPrune = equivalent(cleanText, prunedText);
  steps.push({
    name: "no-degradation: lossless prune ⇒ bytes unchanged",
    status: cleanPrune.lossless && eqPrune.equivalent ? "ok" : "warn",
    detail: `lossless=${cleanPrune.lossless}; equivalent=${eqPrune.equivalent} (strategy=${eqPrune.strategy}, sim=${eqPrune.similarity})`,
    input: { text: cleanText },
    output: { lossless: cleanPrune.lossless, equivalent: eqPrune.equivalent, strategy: eqPrune.strategy, similarity: eqPrune.similarity },
    checks: [
      { label: "pruner reports lossless", passed: cleanPrune.lossless === true },
      { label: "@prune/equivalence confirms equivalent", passed: eqPrune.equivalent === true },
    ],
    quality: { label: "independent equivalence gate", preserved: cleanPrune.lossless === true && eqPrune.equivalent === true, detail: `strategy=${eqPrune.strategy}` },
  });

  // (B) A comment-stripping squeeze (lossless tier) must be AST-equivalent.
  const sq = extension.squeeze(fx.activeFile.content, "lossless");
  const eqSqueeze = equivalent(fx.activeFile.content, sq.compressedCode);
  steps.push({
    name: "no-degradation: squeeze(lossless) ⇒ AST-equivalent",
    status: sq.isValid && eqSqueeze.equivalent ? "ok" : "warn",
    detail: `isValid=${sq.isValid}; equivalent=${eqSqueeze.equivalent} (strategy=${eqSqueeze.strategy}, sim=${eqSqueeze.similarity.toFixed(3)})`,
    input: { file: fx.activeFile.path, tier: "lossless" },
    output: { isValid: sq.isValid, savingsPercent: sq.savingsPercent, equivalent: eqSqueeze.equivalent, strategy: eqSqueeze.strategy, similarity: eqSqueeze.similarity },
    checks: [
      { label: "squeeze re-parse valid (isValid)", passed: sq.isValid === true },
      { label: "@prune/equivalence: output equivalent to original", passed: eqSqueeze.equivalent === true },
    ],
    quality: { label: "independent equivalence gate (AST)", preserved: sq.isValid === true && eqSqueeze.equivalent === true, detail: `strategy=${eqSqueeze.strategy}, similarity=${eqSqueeze.similarity.toFixed(3)}` },
  });

  // ===== Strict pricing =====
  const sub = await mcp.subagentCostPredict({ history: fx.subagentHistory, proposed_count: 2, model: UNPRICED_MODEL });
  steps.push({
    name: "strict pricing (unpriced model)",
    status: sub.priced === false && sub.projectedTotalUsd === null ? "ok" : "warn",
    detail: `priced=${sub.priced}, projectedTotalUsd=${JSON.stringify(sub.projectedTotalUsd)} (no rate invented)`,
    input: { model: UNPRICED_MODEL, proposed_count: 2 },
    output: { priced: sub.priced, projectedTotalUsd: sub.projectedTotalUsd },
    checks: [
      { label: "unpriced model flagged (priced=false)", passed: sub.priced === false },
      { label: "projected USD is null (not fabricated)", passed: sub.projectedTotalUsd === null },
    ],
    quality: null,
  });

  // ===== Boundary safety =====
  const missingModel = await mcp.cacheHabitsFromTranscript({ transcript_path: fx.transcriptPath, proposed_action: {} as never });
  steps.push({
    name: "boundary safety (missing required arg)",
    status: typeof missingModel.error === "string" ? "ok" : "warn",
    detail: typeof missingModel.error === "string" ? "JSON error returned (no throw)" : "unexpected success",
    input: { transcript_path: fx.transcriptPath, proposed_action: {} },
    output: missingModel,
    checks: [{ label: "returns JSON error, never throws", passed: typeof missingModel.error === "string" }],
    quality: null,
  });

  // ===== Fail-safe transcript =====
  const garbage = await mcp.cacheHabitsFromTranscript({ transcript_path: "/no/such/transcript-xyz.jsonl", proposed_action: { model: ACTIVE_MODEL } });
  const derived = garbage.derived as { transcriptHadTurns?: boolean } | undefined;
  steps.push({
    name: "fail-safe (missing transcript)",
    status: derived?.transcriptHadTurns === false && garbage.error === undefined ? "ok" : "warn",
    detail: `transcriptHadTurns=${derived?.transcriptHadTurns}; model falls back to proposal ⇒ no spurious CH-001`,
    input: { transcript_path: "/no/such/transcript-xyz.jsonl", proposed_action: { model: ACTIVE_MODEL } },
    output: { derived: garbage.derived, error: garbage.error ?? null },
    checks: [
      { label: "no throw / no error", passed: garbage.error === undefined },
      { label: "empty-derived snapshot", passed: derived?.transcriptHadTurns === false },
    ],
    quality: null,
  });

  // ===== No false positive =====
  const sameModel = await mcp.cacheHabitsFromTranscript({ transcript_path: fx.transcriptPath, proposed_action: { model: ACTIVE_MODEL } });
  const findings = (sameModel.findings as Array<{ ruleId: string }>) ?? [];
  steps.push({
    name: "no false positive (same model)",
    status: findings.every((f) => f.ruleId !== "CH-001") ? "ok" : "warn",
    detail: `CH-001 absent = ${findings.every((f) => f.ruleId !== "CH-001")}`,
    input: { proposed_action: { model: ACTIVE_MODEL } },
    output: { findings: sameModel.findings },
    checks: [{ label: "CH-001 does not fire for the same model", passed: findings.every((f) => f.ruleId !== "CH-001") }],
    quality: null,
  });

  // ===== result_prune idempotency =====
  const first = await mcp.resultPrune({ text: fx.largeToolResult });
  const second = await mcp.resultPrune({ text: String((first as { pruned?: unknown }).pruned ?? "") });
  steps.push({
    name: "result_prune idempotency",
    status: Number(second.savedTokens) === 0 ? "ok" : "warn",
    detail: `first saved ${first.savedTokens} tok; re-prune saved ${second.savedTokens} tok (fixed point)`,
    input: { reprunePreviousOutput: true },
    output: { firstSaved: first.savedTokens, secondSaved: second.savedTokens },
    checks: [{ label: "re-pruning the output saves nothing (idempotent)", passed: Number(second.savedTokens) === 0 }],
    quality: null,
  });

  // ===== max_tokens insufficient data =====
  const cal = await mcp.maxTokensCalibrate({ samples: [100] });
  steps.push({
    name: "max_tokens_calibrate (too few samples)",
    status: cal.status === "insufficient_data" && cal.recommendedMaxTokens === null ? "ok" : "warn",
    detail: `status=${cal.status}, recommendedMaxTokens=${JSON.stringify(cal.recommendedMaxTokens)}`,
    input: { samples: [100] },
    output: cal,
    checks: [
      { label: "status = insufficient_data", passed: cal.status === "insufficient_data" },
      { label: "no number invented (null)", passed: cal.recommendedMaxTokens === null },
    ],
    quality: null,
  });

  // ===== reasoning_effort hold =====
  const route = await mcp.reasoningEffortRoute({ current_effort: "high", outcomes: [{ effort: "high", n: 2, acceptedCount: 2, meanCostUsd: 0.08 }] } as Parameters<typeof mcp.reasoningEffortRoute>[0]);
  steps.push({
    name: "reasoning_effort_route (insufficient data)",
    status: route.hold === true ? "ok" : "warn",
    detail: `hold=${route.hold}, basis=${route.basis}, recommendedEffort=${route.recommendedEffort}`,
    input: { current_effort: "high", outcomes: "1 effort, n=2" },
    output: route,
    checks: [{ label: "holds (no down-route on thin data)", passed: route.hold === true }],
    quality: null,
  });

  // ===== Forwarder stop-on-failure + gapless resume =====
  const dir = mkdtempSync(join(tmpdir(), "prune-e2e-fwd-"));
  try {
    const dbPath = join(dir, "events.sqlite");
    const cursorPath = join(dir, "cursor.json");
    await seedFeatureEvents(
      dbPath,
      [0, 1, 2, 3].map((i) => ({
        featureId: "f9",
        qualityProof: { schemaVersion: 1, featureId: "f9", verdict: "warn", totals: { findingCount: 1, estimatedWasteUsd: 0.01, estimatedWasteTokens: 100 } },
        eventId: `fwd-${i}`, sessionId: "edge", timestamp: `2026-06-04T00:00:0${i}Z`,
      }))
    );
    const cap1 = captureFetch({ failOnAttempt: 3 });
    const run1 = await runForwardOnce({ dbPath, endpoint: "http://e2e.local/i", cursorPath, fetchImpl: cap1.fetchImpl });
    const cap2 = captureFetch();
    const run2 = await runForwardOnce({ dbPath, endpoint: "http://e2e.local/i", cursorPath, fetchImpl: cap2.fetchImpl });
    const allIds = [...cap1.ids, ...cap2.ids];
    const noDupes = new Set(allIds).size === allIds.length;
    const gapless = new Set(allIds).size === 4;
    steps.push({
      name: "forwarder stop-on-failure + gapless resume",
      status: run1.stoppedOnFailure && run1.sent === 2 && noDupes && gapless ? "ok" : "warn",
      detail: `run1 sent ${run1.sent} then stopped; run2 sent ${run2.sent}; delivered ${new Set(allIds).size}/4 unique, dupes=${!noDupes}`,
      input: { events: 4, failOnAttempt: 3 },
      output: { run1, run2, deliveredIds: allIds },
      checks: [
        { label: "run1 sent exactly 2 then stopped", passed: run1.sent === 2 && run1.stoppedOnFailure },
        { label: "run2 resumes the remainder", passed: run2.sent === 2 },
        { label: "4/4 unique delivered, no duplicates", passed: gapless && noDupes },
      ],
      quality: null,
    });

    const dir2 = mkdtempSync(join(tmpdir(), "prune-e2e-fwd2-"));
    const dbPath2 = join(dir2, "events.sqlite");
    const cursorPath2 = join(dir2, "cursor.json");
    await seedFeatureEvents(dbPath2, [{ featureId: "f11", qualityProof: { cost: { savedUsd: 0.1 } }, eventId: "feat-1", sessionId: "edge" }]);
    await seedPlainEvent(dbPath2, "plain-1");
    const cap3 = captureFetch();
    const run3 = await runForwardOnce({ dbPath: dbPath2, endpoint: "http://e2e.local/i", cursorPath: cursorPath2, fetchImpl: cap3.fetchImpl });
    steps.push({
      name: "forwarder skips non-feature rows",
      status: run3.attempted === 1 && cap3.ids.includes("feat-1") && !cap3.ids.includes("plain-1") ? "ok" : "warn",
      detail: `attempted ${run3.attempted} (feature row only; plain event not shipped)`,
      input: { rows: ["feature f11", "plain (no feature_id)"] },
      output: { attempted: run3.attempted, shipped: cap3.ids },
      checks: [
        { label: "only the feature-tagged row is shipped", passed: run3.attempted === 1 },
        { label: "the plain event is skipped", passed: !cap3.ids.includes("plain-1") },
      ],
      quality: null,
    });
    rmSync(dir2, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ===== Rollup defensive decoding =====
  const rows: EventRow[] = [
    eventRow("f9", null, "malformed-1"),
    eventRow("f9", { verdict: "warn" }, "partial-1"),
    eventRow("f99", { x: 1 }, "oos-1"),
  ];
  const report = lib.aggregateFeatureTelemetry(rows);
  const f9 = report.features.find((f) => f.featureId === "f9");
  steps.push({
    name: "rollup defensive decoding",
    status: (f9?.malformedProofCount ?? 0) >= 1 && report.outOfScopeEventCount === 1 ? "ok" : "warn",
    detail: `f9 malformedProofCount=${f9?.malformedProofCount}, eventCount=${f9?.eventCount}; outOfScope=${report.outOfScopeEventCount}`,
    input: { rows: ["f9 + null proof", "f9 + partial proof", "f99 out-of-scope"] },
    output: { f9MalformedProofCount: f9?.malformedProofCount, f9EventCount: f9?.eventCount, outOfScopeEventCount: report.outOfScopeEventCount },
    checks: [
      { label: "malformed proof counted, not crashed", passed: (f9?.malformedProofCount ?? 0) >= 1 },
      { label: "out-of-scope id excluded from the 13", passed: report.outOfScopeEventCount === 1 },
    ],
    quality: null,
  });

  return {
    flow: "Edge Cases",
    summary: "Discipline matrix + independent equivalence proofs: strict pricing, boundary safety, fail-safe reads, forwarder exactly-once/gapless, defensive decoding, and no-degradation gates.",
    steps,
  };
}

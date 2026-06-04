/**
 * Flow X — the discipline matrix. Proves the invariants that make the product
 * credible rather than a demo: strict pricing (no fabricated cost), boundary
 * safety (bad input → JSON error, never a throw), fail-safe transcript reads,
 * forwarder exactly-once/gapless/stop-on-failure, and the dashboard rollup's
 * defensive decoding (malformed proof, out-of-scope feature id).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mcp } from "../drivers/mcp-driver";
import {
  seedFeatureEvents,
  seedPlainEvent,
  runForwardOnce,
  type DashboardLib,
} from "../drivers/dashboard-driver";
import type { EventRow, FetchLike } from "@prune/persistence";
import { step, type ScenarioResult, type Step } from "../types";
import { ACTIVE_MODEL, UNPRICED_MODEL, type SessionFixture } from "../fixtures/session";

/** A capturing fetch independent of the dashboard store, for forwarder proofs. */
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
    event_id: id,
    session_id: "edge",
    user_id: "local",
    team_id: null,
    timestamp: "2026-06-04T00:00:00Z",
    provider: "anthropic",
    tool: "prune-edge",
    model: ACTIVE_MODEL,
    tokens_in: 0,
    tokens_out: 0,
    tokens_cached: 0,
    latency_ms: 0,
    estimated_cost_usd: 0,
    cumulative_session_cost_usd: 0,
    tool_calls: [],
    files_referenced: [],
    compaction_triggered: false,
    context_size_before: 0,
    context_size_after: 0,
    waste_flags: [],
    classification: "unknown",
    roi_score: 0,
    task_metadata: { type: "feature", repo: null, branch: null },
    feature_id: featureId,
    quality_proof: qualityProof,
  };
}

export async function runEdgeCaseScenario(
  fx: SessionFixture,
  lib: DashboardLib
): Promise<ScenarioResult> {
  const steps: Step[] = [];

  // --- Strict pricing: unpriced model contributes tokens but NO fabricated USD ---
  const sub = await mcp.subagentCostPredict({
    history: fx.subagentHistory,
    proposed_count: 2,
    model: UNPRICED_MODEL,
  });
  steps.push(
    step(
      "strict pricing (unpriced model)",
      sub.priced === false && sub.projectedTotalUsd === null ? "ok" : "warn",
      `priced=${sub.priced}, projectedTotalUsd=${JSON.stringify(sub.projectedTotalUsd)} (no rate invented)`,
      { priced: sub.priced, projectedTotalUsd: sub.projectedTotalUsd }
    )
  );

  // --- Boundary safety: malformed args → JSON error, never a throw ---
  const missingModel = await mcp.cacheHabitsFromTranscript({
    transcript_path: fx.transcriptPath,
    proposed_action: {} as never,
  });
  steps.push(
    step(
      "boundary safety (missing required arg)",
      typeof missingModel.error === "string" ? "ok" : "warn",
      `→ ${typeof missingModel.error === "string" ? "JSON error returned (no throw)" : "unexpected success"}`,
      { error: typeof missingModel.error === "string" }
    )
  );

  // --- Fail-safe transcript: missing file → empty-derived snapshot, no throw ---
  const garbage = await mcp.cacheHabitsFromTranscript({
    transcript_path: "/no/such/transcript-xyz.jsonl",
    proposed_action: { model: ACTIVE_MODEL },
  });
  const derived = garbage.derived as { transcriptHadTurns?: boolean } | undefined;
  steps.push(
    step(
      "fail-safe (missing transcript)",
      derived?.transcriptHadTurns === false && garbage.error === undefined ? "ok" : "warn",
      `transcriptHadTurns=${derived?.transcriptHadTurns}; model falls back to proposal ⇒ no spurious CH-001`,
      { transcriptHadTurns: derived?.transcriptHadTurns ?? null }
    )
  );

  // --- No false positive: same model proposed ⇒ no CH-001 ---
  const sameModel = await mcp.cacheHabitsFromTranscript({
    transcript_path: fx.transcriptPath,
    proposed_action: { model: ACTIVE_MODEL },
  });
  const findings = (sameModel.findings as Array<{ ruleId: string }>) ?? [];
  steps.push(
    step(
      "no false positive (same model)",
      findings.every((f) => f.ruleId !== "CH-001") ? "ok" : "warn",
      `CH-001 absent = ${findings.every((f) => f.ruleId !== "CH-001")}`,
      { firedCH001: findings.some((f) => f.ruleId === "CH-001") }
    )
  );

  // --- result_prune idempotency: prune(prune(x)) == prune(x) ---
  const first = await mcp.resultPrune({ text: fx.largeToolResult });
  const second = await mcp.resultPrune({ text: String((first as { pruned?: unknown }).pruned ?? "") });
  steps.push(
    step(
      "result_prune idempotency",
      Number(second.savedTokens) === 0 || second.prunedTokens === second.originalTokens ? "ok" : "warn",
      `first saved ${first.savedTokens} tok; re-prune saved ${second.savedTokens} tok (fixed point)`,
      { firstSaved: first.savedTokens, secondSaved: second.savedTokens }
    )
  );

  // --- max_tokens_calibrate: too few samples → insufficient_data, null rec ---
  const cal = await mcp.maxTokensCalibrate({ samples: [100] });
  steps.push(
    step(
      "max_tokens_calibrate (too few samples)",
      cal.status === "insufficient_data" && cal.recommendedMaxTokens === null ? "ok" : "warn",
      `status=${cal.status}, recommendedMaxTokens=${JSON.stringify(cal.recommendedMaxTokens)} (no number invented)`,
      { status: cal.status, recommendedMaxTokens: cal.recommendedMaxTokens }
    )
  );

  // --- reasoning_effort_route: insufficient data → hold ---
  const route = await mcp.reasoningEffortRoute({
    current_effort: "high",
    outcomes: [{ effort: "high", n: 2, acceptedCount: 2, meanCostUsd: 0.08 }],
  } as Parameters<typeof mcp.reasoningEffortRoute>[0]);
  steps.push(
    step(
      "reasoning_effort_route (insufficient data)",
      route.hold === true ? "ok" : "warn",
      `hold=${route.hold}, basis=${route.basis}, recommendedEffort=${route.recommendedEffort}`,
      { hold: route.hold, basis: route.basis }
    )
  );

  // --- Forwarder: stop-on-failure + gapless resume (no duplicates) ---
  const dir = mkdtempSync(join(tmpdir(), "prune-e2e-fwd-"));
  try {
    const dbPath = join(dir, "events.sqlite");
    const cursorPath = join(dir, "cursor.json");
    await seedFeatureEvents(
      dbPath,
      [0, 1, 2, 3].map((i) => ({
        featureId: "f9",
        qualityProof: { schemaVersion: 1, featureId: "f9", verdict: "warn", totals: { findingCount: 1, estimatedWasteUsd: 0.01, estimatedWasteTokens: 100 } },
        eventId: `fwd-${i}`,
        sessionId: "edge",
        timestamp: `2026-06-04T00:00:0${i}Z`,
      }))
    );
    const cap1 = captureFetch({ failOnAttempt: 3 });
    const run1 = await runForwardOnce({ dbPath, endpoint: "http://e2e.local/i", cursorPath, fetchImpl: cap1.fetchImpl });
    const cap2 = captureFetch();
    const run2 = await runForwardOnce({ dbPath, endpoint: "http://e2e.local/i", cursorPath, fetchImpl: cap2.fetchImpl });
    const allIds = [...cap1.ids, ...cap2.ids];
    const noDupes = new Set(allIds).size === allIds.length;
    const gapless = new Set(allIds).size === 4;
    steps.push(
      step(
        "forwarder stop-on-failure + gapless resume",
        run1.stoppedOnFailure && run1.sent === 2 && noDupes && gapless ? "ok" : "warn",
        `run1 sent ${run1.sent} then stopped on failure; run2 sent ${run2.sent}; delivered ${new Set(allIds).size}/4 unique, dupes=${!noDupes}`,
        { run1Sent: run1.sent, stopped: run1.stoppedOnFailure, run2Sent: run2.sent, uniqueDelivered: new Set(allIds).size }
      )
    );

    // --- Forwarder only ships feature-tagged rows (plain event skipped) ---
    const dir2 = mkdtempSync(join(tmpdir(), "prune-e2e-fwd2-"));
    const dbPath2 = join(dir2, "events.sqlite");
    const cursorPath2 = join(dir2, "cursor.json");
    await seedFeatureEvents(dbPath2, [{ featureId: "f11", qualityProof: { cost: { savedUsd: 0.1 } }, eventId: "feat-1", sessionId: "edge" }]);
    await seedPlainEvent(dbPath2, "plain-1");
    const cap3 = captureFetch();
    const run3 = await runForwardOnce({ dbPath: dbPath2, endpoint: "http://e2e.local/i", cursorPath: cursorPath2, fetchImpl: cap3.fetchImpl });
    steps.push(
      step(
        "forwarder skips non-feature rows",
        run3.attempted === 1 && cap3.ids.includes("feat-1") && !cap3.ids.includes("plain-1") ? "ok" : "warn",
        `attempted ${run3.attempted} (the feature row only; the plain event was not shipped)`,
        { attempted: run3.attempted, shipped: cap3.ids }
      )
    );
    rmSync(dir2, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // --- Dashboard rollup defensive decoding (pure aggregate over crafted rows) ---
  const rows: EventRow[] = [
    eventRow("f9", null, "malformed-1"), // feature-tagged but null proof → malformed
    eventRow("f9", { verdict: "warn" }, "partial-1"), // missing totals → summary null fields, still counted
    eventRow("f99", { x: 1 }, "oos-1"), // out-of-scope feature id
  ];
  const report = lib.aggregateFeatureTelemetry(rows);
  const f9 = report.features.find((f) => f.featureId === "f9");
  steps.push(
    step(
      "rollup defensive decoding",
      (f9?.malformedProofCount ?? 0) >= 1 && report.outOfScopeEventCount === 1 ? "ok" : "warn",
      `f9 malformedProofCount=${f9?.malformedProofCount}, eventCount=${f9?.eventCount}; outOfScope=${report.outOfScopeEventCount} (f99 excluded from the 13)`,
      {
        f9MalformedProofCount: f9?.malformedProofCount ?? null,
        f9EventCount: f9?.eventCount ?? null,
        outOfScopeEventCount: report.outOfScopeEventCount,
      }
    )
  );

  return {
    flow: "Edge Cases",
    summary: "The discipline matrix: strict pricing, boundary safety, fail-safe reads, forwarder exactly-once/gapless, and defensive rollup decoding.",
    steps,
  };
}

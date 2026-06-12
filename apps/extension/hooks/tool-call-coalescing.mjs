#!/usr/bin/env node
/**
 * Tool-Call Coalescing Gate — PreToolUse hook  (Cost-Security, L4-27).
 *
 * Catches the one duplication cell loop-breaker (cross-turn ROI) and
 * speculative-prune (cross-turn result reuse) both miss: the SAME call —
 * same tool, same canonicalized input — dispatched twice inside ONE turn's
 * parallel block. Both copies bill; one is pure waste.
 *
 * Canonicalization is pinned to loop-breaker's standard (canonicalKey from
 * @prune/intelligence), so "identical" means the same thing in both
 * detectors. ADVISORY (additionalContext), never a block: per the L4
 * review's host-timing note, PreToolUse ordering across a parallel block is
 * host-dependent, so a hard block could race; promotion to a gate goes
 * through the proof pipeline like every other actuator.
 *
 * Config:
 *   PRUNE_COALESCE_DISABLED  "1" → no-op.
 */

import { loadCachedSessionView } from "@prune/telemetry";
import { assessDuplicateParallelCall } from "@prune/cost-security";

import { emitAdditionalContext, emitNoop, readHookPayload, safeRun } from "./_runtime.mjs";
import { deriveSessionId, recordFeatureEventBestEffort, stableId } from "./_telemetry.mjs";

safeRun(async () => {
  if (process.env.PRUNE_COALESCE_DISABLED === "1") return emitNoop();

  const start = Date.now();
  const payload = await readHookPayload();
  if (!payload.transcript_path) return emitNoop();
  if (typeof payload.tool_name !== "string") return emitNoop();

  const { turns } = await loadCachedSessionView(payload.transcript_path);
  if (turns.length === 0) return emitNoop();

  // Dispatch set = the in-progress turn's tool_use blocks. The candidate
  // call being gated is the payload itself; its own transcript entry may or
  // may not be recorded yet depending on host timing, so an exact self-match
  // at the LAST index is ignored (fail-open against double counting).
  const current = turns[turns.length - 1];
  const dispatched = (current.toolUses ?? []).map((u) => ({
    tool: u.name,
    input: u.input,
  }));

  const candidate = { tool: payload.tool_name, input: payload.tool_input ?? {} };
  let report = assessDuplicateParallelCall(dispatched, candidate);
  if (
    report.verdict === "duplicate" &&
    report.matchIndex === dispatched.length - 1
  ) {
    // The single trailing match is plausibly this very call's own record.
    report = assessDuplicateParallelCall(
      dispatched.slice(0, -1),
      candidate
    );
  }

  await recordFeatureEventBestEffort({
    featureId: "tool-call-coalescing",
    qualityProof: {
      schemaVersion: 1,
      featureId: "tool-call-coalescing",
      verdict: report.verdict,
      matchIndex: report.matchIndex,
    },
    sessionId: deriveSessionId(payload),
    eventId: `coalesce-${stableId(payload.transcript_path ?? "", String(turns.length), payload.tool_name)}`,
    latencyMs: Date.now() - start,
  });

  if (report.verdict !== "duplicate") return emitNoop();

  return emitAdditionalContext(
    `⚠️ Cost-guard (duplicate call): this exact ${payload.tool_name} call (identical canonical ` +
      `input) was already dispatched in this turn's parallel block. The first result will cover ` +
      `both — reuse it instead of paying for the same call twice.`,
    payload.hook_event_name ?? "PreToolUse",
  );
});

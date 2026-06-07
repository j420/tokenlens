#!/usr/bin/env node
/**
 * Tool-Error-Rate Breaker — PostToolUse hook  (Cost-Security).
 *
 * Catches a degeneration signal `loop-breaker` misses: a sustained high
 * TOOL-ERROR rate over a window — malformed args, file-not-found, non-zero
 * exits — each retried, each re-billing the turn. `loop-breaker` keys on
 * token-ROI magnitude; a session can keep non-low ROI while its tool calls keep
 * failing, and it won't catch it.
 *
 * This hook replays the session view and reads ONLY the host-tagged
 * `toolResults[].is_error` boolean over the recent window — never the result
 * content/prose. When enough tagged calls fail, it advises the agent to fix the
 * call shape (or step back) instead of retrying the same broken invocation.
 *
 * Fail-open on missing signal: `is_error` is an OPTIONAL host field. On
 * hosts/turns that don't populate it the detector is a permanent honest no-op —
 * it never falls back to text-matching. Advisory; never blocks.
 *
 * Config:
 *   PRUNE_TOOL_ERROR_DISABLED  "1" → no-op.
 *   PRUNE_TOOL_ERROR_WINDOW    turns to look back over (default 5).
 *   PRUNE_TOOL_ERROR_FLOOR     min tagged calls before firing (default 4).
 *   PRUNE_TOOL_ERROR_THRESHOLD error-rate trip point in [0,1] (default 0.5).
 */

import { loadCachedSessionView } from "@prune/telemetry";
import { assessToolErrorRate } from "@prune/cost-security";

import { emitAdditionalContext, emitNoop, readHookPayload, safeRun } from "./_runtime.mjs";
import { deriveSessionId, recordFeatureEventBestEffort, stableId } from "./_telemetry.mjs";

function posIntEnv(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

function unitEnv(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

safeRun(async () => {
  if (process.env.PRUNE_TOOL_ERROR_DISABLED === "1") return emitNoop();

  const start = Date.now();
  const payload = await readHookPayload();
  if (!payload.transcript_path) return emitNoop();

  const { turns } = await loadCachedSessionView(payload.transcript_path);
  if (turns.length === 0) return emitNoop();

  // Window over the most recent turns; flatten their tool results to the only
  // signal we read — the host-tagged is_error boolean.
  const windowTurns = posIntEnv("PRUNE_TOOL_ERROR_WINDOW") ?? 5;
  const recent = turns.slice(-windowTurns);
  const results = [];
  for (const t of recent) {
    for (const r of t.toolResults ?? []) {
      results.push({ isError: r.is_error });
    }
  }

  const options = {};
  const floor = posIntEnv("PRUNE_TOOL_ERROR_FLOOR");
  if (floor !== undefined) options.floor = floor;
  const threshold = unitEnv("PRUNE_TOOL_ERROR_THRESHOLD");
  if (threshold !== undefined) options.threshold = threshold;

  const report = assessToolErrorRate(results, options);

  await recordFeatureEventBestEffort({
    featureId: "tool-error-rate",
    qualityProof: {
      schemaVersion: 1,
      featureId: "tool-error-rate",
      verdict: report.verdict,
      errorCount: report.errorCount,
      observedCount: report.observedCount,
      ratio: report.ratio,
    },
    sessionId: deriveSessionId(payload),
    eventId: `tool-error-${stableId(payload.transcript_path ?? "", String(turns.length))}`,
    latencyMs: Date.now() - start,
  });

  if (report.verdict !== "warn") return emitNoop();

  const pct = Math.round((report.ratio ?? 0) * 100);
  return emitAdditionalContext(
    `⚠️ Cost-guard (tool errors): ${report.errorCount} of the last ${report.observedCount} tool ` +
      `calls failed (${pct}%). Repeating the same failing call burns tokens without progress — ` +
      `fix the call shape (check the path/args), or step back and re-read the error once before ` +
      `retrying.`,
    payload.hook_event_name ?? "PostToolUse",
    {
      verdict: report.verdict,
      error_count: report.errorCount,
      observed_count: report.observedCount,
    }
  );
});

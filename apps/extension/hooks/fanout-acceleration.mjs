#!/usr/bin/env node
/**
 * Fan-Out Acceleration — PreToolUse(Task) hook  (Cost-Security).
 *
 * Complements `subagent-warden` (which caps the ABSOLUTE fan-out size) with the
 * DERIVATIVE it misses: a task whose spawn rate climbs super-linearly turn over
 * turn (2 -> 5 -> 12 ...) — the signature of a recursive/amplifying decomposition
 * that stays under every absolute cap until it suddenly blows the budget. This
 * hook buckets subagent spawns per turn in the per-session store and runs the
 * deterministic acceleration check (assessFanoutAcceleration).
 *
 * Advisory by default; opt-in block. Fail-open. Runs alongside subagent-warden
 * (both PreToolUse/Task) without touching it.
 *
 * Config:
 *   PRUNE_FANOUT_DISABLED "1" → no-op.
 *   PRUNE_FANOUT_BLOCK    "1" → block the spawn (exit 2) instead of advising.
 *   PRUNE_FANOUT_ACCEL    acceleration threshold (default 2).
 */

import { assessFanoutAcceleration } from "@prune/cost-security";
import { loadCachedSessionView } from "@prune/telemetry";

import { emitAdditionalContext, emitBlock, emitNoop, readHookPayload, safeRun } from "./_runtime.mjs";
import { deriveSessionId, recordFeatureEventBestEffort, stableId } from "./_telemetry.mjs";
import { updateSessionStore } from "./_session-store.mjs";

function posNumEnv(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

safeRun(async () => {
  if (process.env.PRUNE_FANOUT_DISABLED === "1") return emitNoop();
  const payload = await readHookPayload();
  if (payload.tool_name !== "Task") return emitNoop();

  const start = Date.now();

  // Turn id = number of turns so far (best-effort; falls back to a coarse bucket).
  let turnId = 0;
  if (payload.transcript_path) {
    try {
      const { turns } = await loadCachedSessionView(payload.transcript_path);
      turnId = Array.isArray(turns) ? turns.length : 0;
    } catch {
      turnId = 0;
    }
  }

  const store = updateSessionStore(payload.transcript_path, (s) => {
    s.seq += 1;
    const last = s.fanoutTurns[s.fanoutTurns.length - 1];
    // turnId 0 means "unknown" — bucket those together under the running seq.
    const bucket = turnId > 0 ? turnId : -1;
    if (last && last.turn === bucket) {
      last.count += 1;
    } else {
      s.fanoutTurns.push({ turn: bucket, count: 1 });
    }
  });

  const series = store.fanoutTurns.map((e) => e.count);
  const report = assessFanoutAcceleration(series, { accelThreshold: posNumEnv("PRUNE_FANOUT_ACCEL") ?? 2 });

  await recordFeatureEventBestEffort({
    featureId: "fanout-acceleration",
    qualityProof: {
      schemaVersion: 1,
      featureId: "fanout-acceleration",
      accelerating: report.accelerating,
      latest: report.latest,
      secondDiff: report.secondDiff,
    },
    sessionId: deriveSessionId(payload),
    eventId: `fanout-${stableId(payload.transcript_path ?? "", String(store.seq))}`,
    latencyMs: Date.now() - start,
  });

  if (!report.accelerating) return emitNoop();

  const message =
    `🌳 Cost-guard (fan-out): subagent spawns are accelerating ` +
    `(${report.cumulative} total; latest turn +${report.latest}, acceleration +${report.secondDiff}). ` +
    `A recursive/amplifying decomposition can blow the budget a few turns out. ` +
    `Confirm this breadth is intended, or consolidate the work before spawning more.`;

  if (process.env.PRUNE_FANOUT_BLOCK === "1") {
    return emitBlock(message, {
      cumulative: report.cumulative,
      latest: report.latest,
      second_diff: report.secondDiff,
    });
  }

  return emitAdditionalContext(message, payload.hook_event_name ?? "PreToolUse", {
    cumulative: report.cumulative,
    latest: report.latest,
    second_diff: report.secondDiff,
  });
});

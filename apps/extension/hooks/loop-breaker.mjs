#!/usr/bin/env node
/**
 * Loop circuit-breaker hook.
 *
 * Wire as a Stop or PostToolUse hook in Claude Code. Replays the session from
 * the transcript and blocks on either of two no-progress signals:
 *
 *   1. ROI loop — 3 consecutive low-ROI turns (the original signal), with a
 *      routing suggestion.
 *   2. Identical-action loop (degeneration fold) — the EXACT same tool call
 *      (tool + canonicalized input) returning the EXACT same result N times.
 *      That is provable no-progress: the world did not change between calls.
 *      The result-SHA gate keeps a same-args call that returns a DIFFERENT
 *      result (real progress) from tripping it.
 *
 * Both are fail-safe (block only on a confirmed signal). Config:
 *   PRUNE_IDENTICAL_ACTION_DISABLED "1" → skip the identical-action trip.
 *   PRUNE_IDENTICAL_ACTION_MIN      override repetitions threshold (default 3).
 */

import { createHash } from "node:crypto";

import { loadCachedSessionView } from "@prune/telemetry";
import {
  evaluateLoopBlock,
  formatLoopBlockMessage,
  evaluateIdenticalActionLoop,
} from "@prune/intelligence";
import {
  emitBlock,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

function posIntEnv(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

/** Stable short hash of a tool result's content (no content is retained). */
function resultShaFor(content) {
  try {
    const s = typeof content === "string" ? content : JSON.stringify(content);
    return createHash("sha256").update(s ?? "").digest("hex").slice(0, 12);
  } catch {
    return "unhashable";
  }
}

/**
 * Pair each tool USE with its RESULT (by tool_use_id) and project onto the
 * ActionObservation shape the detector consumes. Only calls with a paired
 * result are included — we can't compare result SHAs without one.
 */
function buildActionObservations(turns) {
  const observations = [];
  for (const t of turns) {
    const resultById = new Map();
    for (const r of t.toolResults ?? []) {
      if (r && typeof r.tool_use_id === "string") resultById.set(r.tool_use_id, r);
    }
    for (const u of t.toolUses ?? []) {
      const r = u.id ? resultById.get(u.id) : undefined;
      if (!r) continue;
      observations.push({
        turn: t.turnNumber,
        tool: u.name,
        input: u.input,
        resultSha: resultShaFor(r.content),
      });
    }
  }
  return observations;
}

safeRun(async () => {
  const payload = await readHookPayload();
  if (!payload.transcript_path) return emitNoop();

  const { turns, walk } = await loadCachedSessionView(payload.transcript_path);
  if (turns.length === 0) return emitNoop();

  // 1) ROI-based loop block (original behaviour).
  if (walk && turns.length >= 3) {
    const decision = evaluateLoopBlock(walk, {
      consecutiveLowRoiThreshold: 3,
      currentModel: turns[turns.length - 1]?.model,
    });
    if (decision.shouldBlock) {
      return emitBlock(formatLoopBlockMessage(decision), {
        streak: decision.consecutiveLowRoiTurns,
        suggestion: decision.suggestion ?? null,
      });
    }
  }

  // 2) Identical-action loop (degeneration fold).
  if (process.env.PRUNE_IDENTICAL_ACTION_DISABLED !== "1") {
    const observations = buildActionObservations(turns);
    const minRepetitions = posIntEnv("PRUNE_IDENTICAL_ACTION_MIN") ?? 3;
    const idl = evaluateIdenticalActionLoop(observations, { minRepetitions });
    if (idl.shouldBlock) {
      return emitBlock(idl.reason, {
        kind: "identical-action",
        tool: idl.tool ?? null,
        repetitions: idl.repetitions ?? null,
        turns: idl.turns ?? null,
      });
    }
  }

  return emitNoop();
});

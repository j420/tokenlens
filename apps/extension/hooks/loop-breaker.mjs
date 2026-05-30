#!/usr/bin/env node
/**
 * Loop circuit-breaker hook.
 *
 * Wire as a Stop or PostToolUse hook in Claude Code. Replays the session
 * ROI from the transcript and, on 3 consecutive low-ROI turns, blocks
 * with a human-readable reason and a routing suggestion.
 */

import {
  TranscriptReader,
  groupIntoTurns,
  toTurnDataLike,
} from "@prune/telemetry";
import {
  evaluateLoopBlock,
  formatLoopBlockMessage,
  replaySession,
} from "@prune/intelligence";
import {
  emitBlock,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

safeRun(async () => {
  const payload = await readHookPayload();
  if (!payload.transcript_path) return emitNoop();

  const reader = new TranscriptReader(payload.transcript_path);
  if (!reader.exists()) return emitNoop();

  const { messages } = await reader.readAll();
  const turns = groupIntoTurns(messages);
  if (turns.length < 3) return emitNoop();

  const walk = replaySession(turns.map((t) => toTurnDataLike(t)));
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
  return emitNoop();
});

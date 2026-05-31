#!/usr/bin/env node
/**
 * Loop circuit-breaker hook.
 *
 * Wire as a Stop or PostToolUse hook in Claude Code. Replays the session
 * ROI from the transcript and, on 3 consecutive low-ROI turns, blocks
 * with a human-readable reason and a routing suggestion.
 */

import { loadCachedSessionView } from "@prune/telemetry";
import {
  evaluateLoopBlock,
  formatLoopBlockMessage,
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

  const { turns, walk } = await loadCachedSessionView(payload.transcript_path);
  if (turns.length < 3 || !walk) return emitNoop();

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

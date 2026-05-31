#!/usr/bin/env node
/**
 * Subagent Warden — PreToolUse hook for the Task tool.
 *
 * Stops the documented subagent-runaway incident class before the
 * proposed Task spawns:
 *   - 49 parallel subagents / 2.5h / $8K–$15K (/typescript-checks)
 *   - 23 subagents / 3 days unattended / $47K (financial-services team)
 * Sources: https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code
 *          https://buildtolaunch.substack.com/p/claude-code-token-optimization
 *
 * Reads the live session view, projects the activity state with the
 * proposed Task added (proposedTaskCount=1), and routes via the
 * `evaluateSubagentBlock` policy. Hard breaches → exit 2 with a
 * pattern-tagged reason. Soft warnings → emit `additionalContext`.
 *
 * Configuration (env vars):
 *   PRUNE_SUBAGENT_DISABLED       Set "1" to make this hook a no-op.
 *   PRUNE_SUBAGENT_MAX_CONCURRENT Cap on concurrent active subagents (default 15).
 *   PRUNE_SUBAGENT_MAX_BURST      Cap per 60s burst (default 10).
 *   PRUNE_SUBAGENT_MAX_PARALLEL   Cap on parallel Task uses in one turn (default 12).
 *   PRUNE_SUBAGENT_MAX_MINUTES    Per-subagent lifetime ceiling minutes (default 30).
 *
 * Wire as a PreToolUse hook with matcher "Task" so it only fires on
 * subagent spawns. Non-Task tool calls fall through to noop.
 */

import { loadCachedSessionView } from "@prune/telemetry";
import {
  analyzeSubagents,
  evaluateSubagentBlock,
  formatSubagentBlockMessage,
} from "@prune/intelligence";

import {
  emitAdditionalContext,
  emitBlock,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

function intFromEnv(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

safeRun(async () => {
  if (process.env.PRUNE_SUBAGENT_DISABLED === "1") return emitNoop();
  const payload = await readHookPayload();

  // Only fire on Task; PreToolUse hooks may receive other tools too if the
  // matcher isn't configured. Be defensive — silent noop on anything else.
  if (payload.tool_name && payload.tool_name !== "Task") return emitNoop();
  if (!payload.transcript_path) return emitNoop();

  const { turns } = await loadCachedSessionView(payload.transcript_path);
  if (!turns || turns.length === 0) return emitNoop();

  const activity = analyzeSubagents(turns);

  const decision = evaluateSubagentBlock(activity, {
    proposedTaskCount: 1, // the Task this hook is gating
    maxConcurrentSubagents: intFromEnv("PRUNE_SUBAGENT_MAX_CONCURRENT", 15),
    maxBurstCount: intFromEnv("PRUNE_SUBAGENT_MAX_BURST", 10),
    maxParallelInOneTurn: intFromEnv("PRUNE_SUBAGENT_MAX_PARALLEL", 12),
    maxSubagentMinutes: intFromEnv("PRUNE_SUBAGENT_MAX_MINUTES", 30),
  });

  if (decision.shouldBlock) {
    return emitBlock(formatSubagentBlockMessage(decision), {
      pattern: decision.pattern,
      active_count: activity.activeCount,
      total_count: activity.totalCount,
      longest_active_minutes: activity.longestActiveMinutes,
      peak_parallel_in_one_turn: activity.peakParallelInOneTurn,
      burst_count: activity.bursts.length,
      suggestion: decision.suggestion ?? null,
    });
  }

  if (decision.warnings.length > 0) {
    return emitAdditionalContext(
      formatSubagentBlockMessage(decision),
      "PreToolUse",
      {
        active_count: activity.activeCount,
        peak_parallel_in_one_turn: activity.peakParallelInOneTurn,
        warnings: decision.warnings.map((w) => w.pattern),
      }
    );
  }

  return emitNoop();
});

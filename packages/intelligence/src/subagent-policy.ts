/**
 * Subagent policy — pure decision layer. Given a current
 * `SubagentActivity` snapshot and a proposed Task spawn, returns
 * `SubagentBlockDecision` the hook can route on.
 *
 * Every block carries a stable `pattern` id so dashboards and audit
 * logs can roll up by incident class. Every reason cites the numbers
 * that triggered the rule — required for the "explainable to a
 * skeptical platform engineer" hard rule from CLAUDE.md.
 *
 * Default thresholds are tuned conservatively against the documented
 * incidents:
 *   - 49 parallel subagents in 2.5h → 5/min burst, 15 concurrent caps.
 *   - 23 unattended subagents 3 days → 30-minute lifetime ceiling.
 * Users can override per workload.
 */

import type { SubagentActivity } from "./subagent-walk.js";

export type SubagentPattern =
  | "FAN_OUT_RUNAWAY"
  | "UNATTENDED_LOOP"
  | "DEEP_NESTING"
  | "CONCURRENT_CAP"
  | "PEAK_PARALLEL_IN_TURN";

export interface SubagentBlockDecision {
  shouldBlock: boolean;
  pattern: SubagentPattern | null;
  reason: string | null;
  /** Soft-warn messages that surface as additionalContext when not blocked. */
  warnings: Array<{ pattern: SubagentPattern; message: string }>;
  /**
   * Best-effort recommendation the agent can act on. e.g.
   * "wait for active subagents to complete" or "increase
   * --max-subagents flag if intentional".
   */
  suggestion?: string;
}

export interface SubagentPolicyOptions {
  /** Hard cap on concurrent active subagents. Default 15. */
  maxConcurrentSubagents?: number;
  /** Hard cap on subagents started in `burstWindowMs`. Default 10 / 60s. */
  maxBurstCount?: number;
  /** Hard cap on parallel Task uses in a single turn. Default 12. */
  maxParallelInOneTurn?: number;
  /** Soft warn for parallel Task uses in a single turn. Default 6. */
  warnParallelInOneTurn?: number;
  /** Hard cap on minutes any single subagent may run. Default 30. */
  maxSubagentMinutes?: number;
  /** Soft warn when an active subagent crosses this minute mark. Default 15. */
  warnSubagentMinutes?: number;
  /**
   * Number of Task spawns the caller is *about to* issue (default 0). The
   * concurrent + per-turn caps treat the projected count (`activeCount +
   * proposedTaskCount`) as if it were already live, so a PreToolUse hook
   * can pass 1 here and get blocked at the boundary instead of one call
   * after the breach.
   */
  proposedTaskCount?: number;
}

const DEFAULTS: Required<SubagentPolicyOptions> = {
  maxConcurrentSubagents: 15,
  maxBurstCount: 10,
  maxParallelInOneTurn: 12,
  warnParallelInOneTurn: 6,
  maxSubagentMinutes: 30,
  warnSubagentMinutes: 15,
  proposedTaskCount: 0,
};

export function evaluateSubagentBlock(
  activity: SubagentActivity,
  opts: SubagentPolicyOptions = {}
): SubagentBlockDecision {
  const o = { ...DEFAULTS, ...opts };
  const warnings: SubagentBlockDecision["warnings"] = [];
  const projectedActive = activity.activeCount + o.proposedTaskCount;
  const projectedPeak = Math.max(
    activity.peakParallelInOneTurn,
    o.proposedTaskCount
  );

  // Block #1 — UNATTENDED_LOOP. The 23-subagent / 3-day / $47K pattern.
  if (activity.longestActiveMinutes > o.maxSubagentMinutes) {
    return {
      shouldBlock: true,
      pattern: "UNATTENDED_LOOP",
      reason:
        `UNATTENDED_LOOP: an active subagent has been running for ` +
        `${activity.longestActiveMinutes.toFixed(1)} minutes, exceeding the ` +
        `${o.maxSubagentMinutes}-minute ceiling. Pattern matches the documented ` +
        `23-subagent / 3-day / $47K incident.`,
      warnings,
      suggestion:
        "Terminate runaway subagents or raise --max-subagent-minutes if " +
        "intentional. Long-running fan-outs accrue cost without bounded " +
        "human oversight.",
    };
  }

  // Block #2 — CONCURRENT_CAP. Slower-growing but unbounded fan-out.
  if (projectedActive > o.maxConcurrentSubagents) {
    return {
      shouldBlock: true,
      pattern: "CONCURRENT_CAP",
      reason:
        `CONCURRENT_CAP: ${projectedActive} subagents would be active ` +
        `(${activity.activeCount} running + ${o.proposedTaskCount} proposed), ` +
        `exceeding the ${o.maxConcurrentSubagents}-concurrent ceiling. ` +
        `Pattern approaches the 49-subagent / 2.5h / $8K-$15K incident.`,
      warnings,
      suggestion:
        "Wait for active subagents to drain before spawning more, or raise " +
        "--max-concurrent-subagents if the fan-out is intentional and bounded.",
    };
  }

  // Block #3 — FAN_OUT_RUNAWAY. A single burst overshoots the threshold.
  const worstBurst = activity.bursts
    .slice()
    .sort((a, b) => b.count - a.count)[0];
  if (worstBurst && worstBurst.count > o.maxBurstCount) {
    const windowSec = Math.round(
      (worstBurst.windowEnd.getTime() - worstBurst.windowStart.getTime()) / 1000
    );
    return {
      shouldBlock: true,
      pattern: "FAN_OUT_RUNAWAY",
      reason:
        `FAN_OUT_RUNAWAY: ${worstBurst.count} subagents were spawned inside a ` +
        `${windowSec}s window, exceeding the ${o.maxBurstCount}-per-burst ` +
        `ceiling. Pattern matches the documented /typescript-checks 49-subagent ` +
        `incident (parallel spawn within seconds).`,
      warnings,
      suggestion:
        "Serialize spawns or batch the underlying work. Run subagents in " +
        "phases of <= --max-burst-count to bound cost.",
    };
  }

  // Block #4 — PEAK_PARALLEL_IN_TURN. One turn issuing too many parallel Tasks.
  if (projectedPeak > o.maxParallelInOneTurn) {
    return {
      shouldBlock: true,
      pattern: "PEAK_PARALLEL_IN_TURN",
      reason:
        `PEAK_PARALLEL_IN_TURN: a turn would issue ${projectedPeak} ` +
        `parallel Task uses, exceeding the ${o.maxParallelInOneTurn}-per-turn ceiling.`,
      warnings,
      suggestion:
        "Reduce the per-turn fan-out, or raise --max-parallel-in-turn if " +
        "intentional. Per-turn caps prevent silent compound runaway across turns.",
    };
  }

  // Warnings (do not block, surface as additionalContext).
  if (
    projectedPeak > o.warnParallelInOneTurn &&
    projectedPeak <= o.maxParallelInOneTurn
  ) {
    warnings.push({
      pattern: "PEAK_PARALLEL_IN_TURN",
      message:
        `Soft warning: a turn would issue ${projectedPeak} parallel ` +
        `Task uses (warn threshold ${o.warnParallelInOneTurn}, block at ` +
        `${o.maxParallelInOneTurn}). Watch for compound fan-out across turns.`,
    });
  }
  for (const inv of activity.invocations) {
    if (inv.status !== "active" || !inv.startedAt) continue;
    const minutes = activity.longestActiveMinutes; // already computed
    if (minutes > o.warnSubagentMinutes && minutes <= o.maxSubagentMinutes) {
      warnings.push({
        pattern: "UNATTENDED_LOOP",
        message:
          `Soft warning: an active subagent has been running for ` +
          `${minutes.toFixed(1)} minutes (warn at ${o.warnSubagentMinutes}, ` +
          `block at ${o.maxSubagentMinutes}). Verify it has bounded work left.`,
      });
      break; // one message is enough
    }
  }

  return {
    shouldBlock: false,
    pattern: null,
    reason: null,
    warnings,
  };
}

export function formatSubagentBlockMessage(d: SubagentBlockDecision): string {
  if (!d.shouldBlock) {
    const ws = d.warnings.map((w) => "• " + w.message).join("\n");
    return ws.length > 0 ? `Subagent advisory:\n${ws}` : "Subagent state OK.";
  }
  const parts: string[] = ["⛔ Subagent runaway prevention engaged.", "", d.reason ?? ""];
  if (d.suggestion) parts.push("", "Suggested action: " + d.suggestion);
  return parts.filter(Boolean).join("\n");
}

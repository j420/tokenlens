import { describe, it, expect } from "vitest";

import {
  analyzeSubagents,
  type SubagentWalkTurn,
} from "./subagent-walk.js";

import {
  evaluateSubagentBlock,
  formatSubagentBlockMessage,
} from "./subagent-policy.js";

// ============================================================================
// Helpers — build synthetic transcripts.
// ============================================================================

function turn(
  n: number,
  opts: {
    taskIds?: string[];
    completed?: string[];
    errored?: string[];
    startedAt?: string;
    endedAt?: string;
    subagentType?: string;
  } = {}
): SubagentWalkTurn {
  const taskIds = opts.taskIds ?? [];
  return {
    turnNumber: n,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
    toolUses: taskIds.map((id, i) => ({
      name: "Task",
      id,
      input: {
        subagent_type: opts.subagentType ?? "general-purpose",
        description: `subagent ${i}`,
      },
    })),
    toolResults: [
      ...(opts.completed ?? []).map((id) => ({
        tool_use_id: id,
        content: "ok",
        is_error: false,
      })),
      ...(opts.errored ?? []).map((id) => ({
        tool_use_id: id,
        content: "boom",
        is_error: true,
      })),
    ],
  };
}

// ============================================================================
// Walker
// ============================================================================

describe("analyzeSubagents — pure walker", () => {
  it("zero turns → empty activity", () => {
    const a = analyzeSubagents([]);
    expect(a.totalCount).toBe(0);
    expect(a.activeCount).toBe(0);
    expect(a.peakParallelInOneTurn).toBe(0);
    expect(a.bursts).toEqual([]);
  });

  it("counts Task tool_uses only; ignores non-Task tools", () => {
    const a = analyzeSubagents([
      {
        turnNumber: 1,
        toolUses: [
          { name: "Read", id: "r1" },
          { name: "Task", id: "t1" },
          { name: "Bash", id: "b1" },
        ],
        toolResults: [],
      },
    ]);
    expect(a.totalCount).toBe(1);
    expect(a.peakParallelInOneTurn).toBe(1);
  });

  it("matches tool_results by tool_use_id; completed → status 'completed'", () => {
    const a = analyzeSubagents([
      turn(1, { taskIds: ["t1", "t2"], completed: ["t1"] }),
    ]);
    expect(a.totalCount).toBe(2);
    expect(a.activeCount).toBe(1);
    expect(a.invocations[0].status).toBe("completed");
    expect(a.invocations[1].status).toBe("active");
  });

  it("errored results are not 'active' but flagged 'errored'", () => {
    const a = analyzeSubagents([
      turn(1, { taskIds: ["t1"], errored: ["t1"] }),
    ]);
    expect(a.invocations[0].status).toBe("errored");
    expect(a.activeCount).toBe(0);
  });

  it("peakParallelInOneTurn picks the worst turn, not the sum", () => {
    const a = analyzeSubagents([
      turn(1, { taskIds: ["a", "b", "c"] }),
      turn(2, { taskIds: ["d", "e", "f", "g", "h"] }),
      turn(3, { taskIds: ["i"] }),
    ]);
    expect(a.peakParallelInOneTurn).toBe(5);
  });

  it("detects a burst when N spawns land inside the window", () => {
    // 8 subagents in two turns 30s apart → one burst of 8 in <60s.
    const t1 = "2026-05-15T10:00:00.000Z";
    const t2 = "2026-05-15T10:00:30.000Z";
    const a = analyzeSubagents([
      turn(1, { taskIds: ["a", "b", "c", "d"], startedAt: t1, endedAt: t1 }),
      turn(2, { taskIds: ["e", "f", "g", "h"], startedAt: t2, endedAt: t2 }),
    ]);
    expect(a.bursts.length).toBe(1);
    expect(a.bursts[0].count).toBe(8);
  });

  it("no burst when spawns are spread wider than the window", () => {
    const t1 = "2026-05-15T10:00:00.000Z";
    const t2 = "2026-05-15T10:05:00.000Z"; // 5 min later
    const a = analyzeSubagents([
      turn(1, { taskIds: ["a", "b"], startedAt: t1, endedAt: t1 }),
      turn(2, { taskIds: ["c", "d"], startedAt: t2, endedAt: t2 }),
    ]);
    expect(a.bursts).toEqual([]);
  });

  it("longestActiveMinutes reflects the oldest active subagent", () => {
    const started = new Date("2026-05-15T09:00:00.000Z").toISOString();
    const a = analyzeSubagents(
      [turn(1, { taskIds: ["t1"], startedAt: started })],
      { asOf: new Date("2026-05-15T09:45:00.000Z") }
    );
    expect(a.longestActiveMinutes).toBeCloseTo(45, 0);
  });
});

// ============================================================================
// Policy
// ============================================================================

describe("evaluateSubagentBlock — policy", () => {
  it("clean state → allow", () => {
    const d = evaluateSubagentBlock({
      invocations: [],
      activeCount: 0,
      totalCount: 0,
      longestActiveMinutes: 0,
      peakParallelInOneTurn: 0,
      bursts: [],
    });
    expect(d.shouldBlock).toBe(false);
    expect(d.warnings).toHaveLength(0);
  });

  it("UNATTENDED_LOOP fires when a single subagent crosses lifetime ceiling", () => {
    const d = evaluateSubagentBlock(
      {
        invocations: [],
        activeCount: 1,
        totalCount: 1,
        longestActiveMinutes: 45,
        peakParallelInOneTurn: 1,
        bursts: [],
      },
      { maxSubagentMinutes: 30 }
    );
    expect(d.shouldBlock).toBe(true);
    expect(d.pattern).toBe("UNATTENDED_LOOP");
    expect(d.reason).toMatch(/45/); // minutes surfaced
    expect(d.reason).toMatch(/23-subagent/); // documented incident referenced
  });

  it("CONCURRENT_CAP fires before FAN_OUT_RUNAWAY would", () => {
    const d = evaluateSubagentBlock(
      {
        invocations: [],
        activeCount: 20,
        totalCount: 20,
        longestActiveMinutes: 1,
        peakParallelInOneTurn: 5,
        bursts: [],
      },
      { maxConcurrentSubagents: 15 }
    );
    expect(d.shouldBlock).toBe(true);
    expect(d.pattern).toBe("CONCURRENT_CAP");
    expect(d.reason).toMatch(/49-subagent/); // ties to documented incident
  });

  it("FAN_OUT_RUNAWAY fires when a burst exceeds the threshold", () => {
    const burstStart = new Date("2026-05-15T10:00:00.000Z");
    const burstEnd = new Date("2026-05-15T10:00:30.000Z");
    const d = evaluateSubagentBlock(
      {
        invocations: [],
        activeCount: 3,
        totalCount: 12,
        longestActiveMinutes: 0.5,
        peakParallelInOneTurn: 5,
        bursts: [
          {
            windowStart: burstStart,
            windowEnd: burstEnd,
            count: 12,
            toolUseIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"],
          },
        ],
      },
      { maxBurstCount: 10 }
    );
    expect(d.shouldBlock).toBe(true);
    expect(d.pattern).toBe("FAN_OUT_RUNAWAY");
    expect(d.reason).toMatch(/typescript-checks/);
  });

  it("PEAK_PARALLEL_IN_TURN fires on a single huge turn", () => {
    const d = evaluateSubagentBlock(
      {
        invocations: [],
        activeCount: 0,
        totalCount: 49,
        longestActiveMinutes: 0,
        peakParallelInOneTurn: 49,
        bursts: [],
      },
      { maxParallelInOneTurn: 12 }
    );
    expect(d.shouldBlock).toBe(true);
    expect(d.pattern).toBe("PEAK_PARALLEL_IN_TURN");
  });

  it("soft-warns on peak parallel between warn and block thresholds", () => {
    const d = evaluateSubagentBlock(
      {
        invocations: [],
        activeCount: 0,
        totalCount: 8,
        longestActiveMinutes: 0,
        peakParallelInOneTurn: 8,
        bursts: [],
      },
      { warnParallelInOneTurn: 6, maxParallelInOneTurn: 12 }
    );
    expect(d.shouldBlock).toBe(false);
    expect(d.warnings.some((w) => w.pattern === "PEAK_PARALLEL_IN_TURN")).toBe(true);
  });

  it("proposedTaskCount blocks at the boundary, not one after", () => {
    // 15 active + 1 proposed = 16 > 15 → block.
    const d = evaluateSubagentBlock(
      {
        invocations: [],
        activeCount: 15,
        totalCount: 15,
        longestActiveMinutes: 1,
        peakParallelInOneTurn: 5,
        bursts: [],
      },
      { maxConcurrentSubagents: 15, proposedTaskCount: 1 }
    );
    expect(d.shouldBlock).toBe(true);
    expect(d.pattern).toBe("CONCURRENT_CAP");
    expect(d.reason).toMatch(/16 subagents would be active/);
  });

  it("proposedTaskCount=0 keeps post-hoc semantics", () => {
    // 15 active + 0 proposed = 15, not > 15 → allow.
    const d = evaluateSubagentBlock(
      {
        invocations: [],
        activeCount: 15,
        totalCount: 15,
        longestActiveMinutes: 1,
        peakParallelInOneTurn: 5,
        bursts: [],
      },
      { maxConcurrentSubagents: 15 }
    );
    expect(d.shouldBlock).toBe(false);
  });

  it("formatSubagentBlockMessage surfaces reason + suggestion when blocked", () => {
    const d = evaluateSubagentBlock(
      {
        invocations: [],
        activeCount: 1,
        totalCount: 1,
        longestActiveMinutes: 45,
        peakParallelInOneTurn: 1,
        bursts: [],
      },
      { maxSubagentMinutes: 30 }
    );
    const msg = formatSubagentBlockMessage(d);
    expect(msg).toMatch(/⛔/);
    expect(msg).toMatch(/UNATTENDED_LOOP/);
    expect(msg).toMatch(/Suggested action/);
  });
});

// ============================================================================
// End-to-end on a synthetic incident pattern
// ============================================================================

describe("documented incident replays", () => {
  it("/typescript-checks 49-subagent fan-out blocks via FAN_OUT_RUNAWAY", () => {
    // Synthesize the documented pattern: 49 parallel Task uses in one turn,
    // started near-simultaneously, none have completed yet.
    const t0 = "2026-05-15T10:00:00.000Z";
    const ids = Array.from({ length: 49 }, (_, i) => `task-${i}`);
    const turns: SubagentWalkTurn[] = [
      {
        turnNumber: 1,
        startedAt: t0,
        endedAt: t0,
        toolUses: ids.map((id) => ({
          name: "Task",
          id,
          input: { subagent_type: "general-purpose", description: "check" },
        })),
        toolResults: [],
      },
    ];
    const activity = analyzeSubagents(turns, {
      asOf: new Date("2026-05-15T10:01:00.000Z"),
    });
    expect(activity.peakParallelInOneTurn).toBe(49);
    expect(activity.activeCount).toBe(49);

    // At default thresholds (concurrent=15, per-turn=12, burst=10), CONCURRENT_CAP fires first
    // because activeCount(49) > maxConcurrentSubagents(15). All three rules would catch it —
    // CONCURRENT_CAP is the most precise framing.
    const decision = evaluateSubagentBlock(activity);
    expect(decision.shouldBlock).toBe(true);
    expect(["CONCURRENT_CAP", "FAN_OUT_RUNAWAY", "PEAK_PARALLEL_IN_TURN"]).toContain(
      decision.pattern
    );
  });

  it("23-subagent / 3-day unattended loop blocks via UNATTENDED_LOOP", () => {
    const started = "2026-05-12T10:00:00.000Z"; // 3 days ago
    const asOf = new Date("2026-05-15T10:00:00.000Z");
    const ids = Array.from({ length: 23 }, (_, i) => `task-${i}`);
    const turns: SubagentWalkTurn[] = [
      {
        turnNumber: 1,
        startedAt: started,
        endedAt: started,
        toolUses: ids.map((id) => ({
          name: "Task",
          id,
          input: { subagent_type: "general-purpose" },
        })),
        toolResults: [],
      },
    ];
    const activity = analyzeSubagents(turns, { asOf });
    expect(activity.activeCount).toBe(23);
    expect(activity.longestActiveMinutes).toBeGreaterThan(60 * 24 * 2); // > 2 days in minutes

    const decision = evaluateSubagentBlock(activity);
    expect(decision.shouldBlock).toBe(true);
    expect(decision.pattern).toBe("UNATTENDED_LOOP");
  });
});

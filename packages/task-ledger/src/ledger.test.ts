import { describe, it, expect } from "vitest";
import { rollupTaskLedger, eventCostUsd, type SpendEvent } from "./ledger.js";

const PRICED = "claude-sonnet-4-5-20250929"; // input 3, output 15, cached 0.375
const UNPRICED = "totally-made-up-model-9000";

function ev(o: Partial<SpendEvent> & Pick<SpendEvent, "taskId" | "outcome">): SpendEvent {
  return {
    model: PRICED,
    inputTokens: 1000,
    outputTokens: 500,
    ...o,
  };
}

describe("eventCostUsd", () => {
  it("prices a known model: (1000*3 + 500*15)/1e6 = 0.0105", () => {
    expect(eventCostUsd(ev({ taskId: "t", outcome: "accepted" }))).toBeCloseTo(0.0105, 9);
  });

  it("uses cached_input for cache-read tokens", () => {
    // cacheRead 2000 @ 0.375 = 0.00075 on top of 0.0105
    const c = eventCostUsd(ev({ taskId: "t", outcome: "accepted", cacheReadTokens: 2000 }));
    expect(c).toBeCloseTo(0.0105 + 0.00075, 9);
  });

  it("returns null on an unpriced model (never fabricates)", () => {
    expect(eventCostUsd(ev({ taskId: "t", outcome: "accepted", model: UNPRICED }))).toBeNull();
  });
});

describe("rollupTaskLedger", () => {
  it("aggregates a task and computes cost-per-accepted over the real denominator", () => {
    // 1 accepted + 3 retries on the same task → cost-per-accepted reflects ALL spend.
    const events: SpendEvent[] = [
      ev({ taskId: "T1", outcome: "retry" }),
      ev({ taskId: "T1", outcome: "retry" }),
      ev({ taskId: "T1", outcome: "retry" }),
      ev({ taskId: "T1", outcome: "accepted" }),
    ];
    const r = rollupTaskLedger(events);
    const t = r.tasks[0]!;
    expect(t.requestCount).toBe(4);
    expect(t.acceptedCount).toBe(1);
    expect(t.costUsd).toBeCloseTo(0.0105 * 4, 9);
    // the real unit price of landed work = total / 1 accepted
    expect(t.costPerAcceptedUsd).toBeCloseTo(0.042, 9);
    expect(t.wastedTokens).toBe(3 * 1500);
    expect(t.wasteTokenRatio).toBeCloseTo(3 / 4);
  });

  it("flags cost-incomplete and returns null cost-per-accepted on an unpriced event", () => {
    const events: SpendEvent[] = [
      ev({ taskId: "T1", outcome: "accepted" }),
      ev({ taskId: "T1", outcome: "retry", model: UNPRICED }),
    ];
    const r = rollupTaskLedger(events);
    const t = r.tasks[0]!;
    expect(t.costComplete).toBe(false);
    expect(t.costUsd).toBeNull();
    expect(t.costPerAcceptedUsd).toBeNull();
    // tokens are still summed even when dollars are unavailable
    expect(t.totalTokens).toBe(2 * 1500);
    expect(r.costComplete).toBe(false);
    expect(r.costUsd).toBeNull();
  });

  it("returns null cost-per-accepted when nothing was accepted (no divide-by-zero)", () => {
    const events: SpendEvent[] = [
      ev({ taskId: "T1", outcome: "retry" }),
      ev({ taskId: "T1", outcome: "abandoned" }),
    ];
    const t = rollupTaskLedger(events).tasks[0]!;
    expect(t.acceptedCount).toBe(0);
    expect(t.costPerAcceptedUsd).toBeNull();
    expect(t.wasteTokenRatio).toBe(1);
  });

  it("treats pending as neither accepted nor waste", () => {
    const events: SpendEvent[] = [
      ev({ taskId: "T1", outcome: "pending" }),
      ev({ taskId: "T1", outcome: "accepted" }),
    ];
    const t = rollupTaskLedger(events).tasks[0]!;
    expect(t.acceptedCount).toBe(1);
    expect(t.wastedTokens).toBe(0);
  });

  it("aggregates across multiple tasks into a fleet total", () => {
    const events: SpendEvent[] = [
      ev({ taskId: "A", outcome: "accepted" }),
      ev({ taskId: "B", outcome: "rejected" }),
      ev({ taskId: "B", outcome: "accepted" }),
    ];
    const r = rollupTaskLedger(events);
    expect(r.tasks.length).toBe(2);
    expect(r.totalRequests).toBe(3);
    expect(r.totalAccepted).toBe(2);
    expect(r.costUsd).toBeCloseTo(0.0105 * 3, 9);
    expect(r.wastedTokens).toBe(1500); // the one rejected request
  });

  it("respects a custom waste-outcome set", () => {
    const events: SpendEvent[] = [
      ev({ taskId: "T", outcome: "retry" }),
      ev({ taskId: "T", outcome: "accepted" }),
    ];
    // Only 'rejected' counts as waste → retry is not waste here.
    const t = rollupTaskLedger(events, { wasteOutcomes: ["rejected"] }).tasks[0]!;
    expect(t.wastedTokens).toBe(0);
  });

  it("skips malformed events and counts them", () => {
    const r = rollupTaskLedger([
      ev({ taskId: "T", outcome: "accepted" }),
      { taskId: "T" }, // missing fields
      { taskId: "T", model: PRICED, inputTokens: 1, outputTokens: 1, outcome: "nope" },
      null,
      42,
    ] as unknown);
    expect(r.skipped).toBe(4);
    expect(r.totalRequests).toBe(1);
  });

  it("is total on garbage input", () => {
    expect(rollupTaskLedger(null).tasks).toEqual([]);
    expect(rollupTaskLedger("nope" as unknown).totalRequests).toBe(0);
    expect(rollupTaskLedger(undefined).costUsd).toBe(0); // no tasks → complete, zero
  });

  it("is deterministic", () => {
    const events: SpendEvent[] = [
      ev({ taskId: "A", outcome: "accepted" }),
      ev({ taskId: "A", outcome: "retry" }),
    ];
    expect(rollupTaskLedger(events)).toEqual(rollupTaskLedger(events));
  });
});

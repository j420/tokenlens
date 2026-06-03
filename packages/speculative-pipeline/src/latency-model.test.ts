import { describe, expect, it } from "vitest";

import {
  estimateCacheWindowPreservation,
  summarizeLatency,
  TTL_WINDOW_MS,
} from "./latency-model.js";

describe("summarizeLatency", () => {
  it("totals and averages per-hit savings", () => {
    const r = summarizeLatency([1000, 2000, 3000]);
    expect(r.totalLatencySavedMs).toBe(6000);
    expect(r.meanLatencySavedMsPerHit).toBe(2000);
    expect(r.hits).toBe(3);
  });

  it("handles no hits", () => {
    const r = summarizeLatency([]);
    expect(r.totalLatencySavedMs).toBe(0);
    expect(r.meanLatencySavedMsPerHit).toBe(0);
  });

  it("clamps negative figures to 0", () => {
    expect(summarizeLatency([-500, 1000]).totalLatencySavedMs).toBe(1000);
  });
});

describe("estimateCacheWindowPreservation", () => {
  it("computes extra turns that fit inside the saved wall-clock", () => {
    // Saved 24s, mean turn 8s → 3 extra turns inside the window.
    const e = estimateCacheWindowPreservation(24_000, 8_000, "5m");
    expect(e.extraTurnsInsideWindow).toBe(3);
    expect(e.likelyPreservesWindow).toBe(true);
    expect(e.ttl).toBe("5m");
  });

  it("reports no preservation when saving is below one turn", () => {
    const e = estimateCacheWindowPreservation(3_000, 8_000, "5m");
    expect(e.extraTurnsInsideWindow).toBe(0);
    expect(e.likelyPreservesWindow).toBe(false);
  });

  it("guards divide-by-zero when mean turn time is 0", () => {
    const e = estimateCacheWindowPreservation(10_000, 0, "1h");
    expect(e.extraTurnsInsideWindow).toBe(0);
  });

  it("clamps negative latency to 0", () => {
    const e = estimateCacheWindowPreservation(-1000, 8000, "5m");
    expect(e.latencySavedMs).toBe(0);
  });

  it("exposes the documented TTL windows", () => {
    expect(TTL_WINDOW_MS["5m"]).toBe(300_000);
    expect(TTL_WINDOW_MS["1h"]).toBe(3_600_000);
  });
});

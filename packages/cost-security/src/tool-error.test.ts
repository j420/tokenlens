import { describe, it, expect } from "vitest";
import { assessToolErrorRate, type ToolResultSignal } from "./tool-error.js";

const err: ToolResultSignal = { isError: true };
const ok: ToolResultSignal = { isError: false };

describe("assessToolErrorRate", () => {
  it("fires when tagged volume >= floor and rate >= threshold", () => {
    const r = assessToolErrorRate([err, err, err, ok], { floor: 4, threshold: 0.5 });
    expect(r.verdict).toBe("warn");
    expect(r.errorCount).toBe(3);
    expect(r.observedCount).toBe(4);
    expect(r.ratio).toBeCloseTo(0.75);
  });

  it("does not fire below the volume floor even at 100% error", () => {
    const r = assessToolErrorRate([err, err, err], { floor: 4, threshold: 0.5 });
    expect(r.verdict).toBe("ok");
    expect(r.ratio).toBe(1);
  });

  it("does not fire below the rate threshold", () => {
    const r = assessToolErrorRate([err, ok, ok, ok, ok], { floor: 4, threshold: 0.5 });
    expect(r.verdict).toBe("ok");
    expect(r.ratio).toBeCloseTo(0.2);
  });

  it("fires exactly at the threshold boundary", () => {
    const r = assessToolErrorRate([err, err, ok, ok], { floor: 4, threshold: 0.5 });
    expect(r.ratio).toBe(0.5);
    expect(r.verdict).toBe("warn");
  });

  it("returns insufficient_signal when NO result carries a boolean is_error", () => {
    const r = assessToolErrorRate([{}, { isError: "yes" }, { foo: 1 }] as unknown, {
      floor: 1,
    });
    expect(r.verdict).toBe("insufficient_signal");
    expect(r.observedCount).toBe(0);
    expect(r.ratio).toBeNull();
    expect(r.totalCount).toBe(3);
  });

  it("counts only tagged results — untagged ones never enter the denominator", () => {
    // 2 errors, 2 successes tagged; 3 untagged ignored.
    const r = assessToolErrorRate([err, err, ok, ok, {}, {}, {}] as unknown, {
      floor: 4,
      threshold: 0.5,
    });
    expect(r.observedCount).toBe(4);
    expect(r.totalCount).toBe(7);
    expect(r.ratio).toBe(0.5);
    expect(r.verdict).toBe("warn");
  });

  it("is total on garbage input", () => {
    expect(assessToolErrorRate(null).verdict).toBe("insufficient_signal");
    expect(assessToolErrorRate(undefined).verdict).toBe("insufficient_signal");
    expect(assessToolErrorRate("nope" as unknown).verdict).toBe("insufficient_signal");
    expect(assessToolErrorRate(42 as unknown).verdict).toBe("insufficient_signal");
  });

  it("clamps an out-of-range threshold back to the default", () => {
    const r = assessToolErrorRate([err, err, ok, ok], { floor: 4, threshold: 9 });
    // 9 is invalid → default 0.5 → rate 0.5 fires
    expect(r.verdict).toBe("warn");
  });

  it("is deterministic", () => {
    const input = [err, ok, err, ok, err];
    expect(assessToolErrorRate(input, { floor: 4 })).toEqual(
      assessToolErrorRate(input, { floor: 4 })
    );
  });
});

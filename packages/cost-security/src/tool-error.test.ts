import { describe, it, expect } from "vitest";
import { assessToolErrorRate, type ToolResultSignal } from "./tool-error.js";

const err: ToolResultSignal = { isError: true };
const ok: ToolResultSignal = { isError: false };
const untagged = {} as ToolResultSignal; // success that omits is_error (API default)

describe("assessToolErrorRate", () => {
  it("fires when total volume >= floor and rate >= threshold", () => {
    const r = assessToolErrorRate([err, err, err, ok], { floor: 4, threshold: 0.5 });
    expect(r.verdict).toBe("warn");
    expect(r.errorCount).toBe(3);
    expect(r.totalCount).toBe(4);
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

  // --- The regression that motivated the denominator fix -------------------
  it("does NOT false-positive when successes omit is_error (API default)", () => {
    // 4 real failures + 100 successes that omit the flag → 3.8% real rate.
    const results = [
      ...Array.from({ length: 4 }, () => err),
      ...Array.from({ length: 100 }, () => untagged),
    ];
    const r = assessToolErrorRate(results, { floor: 4, threshold: 0.5 });
    expect(r.errorCount).toBe(4);
    expect(r.taggedCount).toBe(4);
    expect(r.totalCount).toBe(104);
    expect(r.ratio).toBeCloseTo(4 / 104);
    expect(r.verdict).toBe("ok"); // NOT warn
  });

  it("counts an absent flag as a success in the denominator", () => {
    // 2 errors + 2 omitted successes → 50% over a denominator of 4.
    const r = assessToolErrorRate([err, err, untagged, untagged], {
      floor: 4,
      threshold: 0.5,
    });
    expect(r.totalCount).toBe(4);
    expect(r.taggedCount).toBe(2);
    expect(r.ratio).toBe(0.5);
    expect(r.verdict).toBe("warn");
  });

  it("returns insufficient_signal when the host tags NOTHING", () => {
    const r = assessToolErrorRate([untagged, { isError: "yes" }, { foo: 1 }] as unknown, {
      floor: 1,
    });
    expect(r.verdict).toBe("insufficient_signal");
    expect(r.taggedCount).toBe(0);
    expect(r.ratio).toBeNull();
    expect(r.totalCount).toBe(3);
  });

  it("returns insufficient_signal on an empty list", () => {
    const r = assessToolErrorRate([], { floor: 1 });
    expect(r.verdict).toBe("insufficient_signal");
    expect(r.totalCount).toBe(0);
    expect(r.ratio).toBeNull();
  });

  it("handles explicit is_error:false successes (hosts that tag both)", () => {
    const r = assessToolErrorRate([err, err, ok, ok], { floor: 4, threshold: 0.5 });
    expect(r.taggedCount).toBe(4);
    expect(r.totalCount).toBe(4);
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
    expect(r.verdict).toBe("warn"); // 9 invalid → default 0.5 → rate 0.5 fires
  });

  it("is deterministic", () => {
    const input = [err, ok, err, ok, err];
    expect(assessToolErrorRate(input, { floor: 4 })).toEqual(
      assessToolErrorRate(input, { floor: 4 })
    );
  });
});

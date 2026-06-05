import { describe, expect, it } from "vitest";
import { assessFanoutAcceleration } from "./fanout.js";

describe("assessFanoutAcceleration — fail-safe inputs", () => {
  it("returns not-accelerating for non-array / garbage", () => {
    for (const bad of [undefined, null, 42, "x", {}]) {
      const r = assessFanoutAcceleration(bad as unknown);
      expect(r.accelerating).toBe(false);
      expect(r.buckets).toBe(0);
    }
  });

  it("filters malformed entries", () => {
    const r = assessFanoutAcceleration([2, "x" as unknown as number, NaN, 5, 12]);
    expect(r.buckets).toBe(3); // 2,5,12 survive
  });

  it("needs a minimum number of buckets", () => {
    expect(assessFanoutAcceleration([2, 9]).accelerating).toBe(false);
  });
});

describe("assessFanoutAcceleration — acceleration detection", () => {
  it("flags a super-linear spawn ramp", () => {
    const r = assessFanoutAcceleration([2, 5, 12]); // diffs 3 then 7, second diff 4
    expect(r.accelerating).toBe(true);
    expect(r.firstDiff).toBe(7);
    expect(r.secondDiff).toBe(4);
    expect(r.cumulative).toBe(19);
    expect(r.latest).toBe(12);
  });

  it("does NOT flag a linear ramp", () => {
    expect(assessFanoutAcceleration([3, 6, 9]).accelerating).toBe(false); // second diff 0
  });

  it("does NOT flag a decelerating series", () => {
    expect(assessFanoutAcceleration([12, 8, 3]).accelerating).toBe(false);
  });

  it("does NOT flag when the latest bucket is small", () => {
    expect(assessFanoutAcceleration([0, 1, 2], { minLatest: 3 }).accelerating).toBe(false);
  });

  it("respects a custom acceleration threshold", () => {
    // diffs 2 then 4, second diff 2
    expect(assessFanoutAcceleration([3, 5, 9], { accelThreshold: 5 }).accelerating).toBe(false);
    expect(assessFanoutAcceleration([3, 5, 9], { accelThreshold: 2 }).accelerating).toBe(true);
  });
});

describe("assessFanoutAcceleration — deterministic", () => {
  it("same series yields an identical report", () => {
    expect(assessFanoutAcceleration([1, 4, 11])).toEqual(assessFanoutAcceleration([1, 4, 11]));
  });
});

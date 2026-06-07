import { describe, expect, it } from "vitest";
import { checkOverheadSlo, rollupSavings } from "./savings.js";
import type { SavingsRecord } from "./types.js";

const recs: SavingsRecord[] = [
  { feature: "f15", baselineTokens: 1000, optimizedTokens: 200, overheadTokens: 50 },
  { feature: "f15", baselineTokens: 500, optimizedTokens: 100, overheadTokens: 25 },
  { feature: "f16", baselineTokens: 2400, optimizedTokens: 0, overheadTokens: 10 },
];

describe("rollupSavings", () => {
  it("computes gross, overhead, and net (net subtracts overhead)", () => {
    const r = rollupSavings(recs);
    expect(r.grossSaved).toBe(800 + 400 + 2400);
    expect(r.overhead).toBe(85);
    expect(r.netSaved).toBe(3600 - 85);
  });

  it("rolls up per feature", () => {
    const r = rollupSavings(recs);
    expect(r.byFeature.f15.records).toBe(2);
    expect(r.byFeature.f15.grossSaved).toBe(1200);
    expect(r.byFeature.f16.grossSaved).toBe(2400);
  });

  it("clamps a negative per-record delta to zero (no manufactured savings)", () => {
    const r = rollupSavings([
      { feature: "x", baselineTokens: 100, optimizedTokens: 300, overheadTokens: 0 },
    ]);
    expect(r.grossSaved).toBe(0);
  });

  it("reports a negative net honestly when overhead exceeds savings", () => {
    const r = rollupSavings([
      { feature: "x", baselineTokens: 100, optimizedTokens: 90, overheadTokens: 500 },
    ]);
    expect(r.netSaved).toBe(10 - 500);
  });

  it("null overhead ratio when there are no gross savings", () => {
    const r = rollupSavings([
      { feature: "x", baselineTokens: 100, optimizedTokens: 100, overheadTokens: 5 },
    ]);
    expect(r.overheadRatio).toBeNull();
  });
});

describe("checkOverheadSlo — reflexive", () => {
  it("passes when overhead is within budget", () => {
    const r = rollupSavings(recs); // overhead 85 / gross 3600 ≈ 2.4%
    expect(checkOverheadSlo(r, { maxOverheadRatio: 0.1 }).ok).toBe(true);
  });

  it("fails when overhead exceeds budget", () => {
    const r = rollupSavings([
      { feature: "x", baselineTokens: 1000, optimizedTokens: 900, overheadTokens: 50 },
    ]); // overhead 50 / gross 100 = 50%
    expect(checkOverheadSlo(r, { maxOverheadRatio: 0.1 }).ok).toBe(false);
  });

  it("fails when overhead was spent but nothing was saved", () => {
    const r = rollupSavings([
      { feature: "x", baselineTokens: 100, optimizedTokens: 100, overheadTokens: 5 },
    ]);
    expect(checkOverheadSlo(r, { maxOverheadRatio: 0.1 }).ok).toBe(false);
  });
});

/**
 * Degenerate-input robustness for F4. No empty list, free model, NaN, or
 * single-sample input may crash or silently produce a bad recommendation.
 */

import { describe, expect, it } from "vitest";
import {
  aggregateModel,
  classifyPareto,
  dominates,
  paretoFrontier,
  recommendForCluster,
  type ModelAggregate,
} from "./index.js";

function agg(
  model: string,
  n: number,
  ar: number,
  cost: number,
  tpr: number | null = null
): ModelAggregate {
  return {
    model,
    clusterId: "c",
    n,
    acceptedCount: Math.round(n * ar),
    acceptanceRate: ar,
    testPassRate: tpr,
    testN: tpr === null ? 0 : n,
    testPassedCount: tpr === null ? 0 : Math.round(n * tpr),
    meanCost: cost,
    totalCost: cost * n,
    qpdRaw: cost > 0 ? ar / cost : Infinity,
  };
}

describe("F4 empty / degenerate inputs", () => {
  it("no candidates ⇒ stay on baseline, no crash", () => {
    const rec = recommendForCluster(agg("base", 100, 0.9, 0.05), []);
    expect(rec.best).toBeNull();
    expect(rec.recommendations).toHaveLength(0);
  });

  it("a free baseline can never be beaten on cost (costRatio = Infinity)", () => {
    const rec = recommendForCluster(agg("free", 100, 0.9, 0), [
      agg("paid", 100, 0.9, 0.02),
    ]);
    const r = rec.recommendations[0];
    expect(r.costRatio).toBe(Infinity);
    expect(r.recommended).toBe(false);
    expect(r.projectedSavingsPct).toBe(0);
  });

  it("empty aggregate has 0 acceptance and 0 (not Infinity) QpD", () => {
    const a = aggregateModel("c", "m", []);
    expect(a.acceptanceRate).toBe(0);
    expect(a.qpdRaw).toBe(0);
    expect(Number.isFinite(a.qpdRaw)).toBe(true);
  });

  it("a genuinely free model that delivers quality is infinitely efficient", () => {
    const a = aggregateModel("c", "m", [
      { promptId: "1", model: "m", qualityScore: 1, accepted: true, testPassed: null, costUsd: 0 },
    ]);
    expect(a.qpdRaw).toBe(Infinity);
  });
});

describe("F4 Pareto robustness", () => {
  it("empty point set ⇒ empty frontier", () => {
    expect(classifyPareto([])).toHaveLength(0);
    expect(paretoFrontier([])).toHaveLength(0);
  });

  it("single point is always on the frontier", () => {
    const c = classifyPareto([{ model: "only", cost: 1, quality: 0.9 }]);
    expect(c[0].onFrontier).toBe(true);
  });

  it("NaN-free: a zero-cost zero-quality point does not crash domination", () => {
    expect(() =>
      classifyPareto([
        { model: "a", cost: 0, quality: 0 },
        { model: "b", cost: 1, quality: 0.5 },
      ])
    ).not.toThrow();
  });

  it("dominates is a strict partial order (no self-domination)", () => {
    const p = { model: "p", cost: 1, quality: 0.5 };
    expect(dominates(p, p)).toBe(false);
  });
});

describe("F4 explicit-undefined options do not clobber defaults", () => {
  it("passing {arMargin: undefined, costDominanceRatio: undefined} uses defaults", () => {
    // An MCP handler forwarding optional args passes explicit undefined.
    // The recommender must coalesce to defaults, not let undefined win.
    const rec = recommendForCluster(
      agg("opus", 500, 0.92, 0.1),
      [agg("sonnet", 500, 0.9, 0.02)],
      { arMargin: undefined, costDominanceRatio: undefined } as never
    );
    expect(rec.best?.model).toBe("sonnet");
    expect(rec.recommendations[0].gates ?? rec.recommendations[0].costGate.passed).toBeTruthy();
    expect(rec.recommendations[0].costGate.passed).toBe(true);
    expect(rec.recommendations[0].arGate.passed).toBe(true);
  });
});

describe("F4 sub-minimum sample never recommended", () => {
  it("a single-sample candidate cannot be recommended", () => {
    const rec = recommendForCluster(agg("opus", 1, 1, 0.1), [
      agg("haiku", 1, 1, 0.001),
    ]);
    expect(rec.recommendations[0].sampleSizeGate.passed).toBe(false);
    expect(rec.recommendations[0].recommended).toBe(false);
  });
});

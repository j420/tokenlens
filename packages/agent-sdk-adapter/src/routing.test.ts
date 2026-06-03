/**
 * Routing policy tests. The credibility property under test: a non-baseline
 * tier is NEVER selected unless an explicit, auditable gate fired.
 */

import { describe, expect, it } from "vitest";
import { createEmptySessionROI, type SessionROI } from "@prune/intelligence";
import type { ClusterRecommendation } from "@prune/qpd-bench";
import {
  LowRoiRoutingPolicy,
  QpdGatedRoutingPolicy,
  StaticRoutingPolicy,
  type RoutingContext,
} from "./routing.js";

function sessionWithStreak(streak: number): SessionROI {
  const s = createEmptySessionROI();
  s.consecutiveLowRoiTurns = streak;
  return s;
}

const baseCtx: RoutingContext = {
  baselineModel: "claude-opus-4-5-20251101",
  sessionROI: createEmptySessionROI(),
};

describe("StaticRoutingPolicy", () => {
  it("always returns the baseline; never reports a switch", () => {
    const p = new StaticRoutingPolicy();
    const d = p.decide(baseCtx);
    expect(d.model).toBe(baseCtx.baselineModel);
    expect(d.switched).toBe(false);
  });
});

describe("LowRoiRoutingPolicy", () => {
  it("does NOT switch below the streak threshold", () => {
    const p = new LowRoiRoutingPolicy({ threshold: 3 });
    const d = p.decide({ ...baseCtx, sessionROI: sessionWithStreak(2) });
    expect(d.switched).toBe(false);
    expect(d.model).toBe(baseCtx.baselineModel);
  });

  it("switches at the streak threshold IF a cheaper tier is registered", () => {
    const p = new LowRoiRoutingPolicy({ threshold: 3 });
    const d = p.decide({ ...baseCtx, sessionROI: sessionWithStreak(3) });
    if (d.switched) {
      // The registered suggestion for opus is the sonnet family.
      expect(d.model).not.toBe(baseCtx.baselineModel);
      expect(d.reason).toContain("low-roi");
    } else {
      // No registered suggestion ⇒ stay on baseline; reason explains.
      expect(d.reason).toMatch(/no registered cheaper tier/);
    }
  });

  it("does not switch when no cheaper tier is registered for the model", () => {
    const p = new LowRoiRoutingPolicy({ threshold: 3 });
    const d = p.decide({
      ...baseCtx,
      baselineModel: "claude-3-haiku-20240307", // bottom of the ladder
      sessionROI: sessionWithStreak(10),
    });
    expect(d.switched).toBe(false);
  });
});

describe("QpdGatedRoutingPolicy", () => {
  function mkRec(
    baseline: string,
    bestModel: string | null
  ): ClusterRecommendation {
    return {
      clusterId: "refactor-ts",
      baselineModel: baseline,
      recommendations: [],
      best: bestModel
        ? {
            model: bestModel,
            recommended: true,
            baselineModel: baseline,
            costRatio: 0.2,
            projectedSavingsPct: 80,
            qpdRelative: 5,
            arGate: {
              passed: true,
              detail: "",
              test: {
                test: "ni",
                statistic: 0,
                pValue: 0,
                reject: true,
                alpha: 0.05,
                detail: {},
              },
            },
            tprGate: { passed: true, detail: "" },
            costGate: { passed: true, detail: "" },
            sampleSizeGate: { passed: true, detail: "" },
            candidate: {
              model: bestModel,
              clusterId: "refactor-ts",
              n: 500,
              acceptedCount: 450,
              acceptanceRate: 0.9,
              testPassRate: null,
              testN: 0,
              testPassedCount: 0,
              meanCost: 0.02,
              totalCost: 10,
              qpdRaw: 45,
            },
          }
        : null,
    };
  }

  it("STAYS on baseline when no cluster id is provided", () => {
    const p = new QpdGatedRoutingPolicy({
      recommendationsByCluster: new Map(),
    });
    const d = p.decide(baseCtx);
    expect(d.switched).toBe(false);
    expect(d.reason).toContain("no cluster id");
  });

  it("STAYS on baseline when no recommendation exists for the cluster", () => {
    const p = new QpdGatedRoutingPolicy({
      recommendationsByCluster: new Map(),
    });
    const d = p.decide({ ...baseCtx, clusterId: "refactor-ts" });
    expect(d.switched).toBe(false);
    expect(d.reason).toMatch(/no F4-recommended model/);
  });

  it("ROUTES to the F4-recommended model when the gates passed", () => {
    const rec = mkRec(baseCtx.baselineModel, "claude-sonnet-4-5-20250929");
    const p = new QpdGatedRoutingPolicy({
      recommendationsByCluster: new Map([[rec.clusterId, rec]]),
    });
    const d = p.decide({ ...baseCtx, clusterId: rec.clusterId });
    expect(d.switched).toBe(true);
    expect(d.model).toBe("claude-sonnet-4-5-20250929");
    expect(d.gatesPassed).toContain("ar-non-inferior");
    expect(d.gatesPassed).toContain("tpr-non-inferior");
    expect(d.gatesPassed).toContain("cost-dominant");
  });

  it("REFUSES a stale recommendation if its bench baseline ≠ current baseline", () => {
    // The bench ran against opus-4, but current baseline is opus-4.5.
    const rec = mkRec("claude-opus-4-20250514", "claude-sonnet-4-5-20250929");
    const p = new QpdGatedRoutingPolicy({
      recommendationsByCluster: new Map([[rec.clusterId, rec]]),
    });
    const d = p.decide({
      ...baseCtx,
      baselineModel: "claude-opus-4-5-20251101",
      clusterId: rec.clusterId,
    });
    expect(d.switched).toBe(false);
    expect(d.reason).toMatch(/baseline.*≠/);
  });

  it("STAYS on baseline when recommendation.best is null (nothing safe)", () => {
    const rec = mkRec(baseCtx.baselineModel, null);
    const p = new QpdGatedRoutingPolicy({
      recommendationsByCluster: new Map([[rec.clusterId, rec]]),
    });
    const d = p.decide({ ...baseCtx, clusterId: rec.clusterId });
    expect(d.switched).toBe(false);
  });
});

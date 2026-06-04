/**
 * 2.4(d) — Reasoning-Effort Auto-Router.
 *
 * The reasoning-effort dial (standard < high < xhigh < max) trades reasoning
 * tokens — and therefore dollars — for quality. CH-009 (cache-habits) WARNS that
 * changing the dial mid-session busts the cached prefix; this router is the
 * actuation side: it recommends the LOWEST effort to START at that is
 * statistically quality-non-inferior to the current one on the user's own task
 * class, so the dial never needs to move mid-session.
 *
 * It is a thin, honest adapter over @prune/qpd-bench's tested non-inferiority
 * gates: each effort level is modeled as a `ModelAggregate` ("model" = effort
 * name) and `recommendForCluster` does the AR/TPR/cost/sample-size gating. The
 * router adds only the dial-specific policy:
 *   - DOWN-ROUTE ONLY. Candidates are efforts strictly BELOW the current one
 *     (cost-reducing). Escalating effort is a quality decision out of scope —
 *     this router reduces waste, it never spends more.
 *   - FLOOR. Never recommends below `floor` (e.g. a hard task class pins a
 *     minimum effort).
 *   - HONEST ABSENCE. No current-effort data, or no lower effort that clears the
 *     gates ⇒ HOLD at the current effort. Caller-supplied stats only; the router
 *     never fabricates an acceptance rate or a cost.
 */

import { recommendForCluster, type RecommenderOptions } from "./recommender.js";
import type { ModelAggregate } from "./scoring.js";

export type ReasoningEffort = "standard" | "high" | "xhigh" | "max";

/** Ordered low→high; index is the effort rank (also the relative cost order). */
export const EFFORT_ORDER: readonly ReasoningEffort[] = [
  "standard",
  "high",
  "xhigh",
  "max",
] as const;

const EFFORT_RANK: Record<ReasoningEffort, number> = {
  standard: 0,
  high: 1,
  xhigh: 2,
  max: 3,
};

export function isReasoningEffort(v: unknown): v is ReasoningEffort {
  return typeof v === "string" && v in EFFORT_RANK;
}

/** Per-effort outcome stats on the user's own task class. Caller-supplied. */
export interface EffortOutcomeStats {
  effort: ReasoningEffort;
  /** Number of tasks observed at this effort. */
  n: number;
  /** How many were accepted (user kept the result). */
  acceptedCount: number;
  /** Test-pass rate over tasks that ran a suite; null/omitted if none did. */
  testPassRate?: number | null;
  testN?: number;
  testPassedCount?: number;
  /**
   * Mean per-task cost in USD at this effort (reasoning + output). Caller
   * computes this from real token usage × price — the router NEVER derives it
   * (it cannot know reasoning-token counts).
   */
  meanCostUsd: number;
}

export interface EffortRouteOptions extends RecommenderOptions {
  /** Task class id (the qpd cluster). Default "default". */
  taskClass?: string;
  /** Never recommend below this effort. Default "standard". */
  floor?: ReasoningEffort;
}

export interface EffortRouteRecommendation {
  currentEffort: ReasoningEffort;
  /** The recommended effort. Equals currentEffort when holding. */
  recommendedEffort: ReasoningEffort;
  /** True when staying put (no safe down-route). */
  hold: boolean;
  basis: "history" | "insufficient_data";
  /** Projected % cost saving vs current when down-routing; null when holding. */
  projectedSavingsPct: number | null;
  rationale: string;
  /** Gate outcomes for the recommended (or best-scoring) lower effort. */
  gates: { ar: boolean; tpr: boolean; cost: boolean; sampleSize: boolean } | null;
}

function toAggregate(stats: EffortOutcomeStats, clusterId: string): ModelAggregate {
  const n = Math.max(0, stats.n);
  const acceptedCount = Math.max(0, Math.min(n, stats.acceptedCount));
  const acceptanceRate = n > 0 ? acceptedCount / n : 0;
  const meanCost = Math.max(0, stats.meanCostUsd);
  const testN = Math.max(0, stats.testN ?? 0);
  return {
    model: stats.effort,
    clusterId,
    n,
    acceptedCount,
    acceptanceRate,
    testPassRate:
      typeof stats.testPassRate === "number" ? stats.testPassRate : null,
    testN,
    testPassedCount: Math.max(0, Math.min(testN, stats.testPassedCount ?? 0)),
    meanCost,
    totalCost: meanCost * n,
    qpdRaw: meanCost > 0 ? acceptanceRate / meanCost : acceptanceRate > 0 ? Infinity : 0,
  };
}

/**
 * Recommend a reasoning effort. Pure & total: any input yields a well-formed
 * recommendation (holding when data is missing or no down-route is safe).
 * Never throws.
 */
export function routeReasoningEffort(
  currentEffort: ReasoningEffort,
  outcomes: readonly EffortOutcomeStats[],
  options: EffortRouteOptions = {}
): EffortRouteRecommendation {
  const clusterId = options.taskClass ?? "default";
  const floor = isReasoningEffort(options.floor) ? options.floor : "standard";

  const hold = (
    basis: EffortRouteRecommendation["basis"],
    rationale: string,
    gates: EffortRouteRecommendation["gates"] = null
  ): EffortRouteRecommendation => ({
    currentEffort,
    recommendedEffort: currentEffort,
    hold: true,
    basis,
    projectedSavingsPct: null,
    rationale,
    gates,
  });

  if (!isReasoningEffort(currentEffort)) {
    return hold("insufficient_data", `unknown current effort "${String(currentEffort)}"`);
  }

  const byEffort = new Map<ReasoningEffort, EffortOutcomeStats>();
  for (const o of Array.isArray(outcomes) ? outcomes : []) {
    if (o && isReasoningEffort(o.effort) && typeof o.n === "number" && o.n > 0) {
      byEffort.set(o.effort, o);
    }
  }

  const current = byEffort.get(currentEffort);
  if (!current) {
    return hold("insufficient_data", `no outcome history at the current effort (${currentEffort})`);
  }

  // Candidates: efforts strictly BELOW current and >= floor, with data.
  const candidateStats = [...byEffort.values()].filter(
    (o) =>
      EFFORT_RANK[o.effort] < EFFORT_RANK[currentEffort] &&
      EFFORT_RANK[o.effort] >= EFFORT_RANK[floor]
  );
  if (candidateStats.length === 0) {
    const why =
      EFFORT_RANK[currentEffort] <= EFFORT_RANK[floor]
        ? `already at the floor effort (${floor})`
        : `no lower-effort history at or above the floor (${floor})`;
    return hold("history", why);
  }

  const baseline = toAggregate(current, clusterId);
  const candidates = candidateStats.map((o) => toAggregate(o, clusterId));
  const rec = recommendForCluster(baseline, candidates, options);

  if (rec.best) {
    const eff = rec.best.model as ReasoningEffort;
    return {
      currentEffort,
      recommendedEffort: eff,
      hold: false,
      basis: "history",
      projectedSavingsPct: Number(rec.best.projectedSavingsPct.toFixed(1)),
      rationale:
        `${eff} is quality-non-inferior to ${currentEffort} on '${clusterId}' ` +
        `at ~${rec.best.projectedSavingsPct.toFixed(0)}% lower cost ` +
        `(${rec.best.arGate.detail}).`,
      gates: {
        ar: rec.best.arGate.passed,
        tpr: rec.best.tprGate.passed,
        cost: rec.best.costGate.passed,
        sampleSize: rec.best.sampleSizeGate.passed,
      },
    };
  }

  // No lower effort cleared every gate — hold, and report the closest one's gates.
  const closest = rec.recommendations[0];
  return hold(
    "history",
    `no lower effort is quality-non-inferior to ${currentEffort} on '${clusterId}'; staying put`,
    closest
      ? {
          ar: closest.arGate.passed,
          tpr: closest.tprGate.passed,
          cost: closest.costGate.passed,
          sampleSize: closest.sampleSizeGate.passed,
        }
      : null
  );
}

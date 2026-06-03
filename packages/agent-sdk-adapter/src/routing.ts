/**
 * Routing policy — selects the model per request.
 *
 * The adapter NEVER routes silently against an unproven tier. Three policy
 * shapes are exposed:
 *
 *   - StaticRoutingPolicy        Always returns the configured model.
 *   - LowRoiRoutingPolicy        After N consecutive low-ROI turns, suggests
 *                                the cheaper tier registered in
 *                                @prune/intelligence's getModelRoutingSuggestion.
 *                                Returns the configured baseline otherwise.
 *   - QpdGatedRoutingPolicy      Will ONLY route to a candidate if a stored
 *                                F4 ClusterRecommendation marked it
 *                                `recommended=true` (i.e. it passed AR + TPR
 *                                non-inferiority and cost dominance at bench
 *                                time). Stays on the baseline otherwise.
 *
 * The decision is pure: same inputs ⇒ same model.
 */

import { getModelRoutingSuggestion, type SessionROI } from "@prune/intelligence";
import type { ClusterRecommendation } from "@prune/qpd-bench";

export interface RoutingContext {
  baselineModel: string;
  sessionROI: SessionROI;
  /** Optional cluster id the current request falls into (for QpD lookup). */
  clusterId?: string;
  /** Optional task complexity hint, surfaced for logging by complex policies. */
  taskComplexity?: "low" | "medium" | "high";
}

export interface RoutingDecision {
  model: string;
  /** Was this a non-baseline decision? */
  switched: boolean;
  /** Provenance — required for the trust UX. */
  reason: string;
  /** Names of every policy gate that fired. */
  gatesPassed: string[];
}

export interface RoutingPolicy {
  readonly name: string;
  decide(ctx: RoutingContext): RoutingDecision;
}

export class StaticRoutingPolicy implements RoutingPolicy {
  readonly name = "static";
  decide(ctx: RoutingContext): RoutingDecision {
    return {
      model: ctx.baselineModel,
      switched: false,
      reason: "static policy: baseline model used",
      gatesPassed: ["static"],
    };
  }
}

export interface LowRoiRoutingOptions {
  /** Consecutive low-ROI turns required to suggest a switch. Default 3. */
  threshold?: number;
}

export class LowRoiRoutingPolicy implements RoutingPolicy {
  readonly name = "low-roi";
  private readonly threshold: number;
  constructor(options: LowRoiRoutingOptions = {}) {
    this.threshold = options.threshold ?? 3;
  }
  decide(ctx: RoutingContext): RoutingDecision {
    const streak = ctx.sessionROI.consecutiveLowRoiTurns;
    if (streak < this.threshold) {
      return {
        model: ctx.baselineModel,
        switched: false,
        reason: `streak ${streak} < threshold ${this.threshold}`,
        gatesPassed: ["streak-below-threshold"],
      };
    }
    const sug = getModelRoutingSuggestion(ctx.baselineModel, streak);
    if (!sug || !sug.suggestedModel) {
      return {
        model: ctx.baselineModel,
        switched: false,
        reason: `low-roi streak ${streak} but no registered cheaper tier`,
        gatesPassed: ["streak-met"],
      };
    }
    return {
      model: sug.suggestedModel,
      switched: true,
      reason: `low-roi streak ${streak}; ${sug.message}`,
      gatesPassed: ["streak-met", "tier-registered"],
    };
  }
}

export interface QpdGatedRoutingOptions {
  /**
   * Map of (clusterId → most recent ClusterRecommendation). Caller refreshes
   * this from persisted bench output. The policy NEVER looks anything up by
   * itself — purity is required so the decision is testable and auditable.
   */
  recommendationsByCluster: Map<string, ClusterRecommendation>;
}

export class QpdGatedRoutingPolicy implements RoutingPolicy {
  readonly name = "qpd-gated";
  constructor(private readonly options: QpdGatedRoutingOptions) {}
  decide(ctx: RoutingContext): RoutingDecision {
    if (!ctx.clusterId) {
      return {
        model: ctx.baselineModel,
        switched: false,
        reason: "no cluster id supplied — staying on baseline",
        gatesPassed: ["no-cluster"],
      };
    }
    const rec = this.options.recommendationsByCluster.get(ctx.clusterId);
    if (!rec || !rec.best) {
      return {
        model: ctx.baselineModel,
        switched: false,
        reason: `no F4-recommended model for cluster ${ctx.clusterId}`,
        gatesPassed: ["cluster-no-recommendation"],
      };
    }
    if (rec.baselineModel !== ctx.baselineModel) {
      // The bench was run against a different baseline; refuse to apply it.
      return {
        model: ctx.baselineModel,
        switched: false,
        reason:
          `bench baseline ${rec.baselineModel} ≠ current baseline ${ctx.baselineModel} — recommendation does not apply`,
        gatesPassed: ["cluster-recommendation-stale-baseline"],
      };
    }
    return {
      model: rec.best.model,
      switched: true,
      reason: `F4 recommendation for cluster ${ctx.clusterId}: ${rec.best.model} (projected savings ${rec.best.projectedSavingsPct.toFixed(1)}%)`,
      gatesPassed: [
        "cluster-recommendation-found",
        "ar-non-inferior",
        "tpr-non-inferior",
        "cost-dominant",
      ],
    };
  }
}

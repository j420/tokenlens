/**
 * @prune/qpd-bench (F4)
 *
 * Pareto Quality-per-Dollar bench. On the USER'S OWN tasks, measures which
 * model tiers are statistically quality-equivalent to the current one at lower
 * cost. Recommends only; the user always picks the model. The only paths that
 * touch a live model live behind the BenchRunner interface (real adapter in
 * agent-sdk-adapter; FixtureRunner here for deterministic testing).
 *
 * End-to-end pipeline:
 *   runBenchPlan(plan, runner) → executions
 *   scoreSample(...) per execution against the accepted reference
 *   aggregateModel(...) per (cluster, model)
 *   recommendForCluster(baseline, candidates) → gated recommendation
 *   classifyPareto / paretoFrontier for the trade-off chart
 */

export * from "./pareto.js";
export * from "./scoring.js";
export * from "./recommender.js";
export * from "./runner.js";

import { aggregateModel, scoreSample } from "./scoring.js";
import type { BenchRunSummary } from "./runner.js";
import type { ModelAggregate } from "./scoring.js";
import type { ScoringOptions } from "./scoring.js";

/**
 * Convenience: score + aggregate a full bench run into per-model aggregates,
 * one per model that ran. Pure.
 */
export function aggregateBenchRun(
  summary: BenchRunSummary,
  options: ScoringOptions = {}
): ModelAggregate[] {
  const byModel = new Map<string, ReturnType<typeof scoreSample>[]>();
  for (const exec of summary.executions) {
    const ref = summary.references.get(exec.promptId);
    if (!ref) continue;
    const scored = scoreSample(exec, ref.referenceOutput, options);
    const list = byModel.get(exec.model) ?? [];
    list.push(scored);
    byModel.set(exec.model, list);
  }
  return [...byModel.entries()].map(([model, samples]) =>
    aggregateModel(summary.clusterId, model, samples)
  );
}

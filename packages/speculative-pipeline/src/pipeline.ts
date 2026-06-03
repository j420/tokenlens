/**
 * SpeculativePipeline — the orchestrator.
 *
 * Lifecycle per agent tool call:
 *   1. speculate(priorCall, callerCandidates)  — predict + budget-gate the
 *      likely next calls, hand the host the batch to execute in parallel.
 *   2. recordResult(key, result)               — host reports each speculative
 *      execution as it completes.
 *   3. reconcile(actualCall)                    — the agent's real call lands;
 *      the pipeline matches it against the batch, returns a hit (with the
 *      already-computed result + latency saved) or a miss, settles the budget,
 *      and updates the rolling stats.
 *   4. observe(prev, cur)                       — feed the executed call back to
 *      the transition model so future predictions improve.
 *
 * Pure accounting (wall-clock is injected). The only external surface is the
 * host's executor, which the pipeline never calls itself — it only decides
 * WHAT to speculate and reconciles WHAT came back.
 */

import { isSpeculatable } from "./eligibility.js";
import { speculationKey } from "./canonical-input.js";
import { TransitionPredictor } from "./predictor.js";
import { SpeculationBudget, type SpeculationBudgetOptions } from "./budget.js";
import type {
  PipelineOptions,
  PipelineStats,
  ReconcileOutcome,
  Speculation,
  SpeculationResult,
  ToolCall,
} from "./types.js";

interface BatchEntry {
  spec: Speculation;
  result: SpeculationResult | null;
}

export interface SpeculativePipelineOptions extends PipelineOptions {
  budget?: SpeculationBudgetOptions;
}

export class SpeculativePipeline {
  private readonly predictor: TransitionPredictor;
  private readonly budget: SpeculationBudget;
  private readonly options: PipelineOptions;
  /** The current in-flight batch, keyed by speculation key. */
  private batch = new Map<string, BatchEntry>();

  private stats: PipelineStats = {
    speculationsIssued: 0,
    hits: 0,
    misses: 0,
    inFlightIncomplete: 0,
    totalSpeculativeElapsedMs: 0,
    hitRate: 0,
    wastedSpeculations: 0,
  };

  constructor(
    history: readonly ToolCall[] = [],
    options: SpeculativePipelineOptions = {}
  ) {
    this.predictor = new TransitionPredictor(history);
    this.budget = new SpeculationBudget(options.budget);
    this.options = options;
  }

  /** A read-only snapshot of the accounting. */
  getStats(): Readonly<PipelineStats> {
    return { ...this.stats };
  }

  /** Expose the budget for the host's HUD / breaker checks. */
  getBudget(): SpeculationBudget {
    return this.budget;
  }

  /**
   * Decide and launch the speculation batch for the upcoming call. Merges the
   * transition-model predictions with any caller-supplied candidates (deduped
   * by key, caller candidates taking the higher probability), drops ineligible
   * and below-threshold ones, then launches as many as the budget allows. Any
   * prior unsettled batch is discarded (settled as wasted) before the new one.
   *
   * Returns the speculations the host should execute now.
   */
  speculate(
    priorCall: ToolCall | null,
    callerCandidates: readonly Speculation[] = [],
    now: number = Date.now()
  ): Speculation[] {
    // Discard any leftover batch — those speculations never matched a real call.
    this.flushBatchAsWasted(now);

    const predicted = this.predictor.predict(priorCall, this.options);
    const merged = new Map<string, Speculation>();
    for (const s of predicted) merged.set(s.key, s);
    for (const c of callerCandidates) {
      // Recompute the key defensively so a caller can't inject a mismatched key.
      const key = speculationKey(c.call);
      if (!isSpeculatable(c.call.name)) continue;
      const existing = merged.get(key);
      const candidate: Speculation = {
        call: c.call,
        key,
        probability: c.probability,
        source: "caller-candidate",
      };
      if (!existing || c.probability > existing.probability) {
        merged.set(key, candidate);
      }
    }

    // Rank by probability, then launch within budget.
    const ranked = [...merged.values()].sort(
      (a, b) => b.probability - a.probability || a.key.localeCompare(b.key)
    );
    const maxK = this.options.maxSpeculationsPerTurn ?? 3;

    const launched: Speculation[] = [];
    for (const spec of ranked.slice(0, maxK)) {
      const decision = this.budget.decide(now);
      if (decision.verdict !== "allow") break;
      this.budget.launch();
      this.batch.set(spec.key, { spec, result: null });
      launched.push(spec);
      this.stats.speculationsIssued++;
    }
    return launched;
  }

  /**
   * Record a completed speculative execution. No-op if the key isn't in the
   * current batch (a late result from a discarded batch is ignored).
   */
  recordResult(result: SpeculationResult): void {
    const entry = this.batch.get(result.key);
    if (entry) entry.result = result;
  }

  /**
   * Reconcile the agent's real call against the in-flight batch. Returns the
   * outcome and settles the budget for the whole batch. Pure accounting.
   */
  reconcile(actualCall: ToolCall, now: number = Date.now()): ReconcileOutcome {
    const key = speculationKey(actualCall);
    const matched = this.batch.get(key);

    let outcome: ReconcileOutcome;
    if (!matched) {
      // The real call was not in our batch.
      outcome = {
        hit: false,
        key: null,
        result: null,
        speculativeElapsedMs: 0,
        classification: isSpeculatable(actualCall.name) ? "miss" : "ineligible",
      };
      this.settleBatch(null, now);
      this.stats.misses++;
    } else if (matched.result) {
      // Correct prediction AND the speculation had finished — full hit.
      outcome = {
        hit: true,
        key,
        result: matched.result.result,
        speculativeElapsedMs: matched.result.elapsedMs,
        classification: "hit",
      };
      this.settleBatch(key, now);
      this.stats.hits++;
      this.stats.totalSpeculativeElapsedMs += matched.result.elapsedMs;
    } else {
      // Correct prediction but the speculation hadn't finished in time.
      outcome = {
        hit: false,
        key,
        result: null,
        speculativeElapsedMs: 0,
        classification: "in_flight_incomplete",
      };
      this.settleBatch(key, now);
      this.stats.inFlightIncomplete++;
    }

    const resolved = this.stats.hits + this.stats.misses;
    this.stats.hitRate = resolved > 0 ? this.stats.hits / resolved : 0;
    this.batch = new Map();
    return outcome;
  }

  /** Feed an executed call back into the transition model. */
  observe(prev: ToolCall | null, cur: ToolCall): void {
    this.predictor.observe(prev, cur);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Settle every batch entry against the budget. The entry whose key === the
   * matched key (if any) is settled USEFUL; all others are wasted.
   */
  private settleBatch(matchedKey: string | null, now: number): void {
    for (const [k] of this.batch) {
      const wasted = k !== matchedKey;
      this.budget.settle(wasted, now);
      if (wasted) this.stats.wastedSpeculations++;
    }
  }

  /** Discard a leftover (un-reconciled) batch, settling each as wasted. */
  private flushBatchAsWasted(now: number): void {
    if (this.batch.size === 0) return;
    for (const [] of this.batch) {
      this.budget.settle(true, now);
      this.stats.wastedSpeculations++;
    }
    this.batch = new Map();
  }
}

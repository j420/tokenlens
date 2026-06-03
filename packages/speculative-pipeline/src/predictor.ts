/**
 * Transition-model next-call predictor.
 *
 * Transparent and explainable (no opaque ML): a first-order Markov model over
 * observed (prevCall → nextCall) transitions within the session, blended with a
 * global call-frequency prior via additive smoothing. Predictions are CONCRETE
 * tool calls (name + exact input) — only a call the model has actually seen
 * follow the current one can be speculated, because only a concrete input can
 * be reconciled by byte-equality. This deliberately captures the real,
 * high-value pattern: an agent that re-walks the same read sequence (retry
 * loops, re-reads after a failed edit, fixed scaffolding traversals).
 *
 * Why concrete-only: a name-only prediction ("probably a Read next") cannot be
 * byte-reconciled to a hit, so executing it would be speculative work that can
 * never pay off. We never fabricate an input the model hasn't observed.
 */

import { isSpeculatable } from "./eligibility.js";
import { speculationKey } from "./canonical-input.js";
import type { PipelineOptions, Speculation, ToolCall } from "./types.js";

const DEFAULT_SMOOTHING = 1;
const DEFAULT_MAX = 3;
const DEFAULT_MIN_PROB = 0.2;

interface TransitionStats {
  /** key = speculationKey(nextCall); value = { call, count } */
  next: Map<string, { call: ToolCall; count: number }>;
  total: number;
}

/**
 * Build a predictor from the ordered list of calls executed so far. Pure; the
 * returned object exposes `predict(priorCall, options)`.
 */
export class TransitionPredictor {
  /** key = speculationKey(prevCall); transitions from that call. */
  private readonly transitions = new Map<string, TransitionStats>();
  /** Global frequency prior over distinct concrete calls. */
  private readonly globalCounts = new Map<string, { call: ToolCall; count: number }>();
  private globalTotal = 0;

  constructor(history: readonly ToolCall[] = []) {
    for (let i = 0; i < history.length; i++) {
      const cur = history[i]!;
      this.observeGlobal(cur);
      if (i > 0) this.observeTransition(history[i - 1]!, cur);
    }
  }

  /** Record one more executed call (online use). */
  observe(prev: ToolCall | null, cur: ToolCall): void {
    this.observeGlobal(cur);
    if (prev) this.observeTransition(prev, cur);
  }

  private observeGlobal(call: ToolCall): void {
    const k = speculationKey(call);
    const entry = this.globalCounts.get(k);
    if (entry) entry.count++;
    else this.globalCounts.set(k, { call, count: 1 });
    this.globalTotal++;
  }

  private observeTransition(prev: ToolCall, cur: ToolCall): void {
    const pk = speculationKey(prev);
    let stats = this.transitions.get(pk);
    if (!stats) {
      stats = { next: new Map(), total: 0 };
      this.transitions.set(pk, stats);
    }
    const ck = speculationKey(cur);
    const entry = stats.next.get(ck);
    if (entry) entry.count++;
    else stats.next.set(ck, { call: cur, count: 1 });
    stats.total++;
  }

  /**
   * Predict the top-K concrete next calls following `priorCall`. Probability is
   * the smoothed transition probability blended with the global prior. Only
   * eligible (pure-read) calls are returned; ineligible candidates are dropped
   * (we never speculate a write). Deterministic: ties break by descending count
   * then by key for stability.
   */
  predict(
    priorCall: ToolCall | null,
    options: PipelineOptions = {}
  ): Speculation[] {
    const smoothing = options.smoothing ?? DEFAULT_SMOOTHING;
    const maxK = options.maxSpeculationsPerTurn ?? DEFAULT_MAX;
    const minProb = options.minProbability ?? DEFAULT_MIN_PROB;

    // Candidate set = transitions from priorCall ∪ global calls (for the prior).
    const candidates = new Map<string, { call: ToolCall; transCount: number }>();

    if (priorCall) {
      const stats = this.transitions.get(speculationKey(priorCall));
      if (stats) {
        for (const [k, v] of stats.next) {
          candidates.set(k, { call: v.call, transCount: v.count });
        }
      }
    }
    // Bring in global-prior-only candidates with transCount 0 so smoothing can
    // still surface a frequently-seen call even without a local transition.
    for (const [k, v] of this.globalCounts) {
      if (!candidates.has(k)) candidates.set(k, { call: v.call, transCount: 0 });
    }

    const transTotal = priorCall
      ? this.transitions.get(speculationKey(priorCall))?.total ?? 0
      : 0;
    const distinctCandidates = candidates.size;
    const denom = transTotal + smoothing * distinctCandidates;

    const scored: Speculation[] = [];
    for (const [k, v] of candidates) {
      if (!isSpeculatable(v.call.name)) continue;
      // Smoothed transition probability: (count + smoothing) / (total + smoothing*|C|).
      const prob = denom > 0 ? (v.transCount + smoothing) / denom : 0;
      if (prob < minProb) continue;
      scored.push({
        call: v.call,
        key: k,
        probability: prob,
        source: "transition-model",
      });
    }

    scored.sort(
      (a, b) => b.probability - a.probability || a.key.localeCompare(b.key)
    );
    return scored.slice(0, maxK);
  }
}

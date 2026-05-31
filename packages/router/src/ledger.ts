/**
 * Routing ledger — track actual-vs-baseline spend per call.
 *
 * Buyer's question, paraphrased: "What did this router actually save me
 * vs. always-Opus?" The ledger answers it with the same accountant
 * @prune/budget-gate uses, so the two layers' numbers reconcile to the
 * cent. Methodology designed to be reproducible by an outside reviewer
 * (CLAUDE.md credibility rule): every call records the model used, the
 * exact usage, and what the baseline model would have cost on the same
 * tokens.
 */

import { calculateCost, type Provider } from "@prune/shared";

export interface LedgerCall {
  model: string;
  provider?: Provider;
  tokensIn: number;
  tokensOut: number;
  tokensCached?: number;
}

export interface LedgerEntry {
  call: LedgerCall;
  actualCostUsd: number;
  baselineCostUsd: number;
  savedUsd: number;
  /** Fraction (0..1) — savedUsd / baselineCostUsd. */
  savedFraction: number;
}

export interface LedgerSummary {
  callCount: number;
  totalActualUsd: number;
  totalBaselineUsd: number;
  totalSavedUsd: number;
  /** weighted average savedFraction. */
  averageSavedFraction: number;
}

export class RoutingLedger {
  private readonly entries: LedgerEntry[] = [];

  /**
   * Construct with the baseline model that the savings are measured
   * against (e.g. "claude-opus-4" — what you'd run if you didn't route).
   */
  constructor(private readonly baselineModel: string, private readonly baselineProvider: Provider = "anthropic") {}

  record(call: LedgerCall): LedgerEntry {
    const actualProvider = call.provider ?? "anthropic";
    const actualCost = calculateCost(
      actualProvider,
      call.model,
      call.tokensIn,
      call.tokensOut,
      call.tokensCached ?? 0
    );
    const baselineCost = calculateCost(
      this.baselineProvider,
      this.baselineModel,
      call.tokensIn,
      call.tokensOut,
      call.tokensCached ?? 0
    );
    const saved = baselineCost - actualCost;
    const fraction = baselineCost > 0 ? saved / baselineCost : 0;
    const entry: LedgerEntry = {
      call,
      actualCostUsd: actualCost,
      baselineCostUsd: baselineCost,
      savedUsd: saved,
      savedFraction: fraction,
    };
    this.entries.push(entry);
    return entry;
  }

  summary(): LedgerSummary {
    let actual = 0;
    let baseline = 0;
    for (const e of this.entries) {
      actual += e.actualCostUsd;
      baseline += e.baselineCostUsd;
    }
    const saved = baseline - actual;
    return {
      callCount: this.entries.length,
      totalActualUsd: actual,
      totalBaselineUsd: baseline,
      totalSavedUsd: saved,
      averageSavedFraction: baseline > 0 ? saved / baseline : 0,
    };
  }

  /** Return entries in insertion order — for audit / per-call analysis. */
  history(): readonly LedgerEntry[] {
    return this.entries;
  }
}

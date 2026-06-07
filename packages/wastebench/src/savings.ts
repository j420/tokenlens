/**
 * Counterfactual savings accounting and the reflexive overhead SLO. Pure.
 *
 * The accounting is deliberately conservative and honest: gross savings clamp
 * negative per-record deltas to zero (an optimization that made a single call
 * costlier doesn't manufacture "savings"), but the observer's overhead is summed
 * in full and subtracted, so the NET can go negative and the SLO can fail. That
 * asymmetry is the point — it makes the benchmark hard to game.
 */

import type {
  FeatureRollup,
  OverheadSlo,
  SavingsRecord,
  SavingsRollup,
  SloVerdict,
} from "./types.js";

export function rollupSavings(records: readonly SavingsRecord[]): SavingsRollup {
  const byFeature: Record<string, FeatureRollup> = {};
  let grossSaved = 0;
  let overhead = 0;

  for (const r of records) {
    const gross = Math.max(0, (r.baselineTokens ?? 0) - (r.optimizedTokens ?? 0));
    const oh = Math.max(0, r.overheadTokens ?? 0);
    grossSaved += gross;
    overhead += oh;

    const f =
      byFeature[r.feature] ??
      (byFeature[r.feature] = {
        records: 0,
        grossSaved: 0,
        overhead: 0,
        netSaved: 0,
      });
    f.records += 1;
    f.grossSaved += gross;
    f.overhead += oh;
    f.netSaved = f.grossSaved - f.overhead;
  }

  return {
    records: records.length,
    grossSaved,
    overhead,
    netSaved: grossSaved - overhead,
    overheadRatio: grossSaved > 0 ? overhead / grossSaved : null,
    byFeature,
  };
}

/**
 * Check the reflexive overhead SLO. A null overhead ratio (no gross savings at
 * all) FAILS the SLO when any overhead was spent — the observer cost something
 * and saved nothing — and passes only when overhead is also zero.
 */
export function checkOverheadSlo(
  rollup: SavingsRollup,
  slo: OverheadSlo
): SloVerdict {
  const budget = slo.maxOverheadRatio;
  if (rollup.overheadRatio === null) {
    const ok = rollup.overhead === 0;
    return {
      ok,
      overheadRatio: null,
      budget,
      reason: ok
        ? "no savings and no overhead"
        : "overhead spent but zero gross savings",
    };
  }
  const ok = rollup.overheadRatio <= budget;
  return {
    ok,
    overheadRatio: rollup.overheadRatio,
    budget,
    reason: ok
      ? `overhead ${(rollup.overheadRatio * 100).toFixed(1)}% within ${(budget * 100).toFixed(1)}% budget`
      : `overhead ${(rollup.overheadRatio * 100).toFixed(1)}% exceeds ${(budget * 100).toFixed(1)}% budget`,
  };
}

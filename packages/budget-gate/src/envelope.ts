/**
 * Pure envelope state math. No I/O; given a snapshot of the envelope row
 * and its charges, produce the dollar/time projections every other layer
 * (gate, hooks, MCP, UI) consumes.
 *
 * Burn rate uses a simple linear fit over the recent window (default
 * 24h or the full elapsed period if shorter). Linear is honest: the
 * underlying spend pattern in coding-agent sessions is bursty and
 * non-stationary, so dressing this up with EWMA or ARIMA would imply
 * more confidence than the data warrants. Callers can replace the
 * projector if they have stronger signal.
 */

import type { BudgetChargeRow, BudgetEnvelopeRow } from "@prune/persistence";

export interface BudgetState {
  envelope: BudgetEnvelopeRow;
  /** Absolute total spent against this envelope in [period_start, asOf]. */
  spentUsd: number;
  /** limit_usd − spentUsd, floored at 0. */
  remainingUsd: number;
  /** spentUsd / limit_usd, clamped to [0, 1]. */
  pctSpent: number;
  /** Calendar-clock fraction of the period elapsed in [0, 1]. */
  pctTimeElapsed: number;
  /** True if envelope is past period_end relative to `asOf`. */
  isExpired: boolean;
  /** Dollars-per-day burn rate over the projection window. 0 if no charges in window. */
  burnRatePerDay: number;
  /** Days remaining in the period (can be 0 or negative if expired). */
  daysLeftInPeriod: number;
  /**
   * Projected total spend at period end, extrapolating burnRatePerDay
   * over daysLeftInPeriod and adding it to spentUsd. Capped at no
   * particular value — caller decides what to do with overruns.
   */
  projectedSpendAtPeriodEnd: number;
  /**
   * If burnRatePerDay > 0 and the projection crosses limit_usd before
   * period_end, the projected exhaustion date; otherwise null.
   */
  projectedExhaustionAt: Date | null;
  /** Time the snapshot was computed. */
  asOf: Date;
}

export interface SummarizeOptions {
  /** Window over which to compute burn rate. Default 24h. */
  burnRateWindow?: { hours: number };
  /** "Now" for testability. Default `new Date()`. */
  asOf?: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Compute burn rate as $/day over the most recent `windowHours` of
 * charges, normalized by the actual elapsed window (so a 3h-old envelope
 * with $1 spent gives 8 $/day, not 24 $/day). Returns 0 when there are
 * no charges or when the window is degenerate.
 */
function computeBurnRate(
  charges: BudgetChargeRow[],
  asOf: Date,
  periodStart: Date,
  windowHours: number
): number {
  if (charges.length === 0) return 0;
  const windowMs = windowHours * MS_PER_HOUR;
  const windowStartMs = Math.max(asOf.getTime() - windowMs, periodStart.getTime());
  const windowStart = new Date(windowStartMs);
  const elapsedMs = asOf.getTime() - windowStartMs;
  if (elapsedMs <= 0) return 0;
  let windowSpend = 0;
  for (const c of charges) {
    const t = Date.parse(c.timestamp);
    if (!Number.isFinite(t)) continue;
    if (t >= windowStart.getTime() && t <= asOf.getTime()) {
      windowSpend += c.cost_usd;
    }
  }
  const elapsedDays = elapsedMs / MS_PER_DAY;
  return windowSpend / elapsedDays;
}

export function summarizeEnvelope(
  envelope: BudgetEnvelopeRow,
  charges: BudgetChargeRow[],
  options: SummarizeOptions = {}
): BudgetState {
  const asOf = options.asOf ?? new Date();
  const windowHours = options.burnRateWindow?.hours ?? 24;

  const periodStart = new Date(envelope.period_start);
  const periodEnd = new Date(envelope.period_end);

  let spentUsd = 0;
  for (const c of charges) {
    const t = Date.parse(c.timestamp);
    if (!Number.isFinite(t)) continue;
    if (t >= periodStart.getTime() && t <= asOf.getTime()) {
      spentUsd += c.cost_usd;
    }
  }

  const remainingUsd = Math.max(0, envelope.limit_usd - spentUsd);
  const pctSpent = envelope.limit_usd > 0 ? clamp01(spentUsd / envelope.limit_usd) : 1;

  const totalPeriodMs = Math.max(1, periodEnd.getTime() - periodStart.getTime());
  const elapsedPeriodMs = Math.max(0, asOf.getTime() - periodStart.getTime());
  const pctTimeElapsed = clamp01(elapsedPeriodMs / totalPeriodMs);
  const isExpired = asOf.getTime() > periodEnd.getTime();
  const daysLeftInPeriod = Math.max(
    0,
    (periodEnd.getTime() - asOf.getTime()) / MS_PER_DAY
  );

  const burnRatePerDay = computeBurnRate(charges, asOf, periodStart, windowHours);
  const projectedAdditionalSpend = burnRatePerDay * daysLeftInPeriod;
  const projectedSpendAtPeriodEnd = spentUsd + projectedAdditionalSpend;

  let projectedExhaustionAt: Date | null = null;
  if (burnRatePerDay > 0 && spentUsd < envelope.limit_usd) {
    const daysToExhaust = (envelope.limit_usd - spentUsd) / burnRatePerDay;
    const exhaustionMs = asOf.getTime() + daysToExhaust * MS_PER_DAY;
    if (exhaustionMs <= periodEnd.getTime()) {
      projectedExhaustionAt = new Date(exhaustionMs);
    }
  }

  return {
    envelope,
    spentUsd,
    remainingUsd,
    pctSpent,
    pctTimeElapsed,
    isExpired,
    burnRatePerDay,
    daysLeftInPeriod,
    projectedSpendAtPeriodEnd,
    projectedExhaustionAt,
    asOf,
  };
}

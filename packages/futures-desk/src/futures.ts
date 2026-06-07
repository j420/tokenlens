/**
 * Token Pre-Commitment / Futures Desk  (F16)
 * ==========================================
 * The Batch API (and off-peak tiers) trade latency for a real published
 * discount, but nothing lets an actor DECLARE up front that a piece of work is
 * non-urgent and capture it. This is that instrument: a reservation says "this
 * job can wait until `deadline`", and the desk prices the discounted (slow-lane)
 * cost against the interactive cost, and reports the saving.
 *
 * `priceReservations(reservations, options)` is a PURE function.
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same inputs => same quotes. Never throws.
 *   - Honest pricing via `@prune/shared`: an unpriced model yields null cost and
 *     null saving — never fabricated. The discount RATE is caller-supplied (the
 *     provider's published Batch rate), not invented.
 *   - Eligibility is a deterministic lead-time test (enough latency headroom to
 *     use the slow lane); an ineligible reservation stays interactive at full
 *     price. No regex, no model.
 */

import { getModelPricingStrictByName } from "@prune/shared";

// ============================================================================
// Types
// ============================================================================

export interface Reservation {
  id: string;
  /** Model the job will run on (drives pricing). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  /** When the result is needed by (ISO). Far enough out ⇒ slow-lane eligible. */
  deadlineIso: string;
}

export interface FuturesOptions {
  /**
   * Published slow-lane (Batch/off-peak) discount in [0,1] — caller-supplied
   * from the provider's billing docs (e.g. 0.5 = 50% off). Required for a
   * saving; an out-of-range value disables the discount (savings 0).
   */
  batchDiscount: number;
  /**
   * Minimum lead time (deadline − now) in ms to qualify for the slow lane.
   * Default 1h.
   */
  minLeadMs?: number;
  /** "now" instant (ISO). Default: the current wall clock. */
  nowIso?: string;
}

export type Lane = "batch" | "interactive";

export interface FuturesQuote {
  id: string;
  lane: Lane;
  eligible: boolean;
  /** Lead time in ms (deadline − now); negative when already past due. */
  leadMs: number;
  interactiveCostUsd: number | null;
  /** Discounted cost when the slow lane is used; equals interactive when not. */
  laneCostUsd: number | null;
  /** interactive − lane, when both priced and the batch lane applies; else null. */
  savingsUsd: number | null;
}

export interface FuturesReport {
  quotes: FuturesQuote[];
  totalInteractiveUsd: number | null;
  totalLaneUsd: number | null;
  totalSavingsUsd: number | null;
  skipped: number;
}

// ============================================================================
// priceReservations
// ============================================================================

const HOUR_MS = 3_600_000;

export function priceReservations(reservations: unknown, options: FuturesOptions): FuturesReport {
  const discount =
    options &&
    typeof options.batchDiscount === "number" &&
    Number.isFinite(options.batchDiscount) &&
    options.batchDiscount > 0 &&
    options.batchDiscount <= 1
      ? options.batchDiscount
      : 0;
  const minLeadMs =
    options && typeof options.minLeadMs === "number" && Number.isFinite(options.minLeadMs) && options.minLeadMs >= 0
      ? options.minLeadMs
      : HOUR_MS;
  const nowMs =
    options && typeof options.nowIso === "string" && Number.isFinite(Date.parse(options.nowIso))
      ? Date.parse(options.nowIso)
      : Date.now();

  const list: Reservation[] = Array.isArray(reservations)
    ? (reservations.filter(isReservation) as Reservation[])
    : [];
  const skipped = (Array.isArray(reservations) ? reservations.length : 0) - list.length;

  const quotes: FuturesQuote[] = [];
  let totalInteractive = 0;
  let totalLane = 0;
  let totalSavings = 0;
  let costComplete = true;

  for (const r of list) {
    const interactive = costUsd(r);
    const deadlineMs = Date.parse(r.deadlineIso);
    const leadMs = Number.isFinite(deadlineMs) ? deadlineMs - nowMs : -Infinity;
    const eligible = discount > 0 && Number.isFinite(leadMs) && leadMs >= minLeadMs;
    const lane: Lane = eligible ? "batch" : "interactive";

    let laneCost: number | null = interactive;
    let savings: number | null = interactive === null ? null : 0;
    if (eligible && interactive !== null) {
      laneCost = round(interactive * (1 - discount));
      savings = round(interactive - laneCost);
    }

    if (interactive === null) costComplete = false;
    else {
      totalInteractive += interactive;
      totalLane += laneCost ?? interactive;
      totalSavings += savings ?? 0;
    }

    quotes.push({
      id: r.id,
      lane,
      eligible,
      leadMs: Number.isFinite(leadMs) ? leadMs : -1,
      interactiveCostUsd: interactive,
      laneCostUsd: laneCost,
      savingsUsd: savings,
    });
  }

  return {
    quotes,
    totalInteractiveUsd: costComplete ? round(totalInteractive) : null,
    totalLaneUsd: costComplete ? round(totalLane) : null,
    totalSavingsUsd: costComplete ? round(totalSavings) : null,
    skipped,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function costUsd(r: Reservation): number | null {
  const p = getModelPricingStrictByName(r.model);
  if (!p || typeof p.input !== "number" || typeof p.output !== "number") return null;
  const cachedRate = typeof p.cached_input === "number" ? p.cached_input : p.input;
  return round(
    (nonNeg(r.inputTokens) * p.input +
      nonNeg(r.outputTokens) * p.output +
      nonNeg(r.cacheReadTokens) * cachedRate) /
      1_000_000
  );
}

function isReservation(v: unknown): v is Reservation {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.model === "string" &&
    r.model.length > 0 &&
    typeof r.inputTokens === "number" &&
    Number.isFinite(r.inputTokens) &&
    typeof r.outputTokens === "number" &&
    Number.isFinite(r.outputTokens) &&
    typeof r.deadlineIso === "string" &&
    r.deadlineIso.length > 0
  );
}

function nonNeg(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

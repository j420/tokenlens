/**
 * Batch-Tier Router  (List1)
 * ==========================
 * Providers offer a Batch lane at roughly half price in exchange for latency.
 * Most agent turns are interactive and can't use it — but a meaningful slice
 * (nightly evals, bulk summarization, non-blocking background work) can. This is
 * the MECHANICAL per-request classifier: given caller-declared signals, it
 * decides batch vs interactive and quotes the discount. (The demand-side
 * commitment contract — declaring future work to capture the discount — is
 * @prune/futures-desk; this is just the per-request routing.)
 *
 * `routeRequest(request, options?)` is a PURE function. Eligibility is a
 * deterministic predicate over DECLARED flags — never inferred from content
 * (no regex, no model). The discount is caller-supplied (the provider's
 * published Batch rate); a saving is null when the request isn't priced.
 */

// ============================================================================
// Types
// ============================================================================

export interface BatchRequest {
  /** Is this turn blocking a human / interactive UI? Caller-declared. */
  interactive: boolean;
  /**
   * Does the provider expose a Batch lane for this model? Caller-declared
   * (varies by provider/model). Absent ⇒ treated as false (no batch lane).
   */
  batchLaneAvailable?: boolean;
  /**
   * Latency headroom in ms before the result is needed. The Batch lane has a
   * long SLA, so a request needs enough slack. Absent ⇒ treated as 0.
   */
  latencySlackMs?: number;
  /** Interactive USD cost of the request (caller-supplied). null ⇒ unknown. */
  interactiveCostUsd?: number | null;
}

export interface RouterOptions {
  /** Published Batch discount in [0,1] (e.g. 0.5). Default 0.5. */
  batchDiscount?: number;
  /** Minimum latency slack (ms) to qualify for the Batch lane. Default 1h. */
  minSlackMs?: number;
}

export type Lane = "batch" | "interactive";

export interface RouteDecision {
  lane: Lane;
  eligible: boolean;
  reason: "interactive-turn" | "no-batch-lane" | "insufficient-slack" | "routed-to-batch";
  interactiveCostUsd: number | null;
  /** Discounted cost when routed to batch; equals interactive otherwise. */
  laneCostUsd: number | null;
  savingsUsd: number | null;
}

// ============================================================================
// routeRequest
// ============================================================================

const HOUR_MS = 3_600_000;

export function routeRequest(request: unknown, options: RouterOptions = {}): RouteDecision {
  const discount = unit(options.batchDiscount, 0.5);
  const minSlack =
    typeof options.minSlackMs === "number" && Number.isFinite(options.minSlackMs) && options.minSlackMs >= 0
      ? options.minSlackMs
      : HOUR_MS;

  const r = (request ?? {}) as Partial<BatchRequest>;
  const interactive = r.interactive !== false; // default-safe: assume interactive
  const batchLane = r.batchLaneAvailable === true;
  const slack = typeof r.latencySlackMs === "number" && Number.isFinite(r.latencySlackMs) ? r.latencySlackMs : 0;
  const cost =
    typeof r.interactiveCostUsd === "number" && Number.isFinite(r.interactiveCostUsd)
      ? r.interactiveCostUsd
      : null;

  const decline = (reason: RouteDecision["reason"]): RouteDecision => ({
    lane: "interactive",
    eligible: false,
    reason,
    interactiveCostUsd: cost,
    laneCostUsd: cost,
    savingsUsd: cost === null ? null : 0,
  });

  if (interactive) return decline("interactive-turn");
  if (!batchLane) return decline("no-batch-lane");
  if (slack < minSlack) return decline("insufficient-slack");

  const laneCost = cost === null ? null : round(cost * (1 - discount));
  return {
    lane: "batch",
    eligible: true,
    reason: "routed-to-batch",
    interactiveCostUsd: cost,
    laneCostUsd: laneCost,
    savingsUsd: cost === null || laneCost === null ? null : round(cost - laneCost),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function unit(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : dflt;
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

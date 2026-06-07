/**
 * Waterbed-Aware Net-Effect Gate  (F12)
 * =====================================
 * Press down on token cost in one place and it often pops up in another: prune a
 * tool result and the agent re-asks for it; rewrite-as-diff and bust the prompt
 * cache; compress context and trigger a retry. A "saving" measured only at the
 * transform site is a GROSS number; the real figure is NET of every cost the
 * transform induces downstream. The `diff-enforcer` already nets ONE specific
 * transform (diff vs rewrite, including the cache bust). This is the general
 * form: wrap ANY transform with its induced-cost vector and decide whether the
 * saving survives.
 *
 * `evaluateWaterbed(transform, options?)` is a PURE function. It subtracts the
 * transform's own overhead and every caller-supplied induced cost
 * (expectedOccurrences × perOccurrenceUsd) from the gross saving, and returns
 * approve / veto / insufficient_data.
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same inputs => same verdict. Never throws.
 *   - Fail-toward-veto on missing data. If the gross saving or ANY induced
 *     cost's per-occurrence price is null/unknown, the verdict is
 *     `insufficient_data` and `approved` is false — a saving that cannot be
 *     shown net-positive is never approved (the whole point of the gate).
 *   - No fabricated numbers. Every USD figure is caller-supplied; nothing is
 *     defaulted. No regex, no model.
 */

// ============================================================================
// Types
// ============================================================================

/** One downstream cost the transform is expected to induce. */
export interface InducedCost {
  /** Free-form label, e.g. "retry", "re-ask", "cache-write", "recompute". */
  kind: string;
  /**
   * Expected number of induced occurrences per application of the transform.
   * A rate (e.g. 0.1 retries) or a count (e.g. 1 cache-write). Caller-measured
   * — e.g. the retry rate from the F11 task-ledger. Must be finite & >= 0.
   */
  expectedOccurrences: number;
  /**
   * USD cost of ONE occurrence. null when the model/price is unknown — which
   * makes the whole evaluation `insufficient_data` (we cannot net an unknown).
   */
  perOccurrenceUsd: number | null;
}

export interface TransformEffect {
  /** Gross USD saving claimed at the transform site. null ⇒ insufficient_data. */
  grossSavingUsd: number | null;
  /** Gross token saving at the transform site (informational; not netted in USD). */
  grossSavingTokens?: number;
  /** USD overhead the transform itself costs to run (probe, recompute). Default 0. */
  overheadUsd?: number;
  /** Induced downstream costs to net out. */
  induced?: readonly InducedCost[];
}

export interface WaterbedOptions {
  /**
   * Minimum net USD saving required to APPROVE. Default 0 — any strictly
   * positive net saving approves. Raise it to demand a margin that absorbs
   * measurement noise.
   */
  marginUsd?: number;
}

export type WaterbedVerdict = "approve" | "veto" | "insufficient_data";

export interface WaterbedReport {
  verdict: WaterbedVerdict;
  /** Convenience boolean: true only when verdict === "approve". */
  approved: boolean;
  /** Gross saving echoed back (null when unknown). */
  grossSavingUsd: number | null;
  /** Sum of induced costs (expectedOccurrences × perOccurrenceUsd) + overhead. null when any induced price is unknown. */
  inducedCostUsd: number | null;
  /** grossSavingUsd − inducedCostUsd. null when either side is unknown. */
  netSavingUsd: number | null;
  /** Per-induced-cost breakdown (occurrences × price), for auditing. */
  breakdown: Array<{ kind: string; occurrences: number; perOccurrenceUsd: number | null; costUsd: number | null }>;
  /** Human-readable one-liner explaining the verdict. */
  reason: string;
}

// ============================================================================
// evaluateWaterbed
// ============================================================================

export function evaluateWaterbed(
  transform: unknown,
  options: WaterbedOptions = {}
): WaterbedReport {
  const margin =
    typeof options.marginUsd === "number" && Number.isFinite(options.marginUsd)
      ? options.marginUsd
      : 0;

  const t = (transform ?? {}) as Partial<TransformEffect>;
  const gross =
    typeof t.grossSavingUsd === "number" && Number.isFinite(t.grossSavingUsd)
      ? t.grossSavingUsd
      : null;
  const overhead =
    typeof t.overheadUsd === "number" && Number.isFinite(t.overheadUsd) && t.overheadUsd > 0
      ? t.overheadUsd
      : 0;

  const inducedList: InducedCost[] = Array.isArray(t.induced)
    ? (t.induced.filter(isInducedCost) as InducedCost[])
    : [];

  // Build the breakdown; any unknown per-occurrence price poisons the total.
  let inducedTotal = overhead;
  let inducedComplete = true;
  const breakdown: WaterbedReport["breakdown"] = [];
  if (overhead > 0) {
    breakdown.push({ kind: "overhead", occurrences: 1, perOccurrenceUsd: overhead, costUsd: overhead });
  }
  for (const ic of inducedList) {
    if (ic.perOccurrenceUsd === null) {
      inducedComplete = false;
      breakdown.push({ kind: ic.kind, occurrences: ic.expectedOccurrences, perOccurrenceUsd: null, costUsd: null });
      continue;
    }
    const cost = ic.expectedOccurrences * ic.perOccurrenceUsd;
    inducedTotal += cost;
    breakdown.push({
      kind: ic.kind,
      occurrences: ic.expectedOccurrences,
      perOccurrenceUsd: ic.perOccurrenceUsd,
      costUsd: round(cost),
    });
  }

  const inducedCostUsd = inducedComplete ? round(inducedTotal) : null;

  // Insufficient data ⇒ never approve.
  if (gross === null || inducedCostUsd === null) {
    return {
      verdict: "insufficient_data",
      approved: false,
      grossSavingUsd: gross,
      inducedCostUsd,
      netSavingUsd: null,
      breakdown,
      reason:
        gross === null
          ? "Gross saving is unknown (null) — cannot verify the transform is net-positive."
          : "An induced cost has an unknown per-occurrence price — cannot net it out.",
    };
  }

  const net = round(gross - inducedCostUsd);
  // Pre-round every USD value the report and its reason string expose, ONCE,
  // so the structured fields and the human-readable text never disagree on
  // precision. The decision itself compares the raw (unrounded) margin.
  const grossRounded = round(gross);
  const marginRounded = round(margin);
  const approve = net > margin;
  return {
    verdict: approve ? "approve" : "veto",
    approved: approve,
    grossSavingUsd: grossRounded,
    inducedCostUsd,
    netSavingUsd: net,
    breakdown,
    reason: approve
      ? `Net saving $${net} exceeds the $${marginRounded} margin after netting $${inducedCostUsd} of induced cost.`
      : `Net saving $${net} does not clear the $${marginRounded} margin (induced cost $${inducedCostUsd} ` +
        `eats the gross $${grossRounded}) — the saving reappears elsewhere; vetoed.`,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function isInducedCost(v: unknown): v is InducedCost {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  const occ = c.expectedOccurrences;
  return (
    typeof c.kind === "string" &&
    c.kind.length > 0 &&
    typeof occ === "number" &&
    Number.isFinite(occ) &&
    occ >= 0 &&
    (c.perOccurrenceUsd === null ||
      (typeof c.perOccurrenceUsd === "number" && Number.isFinite(c.perOccurrenceUsd)))
  );
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * Cheapest-Context Bounty  (F17)
 * ==============================
 * f12 skill-library captures what HAPPENED. This is a contest for the cheapest
 * thing that COULD: among submissions for a recurring task, reward whoever
 * submits the lowest-cost prompt+context that still PASSES a frozen quality gate
 * — min-cost subject to quality. The winner becomes the default skill, so the
 * cheap-sufficient path is the one everyone inherits.
 *
 * `evaluateBounty(submissions, options?)` is a PURE function.
 *
 * THE DISCIPLINE (no model in the decision):
 *   - The quality verdict `passedGate` is CALLER-FED — the frozen
 *     `@prune/quality` non-inferiority gate decided it offline. This package
 *     never judges quality; it only SELECTS among gate-passers by cost.
 *   - Selection is deterministic min-cost: by USD when every passer is priced,
 *     otherwise by tokens; ties broken by (submitter, id) for a total order.
 *   - Honest pricing: a null costUsd makes USD ranking unavailable (falls back
 *     to tokens); savings vs an incumbent is null unless the incumbent cost is
 *     supplied. No fabricated numbers, no regex.
 */

// ============================================================================
// Types
// ============================================================================

export interface BountySubmission {
  id: string;
  submitter: string;
  /** Total context+prompt token cost of this submission. */
  costTokens: number;
  /** USD cost, or null when the model is unpriced. */
  costUsd?: number | null;
  /** Did it PASS the frozen quality gate? (caller-fed; the only eligibility test). */
  passedGate: boolean;
}

export interface BountyOptions {
  /** The current default's cost (USD), to quantify the win. null ⇒ no saving. */
  incumbentCostUsd?: number | null;
  /** The current default's token cost, for a token-basis saving. */
  incumbentCostTokens?: number;
}

export interface RankedSubmission {
  id: string;
  submitter: string;
  costTokens: number;
  costUsd: number | null;
}

export interface BountyResult {
  /** The cheapest gate-passing submission, or null when none passed. */
  winner: RankedSubmission | null;
  /** All gate-passers, cheapest first. */
  ranked: RankedSubmission[];
  /** Submissions that failed the gate (ineligible), by id. */
  rejected: string[];
  /** "usd" when every passer was priced (USD basis); else "tokens". */
  basis: "usd" | "tokens" | "none";
  /** incumbentCost − winnerCost on the chosen basis; null when unavailable. */
  savings: number | null;
  /** Entries ignored because they were malformed. */
  skipped: number;
}

// ============================================================================
// evaluateBounty
// ============================================================================

export function evaluateBounty(submissions: unknown, options: BountyOptions = {}): BountyResult {
  const list: BountySubmission[] = Array.isArray(submissions)
    ? (submissions.filter(isSubmission) as BountySubmission[])
    : [];
  const skipped = (Array.isArray(submissions) ? submissions.length : 0) - list.length;

  const passers = list.filter((s) => s.passedGate);
  const rejected = list.filter((s) => !s.passedGate).map((s) => s.id).sort();

  if (passers.length === 0) {
    return { winner: null, ranked: [], rejected, basis: "none", savings: null, skipped };
  }

  // USD basis only when EVERY passer carries a real price (else honesty demands
  // we rank on tokens, the dimension we fully observe).
  const allPriced = passers.every((s) => typeof s.costUsd === "number" && s.costUsd !== null);
  const basis: "usd" | "tokens" = allPriced ? "usd" : "tokens";

  const ranked = passers
    .map(toRanked)
    .sort((a, b) => {
      const ca = basis === "usd" ? a.costUsd! : a.costTokens;
      const cb = basis === "usd" ? b.costUsd! : b.costTokens;
      if (ca !== cb) return ca - cb;
      // stable, total tie-break
      if (a.submitter !== b.submitter) return a.submitter < b.submitter ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const winner = ranked[0]!;

  let savings: number | null = null;
  if (basis === "usd" && winner.costUsd !== null) {
    const inc = options.incumbentCostUsd;
    if (typeof inc === "number" && Number.isFinite(inc)) savings = round(inc - winner.costUsd);
  } else if (basis === "tokens") {
    const inc = options.incumbentCostTokens;
    if (typeof inc === "number" && Number.isFinite(inc)) savings = inc - winner.costTokens;
  }

  return { winner, ranked, rejected, basis, savings, skipped };
}

// ============================================================================
// Helpers
// ============================================================================

function toRanked(s: BountySubmission): RankedSubmission {
  return {
    id: s.id,
    submitter: s.submitter,
    costTokens: s.costTokens,
    costUsd: typeof s.costUsd === "number" ? s.costUsd : null,
  };
}

function isSubmission(v: unknown): v is BountySubmission {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    s.id.length > 0 &&
    typeof s.submitter === "string" &&
    s.submitter.length > 0 &&
    typeof s.costTokens === "number" &&
    Number.isFinite(s.costTokens) &&
    s.costTokens >= 0 &&
    typeof s.passedGate === "boolean"
  );
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * N3 — Cross-turn input recompression planner.
 *
 * Over a multi-turn session the cacheable prefix accumulates settled content —
 * old tool-results, resolved file reads, superseded reasoning. Each one is
 * re-served at the cache-READ tier (0.10x input) on every subsequent turn.
 * Recompressing it (e.g. squeezing a tool-result to its signature via
 * @prune/squeezer) shrinks that per-turn read — but changing bytes inside the
 * cached prefix BUSTS the cache from that point, forcing a one-time rewrite at
 * the write multiplier (1.25x for 5m, 2.0x for 1h).
 *
 * So recompression is an AMORTIZATION decision: pay a one-time rebuild now to
 * save read tokens on every remaining turn. This planner computes whether — and
 * which contiguous suffix — to recompress, by maximizing the net token saving
 * over the caller's estimated remaining turns.
 *
 * The key result (derived below) is that the WORTH-IT decision is independent
 * of the model's price: it reduces to comparing the estimated remaining turns
 * against a break-even that depends only on token counts and the TTL write
 * multiplier. Only the USD figures need pricing; the recommendation does not.
 *
 *   Recompress a suffix starting at bust point p. Let:
 *     savedPerTurn = sum over compressible segments in [p..] of
 *                    (currentTokens - compressedTokens)        (read saved/turn)
 *     rebuildTokens = sum over [p..] of (compressedTokens ?? currentTokens)
 *                    (the new, smaller tail written once on the bust)
 *     w = write multiplier (1.25 | 2.0); R = READ_MULTIPLIER (0.10)
 *
 *   keepCost(N)        = N * (rebuildTokens + savedPerTurn) * R          (read big each turn)
 *   recompressCost(N)  = rebuildTokens * w + N * rebuildTokens * R       (rebuild once, read small)
 *   net(N)             = keepCost - recompressCost
 *                      = N * savedPerTurn * R  -  rebuildTokens * w
 *   net > 0  <=>  N  >  (rebuildTokens * w) / (R * savedPerTurn)   = break-even
 *
 * The price (input rate) is a common factor and cancels from the inequality.
 *
 * Discipline: pure, deterministic, no model call. `compressedTokens` is
 * CALLER-supplied (the squeezer's measured output); the planner never invents a
 * compression ratio. Strict pricing (unknown model -> null USD, never a default
 * rate). PII-safe: token counts and optional labels only.
 */

import { FLAT_PRICING, type ModelPricing } from "@prune/shared";

import { READ_MULTIPLIER, WRITE_MULTIPLIER_1H, WRITE_MULTIPLIER_5M } from "./ttl-amortization.js";

/** One segment of the cacheable prefix, oldest -> newest. */
export interface RecompressSegment {
  /** Position in the cacheable prefix, 0-based ascending. */
  index: number;
  /** Current token count (caller-tokenized). */
  currentTokens: number;
  /**
   * Token count of a sound compressed variant (e.g. @prune/squeezer output),
   * or null when the segment is not compressible / not eligible (active
   * context, already minimal). NEVER fabricated by the planner. A value >=
   * currentTokens is treated as "no saving" (not compressible).
   */
  compressedTokens: number | null;
  /** Optional label for the plan output (e.g. "tool_result:auth.ts"). */
  label?: string;
}

export interface RecompressInput {
  model: string;
  ttl: "5m" | "1h";
  /** Ordered cacheable-prefix segments (oldest -> newest). */
  segments: readonly RecompressSegment[];
  /**
   * Estimated number of FUTURE turns that will read this prefix. Caller-
   * supplied (e.g. from session history / a remaining-budget heuristic). The
   * amortization is over these turns; 0 means never recompress.
   */
  estimatedRemainingTurns: number;
}

export interface RecompressPlan {
  /** Segment indices recommended for recompression (the compressible ones in the chosen suffix). */
  recompressIndices: number[];
  /** The cache-bust point — earliest index in the chosen suffix. null when no compressible segment exists. */
  bustAtIndex: number | null;
  /** Read tokens saved on every future turn if recompressed. */
  savedTokensPerTurn: number;
  /** Tokens re-written once when the cache busts (the compressed tail size). */
  rebuildTokens: number;
  /**
   * Break-even remaining turns for the chosen suffix — price-independent.
   * null when there is nothing compressible (no saving possible).
   */
  breakEvenTurns: number | null;
  /** Recompress now? True iff savedTokensPerTurn > 0 AND estimatedRemainingTurns >= breakEven. */
  recommend: boolean;
  /** Net USD saved over the remaining turns; null if model unpriced. Positive ⇒ worth it. */
  netSavingUsd: number | null;
  /** One-time rebuild cost in USD; null if unpriced. */
  rebuildCostUsd: number | null;
  /** Per-turn read saving in USD; null if unpriced. */
  savingPerTurnUsd: number | null;
  reason: string;
}

function writeMultiplier(ttl: "5m" | "1h"): number {
  return ttl === "1h" ? WRITE_MULTIPLIER_1H : WRITE_MULTIPLIER_5M;
}

function strictPricing(model: string): ModelPricing | null {
  return FLAT_PRICING[model] ?? null;
}

/** Token saving a segment offers, or 0 when it isn't soundly compressible. */
function segmentSaving(s: RecompressSegment): number {
  if (s.compressedTokens === null) return 0;
  if (!Number.isFinite(s.compressedTokens) || s.compressedTokens < 0) return 0;
  const cur = Math.max(0, s.currentTokens);
  const saving = cur - s.compressedTokens;
  return saving > 0 ? saving : 0;
}

/** Tokens this segment occupies after the (possible) recompression. */
function segmentRebuildTokens(s: RecompressSegment): number {
  const cur = Math.max(0, s.currentTokens);
  if (segmentSaving(s) <= 0) return cur; // not compressed -> stays current
  return Math.max(0, s.compressedTokens as number);
}

/**
 * Plan the cross-turn recompression of the cacheable prefix. Evaluates every
 * candidate bust point (each compressible segment's index) and selects the
 * contiguous suffix that maximizes net token saving over the remaining turns —
 * so a non-compressible early segment can't drag an earlier bust into the red.
 * Pure & deterministic.
 */
export function planRecompression(input: RecompressInput): RecompressPlan {
  const segs = input.segments;
  const w = writeMultiplier(input.ttl);
  const remaining = Number.isFinite(input.estimatedRemainingTurns)
    ? Math.max(0, Math.floor(input.estimatedRemainingTurns))
    : 0;
  const pricing = strictPricing(input.model);
  const unit = pricing && typeof pricing.input === "number" ? pricing.input / 1_000_000 : null;

  const compressibleIdx = segs
    .map((s, i) => (segmentSaving(s) > 0 ? i : -1))
    .filter((i) => i >= 0);

  if (compressibleIdx.length === 0) {
    return {
      recompressIndices: [],
      bustAtIndex: null,
      savedTokensPerTurn: 0,
      rebuildTokens: 0,
      breakEvenTurns: null,
      recommend: false,
      netSavingUsd: unit === null ? null : 0,
      rebuildCostUsd: unit === null ? null : 0,
      savingPerTurnUsd: unit === null ? null : 0,
      reason: "No compressible segments in the cacheable prefix; nothing to recompress.",
    };
  }

  // Evaluate each candidate suffix [p..] for p in the compressible indices.
  // net(p) in token-units = remaining * savedPerTurn(p) * R - rebuildTokens(p) * w.
  // Maximizing token-net maximizes USD-net (price is a positive common factor).
  let best: {
    p: number;
    savedPerTurn: number;
    rebuildTokens: number;
    netTokens: number;
  } | null = null;

  for (const p of compressibleIdx) {
    let savedPerTurn = 0;
    let rebuildTokens = 0;
    for (let i = p; i < segs.length; i++) {
      savedPerTurn += segmentSaving(segs[i]!);
      rebuildTokens += segmentRebuildTokens(segs[i]!);
    }
    const netTokens = remaining * savedPerTurn * READ_MULTIPLIER - rebuildTokens * w;
    if (
      best === null ||
      netTokens > best.netTokens ||
      // Tie-break: prefer the LATER bust point (smaller rebuild, less disruption).
      (netTokens === best.netTokens && p > best.p)
    ) {
      best = { p, savedPerTurn, rebuildTokens, netTokens };
    }
  }

  const chosen = best!;
  const recompressIndices = compressibleIdx.filter((i) => i >= chosen.p);
  const breakEvenTurns =
    chosen.savedPerTurn > 0
      ? (chosen.rebuildTokens * w) / (READ_MULTIPLIER * chosen.savedPerTurn)
      : null;
  const recommend =
    chosen.savedPerTurn > 0 && breakEvenTurns !== null && remaining >= breakEvenTurns;

  const savingPerTurnUsd = unit === null ? null : chosen.savedPerTurn * READ_MULTIPLIER * unit;
  const rebuildCostUsd = unit === null ? null : chosen.rebuildTokens * w * unit;
  const netSavingUsd =
    unit === null ? null : remaining * (chosen.savedPerTurn * READ_MULTIPLIER * unit) - chosen.rebuildTokens * w * unit;

  const reason = recommend
    ? `Recompress suffix from index ${chosen.p}: ${remaining} remaining turns ≥ ` +
      `${breakEvenTurns!.toFixed(2)} break-even; saves ${chosen.savedPerTurn} ` +
      `read tokens/turn after a one-time ${chosen.rebuildTokens}-token rebuild.`
    : `Hold: best plan (suffix from index ${chosen.p}) needs ` +
      `${breakEvenTurns === null ? "∞" : breakEvenTurns.toFixed(2)} remaining turns to amortize the ` +
      `${chosen.rebuildTokens}-token rebuild; only ${remaining} estimated.`;

  return {
    recompressIndices,
    bustAtIndex: chosen.p,
    savedTokensPerTurn: chosen.savedPerTurn,
    rebuildTokens: chosen.rebuildTokens,
    breakEvenTurns,
    recommend,
    netSavingUsd,
    rebuildCostUsd,
    savingPerTurnUsd,
    reason,
  };
}

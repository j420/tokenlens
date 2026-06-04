/**
 * Diff-vs-Rewrite Enforcer (Phase-8 Tier-1).
 *
 * `diffEnforce(original, proposed, options?)` decides whether sending a
 * line-level unified DIFF or a FULL REWRITE is cheaper in REAL tokens, and
 * guarantees the recommended diff is sound via a serialized round-trip apply.
 *
 * Pipeline:
 *   1. Split both texts into EOL-preserving line arrays.
 *   2. Guard input size: if the LCS DP table (n*m cells) would exceed
 *      `maxCells`, do NOT run the quadratic algorithm — fall back to "rewrite"
 *      with reason "bounded-fallback". (Bounded, never unbounded O(n*m).)
 *   3. Compute LCS edit script -> hunks -> serialized unified diff.
 *   4. CORRECTNESS: parse+apply the serialized diff back to `original`; require
 *      byte-equality with `proposed`. If it fails, recommend "rewrite"
 *      (diffVerified=false) — an unsound diff is never recommended.
 *   5. Token-count diff vs proposed via @prune/tokenizer (REAL counts).
 *   6. Decide using token comparison, plus guards for identical files, tiny
 *      files, and a changeRatio threshold favoring rewrite when most lines move.
 *
 * Pure & deterministic given the same tokenizer model. Never throws on input.
 *
 * DESIGN: LINE-LEVEL granularity (deliberate, not a limitation)
 * ------------------------------------------------------------
 * The diff is line-level: a one-character change re-sends that whole line on
 * both the "-" and "+" sides. This is the correct granularity for an EDIT-COST
 * decision, and is chosen over char/word-level intra-line diffing on purpose:
 *   1. SOUNDNESS. The round-trip verify (apply the serialized diff, require
 *      byte-equality) is simple and total at line granularity. Intra-line
 *      patch formats are materially harder to apply unambiguously and would
 *      weaken the one property that makes a diff safe to recommend.
 *   2. APPLICABILITY. Coding agents apply edits as line/region replacements;
 *      a char-level patch is not how the downstream tool consumes the change.
 *   3. MARGINAL TOKEN DELTA. Source lines are short (~tens of chars); the extra
 *      tokens from resending a changed line vs. a char-span are small, and the
 *      enforcer's `minSavingFraction` gate already routes the few cases where
 *      diff overhead isn't worth it to "rewrite". The dominant win (a small
 *      change in a large file) is fully captured at line level.
 * The LCS primitive in lcs.ts operates on any token array, so a caller that
 * genuinely needs sub-line diffing can reuse it on characters/words — but the
 * enforcer's verified recommendation stays line-level by design.
 */

import { countTokens } from "@prune/tokenizer";
import {
  splitLinesKeepingEol,
  computeLineEdits,
  commonAffix,
  type EditOp,
} from "./lcs.js";
import { buildHunks, renderUnifiedDiff, applyUnifiedDiff } from "./unified.js";

export type Recommendation = "diff" | "rewrite";

export interface DiffEnforceOptions {
  /** Token model used for REAL counts. Default "gpt-4o". */
  model?: string;
  /** Lines of context per hunk. Default 3. */
  context?: number;
  /**
   * changeRatio (changedLines / totalLines) at/above which we prefer "rewrite"
   * even if the diff is marginally cheaper — large rearrangements apply less
   * reliably and review worse. Default 0.5. Set to >1 to disable.
   */
  changeRatioThreshold?: number;
  /**
   * Max LCS DP cells (n * m) we will compute. Above this we refuse the
   * quadratic algorithm and fall back to "rewrite". Default 25_000_000
   * (e.g. ~5000 x 5000 lines). Keeps worst case bounded.
   */
  maxCells?: number;
  /**
   * Require diffTokens to be at most this fraction of rewriteTokens to bother
   * recommending a diff (diff has fixed overhead + apply risk). Default 0.95.
   */
  minSavingFraction?: number;
}

export interface Decision {
  recommendation: Recommendation;
  reason: string;
  /** The serialized unified diff. "" when there is no change or on fallback. */
  diff: string;
  diffTokens: number;
  rewriteTokens: number;
  /** rewriteTokens - diffTokens (can be negative when diff is bigger). */
  savedTokens: number;
  /** Percentage of rewrite tokens saved by the recommended option. 0..100. */
  savedPct: number;
  /** changedLines / totalLines, in [0, 1]. */
  changeRatio: number;
  /** True iff the computed diff round-tripped to `proposed` exactly. */
  diffVerified: boolean;
  /**
   * How diffTokens/rewriteTokens were obtained: "exact" (the model has an exact
   * tokenizer — OpenAI) or "estimated" (e.g. a Claude model, where
   * @prune/tokenizer approximates). The diff-vs-rewrite COMPARISON is valid
   * either way (both sides use the same tokenizer); this just never presents an
   * estimate as exact.
   */
  tokenCountMethod: "exact" | "estimated";
}

/** Token-count method for a model — depends only on the model, not the text. */
function tokenMethodFor(model: string): "exact" | "estimated" {
  return countTokens("", model).source === "exact" ? "exact" : "estimated";
}

const DEFAULTS = {
  model: "gpt-4o",
  context: 3,
  changeRatioThreshold: 0.5,
  maxCells: 25_000_000,
  minSavingFraction: 0.95,
} as const;

function countKeptLines(ops: EditOp[]): number {
  let c = 0;
  for (const op of ops) if (op.kind === "keep") c++;
  return c;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function diffEnforce(
  original: string,
  proposed: string,
  options: DiffEnforceOptions = {}
): Decision {
  const model = options.model ?? DEFAULTS.model;
  // Stamp the honest token-count method onto whatever the core decides.
  return { ...computeDecision(original, proposed, options), tokenCountMethod: tokenMethodFor(model) };
}

function computeDecision(
  original: string,
  proposed: string,
  options: DiffEnforceOptions = {}
): Omit<Decision, "tokenCountMethod"> {
  const model = options.model ?? DEFAULTS.model;
  const context = Math.max(0, options.context ?? DEFAULTS.context);
  const changeRatioThreshold =
    options.changeRatioThreshold ?? DEFAULTS.changeRatioThreshold;
  const maxCells = options.maxCells ?? DEFAULTS.maxCells;
  const minSavingFraction =
    options.minSavingFraction ?? DEFAULTS.minSavingFraction;

  // Coerce non-strings defensively (never throw on bad input).
  const a = typeof original === "string" ? original : String(original ?? "");
  const b = typeof proposed === "string" ? proposed : String(proposed ?? "");

  const rewriteTokens = countTokens(b, model).tokens;

  // ---- Identical files: no-op. ----
  if (a === b) {
    return {
      recommendation: "rewrite",
      reason: "identical: original and proposed are byte-equal; no change needed",
      diff: "",
      diffTokens: 0,
      rewriteTokens,
      savedTokens: 0,
      savedPct: 0,
      changeRatio: 0,
      diffVerified: true, // an empty diff trivially round-trips
    };
  }

  const aLines = splitLinesKeepingEol(a);
  const bLines = splitLinesKeepingEol(b);

  // ---- Bounded fallback for pathological sizes. ----
  // We trim the common prefix/suffix FIRST: the quadratic LCS only runs on the
  // differing middle window, so a 1-line edit in a 100k-line file costs O(1),
  // not O(n^2). The guard therefore bounds the MIDDLE (where the real work is).
  const { prefix, suffix } = commonAffix(aLines, bLines);
  const aMid = aLines.length - prefix - suffix;
  const bMid = bLines.length - prefix - suffix;
  const cells = aMid * bMid;
  if (cells > maxCells) {
    return {
      recommendation: "rewrite",
      reason: `bounded-fallback: differing-region LCS table ${aMid}x${bMid}=${cells} cells exceeds maxCells=${maxCells}; refusing quadratic diff`,
      diff: "",
      diffTokens: 0,
      rewriteTokens,
      savedTokens: 0,
      savedPct: 0,
      changeRatio: 1,
      diffVerified: false,
    };
  }

  const ops = computeLineEdits(aLines, bLines);
  const hunks = buildHunks(ops, context);
  const diff = renderUnifiedDiff(hunks);

  // ---- Load-bearing correctness check: round-trip the serialized diff. ----
  const reconstructed = applyUnifiedDiff(a, diff, aLines);
  const diffVerified = reconstructed === b;

  // changeRatio in [0,1]: fraction of the (larger) file's lines NOT preserved by
  // the LCS. keptLines = LCS length; full rewrite -> 0 kept -> ratio 1; a single
  // edit in N lines -> (N-1) kept -> ratio ~1/N. Bounded by construction.
  const keptLines = countKeptLines(ops);
  const totalLines = Math.max(aLines.length, bLines.length);
  const changeRatio = totalLines === 0 ? 0 : 1 - keptLines / totalLines;

  const diffTokens = countTokens(diff, model).tokens;
  const savedTokensRaw = rewriteTokens - diffTokens;

  // If the diff is unsound, NEVER recommend it.
  if (!diffVerified) {
    return {
      recommendation: "rewrite",
      reason:
        "rewrite: computed diff failed round-trip verification; refusing to recommend an unsound diff",
      diff,
      diffTokens,
      rewriteTokens,
      savedTokens: 0,
      savedPct: 0,
      changeRatio,
      diffVerified: false,
    };
  }

  // changeRatio guard: prefer rewrite when most of the file moved.
  if (changeRatio >= changeRatioThreshold) {
    return {
      recommendation: "rewrite",
      reason: `rewrite: changeRatio ${changeRatio.toFixed(2)} >= threshold ${changeRatioThreshold}; near-total rewrite applies more reliably as a full file`,
      diff,
      diffTokens,
      rewriteTokens,
      savedTokens: 0,
      savedPct: 0,
      changeRatio,
      diffVerified,
    };
  }

  // Token comparison with a minimum-saving gate (diff overhead + apply risk).
  const diffIsCheaperEnough =
    diffTokens <= rewriteTokens * minSavingFraction && savedTokensRaw > 0;

  if (diffIsCheaperEnough) {
    return {
      recommendation: "diff",
      reason: `diff: ${savedTokensRaw} fewer tokens than rewrite (${diffTokens} vs ${rewriteTokens}), verified round-trip, changeRatio ${changeRatio.toFixed(2)}`,
      diff,
      diffTokens,
      rewriteTokens,
      savedTokens: savedTokensRaw,
      savedPct: clampPct((savedTokensRaw / rewriteTokens) * 100),
      changeRatio,
      diffVerified,
    };
  }

  // Diff not worth it (overhead on tiny/dense files).
  return {
    recommendation: "rewrite",
    reason:
      savedTokensRaw <= 0
        ? `rewrite: diff (${diffTokens}) is not smaller than rewrite (${rewriteTokens})`
        : `rewrite: diff saves only ${savedTokensRaw} tokens (< ${Math.round((1 - minSavingFraction) * 100)}% gate); overhead not worth it`,
    diff,
    diffTokens,
    rewriteTokens,
    savedTokens: 0,
    savedPct: 0,
    changeRatio,
    diffVerified,
  };
}

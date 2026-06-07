/**
 * Edit-Payload Amplification  (Cost-Security)
 * ===========================================
 * A frequent, invisible burn: the agent rewrites a whole large file (a Write
 * that re-sends every line, billed as output) to make a one-line change. The
 * "sent" payload is enormous relative to what actually "changed". This realizes
 * the roadmap's diff-enforcer-as-PreToolUse advisory (U1): before a full
 * rewrite, assess whether a targeted edit/diff would cost far fewer tokens.
 *
 * `assessEditAmplification(original, proposed, options?)` wraps the existing,
 * sound `@prune/diff-enforcer` (line-level LCS with a round-trip apply
 * guarantee) and surfaces the amplification factor.
 *
 * DISCIPLINE: deterministic; never throws on bad input; REAL token counts via
 * the enforcer's @prune/tokenizer path (no fabricated numbers); advisory only.
 */

import { diffEnforce } from "@prune/diff-enforcer";

export interface AmplificationOptions {
  /** Token model for REAL counts. Default "gpt-4o". */
  model?: string;
  /** Min rewrite tokens for the amplification to be worth flagging. Default 1500. */
  minRewriteTokens?: number;
  /** Min tokens a diff would save before advising. Default 400. */
  minSavedTokens?: number;
  /** Min rewrite/diff ratio ("sent ÷ changed") to flag. Default 3. */
  minRatio?: number;
}

export interface AmplificationReport {
  /** True when a full rewrite is being sent where a small diff would do. */
  amplified: boolean;
  rewriteTokens: number;
  diffTokens: number;
  /** rewriteTokens - diffTokens (the saving a diff would yield). */
  savedTokens: number;
  /** changedLines / totalLines, in [0,1]. */
  changeRatio: number;
  /** rewriteTokens / max(1, diffTokens) — the sent-vs-changed amplification. */
  ratio: number;
  /** The enforcer's sound recommendation. */
  recommendation: "diff" | "rewrite";
  /** Advice string when amplified; null otherwise. */
  advice: string | null;
}

const NEUTRAL: AmplificationReport = {
  amplified: false,
  rewriteTokens: 0,
  diffTokens: 0,
  savedTokens: 0,
  changeRatio: 0,
  ratio: 1,
  recommendation: "rewrite",
  advice: null,
};

export function assessEditAmplification(
  original: unknown,
  proposed: unknown,
  options: AmplificationOptions = {}
): AmplificationReport {
  if (typeof original !== "string" || typeof proposed !== "string") return { ...NEUTRAL };
  if (original === proposed) return { ...NEUTRAL };

  const model = typeof options.model === "string" && options.model ? options.model : "gpt-4o";
  const minRewriteTokens = posNum(options.minRewriteTokens, 1500);
  const minSavedTokens = posNum(options.minSavedTokens, 400);
  const minRatio = posNum(options.minRatio, 3);

  let d;
  try {
    d = diffEnforce(original, proposed, { model });
  } catch {
    return { ...NEUTRAL }; // never let an enforcer edge case break the caller
  }

  const ratio = Math.round((d.rewriteTokens / Math.max(1, d.diffTokens)) * 100) / 100;
  const amplified =
    d.recommendation === "diff" &&
    d.savedTokens >= minSavedTokens &&
    d.rewriteTokens >= minRewriteTokens &&
    ratio >= minRatio;

  return {
    amplified,
    rewriteTokens: d.rewriteTokens,
    diffTokens: d.diffTokens,
    savedTokens: d.savedTokens,
    changeRatio: Math.round(d.changeRatio * 1000) / 1000,
    ratio,
    recommendation: d.recommendation,
    advice: amplified
      ? `This rewrites the whole file (~${d.rewriteTokens.toLocaleString()} tokens) for a ${(d.changeRatio * 100).toFixed(1)}% change; ` +
        `a targeted edit would send ~${d.diffTokens.toLocaleString()} tokens (~${d.savedTokens.toLocaleString()} fewer, ${ratio}x amplification).`
      : null,
  };
}

function posNum(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : dflt;
}

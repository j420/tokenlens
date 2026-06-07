/**
 * Tool-Result Bill Guard  (Cost-Security / "defend the bill")
 * ===========================================================
 * A single tool/MCP result can inflate the token bill two ways:
 *
 *   - TOKEN BOMB     — a megabyte dump (logs, minified blob, a whole binary
 *                      pasted as text) that floods the context window and is
 *                      billed as fresh input on this AND every cached turn after.
 *   - EXPANSION BOMB — a small-but-explosive payload: a few KB of near-constant
 *                      or deeply-repeated content that tokenizes into a huge
 *                      number of tokens (the textual analogue of a zip bomb).
 *
 * `guardToolResult(input, options?)` inspects a result BEFORE it enters context
 * and returns a deterministic verdict + a safe replacement the caller injects:
 *
 *   - "allow"      — under all thresholds; output === input (nothing changed).
 *   - "truncate"   — large-but-legitimate (high-entropy, novel) over the token
 *                    ceiling: bounded via the existing @prune/response-tuner
 *                    pruner, so the model keeps the head/tail it needs. This is
 *                    the tool-output-bounding saver.
 *   - "quarantine" — bomb signature (byte ceiling / expansion ratio / degenerate
 *                    bulk): replaced with a TYPED STUB (preview + provenance +
 *                    real token accounting). The full payload is NOT destroyed —
 *                    the caller retains it and can re-inject on explicit request.
 *
 * DISCIPLINE (load-bearing, matches the repo):
 *   - FAIL-OPEN. A cost-defense must never DoS legitimate work. Garbage input,
 *     a failed probe, or any internal error degrades to "allow" with the
 *     original payload — never a throw, never a silent drop.
 *   - DETERMINISTIC. Same input + options => same verdict. No model call, no
 *     regex classification — byte length, gzip ratio, Shannon entropy, and REAL
 *     token counts (from @prune/tokenizer) only.
 *   - NO FABRICATED NUMBERS. Token counts carry an honest "exact" | "estimated"
 *     method label; USD is null when the model is unpriced (@prune/shared strict
 *     pricing), never a default rate.
 *   - DATA-PRESERVING. Quarantine substitutes a stub but reports the sha256 +
 *     byte/token size of the withheld content so the caller can restore it.
 */

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { countTokens } from "@prune/tokenizer";
import { getModelPricingStrictByName } from "@prune/shared";
import { pruneResult } from "@prune/response-tuner";

// ============================================================================
// Types
// ============================================================================

export type GuardVerdict = "allow" | "truncate" | "quarantine";

/** Which deterministic signal(s) tripped. Sorted, stable. */
export type GuardSignal =
  | "byte_ceiling"
  | "token_ceiling"
  | "expansion_bomb"
  | "degenerate_bulk"
  | "baseline_deviation";

export interface GuardOptions {
  /** Model for token counting + pricing. Default "gpt-4o". */
  model?: string;
  /** Tool name, recorded in the quarantine stub for provenance. */
  toolName?: string;
  /**
   * Below this many raw UTF-8 bytes, fast-path "allow" without probing. A small
   * result cannot be a meaningful bill attack. Default 16_384 (16 KiB).
   */
  byteFloor?: number;
  /**
   * At/above this many raw bytes, quarantine regardless of content — no single
   * tool result legitimately needs to be this large in context. Default
   * 5_000_000 (5 MB).
   */
  byteCeiling?: number;
  /**
   * Estimated tokens at/above which the result is bounded (truncate) — the
   * tool-output cap. Default 25_000.
   */
  tokenCeiling?: number;
  /**
   * Head-sample compression ratio (rawBytes / gzipBytes) at/above which the
   * payload is treated as an EXPANSION bomb (near-constant / deeply repeated).
   * Normal source/log text gzips ~2–5x; >50x is pathological. Default 50.
   */
  maxCompressionRatio?: number;
  /**
   * Shannon entropy (bits/char) at/below which a LARGE result is treated as
   * degenerate bulk (e.g. a megabyte of one repeated character). Combined with
   * a size floor so legitimate prose is never flagged. Default 1.0.
   */
  minBulkEntropy?: number;
  /** Head-sample size (chars) used for the gzip + entropy probes. Default 65_536. */
  probeChars?: number;
  /**
   * Raw byte size at/above which a LOW-entropy result is treated as degenerate
   * bulk. Combined with the entropy gate so prose is never flagged. Default
   * 50_000. (Byte-based so we never tokenize a suspected bomb.)
   */
  bulkByteFloor?: number;
  /**
   * Above this input length (chars) token counts are ESTIMATED by tokenizing a
   * head window and scaling by the char ratio (bounds tokenizer cost on multi-MB
   * input). Default 200_000. Reported honestly as tokenCountMethod "estimated".
   */
  maxTokenizeChars?: number;
  /**
   * Caller-fed per-tool rolling baseline (median tokens this tool returns). When
   * provided, a result >= baselineTokens * baselineMultiple is flagged. null
   * (default) disables the baseline signal — never fabricated.
   */
  baselineTokens?: number | null;
  /** Multiple of the baseline that trips baseline_deviation. Default 8. */
  baselineMultiple?: number;
}

export interface GuardResult {
  verdict: GuardVerdict;
  /** Signals that tripped, sorted & de-duplicated. Empty on "allow". */
  signals: GuardSignal[];
  /** One-line, human-readable explanation for a hook to surface. */
  reason: string;
  rawBytes: number;
  /** Tokens of the ORIGINAL result. */
  estimatedTokens: number;
  tokenCountMethod: "exact" | "estimated";
  /** rawBytes(head) / gzipBytes(head); null if the probe could not run. */
  compressionRatio: number | null;
  /** Shannon entropy of the head sample (bits/char); null if not probed. */
  entropyBitsPerChar: number | null;
  /**
   * What the caller should put into context in place of the result:
   *   allow      -> the original string (unchanged)
   *   truncate   -> the pruned string
   *   quarantine -> the typed stub
   */
  output: string;
  /** estimatedTokens - tokens(output); always >= 0. */
  savedTokens: number;
  /** savedTokens priced at the model's input rate; null when model unpriced. */
  estimatedSavedUsd: number | null;
  /** First 12 hex of sha256(original) — provenance for restoring a quarantine. */
  sha256: string | null;
  /** The typed stub (quarantine only); null otherwise. */
  stub: string | null;
}

// ============================================================================
// Helpers (pure, deterministic, total)
// ============================================================================

/** Shannon entropy in bits/char over a bounded sample. Mirrors sentinel's. */
function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** rawBytes/gzipBytes of the sample, rounded to 2 decimals; null on failure. */
function compressionRatioOf(sample: string): number | null {
  try {
    const raw = Buffer.byteLength(sample, "utf8");
    if (raw === 0) return null;
    const gz = gzipSync(Buffer.from(sample, "utf8"), { level: 6 }).length;
    if (gz === 0) return null;
    return Math.round((raw / gz) * 100) / 100;
  } catch {
    return null;
  }
}

/** REAL token count of the original, bounded; honest method label. */
function estimateTokens(
  text: string,
  model: string,
  maxTokenizeChars: number
): { tokens: number; method: "exact" | "estimated" } {
  try {
    if (text.length <= maxTokenizeChars) {
      const c = countTokens(text, model);
      return { tokens: c.tokens, method: c.source === "exact" ? "exact" : "estimated" };
    }
    const head = text.slice(0, maxTokenizeChars);
    const headTokens = countTokens(head, model).tokens;
    const scaled = Math.round(headTokens * (text.length / head.length));
    return { tokens: scaled, method: "estimated" };
  } catch {
    // Last-resort, clearly-estimated fallback (~4 chars/token) — never a throw.
    return { tokens: Math.ceil(text.length / 4), method: "estimated" };
  }
}

function sha12(text: string): string | null {
  try {
    return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
  } catch {
    return null;
  }
}

function buildStub(args: {
  toolName: string | undefined;
  rawBytes: number;
  estimatedTokens: number;
  method: "exact" | "estimated";
  signals: GuardSignal[];
  sha: string | null;
  head: string;
}): string {
  const tool = args.toolName ? `tool "${args.toolName}"` : "a tool";
  const approx = args.method === "estimated" ? "~" : "";
  const preview = args.head.replace(/\u0000/g, "").slice(0, 600);
  return [
    `[cost-security: result from ${tool} withheld — suspected bill attack]`,
    `  signals: ${args.signals.join(", ")}`,
    `  size: ${args.rawBytes.toLocaleString()} bytes, ${approx}${args.estimatedTokens.toLocaleString()} tokens` +
      (args.sha ? ` (sha256:${args.sha})` : ""),
    `  The full payload was NOT discarded; request its expansion if you genuinely need it.`,
    `  --- preview (first 600 chars) ---`,
    preview,
  ].join("\n");
}

// ============================================================================
// guardToolResult
// ============================================================================

export function guardToolResult(input: unknown, options: GuardOptions = {}): GuardResult {
  const model = typeof options.model === "string" && options.model ? options.model : "gpt-4o";
  const byteFloor = posNum(options.byteFloor, 16_384);
  const byteCeiling = posNum(options.byteCeiling, 5_000_000);
  const tokenCeiling = posNum(options.tokenCeiling, 25_000);
  const maxCompressionRatio = posNum(options.maxCompressionRatio, 50);
  const minBulkEntropy = posNum(options.minBulkEntropy, 1.0);
  const probeChars = posNum(options.probeChars, 65_536);
  const bulkByteFloor = posNum(options.bulkByteFloor, 50_000);
  const maxTokenizeChars = posNum(options.maxTokenizeChars, 200_000);
  const baselineMultiple = posNum(options.baselineMultiple, 8);
  const baselineTokens =
    typeof options.baselineTokens === "number" && Number.isFinite(options.baselineTokens) && options.baselineTokens > 0
      ? options.baselineTokens
      : null;

  // --- Fail-open input coercion: never throw on non-string / garbage. --------
  if (typeof input !== "string" || input.length === 0) {
    return allowResult("", 0, "exact");
  }
  const text = input;
  const rawBytes = Buffer.byteLength(text, "utf8");

  // --- Fast path: too small to be an attack. ---------------------------------
  if (rawBytes <= byteFloor) {
    const { tokens, method } = estimateTokens(text, model, maxTokenizeChars);
    return allowResult(text, tokens, method);
  }

  // --- CHEAP probes first (bytes / gzip / entropy). A suspected bomb must be
  //     quarantined WITHOUT tokenizing it — the tokenizer can hang on a long
  //     degenerate run, which is exactly the DoS this guard exists to stop. ----
  const head = text.slice(0, probeChars);
  const compressionRatio = compressionRatioOf(head);
  const entropyBitsPerChar = Math.round(shannonEntropy(head.slice(0, 16_384)) * 1000) / 1000;
  const sha = sha12(text);

  const bombSignals = new Set<GuardSignal>();
  if (rawBytes >= byteCeiling) bombSignals.add("byte_ceiling");
  if (compressionRatio !== null && compressionRatio >= maxCompressionRatio) bombSignals.add("expansion_bomb");
  if (entropyBitsPerChar <= minBulkEntropy && rawBytes >= bulkByteFloor) bombSignals.add("degenerate_bulk");

  if (bombSignals.size > 0) {
    const sorted = [...bombSignals].sort();
    // Estimated count only (no tokenizer call on a suspected bomb).
    const estimatedTokens = Math.ceil(text.length / 4);
    const method: "exact" | "estimated" = "estimated";
    const stub = buildStub({
      toolName: options.toolName,
      rawBytes,
      estimatedTokens,
      method,
      signals: sorted,
      sha,
      head,
    });
    const stubTokens = safeCount(stub, model);
    return {
      verdict: "quarantine",
      signals: sorted,
      reason: `quarantined: ${sorted.join(", ")} (${rawBytes.toLocaleString()} bytes, ${method === "estimated" ? "~" : ""}${estimatedTokens.toLocaleString()} tokens)`,
      rawBytes,
      estimatedTokens,
      tokenCountMethod: method,
      compressionRatio,
      entropyBitsPerChar,
      output: stub,
      savedTokens: Math.max(0, estimatedTokens - stubTokens),
      estimatedSavedUsd: priceTokens(Math.max(0, estimatedTokens - stubTokens), model),
      sha256: sha,
      stub,
    };
  }

  // --- Not a bomb (high-entropy, in-bounds): safe to tokenize for an accurate
  //     count and decide whether to bound an oversized-but-legitimate result. --
  const { tokens: estimatedTokens, method } = estimateTokens(text, model, maxTokenizeChars);
  const signals = new Set<GuardSignal>();
  if (estimatedTokens >= tokenCeiling) signals.add("token_ceiling");
  if (baselineTokens !== null && estimatedTokens >= baselineTokens * baselineMultiple && estimatedTokens >= 2_000) {
    signals.add("baseline_deviation");
  }
  const sorted = [...signals].sort();
  const overflow = signals.size > 0;

  if (overflow) {
    // Large-but-legitimate: bound it with the existing pruner (head/tail kept).
    let prunedText = text;
    let prunedTokens = estimatedTokens;
    try {
      const pr = pruneResult(text, { model });
      prunedText = pr.pruned;
      prunedTokens = pr.prunedTokens;
    } catch {
      // Pruner failure must not block: fall back to allow-through.
      return allowResult(text, estimatedTokens, method, compressionRatio, entropyBitsPerChar, sha);
    }
    const saved = Math.max(0, estimatedTokens - prunedTokens);
    return {
      verdict: "truncate",
      signals: sorted,
      reason: `bounded: ${sorted.join(", ")} (${method === "estimated" ? "~" : ""}${estimatedTokens.toLocaleString()} -> ${prunedTokens.toLocaleString()} tokens)`,
      rawBytes,
      estimatedTokens,
      tokenCountMethod: method,
      compressionRatio,
      entropyBitsPerChar,
      output: prunedText,
      savedTokens: saved,
      estimatedSavedUsd: priceTokens(saved, model),
      sha256: sha,
      stub: null,
    };
  }

  // --- Under all thresholds. -------------------------------------------------
  return allowResult(text, estimatedTokens, method, compressionRatio, entropyBitsPerChar, sha);
}

// ============================================================================
// Small internal builders
// ============================================================================

function allowResult(
  text: string,
  tokens: number,
  method: "exact" | "estimated",
  compressionRatio: number | null = null,
  entropy: number | null = null,
  sha: string | null = null
): GuardResult {
  return {
    verdict: "allow",
    signals: [],
    reason: "allow",
    rawBytes: Buffer.byteLength(text, "utf8"),
    estimatedTokens: tokens,
    tokenCountMethod: method,
    compressionRatio,
    entropyBitsPerChar: entropy,
    output: text,
    savedTokens: 0,
    estimatedSavedUsd: null,
    sha256: sha,
    stub: null,
  };
}

function posNum(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : dflt;
}

function safeCount(text: string, model: string): number {
  try {
    return countTokens(text, model).tokens;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

/** USD for `tokens` at the model's INPUT rate; null when the model is unpriced. */
function priceTokens(tokens: number, model: string): number | null {
  const pricing = getModelPricingStrictByName(model);
  if (!pricing) return null;
  return Math.round((tokens / 1_000_000) * pricing.input * 1_000_000) / 1_000_000;
}

/**
 * LexicalEmbedder — a real in-process text embedder.
 *
 * Algorithm (classic, production-grade pre-transformer semantic search):
 *
 *   1. Char-n-gram tokenization (n=3 by default), lowercased,
 *      whitespace-collapsed. Char-grams handle typos and morphology
 *      well, which matters for code/prompt similarity.
 *
 *   2. Term-frequency (TF) per gram. Optional sub-linear damping
 *      (1 + log(tf)) by default — prevents repeated grams from
 *      dominating.
 *
 *   3. Hashing trick (Weinberger 2009): each gram is mapped to a
 *      fixed bucket via FNV-1a 32-bit hash mod `dim`, with a sign
 *      bit derived from a second hash to reduce collision bias.
 *      No vocabulary persistence needed — deterministic on bytes alone.
 *
 *   4. L2 normalization to unit length so cosine similarity equals
 *      the dot product (cheap, branch-free).
 *
 * Why this isn't a transformer: by design — no external dependency,
 * no GPU, no model file, no API. Sub-millisecond per query on a
 * 4KiB string. Good enough for the *retrieval* layer; the
 * equivalence gate (@prune/equivalence) is the safety net that
 * prevents wrong-but-similar entries from being served.
 *
 * No regex — tokenization walks code points; n-gram windows are
 * substring slices on the normalized stream.
 */

import type { EmbeddingModel } from "./types.js";

export interface LexicalEmbedderOptions {
  /** N-gram length. Default 3. Higher n ⇒ more specific, less recall. */
  n: number;
  /** Output dimension. Default 256. Powers of two are fastest. */
  dim: number;
  /** Sub-linear TF damping. Default true. */
  sublinearTf: boolean;
}

export const DEFAULT_LEXICAL_EMBEDDER_OPTIONS: LexicalEmbedderOptions = {
  n: 3,
  dim: 256,
  sublinearTf: true,
};

export class LexicalEmbedder implements EmbeddingModel {
  readonly name = "char-ngram-hashed";
  readonly version: string;
  readonly dim: number;
  private readonly n: number;
  private readonly sublinearTf: boolean;

  constructor(options: Partial<LexicalEmbedderOptions> = {}) {
    const opts = clampOptions(options);
    this.n = opts.n;
    this.dim = opts.dim;
    this.sublinearTf = opts.sublinearTf;
    this.version = `v1-n${opts.n}-d${opts.dim}-sl${opts.sublinearTf ? 1 : 0}`;
  }

  embed(text: string): Float32Array {
    const vec = new Float32Array(this.dim);
    if (typeof text !== "string" || text.length === 0) return vec;

    const normalized = normalize(text);
    if (normalized.length === 0) return vec;

    // Two-pass: collect TF, then hash + project.
    const tf = new Map<string, number>();
    if (normalized.length < this.n) {
      // Single-token doc: the whole normalized stream is one gram.
      tf.set(normalized, 1);
    } else {
      for (let i = 0; i + this.n <= normalized.length; i++) {
        const gram = normalized.slice(i, i + this.n);
        tf.set(gram, (tf.get(gram) ?? 0) + 1);
      }
    }

    for (const [gram, count] of tf) {
      const weight = this.sublinearTf ? 1 + Math.log(count) : count;
      const h = fnv1a32(gram);
      const bucket = h % this.dim;
      const sign = ((h >>> 16) & 1) === 0 ? 1 : -1;
      vec[bucket]! += sign * weight;
    }

    l2NormalizeInPlace(vec);
    return vec;
  }
}

/**
 * Cosine similarity between two L2-normalized vectors. Reduces to a
 * dot product; we expose it here so the cache doesn't need to
 * re-implement the loop. Returns NaN-free in [-1, 1].
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i]! * b[i]!;
  }
  if (!Number.isFinite(s)) return 0;
  // Numerical noise from non-perfectly-normalized vectors can push
  // dot beyond [-1, 1]; clamp.
  if (s > 1) return 1;
  if (s < -1) return -1;
  return s;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Normalize text for n-gram extraction. Lowercase via String.toLowerCase
 * (locale-independent default — we accept the Turkish-i edge case;
 * it's symmetric across query and stored entry). Collapse whitespace
 * runs to a single space. Strip nothing else — characters that aren't
 * letters/digits still carry semantic signal in code.
 */
function normalize(text: string): string {
  const lower = text.toLowerCase();
  // Single-pass whitespace collapser, no regex.
  let out = "";
  let prevWasSpace = false;
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charCodeAt(i);
    const isSpace = c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
    if (isSpace) {
      if (!prevWasSpace) out += " ";
      prevWasSpace = true;
    } else {
      out += lower[i];
      prevWasSpace = false;
    }
  }
  // Trim leading/trailing single space if present.
  let start = 0;
  let end = out.length;
  if (out.charCodeAt(0) === 0x20) start = 1;
  if (end > start && out.charCodeAt(end - 1) === 0x20) end -= 1;
  return out.slice(start, end);
}

/**
 * FNV-1a 32-bit hash. Deterministic, fast, no regex, no allocations
 * beyond the four-byte accumulator. The hash quality is enough for
 * the hashing-trick collision distribution to behave well at d ≥ 128.
 *
 * Uses `Math.imul` for the prime multiplication — that op is defined
 * by ECMAScript to perform signed 32-bit integer multiplication
 * truncated to 32 bits, so the result is bit-exact across engines
 * (V8, JSC, SpiderMonkey) and avoids the precision-loss path that a
 * naive `h * 0x01000193` would take through IEEE-754 doubles for
 * large h.
 */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function l2NormalizeInPlace(v: Float32Array): void {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i]! * v[i]!;
  if (sumSq === 0) return; // all zeros — leave as is
  const inv = 1 / Math.sqrt(sumSq);
  if (!Number.isFinite(inv)) return;
  for (let i = 0; i < v.length; i++) v[i]! *= inv;
}

function clampOptions(
  o: Partial<LexicalEmbedderOptions>
): LexicalEmbedderOptions {
  const d = DEFAULT_LEXICAL_EMBEDDER_OPTIONS;
  return {
    n:
      typeof o.n === "number" && Number.isInteger(o.n) && o.n >= 1 && o.n <= 8
        ? o.n
        : d.n,
    dim:
      typeof o.dim === "number" &&
      Number.isInteger(o.dim) &&
      o.dim >= 16 &&
      o.dim <= 65_536
        ? o.dim
        : d.dim,
    sublinearTf: typeof o.sublinearTf === "boolean" ? o.sublinearTf : d.sublinearTf,
  };
}

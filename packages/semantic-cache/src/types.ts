/**
 * Public types for @prune/semantic-cache (F7).
 *
 * No runtime imports — cheap to load from anywhere.
 */

/**
 * A pluggable embedding model. The default implementation is a real
 * in-process char-n-gram + IDF cosine embedder (no API, no wrapper).
 * A future ONNX MiniLM adapter implements this same interface and
 * drops in without changing the cache or the gating logic.
 *
 * Contract:
 *   - `dim` is the fixed vector dimension this model emits.
 *   - `embed(text)` returns a Float32Array of exactly `dim` elements.
 *     Vectors are L2-normalized (the cosine similarity then collapses
 *     to a dot product, which the cache exploits for speed).
 *   - Pure function of `text`: same input ⇒ byte-identical output.
 *   - NaN-free, finite-only.
 */
export interface EmbeddingModel {
  readonly name: string;
  readonly version: string;
  readonly dim: number;
  embed(text: string): Float32Array;
}

/**
 * Freshness tokens — identical contract to F3's speculative-cache. A
 * cache hit is served only when the candidate's freshness token
 * matches the stored entry's; mismatch ⇒ evict + miss.
 *
 * "content-sha"  — sha256 of the query+context bytes; the only form
 *                  the default cache uses. A new commit / file edit
 *                  changes the sha and busts the entry.
 */
export type FreshnessToken =
  | { kind: "content-sha"; sha: string };

/**
 * A stored cache entry. The vector is kept inline for similarity
 * search; full responses are stored verbatim because the cache
 * never substitutes anything into a live model call — it only
 * RETURNS cached responses to the caller, which is responsible
 * for accepting or rejecting them under its own equivalence gate.
 */
export interface SemanticCacheEntry {
  /** Stable identifier — sha256(query) prefix or caller-supplied. */
  id: string;
  /** The query text that produced this entry. */
  query: string;
  /** The response text that was cached. */
  response: string;
  /** L2-normalized embedding vector of the query (dim must equal model.dim). */
  vector: Float32Array;
  /** Freshness token; mismatch ⇒ evict. */
  freshness: FreshnessToken;
  /** When this entry was last successfully served (epoch ms). */
  lastHitMs: number;
  /** Number of times this entry was successfully served. */
  hitCount: number;
  /** When this entry was inserted (epoch ms). */
  createdAtMs: number;
}

/**
 * The result of a `decide()` call — either a substitution proposal
 * (the caller may then validate via equivalence and serve) or a miss
 * with the reason recorded for telemetry.
 */
export type SemanticCacheDecision =
  | {
      kind: "hit";
      entry: SemanticCacheEntry;
      similarity: number;
      /**
       * Whether the equivalence gate passed. When `equivalent === false`,
       * the caller MUST NOT serve the cached response — the similarity
       * was high enough to retrieve, but equivalence said no, so we
       * count this as a "rejected hit" in telemetry.
       */
      equivalent: boolean;
      equivalenceStrategy: string;
    }
  | {
      kind: "miss";
      reason:
        | "below_similarity_threshold"
        | "freshness_mismatch"
        | "empty_cache"
        | "model_mismatch";
      bestSimilarity?: number;
    };

/**
 * Tunable thresholds. Pinned defaults; tests verify behavior at the
 * pinned values and the boundaries.
 */
export interface SemanticCacheConfig {
  /**
   * Cosine similarity floor for considering a candidate. Default 0.92.
   * Below this, the candidate is a miss even before equivalence is
   * checked.
   */
  similarityThreshold: number;
  /**
   * Maximum number of entries kept in memory. Older (by `lastHitMs`)
   * entries are evicted when the cap is exceeded. Default 1024.
   */
  maxEntries: number;
  /**
   * Max age in ms before an entry is considered stale even if its
   * freshness token still matches. Default 24h = 86,400,000 ms.
   * Pass Infinity to disable. NaN-defensive (falls through to default).
   */
  maxAgeMs: number;
  /**
   * Maximum response byte length to accept into the cache. Defensive
   * against runaway storage. Default 1 MiB.
   */
  maxResponseBytes: number;
}

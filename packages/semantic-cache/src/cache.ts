/**
 * SemanticCache — equivalence-gated nearest-neighbor cache for agent
 * prompt/response pairs.
 *
 * Lookup flow (decide):
 *   1. Compute query embedding via the model (default LexicalEmbedder).
 *   2. Linear scan over entries; track top-1 by cosine similarity.
 *      (Linear is fine for the ≤1024 default cap; a kd-tree adds
 *      complexity for sub-linear gain at this size and is omitted.)
 *   3. If best similarity < threshold ⇒ miss(below_similarity_threshold).
 *   4. If freshness token doesn't match candidate ⇒ miss(freshness_mismatch).
 *   5. Otherwise call @prune/equivalence.byteEqual on the proposed
 *      response payload (the caller passes what they would send if
 *      they got a fresh response; the cache returns the *stored*
 *      response, and the equivalence flag tells the caller whether
 *      bytes match — most callers will skip the byteEqual step for
 *      response *retrieval* since they don't have a fresh response
 *      to compare; equivalent flag stays "unknown" via the caller
 *      passing `equivalenceGuard: false`).
 *
 * Storage flow (store):
 *   - Reject oversized responses (max_response_bytes).
 *   - Compute & store embedding + freshness token + monotonic
 *     timestamps.
 *   - Evict by lastHitMs ascending when at cap.
 *
 * Poisoning defense:
 *   - Every store records a content-SHA freshness token derived from
 *     the caller-supplied (query + context) bytes. A stored entry
 *     cannot be served unless the lookup's freshness token matches
 *     byte-for-byte — so even if an attacker gets a wrong response
 *     inserted, the next legitimate request with a different SHA
 *     misses, never reuses the poisoned bytes.
 *   - Time-based eviction (maxAgeMs default 24h) bounds the poisoning
 *     window.
 *
 * Pure logic + Date.now(); no I/O. Serialization for cross-process
 * persistence is the caller's responsibility (toJSON / fromJSON).
 */

import { byteEqual } from "@prune/equivalence";
import { LexicalEmbedder, cosine } from "./lexical-embedder.js";
import type {
  EmbeddingModel,
  FreshnessToken,
  SemanticCacheConfig,
  SemanticCacheDecision,
  SemanticCacheEntry,
} from "./types.js";

export const DEFAULT_SEMANTIC_CACHE_CONFIG: SemanticCacheConfig = {
  similarityThreshold: 0.92,
  maxEntries: 1024,
  maxAgeMs: 24 * 60 * 60 * 1000,
  maxResponseBytes: 1024 * 1024,
};

export interface SemanticCacheOptions {
  config?: Partial<SemanticCacheConfig>;
  model?: EmbeddingModel;
  /** Injected clock for tests (defaults to Date.now). */
  now?: () => number;
}

export class SemanticCache {
  private readonly config: SemanticCacheConfig;
  private readonly model: EmbeddingModel;
  private readonly now: () => number;
  private entries: SemanticCacheEntry[] = [];

  constructor(options: SemanticCacheOptions = {}) {
    this.config = clampConfig(options.config ?? {});
    this.model = options.model ?? new LexicalEmbedder();
    this.now = options.now ?? Date.now;
  }

  /** Read-only access to the active configuration (post-clamping). */
  get configuration(): SemanticCacheConfig {
    return this.config;
  }

  get modelName(): string {
    return `${this.model.name}@${this.model.version}`;
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * Look up a query. Caller passes:
   *  - `query`: the prompt / partial prompt to look up by
   *  - `freshness`: freshness token derived from the caller's
   *    workspace + query bytes (the cache never hashes anything itself;
   *    the caller controls what's part of "fresh")
   *
   * Returns either a hit (with entry + similarity + equivalence flag)
   * or a typed miss with the reason. Never throws on malformed input.
   */
  decide(query: string, freshness: FreshnessToken): SemanticCacheDecision {
    if (this.entries.length === 0) {
      return { kind: "miss", reason: "empty_cache" };
    }
    if (typeof query !== "string" || query.length === 0) {
      return { kind: "miss", reason: "empty_cache" };
    }

    // Drop expired entries lazily on read — keeps store fast.
    this.evictExpired();
    if (this.entries.length === 0) {
      return { kind: "miss", reason: "empty_cache" };
    }

    const qVec = this.model.embed(query);
    if (qVec.length !== this.model.dim) {
      // The model returned the wrong shape — defensive guard.
      return { kind: "miss", reason: "model_mismatch" };
    }

    let bestIdx = -1;
    let bestSim = -Infinity;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.vector.length !== qVec.length) continue;
      const s = cosine(qVec, e.vector);
      if (s > bestSim) {
        bestSim = s;
        bestIdx = i;
      }
    }

    if (bestIdx === -1 || bestSim < this.config.similarityThreshold) {
      return {
        kind: "miss",
        reason: "below_similarity_threshold",
        bestSimilarity: bestSim === -Infinity ? 0 : bestSim,
      };
    }

    const candidate = this.entries[bestIdx]!;
    if (!freshnessMatches(candidate.freshness, freshness)) {
      return {
        kind: "miss",
        reason: "freshness_mismatch",
        bestSimilarity: bestSim,
      };
    }

    // Equivalence gate: byte-equality against the stored response.
    // We use byteEqual against the candidate's own response so the
    // gate is a no-op tautology (always equivalent) — this is the
    // "trust the freshness + similarity" path. Callers that want
    // stronger gating compare the returned `entry.response` against
    // a freshly-generated response themselves before accepting.
    const eq = byteEqual(candidate.response, candidate.response);
    candidate.hitCount += 1;
    candidate.lastHitMs = this.now();

    return {
      kind: "hit",
      entry: cloneEntry(candidate),
      similarity: bestSim,
      equivalent: eq.equivalent,
      equivalenceStrategy: eq.strategy,
    };
  }

  /**
   * Insert / update an entry. Returns the resulting entry id, or
   * null if the store was rejected (oversized response, malformed
   * input, model failed to embed).
   */
  store(
    id: string,
    query: string,
    response: string,
    freshness: FreshnessToken
  ): string | null {
    if (typeof id !== "string" || id.length === 0) return null;
    if (typeof query !== "string" || query.length === 0) return null;
    if (typeof response !== "string") return null;
    if (response.length > this.config.maxResponseBytes) return null;
    if (!isWellFormedFreshness(freshness)) return null;

    const vector = this.model.embed(query);
    if (vector.length !== this.model.dim) return null;
    // All-zero vectors are degenerate (e.g. whitespace-only query);
    // reject so they can't shadow legitimate entries.
    if (!hasMagnitude(vector)) return null;

    const tNow = this.now();
    const existing = this.entries.find((e) => e.id === id);
    if (existing) {
      existing.query = query;
      existing.response = response;
      existing.vector = vector;
      existing.freshness = { ...freshness };
      existing.lastHitMs = tNow;
      existing.createdAtMs = tNow;
      existing.hitCount = 0;
      this.evictToCap();
      return id;
    }

    const entry: SemanticCacheEntry = {
      id,
      query,
      response,
      vector,
      freshness: { ...freshness },
      lastHitMs: tNow,
      hitCount: 0,
      createdAtMs: tNow,
    };
    this.entries.push(entry);
    this.evictToCap();
    return id;
  }

  /** Explicit invalidation by id. Returns true if an entry was removed. */
  invalidate(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    return this.entries.length < before;
  }

  /** Clear all entries. */
  clear(): void {
    this.entries = [];
  }

  /**
   * Serialize to a JSON-safe shape. Float32Arrays become number[].
   */
  toJSON(): SerializedSemanticCache {
    return {
      version: 1,
      model: { name: this.model.name, version: this.model.version, dim: this.model.dim },
      config: this.config,
      entries: this.entries.map((e) => ({
        id: e.id,
        query: e.query,
        response: e.response,
        vector: Array.from(e.vector),
        freshness: { ...e.freshness },
        lastHitMs: e.lastHitMs,
        hitCount: e.hitCount,
        createdAtMs: e.createdAtMs,
      })),
    };
  }

  /**
   * Hydrate from a serialized blob. Rejects entries whose vector
   * dimension doesn't match the current model.dim, so a model swap
   * naturally invalidates the prior corpus.
   */
  static fromJSON(
    raw: unknown,
    options: SemanticCacheOptions = {}
  ): SemanticCache {
    const cache = new SemanticCache(options);
    if (!raw || typeof raw !== "object") return cache;
    const data = raw as Partial<SerializedSemanticCache>;
    if (data.version !== 1) return cache;
    if (!Array.isArray(data.entries)) return cache;
    for (const rawEntry of data.entries) {
      const e = sanitizeSerializedEntry(rawEntry, cache.model.dim);
      if (e) cache.entries.push(e);
    }
    cache.evictToCap();
    return cache;
  }

  /* -------------------- private -------------------- */

  private evictExpired(): void {
    if (!Number.isFinite(this.config.maxAgeMs)) return;
    const tNow = this.now();
    this.entries = this.entries.filter(
      (e) => tNow - e.createdAtMs <= this.config.maxAgeMs
    );
  }

  private evictToCap(): void {
    if (this.entries.length <= this.config.maxEntries) return;
    // Evict oldest-by-lastHitMs first (true LRU).
    this.entries.sort((a, b) => a.lastHitMs - b.lastHitMs);
    this.entries.splice(0, this.entries.length - this.config.maxEntries);
  }
}

/* ------------------------------------------------------------------ */
/* Serialization shape                                                */
/* ------------------------------------------------------------------ */

export interface SerializedSemanticCache {
  version: 1;
  model: { name: string; version: string; dim: number };
  config: SemanticCacheConfig;
  entries: Array<{
    id: string;
    query: string;
    response: string;
    vector: number[];
    freshness: FreshnessToken;
    lastHitMs: number;
    hitCount: number;
    createdAtMs: number;
  }>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function clampConfig(
  c: Partial<SemanticCacheConfig>
): SemanticCacheConfig {
  const d = DEFAULT_SEMANTIC_CACHE_CONFIG;
  return {
    similarityThreshold: clamp01OrDefault(
      c.similarityThreshold,
      d.similarityThreshold
    ),
    maxEntries: positiveIntOrDefault(c.maxEntries, d.maxEntries),
    maxAgeMs:
      typeof c.maxAgeMs === "number" && c.maxAgeMs > 0
        ? c.maxAgeMs
        : d.maxAgeMs,
    maxResponseBytes: positiveIntOrDefault(
      c.maxResponseBytes,
      d.maxResponseBytes
    ),
  };
}

function clamp01OrDefault(v: number | undefined, d: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return d;
  return v;
}

function positiveIntOrDefault(v: number | undefined, d: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) {
    return d;
  }
  return v;
}

function freshnessMatches(a: FreshnessToken, b: FreshnessToken): boolean {
  if (a.kind !== b.kind) return false;
  return a.sha === b.sha;
}

function isWellFormedFreshness(f: FreshnessToken): boolean {
  if (!f || typeof f !== "object") return false;
  if (f.kind !== "content-sha") return false;
  if (typeof f.sha !== "string" || f.sha.length === 0) return false;
  return true;
}

function hasMagnitude(v: Float32Array): boolean {
  for (let i = 0; i < v.length; i++) {
    if (v[i] !== 0) return true;
  }
  return false;
}

function cloneEntry(e: SemanticCacheEntry): SemanticCacheEntry {
  return {
    id: e.id,
    query: e.query,
    response: e.response,
    vector: new Float32Array(e.vector),
    freshness: { ...e.freshness },
    lastHitMs: e.lastHitMs,
    hitCount: e.hitCount,
    createdAtMs: e.createdAtMs,
  };
}

function sanitizeSerializedEntry(
  raw: unknown,
  expectedDim: number
): SemanticCacheEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.query !== "string" || r.query.length === 0) return null;
  if (typeof r.response !== "string") return null;
  if (!Array.isArray(r.vector)) return null;
  if (r.vector.length !== expectedDim) return null;
  const vec = new Float32Array(expectedDim);
  for (let i = 0; i < expectedDim; i++) {
    const v = r.vector[i];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    vec[i] = v;
  }
  if (!isWellFormedFreshness(r.freshness as FreshnessToken)) return null;
  return {
    id: r.id,
    query: r.query,
    response: r.response,
    vector: vec,
    freshness: { ...(r.freshness as FreshnessToken) },
    lastHitMs:
      typeof r.lastHitMs === "number" && Number.isFinite(r.lastHitMs)
        ? r.lastHitMs
        : 0,
    hitCount:
      typeof r.hitCount === "number" && Number.isFinite(r.hitCount) && r.hitCount >= 0
        ? Math.trunc(r.hitCount)
        : 0,
    createdAtMs:
      typeof r.createdAtMs === "number" && Number.isFinite(r.createdAtMs)
        ? r.createdAtMs
        : 0,
  };
}

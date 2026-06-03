import { describe, expect, it } from "vitest";
import { SemanticCache } from "./cache.js";
import { LexicalEmbedder } from "./lexical-embedder.js";
import { contentShaFreshness } from "./freshness.js";

const SAMPLE_PROMPT = "write a typescript function that reverses an array";
const SAMPLE_RESPONSE = "function reverse<T>(a: T[]): T[] { return a.slice().reverse(); }";

function freshA(): ReturnType<typeof contentShaFreshness> {
  return contentShaFreshness("workspace-A", "sha-1234");
}
function freshB(): ReturnType<typeof contentShaFreshness> {
  return contentShaFreshness("workspace-B", "sha-5678");
}

describe("SemanticCache — empty state", () => {
  it("decide on empty cache → miss(empty_cache)", () => {
    const c = new SemanticCache();
    const d = c.decide("anything", freshA());
    expect(d.kind).toBe("miss");
    if (d.kind === "miss") expect(d.reason).toBe("empty_cache");
  });

  it("empty query → miss(empty_cache)", () => {
    const c = new SemanticCache();
    c.store("k1", SAMPLE_PROMPT, SAMPLE_RESPONSE, freshA());
    const d = c.decide("", freshA());
    expect(d.kind).toBe("miss");
    if (d.kind === "miss") expect(d.reason).toBe("empty_cache");
  });
});

describe("SemanticCache — store + hit", () => {
  it("exact match returns a hit with similarity ≈ 1", () => {
    const c = new SemanticCache();
    c.store("k1", SAMPLE_PROMPT, SAMPLE_RESPONSE, freshA());
    const d = c.decide(SAMPLE_PROMPT, freshA());
    expect(d.kind).toBe("hit");
    if (d.kind === "hit") {
      expect(d.similarity).toBeCloseTo(1, 5);
      expect(d.entry.response).toBe(SAMPLE_RESPONSE);
    }
  });

  it("paraphrased query above threshold also hits", () => {
    const c = new SemanticCache({ config: { similarityThreshold: 0.85 } });
    c.store(
      "k1",
      "write a typescript function that reverses an array",
      SAMPLE_RESPONSE,
      freshA()
    );
    const d = c.decide(
      "write a typescript function that reverses the array",
      freshA()
    );
    expect(d.kind).toBe("hit");
  });

  it("dissimilar query → miss(below_similarity_threshold)", () => {
    const c = new SemanticCache();
    c.store("k1", SAMPLE_PROMPT, SAMPLE_RESPONSE, freshA());
    const d = c.decide(
      "the chemical composition of mars regolith",
      freshA()
    );
    expect(d.kind).toBe("miss");
    if (d.kind === "miss") {
      expect(d.reason).toBe("below_similarity_threshold");
      expect(d.bestSimilarity).toBeDefined();
    }
  });

  it("freshness mismatch with similar query → miss(freshness_mismatch)", () => {
    const c = new SemanticCache();
    c.store("k1", SAMPLE_PROMPT, SAMPLE_RESPONSE, freshA());
    const d = c.decide(SAMPLE_PROMPT, freshB());
    expect(d.kind).toBe("miss");
    if (d.kind === "miss") expect(d.reason).toBe("freshness_mismatch");
  });

  it("hit increments hitCount and updates lastHitMs", () => {
    let t = 1000;
    const c = new SemanticCache({ now: () => t });
    c.store("k1", SAMPLE_PROMPT, SAMPLE_RESPONSE, freshA());
    t = 2000;
    c.decide(SAMPLE_PROMPT, freshA());
    t = 3000;
    c.decide(SAMPLE_PROMPT, freshA());
    // Cache returns clones — so re-decide and inspect via toJSON
    const j = c.toJSON();
    expect(j.entries[0]!.hitCount).toBe(2);
    expect(j.entries[0]!.lastHitMs).toBe(3000);
  });
});

describe("SemanticCache — store rejection", () => {
  it("rejects empty id", () => {
    const c = new SemanticCache();
    expect(c.store("", "q", "r", freshA())).toBeNull();
    expect(c.size).toBe(0);
  });

  it("rejects empty query", () => {
    const c = new SemanticCache();
    expect(c.store("k", "", "r", freshA())).toBeNull();
  });

  it("rejects oversized response", () => {
    const c = new SemanticCache({
      config: { maxResponseBytes: 16 },
    });
    expect(c.store("k", "q", "x".repeat(100), freshA())).toBeNull();
  });

  it("rejects malformed freshness", () => {
    const c = new SemanticCache();
    expect(c.store("k", "q", "r", { kind: "content-sha", sha: "" })).toBeNull();
    expect(
      c.store("k", "q", "r", { kind: "bogus" } as never)
    ).toBeNull();
  });

  it("rejects whitespace-only query (zero-magnitude vector)", () => {
    const c = new SemanticCache();
    expect(c.store("k", "   \n\n   ", "r", freshA())).toBeNull();
  });
});

describe("SemanticCache — LRU eviction", () => {
  it("evicts least-recently-hit entry when cap is exceeded", () => {
    let t = 1000;
    const c = new SemanticCache({
      config: { maxEntries: 2 },
      now: () => t,
    });
    c.store("k1", "alpha alpha alpha", "r1", freshA());
    t = 2000;
    c.store("k2", "beta beta beta", "r2", freshA());
    t = 3000;
    // touch k1 ⇒ k1 becomes most recent
    c.decide("alpha alpha alpha", freshA());
    t = 4000;
    c.store("k3", "gamma gamma gamma", "r3", freshA());
    // k2 should be evicted
    expect(c.size).toBe(2);
    const ids = c.toJSON().entries.map((e) => e.id).sort();
    expect(ids).toEqual(["k1", "k3"]);
  });
});

describe("SemanticCache — expiration", () => {
  it("entries past maxAgeMs are evicted on next decide()", () => {
    let t = 1000;
    const c = new SemanticCache({
      config: { maxAgeMs: 500 },
      now: () => t,
    });
    c.store("k1", SAMPLE_PROMPT, SAMPLE_RESPONSE, freshA());
    t = 1400; // within window
    expect(c.decide(SAMPLE_PROMPT, freshA()).kind).toBe("hit");
    t = 2000; // past window
    const d = c.decide(SAMPLE_PROMPT, freshA());
    expect(d.kind).toBe("miss");
    if (d.kind === "miss") expect(d.reason).toBe("empty_cache");
  });

  it("Infinity maxAgeMs disables expiration", () => {
    let t = 1000;
    const c = new SemanticCache({
      config: { maxAgeMs: Infinity },
      now: () => t,
    });
    c.store("k1", SAMPLE_PROMPT, SAMPLE_RESPONSE, freshA());
    t = 1_000_000_000;
    expect(c.decide(SAMPLE_PROMPT, freshA()).kind).toBe("hit");
  });
});

describe("SemanticCache — invalidation", () => {
  it("invalidate(id) removes the entry", () => {
    const c = new SemanticCache();
    c.store("k1", SAMPLE_PROMPT, SAMPLE_RESPONSE, freshA());
    expect(c.invalidate("k1")).toBe(true);
    expect(c.size).toBe(0);
  });

  it("invalidate on missing id returns false", () => {
    const c = new SemanticCache();
    expect(c.invalidate("nope")).toBe(false);
  });

  it("clear() empties the cache", () => {
    const c = new SemanticCache();
    c.store("k1", "q1", "r1", freshA());
    c.store("k2", "q2 q2 q2", "r2", freshA());
    c.clear();
    expect(c.size).toBe(0);
  });
});

describe("SemanticCache — serialization round-trip", () => {
  it("toJSON / fromJSON preserves entries and config", () => {
    const c = new SemanticCache({ config: { similarityThreshold: 0.85 } });
    c.store("k1", SAMPLE_PROMPT, SAMPLE_RESPONSE, freshA());
    const json = c.toJSON();
    const revived = SemanticCache.fromJSON(json);
    expect(revived.size).toBe(1);
    const d = revived.decide(SAMPLE_PROMPT, freshA());
    expect(d.kind).toBe("hit");
  });

  it("fromJSON on malformed input returns an empty cache (no throw)", () => {
    expect(SemanticCache.fromJSON(null).size).toBe(0);
    expect(SemanticCache.fromJSON("garbage").size).toBe(0);
    expect(SemanticCache.fromJSON({ version: 2 }).size).toBe(0);
  });

  it("fromJSON drops entries with vector-dim mismatch (model swap)", () => {
    const c = new SemanticCache({ model: new LexicalEmbedder({ dim: 128 }) });
    c.store("k1", SAMPLE_PROMPT, SAMPLE_RESPONSE, freshA());
    const json = c.toJSON();
    // Revive with a different model dim
    const revived = SemanticCache.fromJSON(json, {
      model: new LexicalEmbedder({ dim: 256 }),
    });
    expect(revived.size).toBe(0);
  });
});

describe("SemanticCache — model identity", () => {
  it("modelName reflects the active model", () => {
    const c = new SemanticCache();
    expect(c.modelName).toMatch(/^char-ngram-hashed@/);
  });
});

describe("SemanticCache — re-store overwrites in place", () => {
  it("storing the same id replaces query/response/vector", () => {
    let t = 1000;
    const c = new SemanticCache({ now: () => t });
    c.store("k1", "alpha alpha alpha", "r1", freshA());
    t = 2000;
    c.store("k1", "different content here", "r2", freshA());
    expect(c.size).toBe(1);
    const d = c.decide("different content here", freshA());
    expect(d.kind).toBe("hit");
    if (d.kind === "hit") expect(d.entry.response).toBe("r2");
  });
});

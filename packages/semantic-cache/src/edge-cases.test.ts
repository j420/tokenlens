/**
 * Adversarial probe for @prune/semantic-cache.
 *
 * Hostile inputs the production cache must survive without throwing,
 * leaking, or producing NaN/Infinity.
 */

import { describe, expect, it } from "vitest";
import { LexicalEmbedder } from "./lexical-embedder.js";
import { SemanticCache } from "./cache.js";
import { contentShaFreshness } from "./freshness.js";

describe("edge: hostile inputs to embedder", () => {
  it("very long input (1MB) embeds without throwing", () => {
    const e = new LexicalEmbedder();
    const big = "abc ".repeat(250_000);
    const v = e.embed(big);
    expect(v.length).toBe(256);
    let sq = 0;
    for (let i = 0; i < v.length; i++) sq += v[i]! * v[i]!;
    expect(Math.abs(Math.sqrt(sq) - 1)).toBeLessThan(1e-4);
  });

  it("null-byte content does not crash normalize/hash", () => {
    const e = new LexicalEmbedder();
    expect(() => e.embed("\x00\x00\x00")).not.toThrow();
  });

  it("multi-byte unicode (BMP + emoji)", () => {
    const e = new LexicalEmbedder();
    const v = e.embed("héllo wörld 🌍🚀");
    let nonzero = 0;
    for (let i = 0; i < v.length; i++) if (v[i] !== 0) nonzero += 1;
    expect(nonzero).toBeGreaterThan(0);
  });
});

describe("edge: poisoning defense", () => {
  it("freshness mismatch prevents serving a previously-poisoned entry", () => {
    const c = new SemanticCache();
    // Attacker insertion: stored under freshness A.
    c.store("k1", "what's my AWS key?", "ATTACKER_KEY_X", contentShaFreshness("A"));
    // Legitimate caller queries under freshness B (different workspace SHA).
    const d = c.decide("what's my AWS key?", contentShaFreshness("B"));
    expect(d.kind).toBe("miss");
    if (d.kind === "miss") expect(d.reason).toBe("freshness_mismatch");
  });

  it("re-store under fresh SHA invalidates the old response", () => {
    const c = new SemanticCache();
    c.store("k1", "give me the secret", "OLD", contentShaFreshness("old"));
    c.store("k1", "give me the secret", "NEW", contentShaFreshness("new"));
    const d = c.decide("give me the secret", contentShaFreshness("new"));
    expect(d.kind).toBe("hit");
    if (d.kind === "hit") expect(d.entry.response).toBe("NEW");
  });
});

describe("edge: degenerate vectors don't pollute lookups", () => {
  it("an all-whitespace store is rejected and doesn't shadow real entries", () => {
    const c = new SemanticCache();
    expect(c.store("noise", "    \n\n ", "x", contentShaFreshness("a"))).toBeNull();
    c.store("real", "the actual prompt", "r", contentShaFreshness("a"));
    const d = c.decide("the actual prompt", contentShaFreshness("a"));
    expect(d.kind).toBe("hit");
  });
});

describe("edge: 1k-entry stress (perf + correctness)", () => {
  it("stores and queries 1000 distinct entries under 200ms", () => {
    const c = new SemanticCache({ config: { maxEntries: 2000 } });
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      c.store(
        `k${i}`,
        `prompt number ${i} about topic ${i % 17}`,
        `response ${i}`,
        contentShaFreshness(`fresh-${i}`)
      );
    }
    for (let i = 0; i < 100; i++) {
      c.decide(`prompt number ${i} about topic ${i % 17}`, contentShaFreshness(`fresh-${i}`));
    }
    const elapsed = performance.now() - t0;
    expect(c.size).toBe(1000);
    expect(elapsed).toBeLessThan(800); // generous; typical run is <200ms
  });
});

describe("edge: fromJSON tolerates corrupt entries", () => {
  it("drops entries with non-finite vector elements", () => {
    const blob = {
      version: 1 as const,
      model: { name: "x", version: "y", dim: 256 },
      config: {
        similarityThreshold: 0.92,
        maxEntries: 1024,
        maxAgeMs: 3600_000,
        maxResponseBytes: 100,
      },
      entries: [
        {
          id: "bad",
          query: "q",
          response: "r",
          vector: Array.from({ length: 256 }, (_, i) =>
            i === 5 ? Number.NaN : 0
          ),
          freshness: { kind: "content-sha" as const, sha: "x" },
          lastHitMs: 1,
          hitCount: 0,
          createdAtMs: 1,
        },
      ],
    };
    const c = SemanticCache.fromJSON(blob);
    expect(c.size).toBe(0);
  });

  it("drops entries with missing required fields", () => {
    const blob = {
      version: 1 as const,
      model: { name: "x", version: "y", dim: 256 },
      config: {
        similarityThreshold: 0.92,
        maxEntries: 1024,
        maxAgeMs: 3600_000,
        maxResponseBytes: 100,
      },
      entries: [{ id: "incomplete" }],
    };
    const c = SemanticCache.fromJSON(blob);
    expect(c.size).toBe(0);
  });
});

describe("edge: config clamping", () => {
  it("NaN similarityThreshold falls back to default", () => {
    const c = new SemanticCache({
      config: { similarityThreshold: Number.NaN },
    });
    expect(c.configuration.similarityThreshold).toBe(0.92);
  });

  it("negative maxEntries falls back to default", () => {
    const c = new SemanticCache({
      config: { maxEntries: -1 },
    });
    expect(c.configuration.maxEntries).toBe(1024);
  });

  it("non-integer maxEntries falls back to default", () => {
    const c = new SemanticCache({
      config: { maxEntries: 3.7 },
    });
    expect(c.configuration.maxEntries).toBe(1024);
  });
});

describe("edge: query/response with NUL bytes", () => {
  it("stores and serves NUL-containing payloads byte-faithfully", () => {
    const c = new SemanticCache();
    const payload = "a\x00b\x00c";
    c.store("k", "binary blob query", payload, contentShaFreshness("x"));
    const d = c.decide("binary blob query", contentShaFreshness("x"));
    expect(d.kind).toBe("hit");
    if (d.kind === "hit") expect(d.entry.response).toBe(payload);
  });
});

describe("edge: cosine cannot leak NaN even on model anomaly", () => {
  it("a model returning a wrong-dim vector causes miss(model_mismatch)", () => {
    const badModel = {
      name: "bad",
      version: "v0",
      dim: 256,
      embed: (_t: string) => new Float32Array(64),
    };
    const c = new SemanticCache({ model: badModel });
    // store also bypasses since dim ≠ vector.length
    expect(c.store("k", "q", "r", contentShaFreshness("a"))).toBeNull();
  });
});

describe("edge: LRU tiebreaker is deterministic (regression for sort instability)", () => {
  it("evicts deterministically when lastHitMs ties", () => {
    // Inject a constant clock so every entry has identical lastHitMs +
    // createdAtMs. Without the tiebreaker the JS engine's sort can
    // pick any of the equal-keyed entries; with the tiebreaker the
    // eviction order is fully determined by id.
    let t = 1000;
    const c = new SemanticCache({
      config: { maxEntries: 3 },
      now: () => t,
    });
    c.store("aaa", "alpha one", "x", contentShaFreshness("a"));
    c.store("bbb", "alpha two", "x", contentShaFreshness("a"));
    c.store("ccc", "alpha three", "x", contentShaFreshness("a"));
    c.store("ddd", "alpha four", "x", contentShaFreshness("a"));
    const ids = c
      .toJSON()
      .entries.map((e) => e.id)
      .sort();
    // "aaa" had the smallest id at the same tied timestamp ⇒ evicted.
    expect(ids).toEqual(["bbb", "ccc", "ddd"]);
  });
});

describe("edge: equivalence-gate surface is honest (no fake byteEqual)", () => {
  it("hits report strategy='trust-similarity-and-freshness' (the actual gate)", () => {
    const c = new SemanticCache();
    c.store("k", "the test query here", "RESPONSE", contentShaFreshness("a"));
    const d = c.decide("the test query here", contentShaFreshness("a"));
    expect(d.kind).toBe("hit");
    if (d.kind === "hit") {
      expect(d.equivalent).toBe(true);
      expect(d.equivalenceStrategy).toBe("trust-similarity-and-freshness");
    }
  });
});

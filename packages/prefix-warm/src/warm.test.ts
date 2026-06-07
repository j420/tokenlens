import { describe, expect, it } from "vitest";
import {
  assessCache,
  cacheHitSavings,
  shouldWarm,
  useEntry,
} from "./warm.js";
import type { PrefixEntry, WarmConfig } from "./types.js";

const entry = (lastUsedAt: number): PrefixEntry => ({
  prefixHash: "h",
  tokens: 5000,
  lastUsedAt,
});

const TTL = 300_000; // 5 min
const config: WarmConfig = { ttlMs: TTL, refreshThresholdMs: 60_000 };

describe("assessCache", () => {
  it("reports absent for a null entry", () => {
    expect(assessCache(null, 1000, TTL).status).toBe("absent");
  });

  it("reports warm within the TTL with correct remaining time", () => {
    const a = assessCache(entry(0), 100_000, TTL);
    expect(a.status).toBe("warm");
    expect(a.msUntilExpiry).toBe(200_000);
    expect(a.expiresAt).toBe(300_000);
  });

  it("reports expired past the TTL", () => {
    expect(assessCache(entry(0), 400_000, TTL).status).toBe("expired");
  });

  it("treats a non-positive TTL as no caching (expired)", () => {
    expect(assessCache(entry(0), 1, 0).status).toBe("expired");
  });
});

describe("useEntry", () => {
  it("refreshes lastUsedAt without mutating the input", () => {
    const e = entry(0);
    const refreshed = useEntry(e, 123);
    expect(refreshed.lastUsedAt).toBe(123);
    expect(e.lastUsedAt).toBe(0);
  });
});

describe("shouldWarm", () => {
  it("does not warm when reuse is not expected", () => {
    expect(shouldWarm(entry(0), 100_000, config, false).warm).toBe(false);
  });

  it("does not warm a warm prefix with ample time left", () => {
    const d = shouldWarm(entry(0), 100_000, config, true); // 200s left > 60s
    expect(d.warm).toBe(false);
  });

  it("warms a warm prefix that is expiring within the threshold", () => {
    const d = shouldWarm(entry(0), 250_000, config, true); // 50s left < 60s
    expect(d.warm).toBe(true);
  });

  it("primes an expired or absent prefix when reuse is expected", () => {
    expect(shouldWarm(entry(0), 400_000, config, true).warm).toBe(true);
    expect(shouldWarm(null, 400_000, config, true).warm).toBe(true);
  });
});

describe("cacheHitSavings", () => {
  it("computes read-discount savings across hits", () => {
    // 5000 tokens, hit costs 10% → saves 90% each, over 3 hits.
    expect(cacheHitSavings(5000, 0.1, 3)).toBeCloseTo(5000 * 0.9 * 3);
  });

  it("clamps discount, tokens, and hits to sane ranges", () => {
    expect(cacheHitSavings(-100, 0.1, 3)).toBe(0);
    expect(cacheHitSavings(5000, 2, 3)).toBe(0); // discount clamped to 1 → no savings
    expect(cacheHitSavings(5000, 0.1, -1)).toBe(0);
  });
});

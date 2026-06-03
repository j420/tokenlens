import { describe, expect, it } from "vitest";

import { analyzeDeltaResend, type PrefixBlock } from "./delta-resend.js";

const SONNET = "claude-sonnet-4-5-20250929"; // input $3/1M, minCacheable 1024

function blk(
  hash: string,
  tokens: number,
  segment: "system" | "tools" = "system",
  blockIndex = 0
): PrefixBlock {
  return { segment, blockIndex, contentHash: hash, tokens };
}

describe("analyzeDeltaResend — surviving prefix detection", () => {
  it("finds the surviving leading run when a LATER block changes", () => {
    const previous = [blk("hA", 2000), blk("hB", 500, "tools"), blk("hC", 3000, "tools")];
    const next = [blk("hA", 2000), blk("hB", 500, "tools"), blk("hC2", 3000, "tools")];
    const r = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous, next });
    expect(r.firstDivergedIndex).toBe(2);
    expect(r.survivingBlockCount).toBe(2);
    expect(r.survivingTokens).toBe(2500);
    expect(r.rewrittenTokens).toBe(3000);
    expect(r.survivingPrefixIsCacheable).toBe(true);
    expect(r.poison.detected).toBe(false);
  });

  it("reports no divergence for identical prefixes", () => {
    const blocks = [blk("hA", 2000), blk("hB", 500)];
    const r = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous: blocks, next: blocks });
    expect(r.firstDivergedIndex).toBeNull();
    expect(r.survivingBlockCount).toBe(2);
    expect(r.rewrittenTokens).toBe(0);
  });

  it("treats appended blocks as the diverged tail, not a poison", () => {
    const previous = [blk("hA", 2000)];
    const next = [blk("hA", 2000), blk("hD", 800, "tools")];
    const r = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous, next });
    expect(r.firstDivergedIndex).toBe(1);
    expect(r.survivingTokens).toBe(2000);
    expect(r.rewrittenTokens).toBe(800);
    expect(r.poison.detected).toBe(false);
  });

  it("handles next being a strict prefix of previous (no rewrite)", () => {
    const previous = [blk("hA", 2000), blk("hB", 500), blk("hC", 3000)];
    const next = [blk("hA", 2000), blk("hB", 500)];
    const r = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous, next });
    expect(r.firstDivergedIndex).toBeNull();
    expect(r.survivingBlockCount).toBe(2);
    expect(r.rewrittenTokens).toBe(0);
  });

  it("divergence at index 0 with no stranded run salvages nothing", () => {
    const previous = [blk("hA", 1500), blk("hB", 1500)];
    const next = [blk("hA2", 1500), blk("hB2", 1500)];
    const r = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous, next });
    expect(r.firstDivergedIndex).toBe(0);
    expect(r.survivingTokens).toBe(0);
    expect(r.survivingPrefixIsCacheable).toBe(false);
    expect(r.poison.detected).toBe(false);
  });
});

describe("analyzeDeltaResend — poison diagnosis", () => {
  it("detects a top-of-prompt in-place change stranding the whole rest", () => {
    // The canonical 'timestamp baked into the system prompt' case.
    const previous = [blk("hSys", 2000), blk("hRules", 500), blk("hTools", 3000, "tools")];
    const next = [blk("hSys2", 2000), blk("hRules", 500), blk("hTools", 3000, "tools")];
    const r = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous, next });
    expect(r.firstDivergedIndex).toBe(0);
    expect(r.survivingTokens).toBe(0);
    expect(r.poison.detected).toBe(true);
    expect(r.poison.strandedStableBlocks).toBe(2);
    expect(r.poison.strandedStableTokens).toBe(3500);
    expect(r.poison.suggestion).toMatch(/Move the volatile block after the cache breakpoint/);
    expect(r.poison.suggestion).toMatch(/clears the 1024-token minimum/);
  });

  it("flags 'still below' when even the rejoined run is sub-minimum", () => {
    // Small stable run stranded; rejoined still below 1024.
    const previous = [blk("hA", 100), blk("hB", 300), blk("hC", 400)];
    const next = [blk("hA2", 100), blk("hB", 300), blk("hC", 400)];
    const r = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous, next });
    expect(r.poison.detected).toBe(true);
    expect(r.poison.strandedStableTokens).toBe(700);
    expect(r.poison.suggestion).toMatch(/still below the 1024-token minimum/);
  });

  it("does not flag poison when the in-place change strands nothing", () => {
    const previous = [blk("hA", 2000), blk("hB", 500)];
    const next = [blk("hA", 2000), blk("hB2", 500)]; // last block changed, nothing after
    const r = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous, next });
    expect(r.firstDivergedIndex).toBe(1);
    expect(r.poison.detected).toBe(false);
  });
});

describe("analyzeDeltaResend — economics (exact, sonnet 5m)", () => {
  it("computes full-bust, delta-resend, and saving for a salvageable change", () => {
    // surviving 2500 (cacheable), rewritten 3000.
    // fullBust   = 5500 * 1.25 * 3/1e6 = 0.020625
    // deltaResend= 2500*0.10*3/1e6 + 3000*1.25*3/1e6 = 0.00075 + 0.01125 = 0.012
    // saved      = 2500*(1.25-0.10)*3/1e6 = 0.008625
    const previous = [blk("hA", 2000), blk("hB", 500), blk("hC", 3000)];
    const next = [blk("hA", 2000), blk("hB", 500), blk("hC2", 3000)];
    const r = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous, next });
    expect(r.fullBustCostUsd).toBeCloseTo(0.020625, 10);
    expect(r.deltaResendCostUsd).toBeCloseTo(0.012, 10);
    expect(r.savedUsd).toBeCloseTo(0.008625, 10);
    expect(r.savedRatio).toBeCloseTo(0.008625 / 0.020625, 8);
  });

  it("reports zero realizable saving when the surviving run is below the minimum", () => {
    // surviving 200 (< 1024) → not cacheable → delta == full bust, saved 0.
    const previous = [blk("hA", 200), blk("hB", 500), blk("hC", 3000)];
    const next = [blk("hA", 200), blk("hB2", 500), blk("hC", 3000)];
    const r = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous, next });
    expect(r.survivingTokens).toBe(200);
    expect(r.survivingPrefixIsCacheable).toBe(false);
    expect(r.savedUsd).toBe(0);
    expect(r.deltaResendCostUsd).toBe(r.fullBustCostUsd);
    // But the poison diagnosis still points at the fix (stranded hC = 3000).
    expect(r.poison.detected).toBe(true);
    expect(r.poison.strandedStableTokens).toBe(3000);
  });

  it("uses the 1h write multiplier when ttl is 1h", () => {
    // surviving 2500, rewritten 3000, 1h writeMult 2.0.
    // fullBust = 5500*2.0*3/1e6 = 0.033 ; saved = 2500*(2.0-0.10)*3/1e6 = 0.014250
    const previous = [blk("hA", 2000), blk("hB", 500), blk("hC", 3000)];
    const next = [blk("hA", 2000), blk("hB", 500), blk("hC2", 3000)];
    const r = analyzeDeltaResend({ model: SONNET, ttl: "1h", previous, next });
    expect(r.fullBustCostUsd).toBeCloseTo(0.033, 10);
    expect(r.savedUsd).toBeCloseTo(0.01425, 10);
  });

  it("returns null USD for an unpriced model but keeps token movement", () => {
    const previous = [blk("hA", 2000), blk("hB", 500), blk("hC", 3000)];
    const next = [blk("hA", 2000), blk("hB", 500), blk("hC2", 3000)];
    const r = analyzeDeltaResend({ model: "unknown-model-x", ttl: "5m", previous, next });
    expect(r.fullBustCostUsd).toBeNull();
    expect(r.savedUsd).toBeNull();
    expect(r.savedRatio).toBeNull();
    expect(r.survivingTokens).toBe(2500);
    expect(r.rewrittenTokens).toBe(3000);
  });
});

describe("analyzeDeltaResend — opus minimum (4096)", () => {
  it("a 2500-token surviving run is NOT cacheable under opus (min 4096)", () => {
    const previous = [blk("hA", 2000), blk("hB", 500), blk("hC", 3000)];
    const next = [blk("hA", 2000), blk("hB", 500), blk("hC2", 3000)];
    const r = analyzeDeltaResend({
      model: "claude-opus-4-5-20251101",
      ttl: "5m",
      previous,
      next,
    });
    expect(r.minCacheableTokens).toBe(4096);
    expect(r.survivingTokens).toBe(2500);
    expect(r.survivingPrefixIsCacheable).toBe(false);
    expect(r.savedUsd).toBe(0);
  });
});

describe("analyzeDeltaResend — edge cases", () => {
  it("two empty prefixes → all zeros, no divergence, no poison", () => {
    const r = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous: [], next: [] });
    expect(r.firstDivergedIndex).toBeNull();
    expect(r.survivingTokens).toBe(0);
    expect(r.rewrittenTokens).toBe(0);
    expect(r.fullBustCostUsd).toBe(0);
    expect(r.savedUsd).toBe(0);
    expect(r.savedRatio).toBeNull(); // full bust 0 → ratio guarded
    expect(r.poison.detected).toBe(false);
  });

  it("previous empty, next non-empty → everything is new (rewritten)", () => {
    const r = analyzeDeltaResend({
      model: SONNET,
      ttl: "5m",
      previous: [],
      next: [blk("hA", 2000)],
    });
    expect(r.firstDivergedIndex).toBe(0);
    expect(r.survivingTokens).toBe(0);
    expect(r.rewrittenTokens).toBe(2000);
  });

  it("is deterministic for the same input", () => {
    const previous = [blk("hA", 2000), blk("hB", 500)];
    const next = [blk("hA", 2000), blk("hB2", 500)];
    const a = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous, next });
    const b = analyzeDeltaResend({ model: SONNET, ttl: "5m", previous, next });
    expect(a).toEqual(b);
  });
});

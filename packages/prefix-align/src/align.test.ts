import { describe, it, expect } from "vitest";
import { alignPrefix } from "./align.js";

describe("alignPrefix", () => {
  it("caches the first boundary and reports the wasted tail (1100 → 1024 cached)", () => {
    const r = alignPrefix(1100);
    expect(r.eligible).toBe(true);
    expect(r.cacheableTokens).toBe(1024);
    expect(r.wastedTailTokens).toBe(76);
    expect(r.nextBoundaryTokens).toBe(1152); // 1024 + 128
    expect(r.padToNextTokens).toBe(52); // 1152 - 1100
  });

  it("aligns exactly on a boundary (no waste)", () => {
    const r = alignPrefix(1024 + 128 * 3); // 1408
    expect(r.cacheableTokens).toBe(1408);
    expect(r.wastedTailTokens).toBe(0);
    expect(r.padToNextTokens).toBe(128); // already aligned → a full increment to the next
  });

  it("reports ineligible below the minimum, advising the pad to reach it", () => {
    const r = alignPrefix(800);
    expect(r.eligible).toBe(false);
    expect(r.cacheableTokens).toBe(0);
    expect(r.wastedTailTokens).toBe(800);
    expect(r.nextBoundaryTokens).toBe(1024);
    expect(r.padToNextTokens).toBe(224);
  });

  it("honors custom min/increment (e.g. a different provider)", () => {
    const r = alignPrefix(2200, { minCacheableTokens: 2048, incrementTokens: 256 });
    // 2048 + 0*256 = 2048 cached, tail 152
    expect(r.cacheableTokens).toBe(2048);
    expect(r.wastedTailTokens).toBe(152);
  });

  it("is total on garbage", () => {
    expect(alignPrefix(null).cacheableTokens).toBe(0);
    expect(alignPrefix(-5).eligible).toBe(false);
    expect(alignPrefix("nope" as unknown).wastedTailTokens).toBe(0);
  });

  it("is deterministic", () => {
    expect(alignPrefix(1300)).toEqual(alignPrefix(1300));
  });
});

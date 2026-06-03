import { describe, expect, it } from "vitest";

import {
  planRecompression,
  type RecompressInput,
  type RecompressSegment,
} from "./recompress-planner.js";

const SONNET = "claude-sonnet-4-5-20250929"; // input $3/1M

function seg(
  index: number,
  currentTokens: number,
  compressedTokens: number | null,
  label?: string
): RecompressSegment {
  return { index, currentTokens, compressedTokens, label };
}

function input(overrides: Partial<RecompressInput> = {}): RecompressInput {
  return {
    model: SONNET,
    ttl: "5m",
    estimatedRemainingTurns: 10,
    segments: [
      seg(0, 5000, 1000, "old-tool-result"),
      seg(1, 2000, null, "system"), // not compressible
      seg(2, 3000, 800, "settled-read"),
    ],
    ...overrides,
  };
}

describe("planRecompression — chosen suffix + exact arithmetic (sonnet 5m)", () => {
  // Candidates: p=0 (tail 0,1,2) and p=2 (tail 2).
  //   p=0: savedPerTurn = 4000+2200 = 6200; rebuildTokens = 1000+2000+800 = 3800
  //        netTokens = 10*6200*0.10 - 3800*1.25 = 6200 - 4750 = 1450
  //   p=2: savedPerTurn = 2200; rebuildTokens = 800
  //        netTokens = 10*2200*0.10 - 800*1.25 = 2200 - 1000 = 1200
  //   best = p=0 (1450 > 1200).
  it("selects the max-net suffix (p=0) over a smaller one (p=2)", () => {
    const p = planRecompression(input());
    expect(p.bustAtIndex).toBe(0);
    expect(p.recompressIndices).toEqual([0, 2]);
    expect(p.savedTokensPerTurn).toBe(6200);
    expect(p.rebuildTokens).toBe(3800);
  });

  it("computes the price-independent break-even and recommends when remaining clears it", () => {
    const p = planRecompression(input());
    // breakEven = rebuildTokens*w / (R*savedPerTurn) = 3800*1.25 / (0.10*6200) = 4750/620
    expect(p.breakEvenTurns).toBeCloseTo(4750 / 620, 10); // ≈ 7.661
    expect(p.recommend).toBe(true); // 10 ≥ 7.661
  });

  it("computes USD figures that match the token math", () => {
    const p = planRecompression(input());
    // savingPerTurnUsd = 6200*0.10*3/1e6 = 0.00186
    // rebuildCostUsd   = 3800*1.25*3/1e6 = 0.01425
    // netSavingUsd     = 10*0.00186 - 0.01425 = 0.00435
    expect(p.savingPerTurnUsd).toBeCloseTo(0.00186, 10);
    expect(p.rebuildCostUsd).toBeCloseTo(0.01425, 10);
    expect(p.netSavingUsd).toBeCloseTo(0.00435, 10);
  });

  it("does NOT recommend when too few turns remain, and shifts to the smaller (cheaper-rebuild) suffix", () => {
    // At remaining=3 the big suffix (p=0) is deeply net-negative, so the planner
    // picks the least-bad plan — the smaller suffix p=2 — and reports ITS
    // break-even. (The chosen suffix legitimately shifts with the horizon.)
    //   net(0) = 3*6200*0.10 - 3800*1.25 = 1860 - 4750 = -2890
    //   net(2) = 3*2200*0.10 -  800*1.25 =  660 - 1000 =  -340  → best (least bad)
    const p = planRecompression(input({ estimatedRemainingTurns: 3 }));
    expect(p.bustAtIndex).toBe(2);
    expect(p.recompressIndices).toEqual([2]);
    expect(p.recommend).toBe(false);
    expect(p.netSavingUsd!).toBeLessThan(0);
    // break-even for the chosen p=2 suffix: 800*1.25 / (0.10*2200) = 1000/220.
    expect(p.breakEvenTurns).toBeCloseTo(1000 / 220, 10);
  });

  it("picks the later, smaller suffix when an early bust would be net-negative", () => {
    // Make the early compressible segment tiny and the middle non-compressible huge,
    // so busting at 0 rewrites a giant middle for little gain; busting at 2 wins.
    const p = planRecompression(
      input({
        estimatedRemainingTurns: 5,
        segments: [
          seg(0, 600, 500, "tiny-old"), // saves 100
          seg(1, 50_000, null, "huge-stable"), // not compressible
          seg(2, 4000, 500, "settled"), // saves 3500
        ],
      })
    );
    // p=0: saved=100+3500=3600; rebuild=500+50000+500=51000; net=5*3600*0.10 - 51000*1.25 = 1800 - 63750 <0
    // p=2: saved=3500; rebuild=500; net=5*3500*0.10 - 500*1.25 = 1750 - 625 = 1125 >0
    expect(p.bustAtIndex).toBe(2);
    expect(p.recompressIndices).toEqual([2]);
    expect(p.recommend).toBe(true);
  });

  it("uses the 1h write multiplier when ttl is 1h", () => {
    const p = planRecompression(input({ ttl: "1h" }));
    // p=0 rebuild=3800 at w=2.0; p=2 rebuild=800 at w=2.0.
    //   net(0) = 6200 - 3800*2 = 6200 - 7600 = -1400
    //   net(2) = 2200 - 800*2  = 2200 - 1600 =  600  → best
    expect(p.bustAtIndex).toBe(2);
    expect(p.rebuildCostUsd).toBeCloseTo(800 * 2.0 * 3 / 1e6, 10);
  });
});

describe("planRecompression — honesty + edge cases", () => {
  it("returns null USD for an unpriced model but still decides via tokens", () => {
    const p = planRecompression(input({ model: "unknown-model-xyz" }));
    expect(p.netSavingUsd).toBeNull();
    expect(p.rebuildCostUsd).toBeNull();
    expect(p.savingPerTurnUsd).toBeNull();
    expect(p.bustAtIndex).toBe(0); // decision unaffected by pricing
    expect(p.recommend).toBe(true);
  });

  it("no compressible segments → no plan, never recommends", () => {
    const p = planRecompression(
      input({ segments: [seg(0, 2000, null), seg(1, 3000, null)] })
    );
    expect(p.bustAtIndex).toBeNull();
    expect(p.recompressIndices).toEqual([]);
    expect(p.savedTokensPerTurn).toBe(0);
    expect(p.breakEvenTurns).toBeNull();
    expect(p.recommend).toBe(false);
  });

  it("treats compressedTokens >= currentTokens as not compressible (no negative saving)", () => {
    const p = planRecompression(
      input({ segments: [seg(0, 1000, 1200), seg(1, 800, 800)] }) // bigger / equal
    );
    expect(p.bustAtIndex).toBeNull();
    expect(p.recommend).toBe(false);
  });

  it("ignores a NaN/negative compressedTokens (no fabrication, no crash)", () => {
    const p = planRecompression(
      input({
        segments: [
          seg(0, 5000, Number.NaN),
          seg(1, 3000, -100),
          seg(2, 2000, 500), // the only real one
        ],
        estimatedRemainingTurns: 100,
      })
    );
    expect(p.bustAtIndex).toBe(2);
    expect(p.savedTokensPerTurn).toBe(1500);
  });

  it("estimatedRemainingTurns = 0 never recommends (no future reads to amortize)", () => {
    const p = planRecompression(input({ estimatedRemainingTurns: 0 }));
    expect(p.recommend).toBe(false);
    expect(p.netSavingUsd!).toBeLessThan(0); // pure one-time rebuild cost, no saving
  });

  it("floors a fractional remaining-turn estimate", () => {
    const a = planRecompression(input({ estimatedRemainingTurns: 7.9 }));
    const b = planRecompression(input({ estimatedRemainingTurns: 7 }));
    expect(a).toEqual(b);
  });

  it("empty prefix → no plan", () => {
    const p = planRecompression(input({ segments: [] }));
    expect(p.bustAtIndex).toBeNull();
    expect(p.recommend).toBe(false);
  });

  it("is deterministic for the same input", () => {
    const i = input();
    expect(planRecompression(i)).toEqual(planRecompression(i));
  });

  it("recommend ⟺ netSavingUsd > 0 for priced models (decision/EV agree)", () => {
    for (const turns of [0, 3, 7, 8, 10, 50]) {
      const p = planRecompression(input({ estimatedRemainingTurns: turns }));
      // recommend uses remaining ≥ break-even, so at the exact boundary net == 0.
      if (p.recommend) expect(p.netSavingUsd!).toBeGreaterThanOrEqual(0);
      else expect(p.netSavingUsd!).toBeLessThanOrEqual(0);
    }
  });
});

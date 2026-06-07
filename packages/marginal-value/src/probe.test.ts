import { describe, it, expect } from "vitest";
import { assessMarginalValue, type ChunkVerdict } from "./probe.js";

const chunk = (id: string, tokens: number, eq: boolean | null): ChunkVerdict => ({
  id,
  tokens,
  outputEquivalentWithout: eq,
});

describe("assessMarginalValue", () => {
  it("flags chunks whose removal left the output equivalent as zero-value waste", () => {
    const r = assessMarginalValue(
      [chunk("useful", 500, false), chunk("dead", 800, true), chunk("dead2", 200, true)],
      { atIso: "2026-06-01T00:00:00Z" }
    );
    expect(r.zeroValueChunks).toEqual(["dead", "dead2"]);
    expect(r.contributingChunks).toEqual(["useful"]);
    expect(r.wastedTokens).toBe(1000);
    expect(r.totalTokens).toBe(1500);
  });

  it("emits F1-shaped observations with the right contribution labels", () => {
    const r = assessMarginalValue([chunk("a", 100, false), chunk("b", 100, true)], {
      atIso: "2026-06-01T00:00:00Z",
    });
    expect(r.observations).toContainEqual({ atomId: "a", contributed: true, atIso: "2026-06-01T00:00:00Z" });
    expect(r.observations).toContainEqual({ atomId: "b", contributed: false, atIso: "2026-06-01T00:00:00Z" });
  });

  it("keeps unprobed (null-verdict) chunks unlabelled and out of the waste total", () => {
    const r = assessMarginalValue([chunk("maybe", 999, null), chunk("dead", 100, true)]);
    expect(r.unprobedChunks).toEqual(["maybe"]);
    expect(r.wastedTokens).toBe(100); // only the proven-dead chunk
    expect(r.observations.map((o) => o.atomId)).toEqual(["dead"]); // no observation for unprobed
  });

  it("skips malformed chunks and is total on garbage", () => {
    const r = assessMarginalValue([chunk("a", 100, true), { id: "x" }, null] as unknown);
    expect(r.skipped).toBe(2);
    expect(assessMarginalValue(null).zeroValueChunks).toEqual([]);
  });

  it("is deterministic (sorted outputs)", () => {
    const input = [chunk("z", 1, true), chunk("a", 1, true)];
    const r = assessMarginalValue(input, { atIso: "2026-06-01T00:00:00Z" });
    expect(r.zeroValueChunks).toEqual(["a", "z"]);
    expect(assessMarginalValue(input, { atIso: "2026-06-01T00:00:00Z" })).toEqual(r);
  });
});

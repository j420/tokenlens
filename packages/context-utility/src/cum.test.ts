import { describe, it, expect } from "vitest";
import {
  emptyCumState,
  updateUtility,
  queryUtility,
  rankAtoms,
  type UtilityObservation,
} from "./cum.js";

function obs(atomId: string, contributed: boolean, atIso: string): UtilityObservation {
  return { atomId, contributed, atIso };
}

const T = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();

describe("updateUtility + queryUtility (Beta-Binomial empirical-Bayes)", () => {
  it("posterior mean for all-contributed atom: (c+α)/(n+α+β)", () => {
    let s = emptyCumState();
    s = updateUtility(s, [obs("a", true, T(1)), obs("a", true, T(2)), obs("a", true, T(3))]);
    const e = queryUtility(s, "a");
    // a=3+1=4, b=0+1=1 → 4/5 = 0.8
    expect(e.utility).toBeCloseTo(0.8, 9);
    expect(e.rawObservations).toBe(3);
    expect(e.stdDev).toBeGreaterThan(0);
  });

  it("posterior mean for a mixed atom", () => {
    let s = emptyCumState();
    s = updateUtility(s, [obs("a", true, T(1)), obs("a", false, T(2)), obs("a", false, T(3))]);
    const e = queryUtility(s, "a");
    // a=1+1=2, b=2+1=3 → 2/5 = 0.4
    expect(e.utility).toBeCloseTo(0.4, 9);
  });

  it("is cold-start (null) below minObservations and for unknown atoms", () => {
    let s = emptyCumState();
    s = updateUtility(s, [obs("a", true, T(1)), obs("a", true, T(2))]); // n=2 < 3
    expect(queryUtility(s, "a").utility).toBeNull();
    expect(queryUtility(s, "ghost").utility).toBeNull();
    expect(queryUtility(s, "a", { minObservations: 2 }).utility).not.toBeNull();
  });

  it("never fabricates: cold-start returns null utility AND null stdDev", () => {
    const e = queryUtility(emptyCumState(), "x");
    expect(e.utility).toBeNull();
    expect(e.stdDev).toBeNull();
    expect(e.rawObservations).toBe(0);
  });

  it("is order-independent across distinct timestamps (deterministic decayed counting)", () => {
    const records = [
      obs("a", true, T(1)),
      obs("a", false, T(2)),
      obs("a", true, T(3)),
      obs("a", true, T(4)),
    ];
    const forward = updateUtility(emptyCumState(), records, { halfLifeMs: 86_400_000 });
    const shuffled = updateUtility(emptyCumState(), [records[2], records[0], records[3], records[1]], {
      halfLifeMs: 86_400_000,
    });
    expect(forward).toEqual(shuffled);
  });

  it("decay weights recent observations more (a recent flip moves the posterior)", () => {
    // Atom contributed early, then stopped contributing recently.
    const recentlyBad = updateUtility(
      emptyCumState(),
      [obs("a", true, T(1)), obs("a", true, T(2)), obs("a", false, T(20)), obs("a", false, T(21))],
      { halfLifeMs: 2 * 86_400_000 } // 2-day half-life
    );
    const noDecay = updateUtility(emptyCumState(), [
      obs("a", true, T(1)),
      obs("a", true, T(2)),
      obs("a", false, T(20)),
      obs("a", false, T(21)),
    ]);
    // With decay the early "good" evidence has faded → lower utility than the
    // undecayed 2/4 split.
    expect(queryUtility(recentlyBad, "a", { halfLifeMs: 2 * 86_400_000 }).utility!).toBeLessThan(
      queryUtility(noDecay, "a").utility!
    );
  });

  it("query-time forward-decay ages a stale prior", () => {
    const s = updateUtility(emptyCumState(), [obs("a", true, T(1)), obs("a", true, T(2)), obs("a", true, T(3))], {
      halfLifeMs: 86_400_000,
    });
    const fresh = queryUtility(s, "a");
    const aged = queryUtility(s, "a", { halfLifeMs: 86_400_000, nowIso: T(10) });
    // Aging shrinks effective observations → posterior pulled toward the prior 0.5.
    expect(aged.effectiveObservations).toBeLessThan(fresh.effectiveObservations);
    expect(aged.utility!).toBeLessThan(fresh.utility!);
    expect(aged.utility!).toBeGreaterThan(0.5);
  });

  it("contributed weight never exceeds included (coerce clamps a corrupt store)", () => {
    const corrupt = { version: 1, atoms: { a: { included: 2, contributed: 99, n: 2, asOfMs: 0 } } };
    const e = queryUtility(corrupt as unknown, "a", { minObservations: 1 });
    expect(e.utility!).toBeLessThanOrEqual(1);
    expect(e.utility!).toBeGreaterThanOrEqual(0);
  });

  it("skips malformed observations without throwing", () => {
    const s = updateUtility(emptyCumState(), [
      obs("a", true, T(1)),
      { atomId: "a", contributed: "yes", atIso: T(2) }, // bad contributed
      { atomId: "a", contributed: true, atIso: "not-a-date" }, // bad date
      null,
      obs("a", true, T(3)),
      obs("a", true, T(4)),
    ] as unknown);
    expect(queryUtility(s, "a").rawObservations).toBe(3); // only the 3 valid ones
  });

  it("is total on garbage state/observations", () => {
    expect(updateUtility(null, null)).toEqual(emptyCumState());
    expect(updateUtility("nope" as unknown, 42 as unknown).atoms).toEqual({});
    expect(queryUtility(undefined, "a").utility).toBeNull();
  });

  it("round-trips through JSON (the standing store is plain JSON)", () => {
    const s = updateUtility(emptyCumState(), [obs("a", true, T(1)), obs("a", true, T(2)), obs("a", false, T(3))]);
    const round = updateUtility(JSON.parse(JSON.stringify(s)), []);
    expect(round).toEqual(s);
  });
});

describe("rankAtoms", () => {
  it("ranks known-utility atoms desc, cold-start last, stable tiebreak", () => {
    let s = emptyCumState();
    // high: 3/3, low: 1/3, cold: only 1 obs
    s = updateUtility(s, [
      obs("high", true, T(1)), obs("high", true, T(2)), obs("high", true, T(3)),
      obs("low", true, T(1)), obs("low", false, T(2)), obs("low", false, T(3)),
      obs("cold", true, T(1)),
    ]);
    const ranked = rankAtoms(s, ["low", "cold", "high", "unknown"]);
    expect(ranked.map((r) => r.atomId)).toEqual(["high", "low", "cold", "unknown"]);
    expect(ranked[0]!.coldStart).toBe(false);
    expect(ranked[2]!.coldStart).toBe(true); // cold
    expect(ranked[3]!.coldStart).toBe(true); // unknown
  });

  it("is total on garbage", () => {
    expect(rankAtoms(null, null)).toEqual([]);
    expect(rankAtoms(emptyCumState(), "nope" as unknown)).toEqual([]);
  });

  it("is deterministic", () => {
    const s = updateUtility(emptyCumState(), [obs("a", true, T(1)), obs("a", true, T(2)), obs("a", true, T(3))]);
    expect(rankAtoms(s, ["a", "b"])).toEqual(rankAtoms(s, ["a", "b"]));
  });
});

import { describe, it, expect } from "vitest";
import {
  emptyCiState,
  recordFixEpisode,
  queryFixAssociation,
  rankFixContext,
} from "./validator.js";

const ep = (failureClass: string, atoms: string[], fixed: boolean) => ({ failureClass, atoms, fixed });

describe("ci-validator", () => {
  it("associates an atom present on fixes with a high fix-probability", () => {
    let s = emptyCiState();
    s = recordFixEpisode(s, ep("TypeError@auth", ["auth.ts", "noise.ts"], true));
    s = recordFixEpisode(s, ep("TypeError@auth", ["auth.ts"], true));
    const a = queryFixAssociation(s, "TypeError@auth", "auth.ts");
    // fixed=2, notFixed=0 → (2+1)/(2+0+2)=3/4
    expect(a.association).toBeCloseTo(0.75, 9);
    expect(a.fixed).toBe(2);
  });

  it("associates an atom present only on non-fixes with a low fix-probability", () => {
    let s = emptyCiState();
    s = recordFixEpisode(s, ep("Err", ["redherring.ts"], false));
    s = recordFixEpisode(s, ep("Err", ["redherring.ts"], false));
    const a = queryFixAssociation(s, "Err", "redherring.ts");
    // fixed=0, notFixed=2 → (0+1)/(0+2+2)=1/4
    expect(a.association).toBeCloseTo(0.25, 9);
  });

  it("is cold-start (null) below minObservations and for unknown class/atom", () => {
    let s = recordFixEpisode(emptyCiState(), ep("C", ["a"], true)); // n=1 < 2
    expect(queryFixAssociation(s, "C", "a").association).toBeNull();
    expect(queryFixAssociation(s, "other", "a").association).toBeNull();
    expect(queryFixAssociation(s, "C", "a", { minObservations: 1 }).association).not.toBeNull();
  });

  it("keys associations per failure class (the same atom differs by class)", () => {
    let s = emptyCiState();
    s = recordFixEpisode(s, ep("C1", ["a"], true));
    s = recordFixEpisode(s, ep("C1", ["a"], true));
    s = recordFixEpisode(s, ep("C2", ["a"], false));
    s = recordFixEpisode(s, ep("C2", ["a"], false));
    expect(queryFixAssociation(s, "C1", "a").association!).toBeGreaterThan(0.5);
    expect(queryFixAssociation(s, "C2", "a").association!).toBeLessThan(0.5);
  });

  it("ranks candidate context by fix-association, cold-start last", () => {
    let s = emptyCiState();
    // fixer: present on 3 fixes; distractor: present on 3 non-fixes; fresh: 1 obs
    for (let i = 0; i < 3; i++) s = recordFixEpisode(s, ep("C", ["fixer"], true));
    for (let i = 0; i < 3; i++) s = recordFixEpisode(s, ep("C", ["distractor"], false));
    s = recordFixEpisode(s, ep("C", ["fresh"], true));
    const ranked = rankFixContext(s, "C", ["distractor", "fresh", "fixer", "unknown"]);
    expect(ranked[0]!.atomId).toBe("fixer");
    expect(ranked.find((x) => x.atomId === "distractor")!.association!).toBeLessThan(0.5);
    expect(ranked[ranked.length - 1]!.coldStart).toBe(true);
  });

  it("dedups atoms within a single episode", () => {
    const s = recordFixEpisode(emptyCiState(), ep("C", ["a", "a", "a"], true));
    expect(queryFixAssociation(s, "C", "a", { minObservations: 1 }).fixed).toBe(1);
  });

  it("round-trips through JSON and is total on garbage", () => {
    let s = recordFixEpisode(emptyCiState(), ep("C", ["a"], true));
    s = recordFixEpisode(JSON.parse(JSON.stringify(s)), ep("C", ["a"], true));
    expect(queryFixAssociation(s, "C", "a").fixed).toBe(2);
    expect(recordFixEpisode(null, null)).toEqual(emptyCiState());
    expect(rankFixContext(null, "C", null)).toEqual([]);
  });

  it("is deterministic", () => {
    let s = emptyCiState();
    s = recordFixEpisode(s, ep("C", ["a"], true));
    s = recordFixEpisode(s, ep("C", ["a"], false));
    expect(rankFixContext(s, "C", ["a", "b"])).toEqual(rankFixContext(s, "C", ["a", "b"]));
  });
});

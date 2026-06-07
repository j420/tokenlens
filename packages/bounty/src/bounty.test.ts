import { describe, it, expect } from "vitest";
import { evaluateBounty, type BountySubmission } from "./bounty.js";

function sub(
  id: string,
  submitter: string,
  costTokens: number,
  passedGate: boolean,
  costUsd?: number | null
): BountySubmission {
  return { id, submitter, costTokens, passedGate, costUsd };
}

describe("evaluateBounty", () => {
  it("picks the cheapest gate-PASSING submission (min-cost s.t. quality)", () => {
    const r = evaluateBounty([
      sub("s1", "alice", 1000, true, 0.05),
      sub("s2", "bob", 600, true, 0.03), // cheapest passer
      sub("s3", "carol", 200, false, 0.01), // cheaper but FAILED the gate
    ]);
    expect(r.winner!.id).toBe("s2");
    expect(r.basis).toBe("usd");
    expect(r.rejected).toEqual(["s3"]);
    expect(r.ranked.map((x) => x.id)).toEqual(["s2", "s1"]);
  });

  it("never picks a failing submission even if it is the cheapest overall", () => {
    const r = evaluateBounty([
      sub("cheap", "a", 10, false, 0.001),
      sub("ok", "b", 999, true, 0.5),
    ]);
    expect(r.winner!.id).toBe("ok");
  });

  it("returns no winner when nothing passed the gate", () => {
    const r = evaluateBounty([sub("a", "x", 10, false), sub("b", "y", 20, false)]);
    expect(r.winner).toBeNull();
    expect(r.basis).toBe("none");
    expect(r.rejected).toEqual(["a", "b"]);
  });

  it("falls back to TOKEN basis when any passer is unpriced", () => {
    const r = evaluateBounty([
      sub("s1", "a", 1000, true, 0.05),
      sub("s2", "b", 400, true, null), // unpriced → token basis
    ]);
    expect(r.basis).toBe("tokens");
    expect(r.winner!.id).toBe("s2"); // fewer tokens
  });

  it("computes USD savings vs a supplied incumbent", () => {
    const r = evaluateBounty([sub("s1", "a", 600, true, 0.03)], { incumbentCostUsd: 0.1 });
    expect(r.savings).toBeCloseTo(0.07, 9);
  });

  it("computes token savings vs an incumbent on the token basis", () => {
    const r = evaluateBounty([sub("s1", "a", 600, true, null)], { incumbentCostTokens: 1000 });
    expect(r.basis).toBe("tokens");
    expect(r.savings).toBe(400);
  });

  it("leaves savings null when no incumbent is supplied", () => {
    expect(evaluateBounty([sub("s1", "a", 600, true, 0.03)]).savings).toBeNull();
  });

  it("breaks cost ties deterministically by (submitter, id)", () => {
    const r = evaluateBounty([
      sub("z", "bob", 500, true, 0.02),
      sub("a", "bob", 500, true, 0.02),
      sub("m", "alice", 500, true, 0.02),
    ]);
    // same cost → alice before bob; within bob, id 'a' before 'z'
    expect(r.ranked.map((x) => x.id)).toEqual(["m", "a", "z"]);
    expect(r.winner!.id).toBe("m");
  });

  it("skips malformed submissions and is total on garbage", () => {
    const r = evaluateBounty([sub("s1", "a", 600, true, 0.03), { id: "x" }, null] as unknown);
    expect(r.skipped).toBe(2);
    expect(evaluateBounty(null).winner).toBeNull();
  });

  it("treats a NaN cost as unpriced (no nondeterministic winner from garbage)", () => {
    const subs = [
      sub("x", "a", 100, true, NaN), // garbage cost
      sub("y", "b", 50, true, 0.5),
      sub("z", "c", 20, true, 0.2),
    ];
    const fwd = evaluateBounty(subs);
    const rev = evaluateBounty([...subs].reverse());
    // any NaN price ⇒ token basis ⇒ deterministic, and the NaN submission
    // (100 tok) never wins on tokens.
    expect(fwd.basis).toBe("tokens");
    expect(fwd.winner!.id).toBe(rev.winner!.id); // deterministic regardless of order
    expect(fwd.winner!.id).toBe("z"); // fewest tokens
  });

  it("is deterministic", () => {
    const subs = [sub("s1", "a", 600, true, 0.03), sub("s2", "b", 400, true, 0.02)];
    expect(evaluateBounty(subs)).toEqual(evaluateBounty(subs));
  });
});

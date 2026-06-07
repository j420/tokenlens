import { describe, it, expect } from "vitest";
import { assessWriters, type WriteEvent } from "./poison.js";

function evts(writerId: string, n: number, rejected: number, collisions = 0): WriteEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    writerId,
    equivalenceRejected: i < rejected,
    nearKeyCollision: i < collisions,
  }));
}

describe("assessWriters", () => {
  it("quarantines a writer whose equivalence-rejection rate exceeds the threshold", () => {
    const r = assessWriters(evts("attacker", 10, 6), { rejectionThreshold: 0.3 });
    const w = r.writers.find((x) => x.writerId === "attacker")!;
    expect(w.rejectionRate).toBeCloseTo(0.6);
    expect(w.quarantine).toBe(true);
    expect(w.reason).toBe("high-rejection-rate");
    expect(r.quarantined).toEqual(["attacker"]);
  });

  it("quarantines on a high near-key-collision rate too", () => {
    const r = assessWriters(evts("collider", 10, 0, 5), { collisionThreshold: 0.3 });
    const w = r.writers[0]!;
    expect(w.reason).toBe("high-collision-rate");
    expect(w.quarantine).toBe(true);
  });

  it("does NOT quarantine a clean writer", () => {
    const r = assessWriters(evts("alice", 10, 1));
    expect(r.writers[0]!.quarantine).toBe(false);
    expect(r.quarantined).toEqual([]);
  });

  it("does not quarantine below the minimum write count (insufficient evidence)", () => {
    const r = assessWriters(evts("new", 3, 3), { minWrites: 5 });
    const w = r.writers[0]!;
    expect(w.rejectionRate).toBe(1);
    expect(w.quarantine).toBe(false);
    expect(w.reason).toBe("below-min-writes");
  });

  it("attributes harm per writer (one bad writer does not taint a clean one)", () => {
    const r = assessWriters([...evts("bad", 10, 8), ...evts("good", 10, 0)]);
    expect(r.quarantined).toEqual(["bad"]);
    expect(r.writers.find((w) => w.writerId === "good")!.quarantine).toBe(false);
    // worst-first ordering
    expect(r.writers[0]!.writerId).toBe("bad");
  });

  it("skips malformed events and is total on garbage", () => {
    const r = assessWriters([{ writerId: "a", equivalenceRejected: true }, { writerId: "x" }, null] as unknown);
    expect(r.skipped).toBe(2);
    expect(assessWriters(null).writers).toEqual([]);
  });

  it("is deterministic", () => {
    const e = evts("a", 10, 5);
    expect(assessWriters(e)).toEqual(assessWriters(e));
  });
});

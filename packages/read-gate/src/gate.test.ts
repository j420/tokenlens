import { describe, expect, it } from "vitest";
import {
  advanceEpoch,
  emptyResidentSet,
  evaluateRead,
  recordRead,
  stepReadGate,
} from "./gate.js";
import type { ReadRequest } from "./types.js";

function req(over: Partial<ReadRequest> = {}): ReadRequest {
  return {
    path: "src/a.ts",
    contentHash: "hash-1",
    turn: 1,
    tokens: 2400,
    epoch: 0,
    ...over,
  };
}

describe("evaluateRead — soundness", () => {
  it("allows a first read (not resident)", () => {
    const v = evaluateRead(emptyResidentSet(), req());
    expect(v.decision).toBe("allow");
    expect(v.reason).toBe("not_resident");
  });

  it("denies an exact re-read in the same epoch (zero info loss)", () => {
    const set = recordRead(emptyResidentSet(), req({ turn: 1 }));
    const v = evaluateRead(set, req({ turn: 5 }));
    expect(v.decision).toBe("deny");
    expect(v.reason).toBe("already_resident");
    expect(v.reclaimedTokens).toBe(2400);
    expect(v.firstReadTurn).toBe(1);
  });

  it("ALLOWS when the content changed (different hash)", () => {
    const set = recordRead(emptyResidentSet(), req({ contentHash: "hash-1" }));
    const v = evaluateRead(set, req({ contentHash: "hash-2" }));
    expect(v.decision).toBe("allow");
    expect(v.reason).toBe("content_changed");
  });

  it("ALLOWS across a compaction boundary (epoch advanced)", () => {
    const set = recordRead(emptyResidentSet(0), req({ epoch: 0 }));
    const v = evaluateRead(set, req({ epoch: 1 }));
    expect(v.decision).toBe("allow");
    expect(v.reason).toBe("epoch_advanced");
  });

  it("never denies on allow — reclaimedTokens is 0", () => {
    const v = evaluateRead(emptyResidentSet(), req());
    expect(v.reclaimedTokens).toBe(0);
    expect(v.firstReadTurn).toBeNull();
  });
});

describe("recordRead — state transitions", () => {
  it("does not mutate the input set", () => {
    const set = emptyResidentSet();
    const next = recordRead(set, req());
    expect(set.entries).toEqual({});
    expect(next.entries["src/a.ts"]).toBeDefined();
  });

  it("clears residency when the epoch advances", () => {
    const set = recordRead(emptyResidentSet(0), req({ epoch: 0, path: "x.ts" }));
    const next = recordRead(set, req({ epoch: 1, path: "y.ts" }));
    expect(next.epoch).toBe(1);
    expect(next.entries["x.ts"]).toBeUndefined();
    expect(next.entries["y.ts"]).toBeDefined();
  });

  it("ignores a stale (older-epoch) request", () => {
    const set = advanceEpoch(emptyResidentSet(0), 2);
    const next = recordRead(set, req({ epoch: 1 }));
    expect(next).toBe(set);
  });

  it("keeps the original turn for an unchanged re-read", () => {
    let set = recordRead(emptyResidentSet(), req({ turn: 3, contentHash: "h" }));
    set = recordRead(set, req({ turn: 9, contentHash: "h" }));
    expect(set.entries["src/a.ts"].turn).toBe(3);
  });

  it("updates the turn when the content changed", () => {
    let set = recordRead(emptyResidentSet(), req({ turn: 3, contentHash: "h1" }));
    set = recordRead(set, req({ turn: 9, contentHash: "h2" }));
    expect(set.entries["src/a.ts"].turn).toBe(9);
  });
});

describe("stepReadGate", () => {
  it("evaluates and records atomically", () => {
    const { verdict, set } = stepReadGate(emptyResidentSet(), req());
    expect(verdict.decision).toBe("allow");
    expect(set.entries["src/a.ts"]).toBeDefined();
    // Second step now denies.
    const second = stepReadGate(set, req({ turn: 7 }));
    expect(second.verdict.decision).toBe("deny");
  });
});

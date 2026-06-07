import { describe, it, expect } from "vitest";
import { emptyFleetCache, putResolved, getResolved, type ResolvedEntry } from "./cache.js";

function entry(over: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    answerRef: "ans-1",
    depShas: { "auth.ts": "sha-a", "session.ts": "sha-b" },
    resolver: "alice",
    resolvedAtIso: "2026-06-01T00:00:00Z",
    ...over,
  };
}

describe("fleet-cache", () => {
  it("serves a fresh hit when every dependency SHA is unchanged", () => {
    const c = putResolved(emptyFleetCache(), "how-auth-works", entry());
    const r = getResolved(c, "how-auth-works", { "auth.ts": "sha-a", "session.ts": "sha-b" });
    expect(r.hit).toBe(true);
    expect(r.reason).toBe("fresh");
    expect(r.entry!.answerRef).toBe("ans-1");
  });

  it("misses a key that was never resolved", () => {
    const r = getResolved(emptyFleetCache(), "unknown", {});
    expect(r.hit).toBe(false);
    expect(r.reason).toBe("miss");
  });

  it("goes stale and EVICTS when a dependency SHA changed", () => {
    const c = putResolved(emptyFleetCache(), "k", entry());
    const r = getResolved(c, "k", { "auth.ts": "sha-CHANGED", "session.ts": "sha-b" });
    expect(r.hit).toBe(false);
    expect(r.reason).toBe("stale-deps");
    expect(r.staleDeps).toEqual(["auth.ts"]);
    // evicted from the returned cache → a subsequent lookup is a clean miss
    expect(getResolved(r.cache, "k", { "auth.ts": "sha-CHANGED", "session.ts": "sha-b" }).reason).toBe("miss");
  });

  it("treats a missing current dep SHA as stale", () => {
    const c = putResolved(emptyFleetCache(), "k", entry());
    const r = getResolved(c, "k", { "auth.ts": "sha-a" }); // session.ts absent
    expect(r.reason).toBe("stale-deps");
    expect(r.staleDeps).toEqual(["session.ts"]);
  });

  it("does not mutate the input cache on eviction (immutable)", () => {
    const c = putResolved(emptyFleetCache(), "k", entry());
    getResolved(c, "k", { "auth.ts": "x" });
    // original cache still has the entry
    expect(getResolved(c, "k", { "auth.ts": "sha-a", "session.ts": "sha-b" }).hit).toBe(true);
  });

  it("rejects malformed entries on put and is total on garbage", () => {
    const c = putResolved(emptyFleetCache(), "k", { answerRef: "x" }); // missing depShas
    expect(getResolved(c, "k", {}).reason).toBe("miss");
    expect(putResolved(null, "", null)).toEqual(emptyFleetCache());
    expect(getResolved(null, "k", null).reason).toBe("miss");
  });

  it("round-trips through JSON", () => {
    const c = putResolved(emptyFleetCache(), "k", entry());
    const round = JSON.parse(JSON.stringify(c));
    expect(getResolved(round, "k", { "auth.ts": "sha-a", "session.ts": "sha-b" }).hit).toBe(true);
  });

  it("is deterministic", () => {
    const c = putResolved(emptyFleetCache(), "k", entry());
    const cur = { "auth.ts": "sha-a", "session.ts": "sha-b" };
    expect(getResolved(c, "k", cur)).toEqual(getResolved(c, "k", cur));
  });
});

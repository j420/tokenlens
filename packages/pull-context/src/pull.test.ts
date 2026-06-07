import { describe, it, expect } from "vitest";
import { buildManifest, resolvePull, type PullSymbol } from "./pull.js";

function sym(id: string, signatureTokens: number, bodyTokens: number, over: Partial<PullSymbol> = {}): PullSymbol {
  return { id, signatureTokens, bodyTokens, ...over };
}

const SYMS: PullSymbol[] = [
  sym("a", 10, 400, { deps: ["t"] }),
  sym("b", 10, 400),
  sym("c", 10, 400),
  sym("t", 8, 100), // a's return type (mandatory dep)
  sym("crit", 10, 500, { critical: true }),
];

describe("buildManifest", () => {
  it("sums signature and body tokens", () => {
    const m = buildManifest(SYMS);
    expect(m.symbolCount).toBe(5);
    expect(m.manifestTokens).toBe(48); // 10+10+10+8+10
    expect(m.pushBaselineTokens).toBe(1800); // 400*3+100+500
    expect(m.ids).toContain("a");
  });
});

describe("resolvePull", () => {
  it("pulls only requested bodies + transitive deps when that beats push", () => {
    const r = resolvePull(SYMS, ["a"]);
    expect(r.decision).toBe("pull");
    // a + its dep t auto-included
    expect(r.injectedIds).toEqual(["a", "t"]);
    expect(r.injectedBodyTokens).toBe(500); // 400 + 100
    expect(r.pullCostTokens).toBe(48 + 500); // manifest + injected
    expect(r.savedTokens).toBe(1800 - 548);
  });

  it("auto-includes transitive (multi-hop) mandatory deps", () => {
    const syms = [
      sym("a", 5, 100, { deps: ["b"] }),
      sym("b", 5, 100, { deps: ["c"] }),
      sym("c", 5, 100),
      sym("filler", 5, 5000),
    ];
    // reFetchBufferTokens:0 isolates the closure logic from the economics gate.
    const r = resolvePull(syms, ["a"], { reFetchBufferTokens: 0 });
    expect(r.injectedIds).toEqual(["a", "b", "c"]);
  });

  it("surfaces an omitted critical symbol as a coverage-floor candidate", () => {
    const r = resolvePull(SYMS, ["a"]);
    expect(r.candidateIds).toEqual(["crit"]); // critical, not requested/closed
  });

  it("does not list a critical as a candidate if it was pulled in", () => {
    const r = resolvePull(SYMS, ["crit"]);
    expect(r.candidateIds).toEqual([]);
    expect(r.injectedIds).toContain("crit");
  });

  it("declines to push when the margin can't absorb one re-fetch", () => {
    // Two equal symbols; requesting one leaves the other as the re-fetch buffer,
    // so pull cost + buffer == push cost → not strictly less → push.
    const syms = [sym("a", 10, 100), sym("b", 10, 100)];
    const r = resolvePull(syms, ["a"]);
    expect(r.decision).toBe("push");
    expect(r.reason).toBe("margin-too-thin");
    expect(r.savedTokens).toBe(0);
    expect(r.reFetchBufferTokens).toBe(100); // the non-injected body
  });

  it("uses a caller-supplied re-fetch buffer when provided", () => {
    const syms = [sym("a", 10, 100), sym("b", 10, 100)];
    // buffer 0 → pull cost (20+100=120) < push (200) → pull
    const r = resolvePull(syms, ["a"], { reFetchBufferTokens: 0 });
    expect(r.decision).toBe("pull");
  });

  it("drops unknown requested ids (fail-safe), still resolving the rest", () => {
    const syms = [sym("a", 5, 100), sym("filler", 5, 9000)];
    const r = resolvePull(syms, ["a", "ghost"], { reFetchBufferTokens: 0 });
    expect(r.droppedIds).toEqual(["ghost"]);
    expect(r.injectedIds).toEqual(["a"]);
    expect(r.decision).toBe("pull");
  });

  it("falls back to push on a malformed (non-array) FETCH request", () => {
    const r = resolvePull(SYMS, "not-an-array" as unknown);
    expect(r.decision).toBe("push");
    expect(r.reason).toBe("malformed-fell-back-to-push");
    expect(r.injectedIds.length).toBe(5); // everything
  });

  it("is cycle-safe in the dependency closure", () => {
    const syms = [
      sym("a", 5, 100, { deps: ["b"] }),
      sym("b", 5, 100, { deps: ["a"] }), // cycle
      sym("filler", 5, 9000),
    ];
    const r = resolvePull(syms, ["a"], { reFetchBufferTokens: 0 });
    expect(r.injectedIds).toEqual(["a", "b"]);
  });

  it("ignores dangling deps that point at unknown symbols", () => {
    const syms = [sym("a", 5, 100, { deps: ["ghost"] }), sym("filler", 5, 9000)];
    const r = resolvePull(syms, ["a"], { reFetchBufferTokens: 0 });
    expect(r.injectedIds).toEqual(["a"]);
  });

  it("is total on garbage and deterministic", () => {
    expect(resolvePull(null, null).decision).toBe("push");
    expect(buildManifest("nope" as unknown).symbolCount).toBe(0);
    expect(resolvePull(SYMS, ["a"])).toEqual(resolvePull(SYMS, ["a"]));
  });
});

import { describe, expect, it } from "vitest";

import { computeDivergence, timelinesIdentical } from "./divergence.js";
import { GENESIS_HASH } from "./segment.js";
import { canonicalSession, seg, timeline } from "./test-helpers.js";

describe("computeDivergence", () => {
  it("returns null divergence for byte-identical timelines", () => {
    const a = canonicalSession();
    const b = canonicalSession();
    const d = computeDivergence(a, b);
    expect(d.divergenceIndex).toBeNull();
    expect(d.sharedSegmentCount).toBe(5);
    expect(d.divergedTailTokensIn).toBe(0);
    expect(d.divergedTailTokensOut).toBe(0);
  });

  it("finds the first differing segment", () => {
    const a = timeline([seg("system", "S", 10), seg("user", "Q1", 5), seg("assistant", "A1", 8, 8)]);
    const b = timeline([seg("system", "S", 10), seg("user", "Q2", 5), seg("assistant", "A1", 8, 8)]);
    const d = computeDivergence(a, b);
    expect(d.divergenceIndex).toBe(1);
    expect(d.sharedSegmentCount).toBe(1);
    expect(d.sharedPrefixTokensIn).toBe(10);
    // tail in modified = seg1(5) + seg2(8) = 13 in; out = 0 + 8 = 8
    expect(d.divergedTailTokensIn).toBe(13);
    expect(d.divergedTailTokensOut).toBe(8);
  });

  it("divergence at index 0 when the system block changes", () => {
    const a = timeline([seg("system", "S1", 10), seg("user", "Q", 5)]);
    const b = timeline([seg("system", "S2", 10), seg("user", "Q", 5)]);
    const d = computeDivergence(a, b);
    expect(d.divergenceIndex).toBe(0);
    expect(d.sharedSegmentCount).toBe(0);
    expect(d.sharedPrefixTokensIn).toBe(0);
    expect(d.sharedPrefixHash).toBe(GENESIS_HASH);
  });

  it("treats a strict-prefix-shorter modified timeline as divergence at the boundary", () => {
    const a = timeline([seg("system", "S", 10), seg("user", "Q", 5), seg("assistant", "A", 8, 8)]);
    const b = timeline([seg("system", "S", 10), seg("user", "Q", 5)]);
    const d = computeDivergence(a, b);
    expect(d.divergenceIndex).toBe(2);
    expect(d.sharedSegmentCount).toBe(2);
    // modified has no tail beyond the shared region
    expect(d.divergedTailTokensIn).toBe(0);
  });

  it("treats a longer modified timeline (appended segment) as divergence at the boundary", () => {
    const a = timeline([seg("system", "S", 10), seg("user", "Q", 5)]);
    const b = timeline([seg("system", "S", 10), seg("user", "Q", 5), seg("assistant", "A", 8, 8)]);
    const d = computeDivergence(a, b);
    expect(d.divergenceIndex).toBe(2);
    expect(d.sharedSegmentCount).toBe(2);
    expect(d.divergedTailTokensIn).toBe(8);
    expect(d.divergedTailTokensOut).toBe(8);
  });

  it("sharedPrefixHash is the last shared segment's prefixHash", () => {
    const a = canonicalSession();
    const b = timeline([
      seg("system", "SYS", 2000, 0),
      seg("user", "Q1", 500, 0),
      seg("assistant", "A1", 800, 800),
      seg("user", "CHANGED", 300, 0),
      seg("assistant", "A2", 1000, 1000),
    ]);
    const d = computeDivergence(a, b);
    expect(d.divergenceIndex).toBe(3);
    expect(d.sharedPrefixHash).toBe(a.segments[2]!.prefixHash);
  });

  it("two empty timelines have no divergence", () => {
    const d = computeDivergence(timeline([]), timeline([]));
    expect(d.divergenceIndex).toBeNull();
    expect(d.sharedSegmentCount).toBe(0);
    expect(d.sharedPrefixHash).toBe(GENESIS_HASH);
  });
});

describe("timelinesIdentical", () => {
  it("true for equal sessions", () => {
    expect(timelinesIdentical(canonicalSession(), canonicalSession())).toBe(true);
  });
  it("false when a segment differs", () => {
    const b = timeline([
      seg("system", "SYS", 2000, 0),
      seg("user", "Q1", 500, 0),
      seg("assistant", "A1", 800, 800),
      seg("user", "DIFFERENT", 300, 0),
      seg("assistant", "A2", 1000, 1000),
    ]);
    expect(timelinesIdentical(canonicalSession(), b)).toBe(false);
  });
  it("false when lengths differ even if the prefix matches", () => {
    const a = timeline([seg("system", "S", 10)]);
    const b = timeline([seg("system", "S", 10), seg("user", "Q", 5)]);
    expect(timelinesIdentical(a, b)).toBe(false);
  });
});

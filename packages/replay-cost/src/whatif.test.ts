import { describe, expect, it } from "vitest";

import {
  applyMutation,
  planReplay,
  WhatIfEngine,
  type TailReplayer,
} from "./whatif.js";
import { computeDivergence } from "./divergence.js";
import { canonicalSession } from "./test-helpers.js";

describe("applyMutation", () => {
  it("changes only the targeted segment's payload", () => {
    const original = canonicalSession();
    const { modified } = applyMutation(original, {
      atIndex: 3,
      newPayload: { role: "user", content: "NEW" },
    });
    expect(modified.segments[3]!.payload).toEqual({ role: "user", content: "NEW" });
    // Segments 0..2 are byte-identical (same content hash).
    for (let i = 0; i < 3; i++) {
      expect(modified.segments[i]!.contentHash).toBe(original.segments[i]!.contentHash);
    }
    // Segment 3 hash changed.
    expect(modified.segments[3]!.contentHash).not.toBe(original.segments[3]!.contentHash);
  });

  it("reuses original tokensIn when newTokensIn omitted", () => {
    const original = canonicalSession();
    const { modified, reusedOriginalTokens } = applyMutation(original, {
      atIndex: 3,
      newPayload: { role: "user", content: "NEW" },
    });
    expect(reusedOriginalTokens).toBe(true);
    expect(modified.segments[3]!.tokensIn).toBe(original.segments[3]!.tokensIn);
  });

  it("applies newTokensIn when supplied", () => {
    const original = canonicalSession();
    const { modified, reusedOriginalTokens } = applyMutation(original, {
      atIndex: 3,
      newPayload: { role: "user", content: "NEW" },
      newTokensIn: 777,
    });
    expect(reusedOriginalTokens).toBe(false);
    expect(modified.segments[3]!.tokensIn).toBe(777);
  });

  it("preserves the mutated segment's role and tokensOut", () => {
    const original = canonicalSession();
    const { modified } = applyMutation(original, {
      atIndex: 4,
      newPayload: { role: "assistant", content: "rewritten" },
    });
    expect(modified.segments[4]!.role).toBe("assistant");
    expect(modified.segments[4]!.tokensOut).toBe(original.segments[4]!.tokensOut);
  });

  it("throws on out-of-range index", () => {
    const original = canonicalSession();
    expect(() => applyMutation(original, { atIndex: 99, newPayload: {} })).toThrow(/out of range/);
    expect(() => applyMutation(original, { atIndex: -1, newPayload: {} })).toThrow(/out of range/);
  });

  it("throws on a non-integer index", () => {
    expect(() =>
      applyMutation(canonicalSession(), { atIndex: 1.5, newPayload: {} })
    ).toThrow(/out of range/);
  });

  it("throws on a negative newTokensIn", () => {
    expect(() =>
      applyMutation(canonicalSession(), { atIndex: 3, newPayload: {}, newTokensIn: -5 })
    ).toThrow(/must be finite and non-negative/);
  });
});

describe("planReplay", () => {
  it("produces a consistent divergence + cost end to end", () => {
    const original = canonicalSession();
    const plan = planReplay(original, { atIndex: 3, newPayload: { role: "user", content: "z" } });
    expect(plan.divergence.divergenceIndex).toBe(3);
    expect(plan.modified.segments.length).toBe(5);
    // The embedded divergence equals a fresh recomputation.
    expect(plan.divergence).toEqual(computeDivergence(original, plan.modified));
  });

  it("is deterministic — same baseline + mutation ⇒ identical plan", () => {
    const original = canonicalSession();
    const m = { atIndex: 3, newPayload: { role: "user", content: "z" } };
    expect(planReplay(original, m)).toEqual(planReplay(original, m));
  });

  it("mutating segment 0 yields zero shared prefix", () => {
    const original = canonicalSession();
    const plan = planReplay(original, { atIndex: 0, newPayload: { role: "system", content: "NEW SYS" } });
    expect(plan.divergence.divergenceIndex).toBe(0);
    expect(plan.cost.sharedPrefixTokensIn).toBe(0);
  });
});

describe("WhatIfEngine", () => {
  it("plans against a fixed baseline", () => {
    const engine = new WhatIfEngine(canonicalSession());
    const plan = engine.plan({ atIndex: 3, newPayload: { role: "user", content: "z" } });
    expect(plan.divergence.divergenceIndex).toBe(3);
    expect(engine.baseline.segments.length).toBe(5);
  });

  it("execute() routes the diverged tail to the caller-supplied replayer", async () => {
    const engine = new WhatIfEngine(canonicalSession());
    const plan = engine.plan({ atIndex: 3, newPayload: { role: "user", content: "z" } });
    let seenIndex = -1;
    const replayer: TailReplayer = async ({ divergenceIndex }) => {
      seenIndex = divergenceIndex;
      return "regenerated tail output";
    };
    const out = await engine.execute(plan, replayer);
    expect(out).toBe("regenerated tail output");
    expect(seenIndex).toBe(3);
  });

  it("execute() falls back to timeline length when there is no divergence", async () => {
    const engine = new WhatIfEngine(canonicalSession());
    // A no-op mutation: replace segment 3 with byte-identical payload.
    const original = engine.baseline;
    const samePayload = original.segments[3]!.payload;
    const plan = engine.plan({ atIndex: 3, newPayload: samePayload });
    expect(plan.divergence.divergenceIndex).toBeNull();
    let seenIndex = -1;
    await engine.execute(plan, async ({ divergenceIndex }) => {
      seenIndex = divergenceIndex;
      return "";
    });
    expect(seenIndex).toBe(plan.modified.segments.length);
  });
});

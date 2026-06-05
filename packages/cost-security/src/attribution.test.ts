import { describe, expect, it } from "vitest";
import { attributeDownstreamCost } from "./attribution.js";

describe("attributeDownstreamCost — fail-safe input handling", () => {
  it("returns allow for garbage input without throwing", () => {
    for (const bad of [undefined, null, 42, "x", true, {}, { sources: "no" }]) {
      const r = attributeDownstreamCost(bad as unknown);
      expect(r.verdict).toBe("allow");
      expect(r.findings).toEqual([]);
      expect(r.flaggedDownstreamTokens).toBe(0);
    }
  });

  it("skips malformed sources/actions", () => {
    const r = attributeDownstreamCost({
      sources: [{ id: "f", kind: "file", tokens: 100 }, { nope: 1 }, { id: "", tokens: 5 }],
      actions: [{ sourceId: "f", tokens: 5000 }, { bad: true }],
    });
    expect(r.findings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("attributeDownstreamCost — amplification detection", () => {
  it("quarantines an untrusted source that drove a read-everything cascade", () => {
    const r = attributeDownstreamCost({
      sources: [{ id: "poison.md", kind: "file", tokens: 200 }],
      actions: [
        { sourceId: "poison.md", tokens: 9000 },
        { sourceId: "poison.md", tokens: 9000 },
      ],
    });
    expect(r.verdict).toBe("warn");
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0]!;
    expect(f.sourceId).toBe("poison.md");
    expect(f.downstreamTokens).toBe(18000);
    expect(f.amplification).toBe(90); // 18000 / 200
    expect(f.recommend).toBe("quarantine");
  });

  it("never flags a user-authored / trusted source (large legit refactor)", () => {
    const r = attributeDownstreamCost({
      sources: [
        { id: "my-prompt", kind: "user", tokens: 50 },
        { id: "trusted.ts", kind: "file", tokens: 100, trusted: true },
      ],
      actions: [
        { sourceId: "my-prompt", tokens: 50000 },
        { sourceId: "trusted.ts", tokens: 50000 },
      ],
    });
    expect(r.verdict).toBe("allow");
    expect(r.findings).toEqual([]);
  });

  it("does not flag a high ratio below the absolute downstream floor (cheap)", () => {
    const r = attributeDownstreamCost({
      sources: [{ id: "tiny", kind: "mcp", tokens: 10 }],
      actions: [{ sourceId: "tiny", tokens: 500 }], // 50x ratio but only 500 tokens
    });
    // ratio clears threshold (watch) but absolute spend is below floor -> no quarantine
    expect(r.verdict).toBe("allow");
    expect(r.findings[0]?.recommend).toBe("watch");
  });

  it("does not flag a source whose downstream spend is proportionate", () => {
    const r = attributeDownstreamCost({
      sources: [{ id: "normal.ts", kind: "file", tokens: 5000 }],
      actions: [{ sourceId: "normal.ts", tokens: 6000 }], // ~1.2x
    });
    expect(r.verdict).toBe("allow");
    expect(r.findings).toEqual([]);
  });
});

describe("attributeDownstreamCost — honest pricing", () => {
  it("prices flagged spend for a known model, null for an unknown one", () => {
    const ledger = {
      sources: [{ id: "p", kind: "file" as const, tokens: 100 }],
      actions: [{ sourceId: "p", tokens: 20000 }],
    };
    const priced = attributeDownstreamCost(ledger, { model: "gpt-4o" });
    expect(priced.findings[0]!.estimatedCostUsd).not.toBeNull();
    expect(priced.findings[0]!.estimatedCostUsd!).toBeGreaterThan(0);

    const unpriced = attributeDownstreamCost(ledger, { model: "no-such-model" });
    expect(unpriced.findings[0]!.estimatedCostUsd).toBeNull();
  });
});

describe("attributeDownstreamCost — deterministic", () => {
  it("same ledger yields an identical report", () => {
    const ledger = {
      sources: [{ id: "p", kind: "file" as const, tokens: 100 }],
      actions: [{ sourceId: "p", tokens: 20000 }],
    };
    expect(attributeDownstreamCost(ledger)).toEqual(attributeDownstreamCost(ledger));
  });
});

import { describe, it, expect } from "vitest";
import { buildLspGraphPayload, type LspIndex, type LspSymbol } from "./lsp-graph.js";

function sym(id: string, tokens: number, over: Partial<LspSymbol> = {}): LspSymbol {
  return { id, name: id, kind: "function", path: `/${id}.ts`, tokens, signature: `function ${id}()`, ...over };
}

describe("buildLspGraphPayload", () => {
  it("includes symbols ordered by reference in-degree (most depended-on first)", () => {
    const index: LspIndex = {
      symbols: [sym("a", 10), sym("b", 10), sym("hub", 10)],
      references: [
        { from: "a", to: "hub" },
        { from: "b", to: "hub" },
        { from: "a", to: "b" },
      ],
    };
    const p = buildLspGraphPayload(index);
    // hub in-degree 2, b in-degree 1, a in-degree 0
    expect(p.included.map((s) => s.id)).toEqual(["hub", "b", "a"]);
    expect(p.included[0]!.inDegree).toBe(2);
  });

  it("dedups in-degree by distinct source (repeated call sites don't inflate it)", () => {
    const index: LspIndex = {
      symbols: [sym("a", 10), sym("t", 10)],
      references: [
        { from: "a", to: "t" },
        { from: "a", to: "t" }, // same source again
      ],
    };
    expect(buildLspGraphPayload(index).included.find((s) => s.id === "t")!.inDegree).toBe(1);
  });

  it("respects the token budget, dropping the lowest-priority symbols", () => {
    const index: LspIndex = {
      symbols: [sym("hub", 60), sym("a", 60), sym("b", 60)],
      references: [{ from: "a", to: "hub" }, { from: "b", to: "hub" }],
    };
    const p = buildLspGraphPayload(index, { maxTokens: 120 });
    // hub (deg 2) + one of a/b (deg 0, tie broken by id 'a') fit; the third drops
    expect(p.payloadTokens).toBe(120);
    expect(p.included.map((s) => s.id)).toEqual(["hub", "a"]);
    expect(p.dropped.map((s) => s.id)).toEqual(["b"]);
  });

  it("keeps only edges whose both endpoints survived selection", () => {
    const index: LspIndex = {
      symbols: [sym("hub", 60), sym("a", 60), sym("b", 60)],
      references: [{ from: "a", to: "hub" }, { from: "b", to: "hub" }],
    };
    const p = buildLspGraphPayload(index, { maxTokens: 120 }); // b dropped
    // edge a->hub survives; edge b->hub is pruned (b not included)
    expect(p.edges).toEqual([{ from: "a", to: "hub" }]);
  });

  it("computes savedTokens vs a caller-supplied full-context baseline", () => {
    const index: LspIndex = { symbols: [sym("a", 50), sym("b", 50)], references: [] };
    const p = buildLspGraphPayload(index, { fullContextTokens: 5000 });
    expect(p.payloadTokens).toBe(100);
    expect(p.savedTokens).toBe(4900);
  });

  it("leaves savedTokens null when no baseline is supplied (no fabrication)", () => {
    const p = buildLspGraphPayload({ symbols: [sym("a", 50)], references: [] });
    expect(p.savedTokens).toBeNull();
    expect(p.fullContextTokens).toBeNull();
  });

  it("never reports a negative saving", () => {
    const index: LspIndex = { symbols: [sym("a", 5000)], references: [] };
    const p = buildLspGraphPayload(index, { fullContextTokens: 100 });
    expect(p.savedTokens).toBeNull(); // payload bigger than baseline → no saving
  });

  it("drops dangling edges that point at unknown symbols", () => {
    const index = {
      symbols: [sym("a", 10)],
      references: [{ from: "a", to: "ghost" }, { from: "ghost", to: "a" }],
    };
    const p = buildLspGraphPayload(index as unknown);
    expect(p.edges).toEqual([]);
    expect(p.included[0]!.inDegree).toBe(0);
  });

  it("skips malformed symbols and references", () => {
    const index = {
      symbols: [sym("a", 10), { id: "bad" }, { id: "x", name: "x", kind: "nope", path: "/x", tokens: 1 }, null],
      references: [{ from: "a" }, 42, { from: "a", to: "a" }],
    };
    const p = buildLspGraphPayload(index as unknown);
    expect(p.included.map((s) => s.id)).toEqual(["a"]);
    expect(p.skipped).toBeGreaterThanOrEqual(3);
  });

  it("is total on garbage input", () => {
    expect(buildLspGraphPayload(null).included).toEqual([]);
    expect(buildLspGraphPayload("nope" as unknown).payloadTokens).toBe(0);
    expect(buildLspGraphPayload({ symbols: "x", references: 3 } as unknown).included).toEqual([]);
  });

  it("is deterministic", () => {
    const index: LspIndex = {
      symbols: [sym("a", 10), sym("b", 20)],
      references: [{ from: "a", to: "b" }],
    };
    expect(buildLspGraphPayload(index)).toEqual(buildLspGraphPayload(index));
  });
});

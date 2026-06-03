import { describe, expect, it } from "vitest";

import { compareOutputs } from "./equivalence-gate.js";

describe("compareOutputs", () => {
  it("reports no_change for byte-identical outputs", () => {
    const r = compareOutputs("hello world", "hello world");
    expect(r.verdict).toBe("no_change");
    expect(r.equivalent).toBe(true);
    expect(r.similarity).toBe(1);
  });

  it("reports no_change for code that differs only in whitespace/formatting", () => {
    // The equivalence dispatcher uses literal identifier mode (the ship-safe
    // default), so structurally-identical code with different formatting is
    // AST-equivalent — exactly the property a replay wants ("the model
    // reformatted the same answer; that's a no-op").
    const a = "function add(a, b) { return a + b; }";
    const b = "function add(a,b){\n  return a + b;\n}";
    const r = compareOutputs(a, b, { asCode: true });
    expect(r.strategy).toBe("ast");
    expect(r.verdict).toBe("no_change");
  });

  it("reports changed when identifiers differ (literal mode is the ship-safe default)", () => {
    // Alpha-renaming is opt-in in @prune/equivalence and NOT enabled by the
    // dispatcher, so a renamed parameter is a real change to the replay gate.
    const a = "function add(a, b) { return a + b; }";
    const b = "function add(x, y) { return x + y; }";
    const r = compareOutputs(a, b, { asCode: true });
    expect(r.verdict).toBe("changed");
  });

  it("reports changed for materially different prose", () => {
    const r = compareOutputs(
      "The auth flow uses JWT with a 15-minute expiry.",
      "Switch the database to PostgreSQL and add a Redis cache layer."
    );
    expect(r.verdict).toBe("changed");
    expect(r.equivalent).toBe(false);
  });

  it("passes the similarity and strategy through from the equivalence engine", () => {
    const r = compareOutputs("alpha beta gamma", "alpha beta gamma");
    expect(typeof r.similarity).toBe("number");
    expect(typeof r.strategy).toBe("string");
  });
});

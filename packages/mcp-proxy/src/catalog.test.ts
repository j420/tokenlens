import { describe, expect, it } from "vitest";

import { indexCatalog, ALL_INTENTS } from "./catalog.js";
import {
  buildCatalog,
  loadFixtureCatalog,
  tokenCostsForCatalog,
} from "./test-helpers.js";

describe("indexCatalog", () => {
  it("indexes every tool from the fixture", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat);
    expect(idx.tools.length).toBe(cat.tools.length);
  });

  it("classifies postgres__query under 'retrieve' (from 'query' verb)", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat);
    expect(idx.byIntent.get("retrieve")).toContain("postgres__query");
  });

  it("classifies github__create_pull_request under 'generate'", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat);
    expect(idx.byIntent.get("generate")).toContain("github__create_pull_request");
  });

  it("classifies linear__update_issue under 'refactor'", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat);
    expect(idx.byIntent.get("refactor")).toContain("linear__update_issue");
  });

  it("places ambiguous_tool_xyz in alwaysInclude (fail-safe), NOT in byIntent", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat);
    expect(idx.alwaysInclude).toContain("ambiguous_tool_xyz");
    // It does NOT appear in any byIntent list. The matcher composes
    // byIntent ∪ alwaysInclude when includeFallback=true so the routing
    // is opt-outable.
    for (const intent of ALL_INTENTS) {
      expect(idx.byIntent.get(intent)).not.toContain("ambiguous_tool_xyz");
    }
  });

  it("respects explicit overrides", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat, {
      overrides: [
        { toolName: "postgres__query", intents: ["debug"] },
      ],
    });
    const queryEntry = idx.tools.find((t) => t.name === "postgres__query")!;
    expect(queryEntry.source).toBe("override");
    expect(queryEntry.intents).toEqual(["debug"]);
    expect(idx.byIntent.get("debug")).toContain("postgres__query");
    expect(idx.byIntent.get("retrieve")).not.toContain("postgres__query");
  });

  it("computes total schema + description tokens", () => {
    const cat = loadFixtureCatalog();
    const costs = tokenCostsForCatalog(cat);
    const idx = indexCatalog(cat, { tokenCostByName: costs });
    expect(idx.totalSchemaTokens).toBeGreaterThan(0);
    expect(idx.totalDescriptionTokens).toBeGreaterThan(0);
  });

  it("uses zero-cost when token costs are not provided (never fabricates)", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat);
    expect(idx.totalSchemaTokens).toBe(0);
    expect(idx.totalDescriptionTokens).toBe(0);
  });

  it("sorts byIntent lists deterministically", () => {
    const cat = buildCatalog([
      {
        name: "z_create_x",
        description: "z",
        inputSchema: {},
      },
      {
        name: "a_create_y",
        description: "a",
        inputSchema: {},
      },
    ]);
    const idx = indexCatalog(cat);
    expect(idx.byIntent.get("generate")).toEqual(["a_create_y", "z_create_x"]);
  });

  it("is deterministic across two calls with identical input", () => {
    const cat = loadFixtureCatalog();
    const a = indexCatalog(cat);
    const b = indexCatalog(cat);
    expect(a).toEqual(b);
  });
});

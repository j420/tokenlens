import { describe, expect, it } from "vitest";

import { indexCatalog } from "./catalog.js";
import { matchCatalog } from "./intent-matcher.js";
import { loadFixtureCatalog } from "./test-helpers.js";

describe("matchCatalog", () => {
  it("returns full catalog when intent is null (no_intent)", () => {
    const idx = indexCatalog(loadFixtureCatalog());
    const r = matchCatalog(idx, null);
    expect(r.reduced).toBe(false);
    expect(r.fallbackReason).toBe("no_intent");
    expect(r.trimmed.manifest.length).toBe(idx.tools.length);
    expect(r.trimmed.hiddenNames.length).toBe(0);
  });

  it("returns full catalog when intent is 'classify' (trivial_classify)", () => {
    const idx = indexCatalog(loadFixtureCatalog());
    const r = matchCatalog(idx, "classify");
    expect(r.reduced).toBe(false);
    expect(r.fallbackReason).toBe("trivial_classify");
  });

  it("trims to retrieval tools on 'retrieve' intent", () => {
    const idx = indexCatalog(loadFixtureCatalog());
    const r = matchCatalog(idx, "retrieve");
    expect(r.reduced).toBe(true);
    expect(r.fallbackReason).toBeNull();
    const names = r.trimmed.manifest.map((m) => m.name);
    expect(names).toContain("postgres__query");
    expect(names).toContain("github__search_code");
    expect(names).not.toContain("github__create_pull_request");
  });

  it("trims to generation tools on 'generate' intent", () => {
    const idx = indexCatalog(loadFixtureCatalog());
    const r = matchCatalog(idx, "generate");
    expect(r.reduced).toBe(true);
    const names = r.trimmed.manifest.map((m) => m.name);
    expect(names).toContain("github__create_pull_request");
    expect(names).toContain("linear__create_issue");
    expect(names).not.toContain("postgres__query");
  });

  it("includes the alwaysInclude (fail-safe) set on every intent by default", () => {
    const idx = indexCatalog(loadFixtureCatalog());
    const r = matchCatalog(idx, "refactor");
    expect(r.trimmed.manifest.map((m) => m.name)).toContain("ambiguous_tool_xyz");
  });

  it("excludes alwaysInclude when caller opts out via includeFallback=false", () => {
    const idx = indexCatalog(loadFixtureCatalog());
    const r = matchCatalog(idx, "refactor", { includeFallback: false });
    expect(r.trimmed.manifest.map((m) => m.name)).not.toContain(
      "ambiguous_tool_xyz"
    );
  });

  it("emits hiddenNames for tools not in the matched intent", () => {
    const idx = indexCatalog(loadFixtureCatalog());
    const r = matchCatalog(idx, "retrieve");
    expect(r.trimmed.hiddenNames).toContain("github__create_pull_request");
  });

  it("returns full catalog when no tool matches an intent (failure to infer)", () => {
    // Build a catalog where every tool is ambiguous → all-intents fallback.
    // 'classify' intent under fallback-include=false hits 'all_inferred_failed'
    // because nothing has an explicit `classify` match.
    const cat = indexCatalog({
      tools: [
        { name: "thing_one", description: "", inputSchema: {} },
        { name: "thing_two", description: "", inputSchema: {} },
      ],
    });
    // With fallback-include=false: the matched set is empty for 'debug'.
    const r = matchCatalog(cat, "debug", { includeFallback: false });
    expect(r.reduced).toBe(false);
    expect(r.fallbackReason).toBe("all_inferred_failed");
  });

  it("returns full catalog (no reduction) when intent matches ALL tools", () => {
    // Tools whose names ALL infer 'retrieve' → matching that intent
    // yields the entire set; the matcher records 'intent_matches_all'.
    const cat = indexCatalog({
      tools: [
        { name: "list_a", description: "", inputSchema: {} },
        { name: "list_b", description: "", inputSchema: {} },
      ],
    });
    const r = matchCatalog(cat, "retrieve");
    expect(r.reduced).toBe(false);
    expect(r.fallbackReason).toBe("intent_matches_all");
  });

  it("is deterministic across two calls", () => {
    const idx = indexCatalog(loadFixtureCatalog());
    expect(matchCatalog(idx, "retrieve")).toEqual(matchCatalog(idx, "retrieve"));
  });
});

import { describe, expect, it } from "vitest";

import { indexCatalog } from "./catalog.js";
import { McpProxy } from "./proxy.js";
import { buildQualityProof } from "./quality-proof.js";
import {
  loadFixtureCatalog,
  tokenCostsForCatalog,
} from "./test-helpers.js";

describe("McpProxy.serveToolsList", () => {
  it("returns the full catalog by tool count when intent is null", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat, { tokenCostByName: tokenCostsForCatalog(cat) });
    const proxy = new McpProxy(idx);
    const { trimmed, audit } = proxy.serveToolsList(null);
    // No tool COUNT reduction…
    expect(trimmed.manifest.length).toBe(idx.tools.length);
    expect(audit.keptTools).toBe(audit.totalTools);
    expect(audit.fallbackReason).toBe("no_intent");
    // …but lazy-schema substitution still saves the schema bytes. The
    // manifest ships only descriptions, schemas remain on the server.
    expect(audit.savedTokens).toBe(idx.totalSchemaTokens);
  });

  it("trims and reports a positive savedTokens count on a real catalog under 'retrieve'", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat, { tokenCostByName: tokenCostsForCatalog(cat) });
    const proxy = new McpProxy(idx);
    const { trimmed, audit } = proxy.serveToolsList("retrieve");
    expect(audit.totalTools).toBe(idx.tools.length);
    expect(audit.keptTools).toBeLessThan(audit.totalTools);
    expect(audit.savedTokens).toBeGreaterThan(0);
    expect(audit.keptRatio).toBeLessThan(1);
    expect(audit.keptNames).toEqual(audit.keptNames.slice().sort());
    expect(audit.hiddenNames).toEqual(audit.hiddenNames.slice().sort());
    // Sanity: the manifest only carries name + description, never schema.
    for (const entry of trimmed.manifest) {
      expect(typeof entry.name).toBe("string");
      // No `inputSchema` field in the manifest entry.
      expect("inputSchema" in entry).toBe(false);
    }
  });

  it("audit savedTokens equals fullCatalogTokens minus shippedTokens", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat, { tokenCostByName: tokenCostsForCatalog(cat) });
    const proxy = new McpProxy(idx);
    const { audit } = proxy.serveToolsList("retrieve");
    expect(audit.savedTokens).toBe(audit.fullCatalogTokens - audit.shippedTokens);
  });

  it("audit is deterministic across two calls", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat, { tokenCostByName: tokenCostsForCatalog(cat) });
    const proxy = new McpProxy(idx);
    expect(proxy.serveToolsList("retrieve").audit).toEqual(
      proxy.serveToolsList("retrieve").audit
    );
  });

  it("quality_proof wraps the audit under f10 + schema v1", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat, { tokenCostByName: tokenCostsForCatalog(cat) });
    const proxy = new McpProxy(idx);
    const { audit } = proxy.serveToolsList("generate");
    const proof = buildQualityProof(audit);
    expect(proof.schemaVersion).toBe(1);
    expect(proof.featureId).toBe("f10");
    expect(proof.audit).toEqual(audit);
  });

  it("resolveToolCall returns full tool definition", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat);
    const proxy = new McpProxy(idx);
    const r = proxy.resolveToolCall("postgres__query");
    expect(r).not.toBeNull();
    expect(r!.tool.name).toBe("postgres__query");
    expect(r!.tool.inputSchema).toEqual(
      cat.tools.find((t) => t.name === "postgres__query")!.inputSchema
    );
    expect(r!.cold).toBe(true);
    expect(proxy.getLoadedCount()).toBe(1);
  });

  it("resolveToolCall returns null for unknown name", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat);
    const proxy = new McpProxy(idx);
    expect(proxy.resolveToolCall("not_a_real_tool")).toBeNull();
  });

  it("resetLoaded clears the loaded-set", () => {
    const cat = loadFixtureCatalog();
    const idx = indexCatalog(cat);
    const proxy = new McpProxy(idx);
    proxy.resolveToolCall("postgres__query");
    expect(proxy.getLoadedCount()).toBe(1);
    proxy.resetLoaded();
    expect(proxy.getLoadedCount()).toBe(0);
  });
});

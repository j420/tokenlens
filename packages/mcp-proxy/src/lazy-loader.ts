/**
 * Lazy schema loader.
 *
 * The proxy ships a manifest (name + description) downstream, holding back
 * the full `inputSchema` until the agent's first `tools/call` for that tool
 * arrives. This module is the lookup + memoization layer: given a tool
 * name, return the full tool definition for substitution into context.
 *
 * The loader is purely in-memory and per-session. Persistence is out of
 * scope: the catalog is already cheap to rebuild (the upstream MCP
 * server's `tools/list` is a single round-trip), and persisting the
 * loaded subset across sessions adds a stale-schema risk we'd then need
 * to gate.
 *
 * The loader passes every dynamically-loaded schema through
 * `@prune/sentinel.scanMcpResponseForInjection` before handing it
 * downstream. The schema is, after all, content the host did not author —
 * a hostile MCP server could embed prompt-injection markup in a
 * description. This mirrors the program rule that "every dynamically-
 * loaded schema must pass the injection shield" (Phase 6 sentinel notes).
 */

import { scanMcpResponseForInjection, type InjectionReport } from "@prune/sentinel";

import type { IndexedTool, IndexedCatalog } from "./types.js";

export interface LazyLoadResult {
  /** The tool, with full schema ready to ship. */
  tool: IndexedTool;
  /** Was this the first reference (cold), or a memoized hit (warm)? */
  cold: boolean;
  /** Sentinel verdict on the tool's description + schema. */
  injectionReport: InjectionReport;
}

export class LazyLoader {
  private readonly catalog: IndexedCatalog;
  private readonly loaded = new Set<string>();
  private readonly byName: Map<string, IndexedTool>;
  /** Names that the sentinel blocked. The proxy refuses to serve these. */
  private readonly blocked = new Set<string>();

  constructor(catalog: IndexedCatalog) {
    this.catalog = catalog;
    this.byName = new Map();
    for (const tool of catalog.tools) this.byName.set(tool.name, tool);
  }

  /** Number of tools loaded so far (per session). */
  get loadedCount(): number {
    return this.loaded.size;
  }

  /** Names that have been blocked by the injection shield. */
  get blockedNames(): readonly string[] {
    return [...this.blocked];
  }

  /**
   * Look up a tool by name. Returns null when the name isn't in the
   * catalog (the proxy then surfaces an MCP error to the agent — name
   * unknown is a host-side bug, not a proxy bug).
   *
   * On first reference, scans the tool's description + schema for
   * injection markup via `@prune/sentinel`. If the sentinel `block`s,
   * the loader records the block and returns null on this and every
   * subsequent reference.
   */
  load(name: string): LazyLoadResult | null {
    if (this.blocked.has(name)) return null;
    const tool = this.byName.get(name);
    if (!tool) return null;
    const cold = !this.loaded.has(name);
    let injectionReport: InjectionReport;
    if (cold) {
      // Sentinel scans the concatenation of description + JSON-stringified
      // schema. Any block verdict halts substitution.
      const payload =
        (tool.description ?? "") +
        "\n" +
        JSON.stringify(tool.inputSchema);
      injectionReport = scanMcpResponseForInjection(payload);
      if (injectionReport.verdict === "block") {
        this.blocked.add(name);
        return null;
      }
      this.loaded.add(name);
    } else {
      injectionReport = {
        verdict: "allow",
        reason: null,
        injectionFindings: [],
      };
    }
    return { tool, cold, injectionReport };
  }

  /** Drop the loaded-set so subsequent loads are cold again. */
  reset(): void {
    this.loaded.clear();
    this.blocked.clear();
  }
}

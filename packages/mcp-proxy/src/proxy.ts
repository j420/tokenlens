/**
 * McpProxy — the orchestrator that sits between the host (Cursor / Codex
 * CLI / Cline / Continue / Aider) and the upstream MCP servers.
 *
 * v0.1 ships the JSON-RPC INTERCEPTION SHAPE — pure functions that
 * transform a `tools/list` response and look up a tool by name on
 * `tools/call`. v0.2 will add a Node-side transport (stdio / socket) that
 * mounts this against a live host. Keeping the transport out of v0.1
 * means the package builds and tests without any vendor-specific MCP
 * client SDK.
 *
 * Public contract:
 *   - `serveToolsList(intent)`  → trimmed manifest + audit record
 *   - `resolveToolCall(name)`   → full tool definition or null + injection
 *                                  shield verdict
 */

import { matchCatalog, type MatchOptions } from "./intent-matcher.js";
import { LazyLoader, type LazyLoadResult } from "./lazy-loader.js";
import type {
  IndexedCatalog,
  IndexedTool,
  ReductionAudit,
  TrimmedToolList,
} from "./types.js";
import type { IntentKind } from "@prune/router";

export interface ProxyOptions {
  /**
   * Strategy options forwarded to the intent matcher. Most callers leave
   * the default; power users can opt into stricter reduction.
   */
  match?: MatchOptions;
}

export interface ServeResult {
  trimmed: TrimmedToolList;
  audit: ReductionAudit;
}

export class McpProxy {
  private readonly catalog: IndexedCatalog;
  private readonly loader: LazyLoader;
  private readonly matchOptions: MatchOptions;

  constructor(catalog: IndexedCatalog, options: ProxyOptions = {}) {
    this.catalog = catalog;
    this.loader = new LazyLoader(catalog);
    this.matchOptions = options.match ?? {};
  }

  /** Read-only access to the catalog the proxy is serving. */
  getCatalog(): IndexedCatalog {
    return this.catalog;
  }

  /** Number of tools dynamically loaded so far. */
  getLoadedCount(): number {
    return this.loader.loadedCount;
  }

  /** Names blocked by the injection shield. */
  getBlockedNames(): readonly string[] {
    return this.loader.blockedNames;
  }

  /**
   * Build the trimmed `tools/list` response for the given intent. Emits
   * an audit record carrying the reduction ratio + kept/hidden names so
   * the persistence sink (and any downstream observability) can roll up.
   *
   * Pure: same catalog + intent + options always produce the same result.
   */
  serveToolsList(intent: IntentKind | null): ServeResult {
    const result = matchCatalog(this.catalog, intent, this.matchOptions);
    const audit = this.buildAudit(intent, result.trimmed, result.fallbackReason);
    return { trimmed: result.trimmed, audit };
  }

  /**
   * Resolve a `tools/call` lookup. Returns the full tool (with schema)
   * and an injection-shield report from the lazy loader. Returns null
   * when the name is unknown or the sentinel blocked it.
   */
  resolveToolCall(name: string): LazyLoadResult | null {
    return this.loader.load(name);
  }

  /** Re-arm the lazy loader (forget what's been loaded). */
  resetLoaded(): void {
    this.loader.reset();
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private buildAudit(
    intent: IntentKind | null,
    trimmed: TrimmedToolList,
    fallbackReason: string | null
  ): ReductionAudit {
    const keptNames = trimmed.manifest.map((m) => m.name).slice().sort();
    const hiddenNames = trimmed.hiddenNames.slice().sort();
    const keptToolSet = new Set(keptNames);

    let shippedTokens = 0;
    for (const tool of this.catalog.tools) {
      if (keptToolSet.has(tool.name)) {
        // Only description ships in the manifest; the full schema is held
        // back until `tools/call` references it.
        shippedTokens += tool.cost.descriptionTokens;
      }
    }
    const fullCatalogTokens =
      this.catalog.totalSchemaTokens + this.catalog.totalDescriptionTokens;
    const savedTokens = fullCatalogTokens - shippedTokens;
    const keptRatio =
      fullCatalogTokens === 0 ? 1 : shippedTokens / fullCatalogTokens;

    return {
      schemaVersion: 1,
      intent,
      totalTools: this.catalog.tools.length,
      keptTools: keptNames.length,
      hiddenTools: hiddenNames.length,
      fullCatalogTokens,
      shippedTokens,
      savedTokens,
      keptRatio,
      keptNames,
      hiddenNames,
      fallbackReason,
    };
  }
}

/** Convenience: ship full schemas of every CURRENTLY-LOADED tool. */
export function loadedToolDefinitions(proxy: McpProxy): readonly IndexedTool[] {
  const out: IndexedTool[] = [];
  const cat = proxy.getCatalog();
  for (const tool of cat.tools) {
    const r = proxy.resolveToolCall(tool.name);
    // resolveToolCall would force-load every tool, defeating laziness.
    // This helper is for testing only and is intentionally compromised —
    // production callers should observe `getLoadedCount` instead.
    if (r && !r.cold) out.push(r.tool);
  }
  return out;
}

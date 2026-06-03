/**
 * @prune/mcp-proxy — typed surface.
 *
 * The proxy operates on the MCP JSON-RPC tool catalog. It does NOT need a
 * full MCP-spec implementation: only the message shapes for `tools/list`
 * (catalog enumeration) and `tools/call` (invocation) matter for trimming.
 *
 * Discipline:
 *   - No regex anywhere. Verb classification walks `_`/`-`/`.`-split tokens.
 *   - No model call. Intent comes from the host's `@prune/router/classifier`.
 *   - Caller-declared intent (must be supplied; never sniffed from prompt).
 *   - Fail-safe-to-INCLUDE: when intent matching is uncertain, the proxy
 *     emits the FULL catalog rather than risk hiding a tool the agent needs.
 *     The only failure mode is "didn't save tokens," never "broke the agent."
 */

import type { IntentKind } from "@prune/router";

export type { IntentKind };

/**
 * One MCP tool as published by an upstream server. The proxy treats the
 * `inputSchema` as opaque JSON — it does not parse the schema; it merely
 * counts the schema's token cost and decides whether to ship it now or
 * later.
 */
export interface McpTool {
  /** The MCP-server-namespaced tool name, e.g. "postgres__query" or "linear__create_issue". */
  name: string;
  /** Human-readable description (typically 1–3 sentences). */
  description?: string;
  /** Full JSON Schema object describing the tool's inputs. */
  inputSchema: Record<string, unknown>;
  /** Optional MCP-server origin tag, used by the audit log for rollup. */
  origin?: string;
}

/**
 * A full catalog as received from one or more upstream MCP servers. The
 * proxy merges multiple servers' catalogs into one before indexing.
 */
export interface ToolCatalog {
  tools: readonly McpTool[];
}

/**
 * Caller-declared intent tags for a tool. Overrides the verb-classifier's
 * inference. Use this for tools whose name doesn't carry verb signal
 * (e.g., "postgres__sql_execute" → ["retrieve", "refactor"]).
 */
export interface IntentOverride {
  /** Exact tool name to override. */
  toolName: string;
  /** Intent labels to use instead of the inferred set. */
  intents: readonly IntentKind[];
}

/**
 * The auto-classified tag set for a tool, plus the verb tokens that
 * justified each tag. Used by the audit log so a skeptical reader can
 * trace why a tool was included or excluded.
 */
export interface ClassifiedTool extends McpTool {
  /** Intent labels this tool serves. */
  intents: readonly IntentKind[];
  /**
   * Verb tokens extracted from the tool name that drove classification.
   * Empty array means classification was inconclusive → all intents.
   */
  verbTokens: readonly string[];
  /** Did the user explicitly override the inferred tags? */
  overridden: boolean;
  /** Source of the tags: "inferred" | "override" | "fallback-all-intents". */
  source: "inferred" | "override" | "fallback-all-intents";
}

/**
 * Per-tool token cost. Caller-supplied via `@prune/tokenizer`; the proxy
 * does not estimate. Used to compute the reduction ratio in the audit log.
 */
export interface ToolTokenCost {
  /** Tokens in the tool's full inputSchema (caller-tokenized). */
  schemaTokens: number;
  /** Tokens in the tool's description (caller-tokenized). */
  descriptionTokens: number;
}

/**
 * Per-tool entry in the indexed catalog: the tool + tags + per-tool
 * tokenized cost. The indexer stores these once at index time so the
 * runtime `tools/list` interception is a pure lookup.
 */
export interface IndexedTool extends ClassifiedTool {
  cost: ToolTokenCost;
}

/**
 * The merged + indexed catalog the proxy serves from. The `byIntent` map
 * is precomputed for O(1) lookup on intent → tool-subset queries.
 */
export interface IndexedCatalog {
  /** All tools, in their stable insertion order. */
  tools: readonly IndexedTool[];
  /**
   * Intent → array of tool names that serve that intent. The proxy walks
   * this map to assemble a trimmed `tools/list` response.
   */
  byIntent: ReadonlyMap<IntentKind, readonly string[]>;
  /**
   * The set of tools whose intents could not be inferred (verb tokens
   * empty); these are included in EVERY intent's subset by the
   * fail-safe-to-include policy.
   */
  alwaysInclude: readonly string[];
  /** Sum of per-tool schemaTokens. Used for reduction-ratio audit. */
  totalSchemaTokens: number;
  /** Sum of per-tool descriptionTokens. */
  totalDescriptionTokens: number;
}

/**
 * A trimmed `tools/list` response, ready to ship downstream. The proxy
 * returns the FULL catalog when intent is unset or the classifier returns
 * "classify" (the trivial-tier triage; we can't tell yet what's needed).
 */
export interface TrimmedToolList {
  /**
   * Manifest entries: just `{name, description}` per tool. The full
   * `inputSchema` is held back until `tools/call` references the tool.
   * Even shipping descriptions saves the ~90% of schema bytes.
   */
  manifest: ReadonlyArray<{ name: string; description: string | undefined }>;
  /**
   * Names of tools NOT included in this trim, so the host can warn the
   * user if the agent later asks for one of them (it can still arrive via
   * the lazy-load path; this is for observability).
   */
  hiddenNames: readonly string[];
}

/**
 * The audit record the proxy emits for each `tools/list` interception.
 * Goes into the persistence sink under `feature_id = "f10"`.
 */
export interface ReductionAudit {
  schemaVersion: 1;
  /** Caller-supplied intent that drove this trim. null if not provided. */
  intent: IntentKind | null;
  /** Total tools in the upstream catalog. */
  totalTools: number;
  /** Tools kept in the manifest. */
  keptTools: number;
  /** Tools hidden by intent matching. */
  hiddenTools: number;
  /** Tokens in the full catalog (schema + description). */
  fullCatalogTokens: number;
  /** Tokens shipped in this trimmed response (manifest only). */
  shippedTokens: number;
  /** Tokens saved (fullCatalogTokens - shippedTokens). */
  savedTokens: number;
  /** Ratio kept (0..1). 1.0 means no reduction; 0.05 means 95% saved. */
  keptRatio: number;
  /** Names of kept tools, deterministically sorted for diff stability. */
  keptNames: readonly string[];
  /** Names of hidden tools, sorted. */
  hiddenNames: readonly string[];
  /**
   * The fallback that fired, if any. "no_intent" / "trivial_classify" /
   * "all_inferred_failed" each map to "no reduction this time."
   */
  fallbackReason: string | null;
}

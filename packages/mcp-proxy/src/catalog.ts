/**
 * Catalog indexer. Takes the merged upstream `ToolCatalog`, classifies each
 * tool (with caller-supplied overrides taking precedence), and builds the
 * `IndexedCatalog` the runtime serves from.
 *
 * Pure. Indexing is offline; no I/O. Output is deterministic given the
 * same input order.
 */

import type {
  ClassifiedTool,
  IndexedCatalog,
  IndexedTool,
  IntentOverride,
  ToolCatalog,
  ToolTokenCost,
} from "./types.js";
import type { IntentKind } from "@prune/router";
import { classifyToolNameByVerbs } from "./verb-classifier.js";

const ALL_INTENTS: readonly IntentKind[] = [
  "classify",
  "retrieve",
  "generate",
  "refactor",
  "debug",
  "explain",
  "test",
  "format",
] as const;

export interface IndexOptions {
  /**
   * Per-tool token cost. Caller-supplied (tokenizer-of-record decides).
   * When missing for a tool, the proxy uses `{ schemaTokens: 0,
   * descriptionTokens: 0 }` and notes it in the audit — but the proxy
   * never tries to estimate.
   */
  tokenCostByName?: ReadonlyMap<string, ToolTokenCost>;
  /** Caller overrides — intent tags supplied directly. */
  overrides?: readonly IntentOverride[];
}

/**
 * Classify + index a catalog. Pure.
 */
export function indexCatalog(
  catalog: ToolCatalog,
  options: IndexOptions = {}
): IndexedCatalog {
  const overrideMap = new Map<string, readonly IntentKind[]>();
  for (const o of options.overrides ?? []) overrideMap.set(o.toolName, o.intents);

  const tools: IndexedTool[] = [];
  const byIntent: Map<IntentKind, string[]> = new Map();
  const alwaysInclude: string[] = [];
  let totalSchemaTokens = 0;
  let totalDescriptionTokens = 0;

  for (const intent of ALL_INTENTS) byIntent.set(intent, []);

  for (const tool of catalog.tools) {
    const override = overrideMap.get(tool.name);
    const verb = classifyToolNameByVerbs(tool.name);

    let intents: readonly IntentKind[];
    let source: ClassifiedTool["source"];
    let isFallback = false;
    if (override && override.length > 0) {
      intents = override;
      source = "override";
    } else if (verb.intents.length > 0) {
      intents = verb.intents;
      source = "inferred";
    } else {
      // Fail-safe-to-INCLUDE: register the tool in `alwaysInclude` (not
      // byIntent). The matcher composes byIntent with alwaysInclude under
      // the `includeFallback` toggle — keeping the two sets disjoint lets
      // a power-user opt out of the fallback without breaking inferred
      // matches.
      intents = ALL_INTENTS;
      source = "fallback-all-intents";
      alwaysInclude.push(tool.name);
      isFallback = true;
    }

    const cost: ToolTokenCost = options.tokenCostByName?.get(tool.name) ?? {
      schemaTokens: 0,
      descriptionTokens: 0,
    };
    totalSchemaTokens += cost.schemaTokens;
    totalDescriptionTokens += cost.descriptionTokens;

    const indexed: IndexedTool = {
      ...tool,
      intents,
      verbTokens: verb.verbTokens,
      overridden: source === "override",
      source,
      cost,
    };
    tools.push(indexed);

    if (!isFallback) {
      for (const intent of intents) {
        const list = byIntent.get(intent);
        if (list) list.push(tool.name);
      }
    }
  }

  // Sort the per-intent lists deterministically so the trimmed response
  // is stable byte-for-byte across runs (required for downstream cache
  // hits on the trimmed payload).
  for (const [intent, list] of byIntent) {
    list.sort();
    byIntent.set(intent, list);
  }
  alwaysInclude.sort();

  return {
    tools,
    byIntent: byIntent as ReadonlyMap<IntentKind, readonly string[]>,
    alwaysInclude,
    totalSchemaTokens,
    totalDescriptionTokens,
  };
}

/** Public re-export of the canonical intent list, for testing / docs. */
export { ALL_INTENTS };

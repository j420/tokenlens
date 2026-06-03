/**
 * Intent matcher. Given an `IndexedCatalog` and a caller-supplied
 * `IntentKind`, returns the deterministic subset of tools whose intents
 * include the requested label, plus the alwaysInclude set.
 *
 * Fail-safe contract:
 *   - When intent is `null` / unset → return FULL catalog (no reduction).
 *     The caller is saying "I don't know," and the proxy must not guess.
 *   - When intent is `"classify"` (the trivial triage intent) → return
 *     FULL catalog. Trivial-tier triage often needs to *see* the whole
 *     catalog to decide what to do next; hiding tools here would cause
 *     misclassification.
 *
 * In both cases the audit log records `fallbackReason` so the user can
 * tell why no reduction happened.
 */

import type { IndexedCatalog, TrimmedToolList } from "./types.js";
import type { IntentKind } from "@prune/router";

export interface MatchOptions {
  /**
   * When true and intent is non-fallback, the matcher also includes any
   * `alwaysInclude` tools (verb-inconclusive tools). Default true; turning
   * this off lets a power-user opt into stricter reduction at the risk of
   * hiding a tool the agent needs.
   */
  includeFallback?: boolean;
}

export interface MatchResult {
  trimmed: TrimmedToolList;
  /** Was a reduction applied (vs full passthrough)? */
  reduced: boolean;
  /** Reason for no-reduction passthrough, when relevant. */
  fallbackReason: string | null;
}

export function matchCatalog(
  catalog: IndexedCatalog,
  intent: IntentKind | null,
  options: MatchOptions = {}
): MatchResult {
  const includeFallback = options.includeFallback ?? true;

  if (intent === null) {
    return {
      trimmed: fullCatalog(catalog),
      reduced: false,
      fallbackReason: "no_intent",
    };
  }
  if (intent === "classify") {
    return {
      trimmed: fullCatalog(catalog),
      reduced: false,
      fallbackReason: "trivial_classify",
    };
  }

  const matched = new Set<string>(catalog.byIntent.get(intent) ?? []);
  if (includeFallback) {
    for (const name of catalog.alwaysInclude) matched.add(name);
  }
  if (matched.size === catalog.tools.length) {
    // Reduction is no-op — emit full catalog to be honest about it.
    return {
      trimmed: fullCatalog(catalog),
      reduced: false,
      fallbackReason: "intent_matches_all",
    };
  }
  if (matched.size === 0) {
    // No tool matched and there's nothing to fall back to. Return full
    // catalog rather than risk hiding everything.
    return {
      trimmed: fullCatalog(catalog),
      reduced: false,
      fallbackReason: "all_inferred_failed",
    };
  }

  const manifest: Array<{ name: string; description: string | undefined }> = [];
  const hiddenNames: string[] = [];
  for (const tool of catalog.tools) {
    if (matched.has(tool.name)) {
      manifest.push({ name: tool.name, description: tool.description });
    } else {
      hiddenNames.push(tool.name);
    }
  }
  return {
    trimmed: { manifest, hiddenNames },
    reduced: true,
    fallbackReason: null,
  };
}

function fullCatalog(catalog: IndexedCatalog): TrimmedToolList {
  return {
    manifest: catalog.tools.map((t) => ({ name: t.name, description: t.description })),
    hiddenNames: [],
  };
}

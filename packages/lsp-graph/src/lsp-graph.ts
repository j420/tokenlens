/**
 * LSP Symbol-Graph Substitution  (F10)
 * ====================================
 * repo-map and squeezer DERIVE a symbol/call graph from source — and so does the
 * model, every time you paste full files in and ask it to "understand the
 * structure". But the IDE already has that graph: the language server resolved
 * it precisely (imports, types, call sites) and it is FREE and AUTHORITATIVE.
 * This builds a compact, injectable payload from the language server's own index
 * — signatures + call edges — so the model never re-derives the graph from raw
 * bodies.
 *
 * `buildLspGraphPayload(index, options?)` is a PURE function over a
 * caller-supplied LSP index (the HOST runs the language-server queries; this
 * package never does I/O). It budget-selects symbols by reference in-degree
 * (the most-depended-on symbols first), keeps the edges among the selected set,
 * and accounts the token cost against the full-context alternative.
 *
 * EQUIVALENCE: by construction. The graph IS the language server's canonical
 * resolution, not a model inference — so substituting it for "send the files and
 * let the model figure out the structure" cannot change the structural facts.
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same index => same payload. Malformed entries skipped.
 *   - Caller-fed only. Token sizes are caller-supplied (tokenizer); no fabrication.
 *   - savedTokens is null unless the caller supplies the full-context token cost
 *     to compare against — never invents the baseline.
 *   - No regex, no model.
 */

// ============================================================================
// Types
// ============================================================================

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "constant"
  | "enum"
  | "module"
  | "other";

/** One symbol from the language server's index. */
export interface LspSymbol {
  /** Stable unique id (identity key for edges). */
  id: string;
  /** Display name. */
  name: string;
  kind: SymbolKind;
  /** Source path the symbol is defined in. */
  path: string;
  /** Signature-only text (no body) — what gets injected. */
  signature?: string;
  /** Token size of the signature (caller-supplied via tokenizer). Finite, >= 0. */
  tokens: number;
}

/** A directed reference edge: symbol `from` references / calls symbol `to`. */
export interface LspReference {
  from: string;
  to: string;
}

export interface LspIndex {
  symbols: LspSymbol[];
  references: LspReference[];
}

export interface LspGraphOptions {
  /**
   * Max tokens for the injected payload. Symbols are included by descending
   * reference in-degree until the budget is reached. 0 / unset = no cap.
   */
  maxTokens?: number;
  /**
   * Tokens the FULL-context alternative would have cost (send the files, let the
   * model re-derive the graph). Caller-supplied; enables `savedTokens`. null/
   * unset ⇒ savedTokens stays null (no fabricated baseline).
   */
  fullContextTokens?: number | null;
}

export interface IncludedSymbol {
  id: string;
  name: string;
  kind: SymbolKind;
  path: string;
  signature: string | null;
  tokens: number;
  /** How many distinct symbols reference this one (the selection priority). */
  inDegree: number;
}

export interface LspGraphPayload {
  /** Selected symbols, ordered by descending in-degree (most depended-on first). */
  included: IncludedSymbol[];
  /** Ids dropped for budget, with their in-degree (for transparency). */
  dropped: Array<{ id: string; tokens: number; inDegree: number }>;
  /** Edges among the INCLUDED set only (a self-consistent sub-graph). */
  edges: LspReference[];
  /** Sum of included signature tokens. */
  payloadTokens: number;
  /** Caller-supplied full-context baseline, echoed back. null when not supplied. */
  fullContextTokens: number | null;
  /** fullContextTokens − payloadTokens, when positive and baseline supplied; else null. */
  savedTokens: number | null;
  /** Entries ignored because they were malformed. */
  skipped: number;
}

// ============================================================================
// buildLspGraphPayload
// ============================================================================

export function buildLspGraphPayload(
  index: unknown,
  options: LspGraphOptions = {}
): LspGraphPayload {
  const maxTokens =
    typeof options.maxTokens === "number" &&
    Number.isFinite(options.maxTokens) &&
    options.maxTokens > 0
      ? Math.floor(options.maxTokens)
      : 0;
  const fullContextTokens =
    typeof options.fullContextTokens === "number" &&
    Number.isFinite(options.fullContextTokens) &&
    options.fullContextTokens >= 0
      ? Math.floor(options.fullContextTokens)
      : null;

  const idx = (index ?? {}) as Partial<LspIndex>;
  const rawSymbols = Array.isArray(idx.symbols) ? idx.symbols : [];
  const rawRefs = Array.isArray(idx.references) ? idx.references : [];

  const symbols = rawSymbols.filter(isLspSymbol) as LspSymbol[];
  let skipped = rawSymbols.length - symbols.length;

  const symbolById = new Map<string, LspSymbol>();
  for (const s of symbols) symbolById.set(s.id, s);

  // Valid edges connect two KNOWN symbols. in-degree = count of distinct
  // sources referencing a target (dedup so repeated call sites don't inflate it).
  const validRefs: LspReference[] = [];
  const inSources = new Map<string, Set<string>>(); // target -> set of sources
  for (const r of rawRefs) {
    if (!isLspReference(r)) {
      skipped++;
      continue;
    }
    if (!symbolById.has(r.from) || !symbolById.has(r.to)) continue; // dangling edge
    validRefs.push(r);
    const set = inSources.get(r.to) ?? new Set<string>();
    set.add(r.from);
    inSources.set(r.to, set);
  }
  const inDegreeOf = (id: string): number => inSources.get(id)?.size ?? 0;

  // Selection order: highest in-degree first, then larger signatures (more
  // valuable to inject), then id for a total order.
  const ordered = [...symbols].sort(
    (a, b) =>
      inDegreeOf(b.id) - inDegreeOf(a.id) ||
      b.tokens - a.tokens ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );

  const includedIds = new Set<string>();
  const included: IncludedSymbol[] = [];
  const dropped: LspGraphPayload["dropped"] = [];
  let payloadTokens = 0;
  for (const s of ordered) {
    const deg = inDegreeOf(s.id);
    if (maxTokens > 0 && payloadTokens + s.tokens > maxTokens) {
      dropped.push({ id: s.id, tokens: s.tokens, inDegree: deg });
      continue;
    }
    included.push({
      id: s.id,
      name: s.name,
      kind: s.kind,
      path: s.path,
      signature: typeof s.signature === "string" ? s.signature : null,
      tokens: s.tokens,
      inDegree: deg,
    });
    includedIds.add(s.id);
    payloadTokens += s.tokens;
  }

  // Keep only edges whose BOTH endpoints survived selection — a self-consistent
  // sub-graph the model can trust without dangling references.
  const edges = validRefs.filter((r) => includedIds.has(r.from) && includedIds.has(r.to));

  const savedTokens =
    fullContextTokens !== null && fullContextTokens > payloadTokens
      ? fullContextTokens - payloadTokens
      : null;

  return {
    included,
    dropped,
    edges,
    payloadTokens,
    fullContextTokens,
    savedTokens,
    skipped,
  };
}

// ============================================================================
// Helpers
// ============================================================================

const VALID_KINDS: ReadonlySet<string> = new Set([
  "function",
  "method",
  "class",
  "interface",
  "type",
  "variable",
  "constant",
  "enum",
  "module",
  "other",
]);

function isLspSymbol(v: unknown): v is LspSymbol {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    s.id.length > 0 &&
    typeof s.name === "string" &&
    typeof s.kind === "string" &&
    VALID_KINDS.has(s.kind) &&
    typeof s.path === "string" &&
    typeof s.tokens === "number" &&
    Number.isFinite(s.tokens) &&
    s.tokens >= 0
  );
}

function isLspReference(v: unknown): v is LspReference {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.from === "string" &&
    r.from.length > 0 &&
    typeof r.to === "string" &&
    r.to.length > 0
  );
}

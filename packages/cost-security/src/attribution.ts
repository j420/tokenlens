/**
 * Injection-Cost Attributor  (Cost-Security / "defend the bill")
 * =============================================================
 * A cost-driving prompt injection does not need a known attack string. A
 * poisoned file or hostile MCP result can simply steer the agent into a
 * read-everything cascade ("for full context, review the whole module tree"),
 * spending the victim's budget on downstream reads that sentinel's string
 * matcher never sees. The signal is economic, not lexical: ONE ingested,
 * untrusted source is followed by a burst of token spend out of all proportion
 * to the source's own size.
 *
 * `attributeDownstreamCost(ledger, options?)` is a PURE function over a
 * caller-fed ledger of ingested sources and the downstream actions attributed
 * to each. It computes an AMPLIFICATION ratio A(S) = downstreamTokens(S) /
 * sourceTokens(S) and flags untrusted sources whose amplification AND absolute
 * downstream spend both exceed thresholds.
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same ledger => same report. Garbage is skipped.
 *   - Caller-fed only. The caller (a hook) supplies the attribution; this never
 *     parses a transcript and carries no content — source ids + token counts.
 *   - Honest cost. USD via @prune/shared strict pricing; null on unpriced model.
 *   - Fail-open. USER-authored and explicitly-trusted sources are never flagged,
 *     so a large legitimate refactor the developer asked for is not quarantined.
 *     The output is advisory (watch / quarantine recommendation), never a block.
 */

import { getModelPricingStrictByName } from "@prune/shared";

// ============================================================================
// Types
// ============================================================================

export type SourceKind = "file" | "mcp" | "web" | "user" | "unknown";

/** One source that entered context this session. */
export interface LedgerSource {
  /** Stable identity (path, tool name, url hash...). Not interpreted. */
  id: string;
  kind: SourceKind;
  /** Token size of the source itself when ingested. */
  tokens: number;
  /**
   * Whether the source is trusted (user-authored, first-party). Trusted and
   * "user"-kind sources are never flagged. Default: untrusted unless kind==="user".
   */
  trusted?: boolean;
}

/** One downstream action's token cost, attributed to the source that drove it. */
export interface LedgerAction {
  sourceId: string;
  tokens: number;
}

export interface CostLedger {
  sources: LedgerSource[];
  actions: LedgerAction[];
}

export interface AttributionOptions {
  /** Model for USD pricing. Default "gpt-4o". */
  model?: string;
  /**
   * Amplification (downstream/source tokens) at/above which a source is
   * suspicious. Default 10 (a source drove 10x its own size in downstream spend).
   */
  amplificationThreshold?: number;
  /**
   * Absolute downstream-token floor below which we never flag, no matter the
   * ratio (a tiny source with a high ratio is cheap). Default 2_000.
   */
  minDownstreamTokens?: number;
}

export interface AttributionFinding {
  sourceId: string;
  kind: SourceKind;
  sourceTokens: number;
  downstreamTokens: number;
  /** downstreamTokens / max(1, sourceTokens), 2 decimals. */
  amplification: number;
  /** downstreamTokens priced at the model input rate; null when unpriced. */
  estimatedCostUsd: number | null;
  /** "quarantine" once both thresholds clear; "watch" when only ratio clears. */
  recommend: "quarantine" | "watch";
}

export interface AttributionReport {
  verdict: "allow" | "warn";
  findings: AttributionFinding[];
  /** Total downstream tokens attributed across all flagged sources. */
  flaggedDownstreamTokens: number;
}

// ============================================================================
// attributeDownstreamCost
// ============================================================================

export function attributeDownstreamCost(
  ledger: unknown,
  options: AttributionOptions = {}
): AttributionReport {
  const model = typeof options.model === "string" && options.model ? options.model : "gpt-4o";
  const ampThreshold = posNum(options.amplificationThreshold, 10);
  const minDownstream = posNum(options.minDownstreamTokens, 2_000);

  const sources = sourcesOf(ledger);
  const actions = actionsOf(ledger);
  if (sources.length === 0) return { verdict: "allow", findings: [], flaggedDownstreamTokens: 0 };

  // --- Sum downstream tokens per source id. ----------------------------------
  const downstream = new Map<string, number>();
  for (const a of actions) {
    downstream.set(a.sourceId, (downstream.get(a.sourceId) ?? 0) + a.tokens);
  }

  const pricing = getModelPricingStrictByName(model);
  const findings: AttributionFinding[] = [];

  for (const s of sources) {
    const isTrusted = s.trusted === true || s.kind === "user";
    if (isTrusted) continue;

    const down = downstream.get(s.id) ?? 0;
    const amplification = Math.round((down / Math.max(1, s.tokens)) * 100) / 100;
    if (amplification < ampThreshold) continue;

    const recommend: AttributionFinding["recommend"] = down >= minDownstream ? "quarantine" : "watch";
    findings.push({
      sourceId: s.id,
      kind: s.kind,
      sourceTokens: s.tokens,
      downstreamTokens: down,
      amplification,
      estimatedCostUsd: pricing ? round6((down / 1_000_000) * pricing.input) : null,
      recommend,
    });
  }

  findings.sort(
    (a, b) =>
      b.downstreamTokens - a.downstreamTokens ||
      (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)
  );

  const hasQuarantine = findings.some((f) => f.recommend === "quarantine");
  const flaggedDownstreamTokens = findings.reduce((sum, f) => sum + f.downstreamTokens, 0);

  return {
    verdict: hasQuarantine ? "warn" : "allow",
    findings,
    flaggedDownstreamTokens,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function sourcesOf(ledger: unknown): LedgerSource[] {
  const raw = (ledger as { sources?: unknown })?.sources;
  if (!Array.isArray(raw)) return [];
  const out: LedgerSource[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const s = v as Record<string, unknown>;
    if (typeof s.id !== "string" || s.id.length === 0) continue;
    if (typeof s.tokens !== "number" || !Number.isFinite(s.tokens) || s.tokens < 0) continue;
    out.push({
      id: s.id,
      kind: isSourceKind(s.kind) ? s.kind : "unknown",
      tokens: s.tokens,
      trusted: s.trusted === true,
    });
  }
  return out;
}

function actionsOf(ledger: unknown): LedgerAction[] {
  const raw = (ledger as { actions?: unknown })?.actions;
  if (!Array.isArray(raw)) return [];
  const out: LedgerAction[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const a = v as Record<string, unknown>;
    if (typeof a.sourceId !== "string" || a.sourceId.length === 0) continue;
    if (typeof a.tokens !== "number" || !Number.isFinite(a.tokens) || a.tokens < 0) continue;
    out.push({ sourceId: a.sourceId, tokens: a.tokens });
  }
  return out;
}

function isSourceKind(v: unknown): v is SourceKind {
  return v === "file" || v === "mcp" || v === "web" || v === "user" || v === "unknown";
}

function posNum(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : dflt;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * Known-Knowledge Negotiation Layer  (F2)
 * =======================================
 * f7 semantic-cache and intra-request-dedup drop content that is redundant
 * because you SENT it before. This drops content redundant with the model's
 * WEIGHTS — bytes it can reproduce verbatim (stdlib signatures, framework
 * boilerplate, ubiquitous license headers) and therefore never needed sending.
 * A different redundancy axis, and a negotiable one: send a tiny stub, and only
 * materialize the body if the model fetches it back.
 *
 * THE CRUX (why this is safe and not a model-in-the-loop decision):
 *   - The "model-knows" verdict is CALLER-FED. An OFFLINE, content-SHA-keyed
 *     probe had the model regenerate the span and the result passed the existing
 *     `@prune/equivalence` gate (byteEqual / astEquivalent). This package only
 *     records that boolean verdict — it never calls a model and never inspects
 *     content (it sees SHAs + token counts only).
 *   - Keyed by (contentSHA, modelId). Any edit changes the SHA ⇒ no verdict ⇒
 *     send full. An unknown model ⇒ no verdict ⇒ send full. The default for any
 *     unprobed / edited / unknown span is ALWAYS "send full" — it only ever
 *     SUBTRACTS proven-redundant bytes.
 *   - Self-correcting: a FETCH-BACK (the model pulled the body) demotes the span
 *     to "not reliably known", so a wrong verdict heals itself.
 *
 * DISCIPLINE: deterministic, total (never throws), PII-safe (SHAs only), no
 * regex, no model. Savings are caller-supplied token counts, never fabricated.
 */

// ============================================================================
// Types
// ============================================================================

/** Per-(sha,model) knowledge record. */
export interface KnowledgeRecord {
  /** Times an offline probe judged this span model-known (equivalence-passed). */
  knownProbes: number;
  /** Times the model fetched the body back (demotions). */
  fetchBacks: number;
  /** Latest activity epoch ms (for audit / freshness). */
  asOfMs: number;
}

/** The standing store. Plain JSON (key = `${sha}\u0000${modelId}`). */
export interface KnownStore {
  version: 1;
  records: Record<string, KnowledgeRecord>;
}

/** A content span the caller is about to send. */
export interface Span {
  /** Stable id (for the plan output). */
  id: string;
  /** Content SHA (identity for the knowledge verdict). */
  sha: string;
  /** Full token cost of the span. */
  tokens: number;
}

export interface ProbeEvent {
  sha: string;
  modelId: string;
  /** Did the offline equivalence probe judge the span model-known? */
  known: boolean;
  atIso: string;
}

export interface FetchBackEvent {
  sha: string;
  modelId: string;
  atIso: string;
}

export interface NegotiateOptions {
  /** Active model id (verdicts are per-model). */
  modelId: string;
  /** Token cost of the reference stub that replaces a known span. Default 8. */
  stubTokens?: number;
  /** Minimum NET known probes (knownProbes − fetchBacks) to stub. Default 1. */
  minKnownMargin?: number;
}

export type SpanDecision = "stub" | "full";

export interface SpanPlan {
  id: string;
  sha: string;
  decision: SpanDecision;
  /** Tokens saved if stubbed (max(0, tokens − stubTokens)); 0 when sent full. */
  savedTokens: number;
  reason: "model-knows" | "not-probed" | "demoted-by-fetchback" | "below-margin" | "stub-not-smaller";
}

export interface NegotiatePlan {
  spans: SpanPlan[];
  stubbedCount: number;
  savedTokens: number;
  skippedMalformed: number;
}

// ============================================================================
// Store construction + event folding
// ============================================================================

export function emptyKnownStore(): KnownStore {
  return { version: 1, records: {} };
}

/** Key a record by (sha, modelId). NUL is a safe separator (can't appear in either). */
function keyOf(sha: string, modelId: string): string {
  return `${sha}\u0000${modelId}`;
}

export function recordProbe(store: unknown, event: unknown): KnownStore {
  const next = coerceStore(store);
  if (!isProbe(event)) return next;
  const t = Date.parse(event.atIso);
  if (!Number.isFinite(t)) return next;
  const k = keyOf(event.sha, event.modelId);
  const rec = next.records[k] ?? { knownProbes: 0, fetchBacks: 0, asOfMs: t };
  if (event.known) rec.knownProbes += 1;
  // A probe that judged NOT-known is a (soft) demotion signal too.
  else rec.fetchBacks += 1;
  rec.asOfMs = Math.max(rec.asOfMs, t);
  next.records[k] = rec;
  return next;
}

export function recordFetchBack(store: unknown, event: unknown): KnownStore {
  const next = coerceStore(store);
  if (!isFetchBack(event)) return next;
  const t = Date.parse(event.atIso);
  if (!Number.isFinite(t)) return next;
  const k = keyOf(event.sha, event.modelId);
  const rec = next.records[k] ?? { knownProbes: 0, fetchBacks: 0, asOfMs: t };
  rec.fetchBacks += 1;
  rec.asOfMs = Math.max(rec.asOfMs, t);
  next.records[k] = rec;
  return next;
}

// ============================================================================
// negotiateSpans — the deterministic plan
// ============================================================================

export function negotiateSpans(
  store: unknown,
  spans: unknown,
  options: NegotiateOptions
): NegotiatePlan {
  const s = coerceStore(store);
  const modelId = options?.modelId;
  const stubTokens = intOr(options?.stubTokens, 8, 0);
  const minMargin = intOr(options?.minKnownMargin, 1, 1);

  const list: Span[] = Array.isArray(spans) ? (spans.filter(isSpan) as Span[]) : [];
  const skippedMalformed = (Array.isArray(spans) ? spans.length : 0) - list.length;

  const out: SpanPlan[] = [];
  let stubbedCount = 0;
  let savedTokens = 0;

  for (const span of list) {
    const plan = planSpan(s, span, modelId, stubTokens, minMargin);
    if (plan.decision === "stub") {
      stubbedCount++;
      savedTokens += plan.savedTokens;
    }
    out.push(plan);
  }

  return { spans: out, stubbedCount, savedTokens, skippedMalformed };
}

function planSpan(
  store: KnownStore,
  span: Span,
  modelId: string,
  stubTokens: number,
  minMargin: number
): SpanPlan {
  const full = (reason: SpanPlan["reason"]): SpanPlan => ({
    id: span.id,
    sha: span.sha,
    decision: "full",
    savedTokens: 0,
    reason,
  });

  if (typeof modelId !== "string" || modelId.length === 0) return full("not-probed");
  const rec = store.records[keyOf(span.sha, modelId)];
  if (!rec || rec.knownProbes === 0) return full("not-probed");
  const margin = rec.knownProbes - rec.fetchBacks;
  if (rec.fetchBacks > 0 && margin < minMargin) return full("demoted-by-fetchback");
  if (margin < minMargin) return full("below-margin");

  // Known — but only stub if the stub is actually smaller (never inflate).
  const saved = span.tokens - stubTokens;
  if (saved <= 0) return full("stub-not-smaller");
  return { id: span.id, sha: span.sha, decision: "stub", savedTokens: saved, reason: "model-knows" };
}

// ============================================================================
// Helpers
// ============================================================================

function coerceStore(store: unknown): KnownStore {
  const out: KnownStore = { version: 1, records: {} };
  if (!store || typeof store !== "object") return out;
  const s = store as Partial<KnownStore>;
  if (!s.records || typeof s.records !== "object") return out;
  for (const [k, raw] of Object.entries(s.records)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<KnowledgeRecord>;
    if (
      typeof r.knownProbes === "number" &&
      Number.isFinite(r.knownProbes) &&
      typeof r.fetchBacks === "number" &&
      Number.isFinite(r.fetchBacks) &&
      typeof r.asOfMs === "number" &&
      Number.isFinite(r.asOfMs)
    ) {
      out.records[k] = {
        knownProbes: Math.max(0, Math.floor(r.knownProbes)),
        fetchBacks: Math.max(0, Math.floor(r.fetchBacks)),
        asOfMs: r.asOfMs,
      };
    }
  }
  return out;
}

function isSpan(v: unknown): v is Span {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    s.id.length > 0 &&
    typeof s.sha === "string" &&
    s.sha.length > 0 &&
    typeof s.tokens === "number" &&
    Number.isFinite(s.tokens) &&
    s.tokens >= 0
  );
}

function isProbe(v: unknown): v is ProbeEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.sha === "string" &&
    e.sha.length > 0 &&
    typeof e.modelId === "string" &&
    e.modelId.length > 0 &&
    typeof e.known === "boolean" &&
    typeof e.atIso === "string"
  );
}

function isFetchBack(v: unknown): v is FetchBackEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.sha === "string" &&
    e.sha.length > 0 &&
    typeof e.modelId === "string" &&
    e.modelId.length > 0 &&
    typeof e.atIso === "string"
  );
}

function intOr(v: unknown, dflt: number, min: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min ? Math.floor(v) : dflt;
}

/**
 * @prune/known-knowledge (F2 — Known-Knowledge Negotiation)
 *
 * Replaces content the model provably already knows (caller-fed, content-SHA-
 * keyed equivalence-probe verdict) with a reference stub; self-corrects on a
 * fetch-back; defaults to sending full on any unprobed/edited/unknown span.
 * Deterministic; no model call; no regex; PII-safe (SHAs only).
 */

export {
  emptyKnownStore,
  recordProbe,
  recordFetchBack,
  negotiateSpans,
  type KnowledgeRecord,
  type KnownStore,
  type Span,
  type ProbeEvent,
  type FetchBackEvent,
  type NegotiateOptions,
  type SpanDecision,
  type SpanPlan,
  type NegotiatePlan,
} from "./known.js";

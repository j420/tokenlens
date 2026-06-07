/**
 * Types for WasteBench + Signed Attestations (F19).
 *
 * The point of this package is credibility: it turns "we saved tokens" into an
 * auditable, signed claim. It does so honestly — savings are counterfactual
 * (baseline minus optimized) and ALWAYS net out the observer's own overhead, so
 * a feature that costs more than it saves shows a negative net and fails the
 * reflexive SLO. Nothing here fabricates a number; every magnitude is a
 * caller-measured token count.
 */

/** One measured savings observation attributable to a feature. */
export interface SavingsRecord {
  /** Feature id/name that produced the saving (e.g. "f15"). */
  feature: string;
  /** Tokens the operation would have cost WITHOUT the optimization. */
  baselineTokens: number;
  /** Tokens it cost WITH the optimization. */
  optimizedTokens: number;
  /** Tokens the observer itself spent to produce/decide this saving. */
  overheadTokens: number;
}

export interface FeatureRollup {
  records: number;
  grossSaved: number;
  overhead: number;
  netSaved: number;
}

export interface SavingsRollup {
  records: number;
  /** Sum of max(0, baseline - optimized). */
  grossSaved: number;
  /** Sum of overhead. */
  overhead: number;
  /** grossSaved - overhead (may be negative — reported, not hidden). */
  netSaved: number;
  /** overhead / grossSaved, or null when grossSaved is 0. */
  overheadRatio: number | null;
  byFeature: Record<string, FeatureRollup>;
}

/** Reflexive SLO: the observer's overhead must stay a small fraction of savings. */
export interface OverheadSlo {
  /** Max acceptable overhead/gross ratio, e.g. 0.1 = overhead under 10%. */
  maxOverheadRatio: number;
}

export interface SloVerdict {
  ok: boolean;
  overheadRatio: number | null;
  budget: number;
  reason: string;
}

export interface SavingsManifest {
  version: 1;
  issuedAt: string;
  window: { from: string; to: string } | null;
  rollup: SavingsRollup;
  slo: SloVerdict;
}

export interface SignedAttestation {
  manifest: SavingsManifest;
  /** The exact canonical bytes that were signed. */
  canonical: string;
  algorithm: "ed25519";
  publicKeyPem: string;
  /** Base64 signature over `canonical`. */
  signature: string;
}

export interface VerifyResult {
  valid: boolean;
  reason: string;
}

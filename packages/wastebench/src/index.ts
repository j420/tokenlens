/**
 * @prune/wastebench — F19, WasteBench + Signed Attestations.
 *
 * Public surface:
 *   - rollupSavings(records) / checkOverheadSlo(rollup, slo) → honest accounting
 *   - buildManifest(records, slo, opts) → a SavingsManifest
 *   - generateKeypair / signManifest / verifyAttestation → Ed25519 attestation
 *   - canonicalize(value) → deterministic serialization
 *
 * Net savings always subtract the observer's own overhead (can be negative),
 * and attestations are tamper-evident. No regex, no model, no fabricated numbers.
 */

import { rollupSavings, checkOverheadSlo } from "./savings.js";
import type {
  OverheadSlo,
  SavingsManifest,
  SavingsRecord,
} from "./types.js";

export * from "./types.js";
export { rollupSavings, checkOverheadSlo } from "./savings.js";
export { canonicalize } from "./canonical.js";
export {
  generateKeypair,
  signManifest,
  verifyAttestation,
  type KeyPairPem,
} from "./attest.js";

export interface ManifestOptions {
  /** ISO timestamp to stamp; pass explicitly for deterministic/testable output. */
  issuedAt: string;
  window?: { from: string; to: string } | null;
}

/** Assemble a savings manifest from records + an SLO. */
export function buildManifest(
  records: readonly SavingsRecord[],
  slo: OverheadSlo,
  opts: ManifestOptions
): SavingsManifest {
  const rollup = rollupSavings(records);
  return {
    version: 1,
    issuedAt: opts.issuedAt,
    window: opts.window ?? null,
    rollup,
    slo: checkOverheadSlo(rollup, slo),
  };
}

/**
 * @prune/replay-vault
 *
 * Tamper-evident local audit log for AI coding-agent sessions.
 * Hash-chained records + ed25519 signatures, backed by any
 * `PersistenceSink` (defaults to LocalSqliteSink). Designed to
 * satisfy EU AI Act Article 12, ISO/IEC 42001 A.6.1.6, and NIST AI
 * RMF Measure 2.5 simultaneously, with a citable trail any auditor
 * can re-verify by hand from the canonicalization + digest sources.
 */

export {
  ReplayVault,
  type RecordKind,
  type AppendInput,
  type VerificationResult,
  type VaultOptions,
} from "./vault.js";

export {
  canonicalize,
  type CanonicalValue,
} from "./canonicalize.js";

export {
  sha256Hex,
  generateEd25519KeyPair,
  signEd25519,
  verifyEd25519,
  type Ed25519KeyPairPem,
} from "./digest.js";

export {
  loadOrCreateKey,
  type KeystoreKey,
  type LoadKeyOptions,
} from "./keystore.js";

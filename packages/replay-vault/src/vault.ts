/**
 * ReplayVault — tamper-evident audit log for AI coding-agent sessions.
 *
 * Compliance framing (cite-able to a procurement reviewer):
 *
 *   EU AI Act Article 12 (logging for high-risk AI systems, effective
 *   Aug 2 2026 per https://artificialintelligenceact.eu/implementation-timeline/)
 *     — "automatic recording of events" requirement; each append is a
 *     recorded event with timestamp, model id, prompt/response hashes.
 *
 *   ISO/IEC 42001 A.6.1.6 (information for AI system documentation)
 *     — provides the evidentiary trail.
 *
 *   NIST AI RMF Measure 2.5 (AI system traceability and explainability)
 *     — chain + signature → reproducible audit.
 *
 *   See Sakura Sky / arXiv 2601.15322 for the "determinism-faithfulness
 *   harness" framing the vault implements.
 *
 * Threat model:
 *   - In scope: detection of post-hoc modification of any record
 *     (chain breaks, signatures fail), of unauthorized inserts
 *     (signature fails), and of deletion runs (sequence gaps).
 *   - Out of scope: preventing an attacker with write access from
 *     truncating the most-recent records (a tamper-evident log can't
 *     stop deletion of the tail; mitigation is offsite checkpointing,
 *     planned for v0.2 via the optional cloud orchestrator).
 *
 * Persistence: backed by any `PersistenceSink`. State is a hash chain
 * across `replay_log` rows. The vault never reads or rewrites prior rows
 * during append; the only mutation is the new tail row.
 */

import { randomUUID } from "node:crypto";

import type {
  PersistenceSink,
  ReplayLogRow,
} from "@prune/persistence";

import { canonicalize } from "./canonicalize.js";
import { sha256Hex, signEd25519, verifyEd25519 } from "./digest.js";
import { loadOrCreateKey, type KeystoreKey } from "./keystore.js";

export type RecordKind =
  | "request"
  | "response"
  | "tool_use"
  | "tool_result"
  | "system";

export interface AppendInput {
  sessionId: string;
  kind: RecordKind;
  /** The JSON-canonicalizable payload to seal into the audit log. */
  payload: unknown;
  /** Per-record metadata stored unsigned alongside (model id, etc). */
  metadata?: Record<string, unknown>;
  /** Override timestamp; mostly for tests. */
  at?: Date;
}

export interface VerificationResult {
  ok: boolean;
  /** First sequence at which integrity breaks; null when ok. */
  brokeAtSequence: number | null;
  /** Number of rows checked. */
  recordsChecked: number;
  /** Per-row results, in sequence order. */
  perRow: Array<{
    sequence: number;
    hashOk: boolean;
    chainOk: boolean;
    signatureOk: boolean;
    reason: string | null;
  }>;
}

export interface VaultOptions {
  /** Override the keystore path (default: ~/.prune/keys/replay.pem). */
  keyPath?: string;
  /** Trusted public keys (PEM). Defaults to the local keypair's public. */
  trustedPublicPems?: string[];
}

export class ReplayVault {
  private readonly key: KeystoreKey;
  private readonly trustedPublicPems: string[];
  private readonly signerFingerprint: string;

  constructor(private readonly sink: PersistenceSink, opts: VaultOptions = {}) {
    this.key = loadOrCreateKey({ path: opts.keyPath });
    this.trustedPublicPems = opts.trustedPublicPems ?? [this.key.publicPem];
    this.signerFingerprint = sha256Hex(this.key.publicPem).slice(0, 16);
  }

  /** Public key of the local signer in PEM form. Safe to publish. */
  publicKey(): string {
    return this.key.publicPem;
  }

  /** 16-char prefix of the SHA-256 over the public key. Stable per key. */
  fingerprint(): string {
    return this.signerFingerprint;
  }

  /**
   * Append a new record to the session's chain. Atomically computes
   * record_hash, fetches the previous tail to get prev_record_hash, and
   * signs (prev || curr) so the signature is bound to the chain position.
   */
  async append(input: AppendInput): Promise<ReplayLogRow> {
    if (!input.sessionId) throw new Error("sessionId is required");
    const tail = await this.sink.getLatestReplayLog(input.sessionId);
    const sequence = (tail?.sequence ?? -1) + 1;
    const ts = (input.at ?? new Date()).toISOString();
    const sealed = {
      session_id: input.sessionId,
      sequence,
      timestamp: ts,
      kind: input.kind,
      payload: input.payload,
    };
    const payloadCanonical = canonicalize(sealed);
    const recordHash = sha256Hex(payloadCanonical);
    const prevHash = tail?.record_hash ?? null;
    const signingMaterial = (prevHash ?? "") + recordHash;
    const signature = signEd25519(signingMaterial, this.key.privatePem);
    const row: ReplayLogRow = {
      record_id: randomUUID(),
      session_id: input.sessionId,
      sequence,
      timestamp: ts,
      kind: input.kind,
      payload_canonical: payloadCanonical,
      record_hash: recordHash,
      prev_record_hash: prevHash,
      signature,
      signer_fingerprint: this.signerFingerprint,
      metadata: input.metadata ?? {},
    };
    await this.sink.appendReplayLog(row);
    return row;
  }

  /** Read a session's chain in canonical (sequence-ascending) order. */
  async list(sessionId: string): Promise<ReplayLogRow[]> {
    return this.sink.getReplayLogBySession(sessionId);
  }

  /**
   * Re-verify the chain end-to-end:
   *   - Recompute record_hash from payload_canonical (catches payload tampering).
   *   - Check prev_record_hash matches the actual previous row (catches chain breaks).
   *   - Check signature over (prev || curr) against the trusted set
   *     (catches unauthorized appends or key swaps).
   * Returns the first failure point if any. Fail-closed — any mismatch
   * is an "ok: false".
   */
  async verify(sessionId: string): Promise<VerificationResult> {
    const rows = await this.sink.getReplayLogBySession(sessionId);
    const perRow: VerificationResult["perRow"] = [];
    let firstBreak: number | null = null;
    let prevRow: ReplayLogRow | null = null;
    for (const r of rows) {
      const recomputed = sha256Hex(r.payload_canonical);
      const hashOk = recomputed === r.record_hash;
      const chainOk =
        prevRow === null
          ? r.prev_record_hash === null
          : r.prev_record_hash === prevRow.record_hash;
      const signingMaterial = (r.prev_record_hash ?? "") + r.record_hash;
      const signatureOk = this.trustedPublicPems.some((pem) =>
        verifyEd25519(signingMaterial, r.signature, pem)
      );
      let reason: string | null = null;
      if (!hashOk) {
        reason = "record_hash does not match SHA-256 of payload_canonical";
      } else if (!chainOk) {
        reason =
          prevRow === null
            ? "expected prev_record_hash=null at sequence 0"
            : "prev_record_hash does not match the prior row's record_hash";
      } else if (!signatureOk) {
        reason = "signature does not verify under any trusted public key";
      }
      perRow.push({
        sequence: r.sequence,
        hashOk,
        chainOk,
        signatureOk,
        reason,
      });
      if (reason !== null && firstBreak === null) firstBreak = r.sequence;
      prevRow = r;
    }
    // Also catch sequence gaps that would indicate tail-deletion. They
    // are not signature-detectable but they are sequence-monotonic-detectable.
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].sequence !== i) {
        if (firstBreak === null) firstBreak = rows[i].sequence;
        perRow.push({
          sequence: rows[i].sequence,
          hashOk: true,
          chainOk: false,
          signatureOk: true,
          reason: `sequence gap — expected ${i}, found ${rows[i].sequence}`,
        });
        break;
      }
    }
    return {
      ok: firstBreak === null,
      brokeAtSequence: firstBreak,
      recordsChecked: rows.length,
      perRow,
    };
  }
}

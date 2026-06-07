/**
 * Ed25519 signing and verification of savings manifests. Real PKI via the Node
 * crypto builtin — no third-party dependency. Ed25519 is used with the null
 * digest algorithm (the scheme hashes internally).
 *
 * verifyAttestation re-derives the canonical bytes from the attestation's
 * manifest and checks them against BOTH the embedded `canonical` field and the
 * signature, so tampering with either the manifest or the canonical string is
 * detected.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

import { canonicalize } from "./canonical.js";
import type {
  SavingsManifest,
  SignedAttestation,
  VerifyResult,
} from "./types.js";

export interface KeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
}

/** Generate an Ed25519 keypair as PEM strings. */
export function generateKeypair(): KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}

/** Sign a manifest, returning a self-contained attestation. */
export function signManifest(
  manifest: SavingsManifest,
  privateKeyPem: string
): SignedAttestation {
  const canonical = canonicalize(manifest);
  const key = createPrivateKey(privateKeyPem);
  const signature = cryptoSign(null, Buffer.from(canonical, "utf8"), key);
  const publicKeyPem = createPublicKey(key)
    .export({ type: "spki", format: "pem" })
    .toString();
  return {
    manifest,
    canonical,
    algorithm: "ed25519",
    publicKeyPem,
    signature: signature.toString("base64"),
  };
}

/**
 * Verify an attestation. Fails (never throws) on any mismatch: wrong algorithm,
 * canonical/manifest disagreement, or a bad signature.
 */
export function verifyAttestation(att: SignedAttestation): VerifyResult {
  try {
    if (att.algorithm !== "ed25519") {
      return { valid: false, reason: `unsupported algorithm ${att.algorithm}` };
    }
    const recomputed = canonicalize(att.manifest);
    if (recomputed !== att.canonical) {
      return {
        valid: false,
        reason: "canonical bytes do not match the manifest (tampered)",
      };
    }
    const key = createPublicKey(att.publicKeyPem);
    const ok = cryptoVerify(
      null,
      Buffer.from(recomputed, "utf8"),
      key,
      Buffer.from(att.signature, "base64")
    );
    return ok
      ? { valid: true, reason: "signature valid" }
      : { valid: false, reason: "signature does not verify" };
  } catch (err) {
    return {
      valid: false,
      reason: `verification error: ${(err as Error)?.message ?? "unknown"}`,
    };
  }
}

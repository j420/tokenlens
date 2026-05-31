/**
 * SHA-256 digest + ed25519 sign/verify, using only `node:crypto`.
 *
 * Why ed25519: fast, deterministic signing (no per-signature nonce
 * source needed beyond the key), tiny signatures (64 bytes), and
 * native support in Node ≥ 12. Same primitive Signal, SSH, and TLS
 * 1.3 use; no proprietary scheme, no third-party dep.
 *
 * Why SHA-256 over the canonical JSON: the canonicalization in
 * canonicalize.ts gives a unique byte string per logical value; SHA-256
 * of that byte string is a stable content hash any compliant party can
 * recompute. Auditor reads canonicalize.ts + this file and can verify
 * the entire chain by hand.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from "node:crypto";

export function sha256Hex(payload: string | Uint8Array): string {
  const h = createHash("sha256");
  h.update(payload);
  return h.digest("hex");
}

export interface Ed25519KeyPairPem {
  publicPem: string;
  privatePem: string;
}

export function generateEd25519KeyPair(): Ed25519KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

export function signEd25519(payload: string | Uint8Array, privatePem: string): string {
  const key = createPrivateKey(privatePem);
  const buf = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
  // Ed25519: algorithm must be null (the key carries the curve).
  const sig = nodeSign(null, buf, key);
  return sig.toString("base64");
}

export function verifyEd25519(
  payload: string | Uint8Array,
  signatureB64: string,
  publicPem: string
): boolean {
  try {
    const key = createPublicKey(publicPem);
    const buf = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
    return nodeVerify(null, buf, key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

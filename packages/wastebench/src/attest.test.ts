import { describe, expect, it } from "vitest";
import {
  generateKeypair,
  signManifest,
  verifyAttestation,
} from "./attest.js";
import { canonicalize } from "./canonical.js";
import { buildManifest } from "./index.js";
import type { SavingsRecord } from "./types.js";

const recs: SavingsRecord[] = [
  { feature: "f15", baselineTokens: 1000, optimizedTokens: 200, overheadTokens: 50 },
];

function manifest() {
  return buildManifest(recs, { maxOverheadRatio: 0.1 }, {
    issuedAt: "2026-06-07T00:00:00.000Z",
  });
}

describe("canonicalize", () => {
  it("is order-independent over object keys", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("preserves array order and distinguishes values", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow();
  });
});

describe("sign + verify", () => {
  it("verifies a freshly signed attestation", () => {
    const { privateKeyPem } = generateKeypair();
    const att = signManifest(manifest(), privateKeyPem);
    expect(verifyAttestation(att).valid).toBe(true);
  });

  it("detects manifest tampering", () => {
    const { privateKeyPem } = generateKeypair();
    const att = signManifest(manifest(), privateKeyPem);
    const tampered = {
      ...att,
      manifest: {
        ...att.manifest,
        rollup: { ...att.manifest.rollup, netSaved: 999999 },
      },
    };
    const r = verifyAttestation(tampered);
    expect(r.valid).toBe(false);
  });

  it("detects a swapped signature", () => {
    const a = signManifest(manifest(), generateKeypair().privateKeyPem);
    const b = signManifest(manifest(), generateKeypair().privateKeyPem);
    // Keep a's manifest+canonical+pubkey but b's signature.
    const forged = { ...a, signature: b.signature };
    expect(verifyAttestation(forged).valid).toBe(false);
  });

  it("detects a canonical-field mismatch", () => {
    const att = signManifest(manifest(), generateKeypair().privateKeyPem);
    const r = verifyAttestation({ ...att, canonical: att.canonical + " " });
    expect(r.valid).toBe(false);
  });

  it("never throws on malformed input", () => {
    const r = verifyAttestation({
      manifest: manifest(),
      canonical: "{}",
      algorithm: "ed25519",
      publicKeyPem: "not a key",
      signature: "AAAA",
    });
    expect(r.valid).toBe(false);
  });
});

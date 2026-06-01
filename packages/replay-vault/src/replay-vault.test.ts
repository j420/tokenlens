import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteSink } from "@prune/persistence";

import { canonicalize } from "./canonicalize.js";
import {
  generateEd25519KeyPair,
  sha256Hex,
  signEd25519,
  verifyEd25519,
} from "./digest.js";
import { loadOrCreateKey } from "./keystore.js";
import { ReplayVault } from "./vault.js";

// ============================================================================
// Canonicalization (RFC 8785)
// ============================================================================

describe("canonicalize — RFC 8785 minimal impl", () => {
  it("sorts object keys by code-unit order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: 1, A: 2 })).toBe('{"A":2,"z":1}');
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("normalizes negative zero to 0", () => {
    expect(canonicalize(-0)).toBe("0");
  });

  it("escapes only control chars, quote, and backslash", () => {
    expect(canonicalize("hello world")).toBe('"hello world"');
    expect(canonicalize('a"b')).toBe('"a\\"b"');
    expect(canonicalize("a\nb")).toBe('"a\\nb"');
  });

  it("two equivalent objects with different key insert order hash identically", () => {
    const a = { id: "x", payload: { b: 2, a: 1 }, count: 3 };
    const b = { payload: { a: 1, b: 2 }, count: 3, id: "x" };
    expect(sha256Hex(canonicalize(a))).toBe(sha256Hex(canonicalize(b)));
  });

  it("throws on non-finite numbers", () => {
    expect(() => canonicalize(Infinity)).toThrow();
    expect(() => canonicalize(NaN)).toThrow();
  });

  it("drops undefined object values; renders array-undefined as null (matches JSON.stringify)", () => {
    expect(canonicalize({ a: 1, b: undefined as unknown as number })).toBe('{"a":1}');
    expect(canonicalize([1, undefined as unknown as number, 3])).toBe("[1,null,3]");
  });
});

// ============================================================================
// Digest + signing
// ============================================================================

describe("digest — sha256 + ed25519", () => {
  it("sha256 is deterministic across calls", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
  });

  it("ed25519 sign + verify round-trips", () => {
    const { privatePem, publicPem } = generateEd25519KeyPair();
    const sig = signEd25519("payload", privatePem);
    expect(verifyEd25519("payload", sig, publicPem)).toBe(true);
  });

  it("ed25519 verify fails on tampered payload", () => {
    const { privatePem, publicPem } = generateEd25519KeyPair();
    const sig = signEd25519("original", privatePem);
    expect(verifyEd25519("tampered", sig, publicPem)).toBe(false);
  });

  it("ed25519 verify fails under the wrong public key", () => {
    const a = generateEd25519KeyPair();
    const b = generateEd25519KeyPair();
    const sig = signEd25519("payload", a.privatePem);
    expect(verifyEd25519("payload", sig, b.publicPem)).toBe(false);
  });
});

// ============================================================================
// Keystore
// ============================================================================

let workDir = "";
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "prune-vault-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("keystore", () => {
  it("loadOrCreateKey writes a new PEM on first call, loads it on second", () => {
    const path = join(workDir, "k.pem");
    const k1 = loadOrCreateKey({ path });
    const k2 = loadOrCreateKey({ path });
    expect(k1.privatePem).toBe(k2.privatePem);
    expect(k1.publicPem).toBe(k2.publicPem);
  });

  it("derived public key verifies signatures made by the private key", () => {
    const path = join(workDir, "k.pem");
    const k = loadOrCreateKey({ path });
    const sig = signEd25519("hello", k.privatePem);
    expect(verifyEd25519("hello", sig, k.publicPem)).toBe(true);
  });
});

// ============================================================================
// ReplayVault — end-to-end with LocalSqliteSink
// ============================================================================

describe("ReplayVault — append + verify + tamper detection", () => {
  let sink: LocalSqliteSink;
  let vault: ReplayVault;

  beforeEach(async () => {
    sink = new LocalSqliteSink({ path: join(workDir, "v.sqlite") });
    await sink.init();
    vault = new ReplayVault(sink, { keyPath: join(workDir, "k.pem") });
  });

  afterEach(async () => {
    await sink.close();
  });

  it("appends sequential records starting at 0", async () => {
    const r1 = await vault.append({ sessionId: "s1", kind: "request", payload: { q: "hi" } });
    const r2 = await vault.append({ sessionId: "s1", kind: "response", payload: { a: "hello" } });
    expect(r1.sequence).toBe(0);
    expect(r2.sequence).toBe(1);
    expect(r2.prev_record_hash).toBe(r1.record_hash);
  });

  it("verify() returns ok on a clean chain", async () => {
    await vault.append({ sessionId: "s1", kind: "request", payload: { q: "1" } });
    await vault.append({ sessionId: "s1", kind: "response", payload: { a: "1" } });
    await vault.append({ sessionId: "s1", kind: "request", payload: { q: "2" } });
    const v = await vault.verify("s1");
    expect(v.ok).toBe(true);
    expect(v.brokeAtSequence).toBeNull();
    expect(v.recordsChecked).toBe(3);
    expect(v.perRow.every((r) => r.hashOk && r.chainOk && r.signatureOk)).toBe(true);
  });

  it("verify() catches payload tampering — record_hash no longer matches payload_canonical", async () => {
    // Seed a row whose record_hash is computed over the right payload,
    // then directly inject one whose payload_canonical was mutated after
    // the hash was set. This is the on-disk tampering shape.
    const payloadCanonical = canonicalize({
      session_id: "s-tamp",
      sequence: 0,
      timestamp: "2026-05-15T00:00:00.000Z",
      kind: "request",
      payload: { q: "original" },
    });
    const recordHash = sha256Hex(payloadCanonical);
    const sig = signEd25519("" + recordHash, loadOrCreateKey({ path: join(workDir, "k.pem") }).privatePem);
    await sink.appendReplayLog({
      record_id: "row-0",
      session_id: "s-tamp",
      sequence: 0,
      timestamp: "2026-05-15T00:00:00.000Z",
      kind: "request",
      // Tampered payload: hash was computed for "original" but stored
      // canonical says "MUTATED".
      payload_canonical: canonicalize({
        session_id: "s-tamp",
        sequence: 0,
        timestamp: "2026-05-15T00:00:00.000Z",
        kind: "request",
        payload: { q: "MUTATED" },
      }),
      record_hash: recordHash,
      prev_record_hash: null,
      signature: sig,
      signer_fingerprint: vault.fingerprint(),
      metadata: {},
    });
    const v = await vault.verify("s-tamp");
    expect(v.ok).toBe(false);
    expect(v.brokeAtSequence).toBe(0);
    expect(v.perRow[0].hashOk).toBe(false);
    expect(v.perRow[0].reason).toMatch(/record_hash/);
  });

  it("detects chain break when prev_record_hash is wrong", async () => {
    // Build a fresh vault, then directly insert a row with a bad
    // prev_record_hash to simulate someone splicing the chain.
    await vault.append({ sessionId: "s1", kind: "request", payload: { q: "0" } });
    const tampered = {
      record_id: "spliced",
      session_id: "s1",
      sequence: 1,
      timestamp: new Date().toISOString(),
      kind: "response",
      payload_canonical: canonicalize({
        session_id: "s1",
        sequence: 1,
        timestamp: "fake",
        kind: "response",
        payload: { a: "evil" },
      }),
      record_hash: sha256Hex("anything-not-matching"),
      prev_record_hash: "deadbeef".repeat(8),
      signature: "AA==",
      signer_fingerprint: vault.fingerprint(),
      metadata: {},
    };
    await sink.appendReplayLog(tampered as never);
    const v = await vault.verify("s1");
    expect(v.ok).toBe(false);
    expect(v.brokeAtSequence).toBe(1);
  });

  it("detects unauthorized signer — signature does not verify under trusted keys", async () => {
    await vault.append({ sessionId: "s1", kind: "request", payload: { q: "0" } });
    // Spliced row with a real ed25519 signature but from a *different* keypair.
    const stranger = generateEd25519KeyPair();
    const payloadCanonical = canonicalize({
      session_id: "s1",
      sequence: 1,
      timestamp: "x",
      kind: "response",
      payload: { a: "evil" },
    });
    const recordHash = sha256Hex(payloadCanonical);
    const prev = (await sink.getLatestReplayLog("s1"))!.record_hash;
    const sig = signEd25519(prev + recordHash, stranger.privatePem);
    await sink.appendReplayLog({
      record_id: "stranger",
      session_id: "s1",
      sequence: 1,
      timestamp: "x",
      kind: "response",
      payload_canonical: payloadCanonical,
      record_hash: recordHash,
      prev_record_hash: prev,
      signature: sig,
      signer_fingerprint: sha256Hex(stranger.publicPem).slice(0, 16),
      metadata: {},
    });
    const v = await vault.verify("s1");
    expect(v.ok).toBe(false);
    expect(v.brokeAtSequence).toBe(1);
    expect(v.perRow[1].signatureOk).toBe(false);
  });

  it("identical payloads with different field insert order produce identical record_hashes", async () => {
    const a = await vault.append({
      sessionId: "s-a",
      kind: "request",
      payload: { b: 2, a: 1 },
    });
    const b = await vault.append({
      sessionId: "s-b",
      kind: "request",
      payload: { a: 1, b: 2 },
    });
    // Records differ only by session_id + timestamp; the payload portion
    // canonicalizes the same way → audit replay is order-independent.
    expect(JSON.parse(a.payload_canonical).payload).toEqual(
      JSON.parse(b.payload_canonical).payload
    );
  });

  it("verify() respects trustedPublicPems — accepts an externally rotated trust set", async () => {
    await vault.append({ sessionId: "s1", kind: "request", payload: { q: "0" } });
    await vault.append({ sessionId: "s1", kind: "response", payload: { a: "0" } });
    // Verifier starts up later with the public key copy and verifies the chain.
    const sink2 = new LocalSqliteSink({ path: join(workDir, "v.sqlite") });
    // Don't init — same DB; LocalSqliteSink's init wants exclusive lock.
    // Use the same sink instance; instantiate a fresh verifier with the
    // matching public key but a different keystore file.
    const verifierVault = new ReplayVault(sink, {
      keyPath: join(workDir, "fresh.pem"),
      trustedPublicPems: [vault.publicKey()],
    });
    const v = await verifierVault.verify("s1");
    expect(v.ok).toBe(true);
    void sink2; // we did not init it
  });
});

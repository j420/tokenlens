import { describe, expect, it } from "vitest";

import {
  buildTimeline,
  chainPrefixHash,
  GENESIS_HASH,
  rehash,
  segmentContentHash,
} from "./segment.js";
import { canonicalSession, seg, timeline } from "./test-helpers.js";

describe("segmentContentHash", () => {
  it("is deterministic for the same payload", () => {
    const p = { role: "user", content: "hello" };
    expect(segmentContentHash(p)).toBe(segmentContentHash(p));
  });

  it("is invariant to object key order (RFC-8785 canonicalization)", () => {
    expect(segmentContentHash({ a: 1, b: 2 })).toBe(
      segmentContentHash({ b: 2, a: 1 })
    );
  });

  it("differs for different payloads", () => {
    expect(segmentContentHash({ content: "a" })).not.toBe(
      segmentContentHash({ content: "b" })
    );
  });
});

describe("GENESIS_HASH + chainPrefixHash", () => {
  it("GENESIS_HASH is the SHA-256 of empty string (well-known constant)", () => {
    expect(GENESIS_HASH).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("chain is deterministic and order-sensitive", () => {
    const c1 = segmentContentHash({ x: 1 });
    const c2 = segmentContentHash({ x: 2 });
    const a = chainPrefixHash(chainPrefixHash(GENESIS_HASH, c1), c2);
    const b = chainPrefixHash(chainPrefixHash(GENESIS_HASH, c2), c1);
    expect(a).not.toBe(b); // order matters
    expect(a).toBe(chainPrefixHash(chainPrefixHash(GENESIS_HASH, c1), c2));
  });
});

describe("buildTimeline", () => {
  it("computes a prefix-hash chain that matches manual chaining", () => {
    const t = timeline([seg("system", "S", 10), seg("user", "U", 5)]);
    const c0 = segmentContentHash({ role: "system", content: "S" });
    const c1 = segmentContentHash({ role: "user", content: "U" });
    const p0 = chainPrefixHash(GENESIS_HASH, c0);
    const p1 = chainPrefixHash(p0, c1);
    expect(t.segments[0]!.prefixHash).toBe(p0);
    expect(t.segments[1]!.prefixHash).toBe(p1);
    expect(t.rootHash).toBe(p1);
  });

  it("empty timeline has rootHash === GENESIS_HASH", () => {
    const t = timeline([]);
    expect(t.rootHash).toBe(GENESIS_HASH);
    expect(t.segments).toEqual([]);
  });

  it("throws on non-contiguous indices", () => {
    expect(() =>
      buildTimeline({
        model: "claude-sonnet-4-5-20250929",
        provider: "anthropic",
        segments: [
          { index: 0, role: "system", payload: {}, tokensIn: 1, tokensOut: 0 },
          { index: 5, role: "user", payload: {}, tokensIn: 1, tokensOut: 0 },
        ],
      })
    ).toThrow(/non-contiguous/);
  });

  it("throws on negative tokensIn", () => {
    expect(() =>
      buildTimeline({
        model: "claude-sonnet-4-5-20250929",
        provider: "anthropic",
        segments: [
          { index: 0, role: "system", payload: {}, tokensIn: -1, tokensOut: 0 },
        ],
      })
    ).toThrow(/invalid tokensIn/);
  });

  it("throws on non-finite tokensOut", () => {
    expect(() =>
      buildTimeline({
        model: "claude-sonnet-4-5-20250929",
        provider: "anthropic",
        segments: [
          {
            index: 0,
            role: "assistant",
            payload: {},
            tokensIn: 1,
            tokensOut: Number.POSITIVE_INFINITY,
          },
        ],
      })
    ).toThrow(/invalid tokensOut/);
  });

  it("is fully deterministic across two builds", () => {
    expect(canonicalSession()).toEqual(canonicalSession());
  });
});

describe("rehash", () => {
  it("reproduces an identical timeline (idempotent on unchanged input)", () => {
    const t = canonicalSession();
    expect(rehash(t)).toEqual(t);
  });
});

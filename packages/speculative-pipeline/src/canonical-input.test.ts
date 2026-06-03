import { describe, expect, it } from "vitest";

import { sameCall, speculationKey } from "./canonical-input.js";

describe("speculationKey", () => {
  it("is deterministic for the same call", () => {
    const c = { name: "Read", input: { file_path: "/a/b.ts" } };
    expect(speculationKey(c)).toBe(speculationKey(c));
  });

  it("is invariant to input key order (RFC-8785 canonicalization)", () => {
    const a = { name: "Grep", input: { pattern: "foo", path: "/x" } };
    const b = { name: "Grep", input: { path: "/x", pattern: "foo" } };
    expect(speculationKey(a)).toBe(speculationKey(b));
  });

  it("differs for different tool names", () => {
    expect(speculationKey({ name: "Read", input: { p: 1 } })).not.toBe(
      speculationKey({ name: "Glob", input: { p: 1 } })
    );
  });

  it("differs for different inputs", () => {
    expect(speculationKey({ name: "Read", input: { file_path: "/a" } })).not.toBe(
      speculationKey({ name: "Read", input: { file_path: "/b" } })
    );
  });

  it("distinguishes number 1 from string '1' in input", () => {
    expect(speculationKey({ name: "Read", input: { n: 1 } })).not.toBe(
      speculationKey({ name: "Read", input: { n: "1" } })
    );
  });
});

describe("sameCall", () => {
  it("true for byte-identical calls modulo key order", () => {
    expect(
      sameCall(
        { name: "Read", input: { a: 1, b: 2 } },
        { name: "Read", input: { b: 2, a: 1 } }
      )
    ).toBe(true);
  });
  it("false for differing calls", () => {
    expect(
      sameCall({ name: "Read", input: { a: 1 } }, { name: "Read", input: { a: 2 } })
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { contentShaFreshness } from "./freshness.js";

describe("contentShaFreshness", () => {
  it("returns a content-sha-shaped token", () => {
    const t = contentShaFreshness("workspace", "file:abc");
    expect(t.kind).toBe("content-sha");
    expect(typeof t.sha).toBe("string");
    expect(t.sha.length).toBe(64); // sha256 hex
  });

  it("is deterministic — same parts ⇒ same SHA", () => {
    const a = contentShaFreshness("part1", "part2");
    const b = contentShaFreshness("part1", "part2");
    expect(a.sha).toBe(b.sha);
  });

  it("different parts ⇒ different SHA", () => {
    const a = contentShaFreshness("part1");
    const b = contentShaFreshness("part2");
    expect(a.sha).not.toBe(b.sha);
  });

  it("concatenation isn't ambiguous (NUL separator prevents collision)", () => {
    const a = contentShaFreshness("ab", "c");
    const b = contentShaFreshness("a", "bc");
    expect(a.sha).not.toBe(b.sha);
  });

  it("empty parts list yields a defined token", () => {
    const t = contentShaFreshness();
    expect(t.kind).toBe("content-sha");
    expect(t.sha.length).toBe(64);
  });
});

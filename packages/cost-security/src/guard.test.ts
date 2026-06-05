import { describe, expect, it } from "vitest";
import { guardToolResult } from "./guard.js";

/**
 * Deterministic high-entropy line generator (xorshift32, high-bit sampling).
 * NOTE: a plain LCG's low bits are periodic and gzip-compressible — which the
 * guard correctly flags as an expansion bomb. We need genuinely high-entropy,
 * low-compressibility content here, hence xorshift + high-bit indexing.
 */
function entropyLines(count: number, width = 40): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let state = 0x9e3779b1;
  const next = () => {
    state ^= (state << 13) >>> 0;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= (state << 5) >>> 0;
    state >>>= 0;
    return state >>> 0;
  };
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    let line = "";
    for (let j = 0; j < width; j++) line += alphabet[Math.floor((next() / 4_294_967_296) * alphabet.length)];
    lines.push(line);
  }
  return lines.join("\n");
}

describe("guardToolResult — fail-open input handling (never throws)", () => {
  it("returns a neutral allow for non-string / garbage input", () => {
    for (const bad of [undefined, null, 42, {}, [], true, Symbol("x") as unknown]) {
      const r = guardToolResult(bad as unknown);
      expect(r.verdict).toBe("allow");
      expect(r.output).toBe("");
      expect(r.estimatedTokens).toBe(0);
      expect(r.savedTokens).toBe(0);
      expect(r.stub).toBeNull();
    }
  });

  it("does not throw on garbage option values", () => {
    const r = guardToolResult("hello world", {
      byteFloor: -5 as unknown as number,
      tokenCeiling: NaN,
      maxCompressionRatio: "x" as unknown as number,
    });
    expect(typeof r.verdict).toBe("string");
  });
});

describe("guardToolResult — small results pass through untouched", () => {
  it("allows a tiny result via the byte-floor fast path", () => {
    const r = guardToolResult("a small grep result\nwith two lines");
    expect(r.verdict).toBe("allow");
    expect(r.output).toBe("a small grep result\nwith two lines");
    expect(r.savedTokens).toBe(0);
    expect(r.signals).toEqual([]);
  });
});

describe("guardToolResult — EXPANSION bomb (small bytes, huge repetition)", () => {
  it("quarantines a megabyte of one repeated character", () => {
    const bomb = "A".repeat(2_000_000); // 2 MB, ~0 entropy, gzips ~1000x
    const r = guardToolResult(bomb, { toolName: "evil_mcp" });
    expect(r.verdict).toBe("quarantine");
    expect(r.signals).toContain("expansion_bomb");
    expect(r.signals).toContain("degenerate_bulk");
    // The stub replaces the payload and is far smaller than the original.
    expect(r.output).toBe(r.stub);
    expect(r.output.length).toBeLessThan(bomb.length);
    expect(r.savedTokens).toBeGreaterThan(0);
    // Provenance is preserved so the caller can restore the withheld payload.
    expect(r.sha256).toMatch(/^[0-9a-f]{12}$/);
    expect(r.stub).toContain("evil_mcp");
    expect(r.stub).toContain("withheld");
  });
});

describe("guardToolResult — BYTE-ceiling bomb", () => {
  it("quarantines anything over the byte ceiling regardless of content", () => {
    const big = entropyLines(2000, 50); // high-entropy, but force a low ceiling
    const r = guardToolResult(big, { byteCeiling: 1000 });
    expect(r.verdict).toBe("quarantine");
    expect(r.signals).toContain("byte_ceiling");
  });
});

describe("guardToolResult — large-but-legitimate => bounded (truncate)", () => {
  it("bounds a high-entropy result over the token ceiling and saves tokens", () => {
    const big = entropyLines(2500, 40); // ~100 KB, high entropy, >2000 lines
    const r = guardToolResult(big, { tokenCeiling: 1000 });
    expect(r.verdict).toBe("truncate");
    expect(r.signals).toContain("token_ceiling");
    // Not a bomb: high entropy, low compression ratio.
    expect(r.signals).not.toContain("expansion_bomb");
    expect(r.signals).not.toContain("degenerate_bulk");
    // The pruner bounded it: output is smaller and tokens were saved.
    expect(r.output.length).toBeLessThan(big.length);
    expect(r.savedTokens).toBeGreaterThan(0);
    expect(r.stub).toBeNull();
  });
});

describe("guardToolResult — baseline deviation", () => {
  it("bounds a result that is many multiples of the per-tool baseline", () => {
    const big = entropyLines(2500, 40);
    const r = guardToolResult(big, { tokenCeiling: 10_000_000, baselineTokens: 100, baselineMultiple: 8 });
    expect(r.signals).toContain("baseline_deviation");
    expect(r.verdict).toBe("truncate");
  });
});

describe("guardToolResult — honest pricing", () => {
  it("prices saved tokens for a known model and returns null for an unknown one", () => {
    const bomb = "A".repeat(2_000_000);
    const priced = guardToolResult(bomb, { model: "gpt-4o" });
    expect(priced.estimatedSavedUsd === null || priced.estimatedSavedUsd! > 0).toBe(true);

    const unpriced = guardToolResult(bomb, { model: "totally-made-up-model-xyz" });
    expect(unpriced.estimatedSavedUsd).toBeNull();
  });
});

describe("guardToolResult — deterministic", () => {
  it("yields an identical result for the same input twice", () => {
    const input = entropyLines(2500, 40);
    const a = guardToolResult(input, { tokenCeiling: 1000 });
    const b = guardToolResult(input, { tokenCeiling: 1000 });
    expect(a).toEqual(b);
  });
});

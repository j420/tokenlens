import { describe, expect, it } from "vitest";
import { countTokens } from "@prune/tokenizer";
import { pruneResult, type PruneResult } from "./result-pruner.js";

// Helpers ---------------------------------------------------------------------

const lines = (...xs: string[]) => xs.join("\n");

/** Re-count tokens independently to assert the reported numbers are REAL. */
function realTokens(s: string): number {
  return countTokens(s, "gpt-4o").tokens;
}

describe("pruneResult — input guards (never throw)", () => {
  it("returns neutral result for non-string input", () => {
    for (const bad of [undefined, null, 42, {}, [], true, Symbol("x")]) {
      const r = pruneResult(bad as unknown);
      expect(r.pruned).toBe("");
      expect(r.originalTokens).toBe(0);
      expect(r.prunedTokens).toBe(0);
      expect(r.savedTokens).toBe(0);
      expect(r.savedPct).toBe(0);
      expect(r.lossless).toBe(true);
      expect(r.manifest).toEqual([]);
    }
  });

  it("returns neutral result for empty string", () => {
    const r = pruneResult("");
    expect(r.pruned).toBe("");
    expect(r.manifest).toEqual([]);
    expect(r.lossless).toBe(true);
  });

  it("does not throw on garbage option values", () => {
    const r = pruneResult("a\nb\nc", {
      blobMinChars: -5 as unknown as number,
      middleElisionTriggerLines: NaN as unknown as number,
      middleElisionKeep: -1 as unknown as number,
      model: "" ,
    });
    expect(typeof r.pruned).toBe("string");
    expect(r.originalTokens).toBeGreaterThan(0);
  });
});

describe("pruneResult — token accounting is REAL", () => {
  it("reports the actual tokenizer counts for input and output", () => {
    const input = lines("hello world", "hello world", "hello world", "tail");
    const r = pruneResult(input);
    expect(r.originalTokens).toBe(realTokens(input));
    expect(r.prunedTokens).toBe(realTokens(r.pruned));
    expect(r.savedTokens).toBe(r.originalTokens - r.prunedTokens);
  });

  it("savedPct is consistent with savedTokens/originalTokens", () => {
    const input = lines(...Array(50).fill("dup line here"));
    const r = pruneResult(input);
    const expectedPct =
      Math.round((r.savedTokens / r.originalTokens) * 10000) / 100;
    expect(r.savedPct).toBe(expectedPct);
    expect(r.savedTokens).toBeGreaterThan(0);
  });

  it("plain prose with no redundancy is unchanged and lossless", () => {
    const input = "The quick brown fox jumps over the lazy dog.";
    const r = pruneResult(input);
    expect(r.pruned).toBe(input);
    expect(r.lossless).toBe(true);
    expect(r.savedTokens).toBe(0);
    expect(r.manifest).toEqual([]);
  });
});

describe("pruneResult — identical-run collapse", () => {
  it("collapses a run of 3+ identical lines to line + marker", () => {
    const input = lines("X", "X", "X", "X", "done");
    const r = pruneResult(input);
    expect(r.pruned).toBe(lines("X", "… (×4 identical lines)", "done"));
    const entry = r.manifest.find((m) => m.kind === "identical_run");
    expect(entry).toBeDefined();
    expect(entry!.removedLines).toBe(3); // 4 lines -> 1 kept, 3 removed
    expect(entry!.atLine).toBe(2);
    expect(r.lossless).toBe(false);
  });

  it("does NOT collapse a run of exactly 2 (would not save)", () => {
    const input = lines("Y", "Y", "z");
    const r = pruneResult(input);
    expect(r.pruned).toBe(input);
    expect(r.manifest.filter((m) => m.kind === "identical_run")).toHaveLength(0);
  });

  it("trailing-whitespace-equal lines collapse when option on", () => {
    const input = lines("a", "a   ", "a\t", "b");
    const r = pruneResult(input, { stripTrailingWhitespace: false });
    // equality after trailing-trim => the three 'a' variants form a run of 3
    const entry = r.manifest.find((m) => m.kind === "identical_run");
    expect(entry).toBeDefined();
    expect(entry!.removedLines).toBe(2);
  });

  it("byte-exact equality only when trimTrailingForRunEquality=false", () => {
    const input = lines("a", "a   ", "a\t", "b");
    const r = pruneResult(input, {
      stripTrailingWhitespace: false,
      trimTrailingForRunEquality: false,
    });
    expect(r.manifest.filter((m) => m.kind === "identical_run")).toHaveLength(0);
  });

  it("can be disabled", () => {
    const input = lines("Q", "Q", "Q", "Q");
    const r = pruneResult(input, { collapseIdenticalRuns: false, stripTrailingWhitespace: false });
    expect(r.pruned).toBe(input);
  });
});

describe("pruneResult — blank-run collapse", () => {
  it("collapses 3+ blank lines to a single blank", () => {
    const input = lines("a", "", "", "", "", "b");
    const r = pruneResult(input);
    expect(r.pruned).toBe(lines("a", "", "b"));
    const entry = r.manifest.find((m) => m.kind === "blank_run");
    expect(entry).toBeDefined();
    expect(entry!.removedLines).toBe(3); // 4 blanks -> 1 kept
  });

  it("leaves 2 blank lines alone", () => {
    const input = lines("a", "", "", "b");
    const r = pruneResult(input);
    expect(r.pruned).toBe(input);
    expect(r.manifest.filter((m) => m.kind === "blank_run")).toHaveLength(0);
  });

  it("treats whitespace-only lines as blank", () => {
    const input = lines("a", "   ", "\t", "  ", "b");
    const r = pruneResult(input);
    expect(r.pruned).toBe(lines("a", "", "b"));
  });

  it("can be disabled", () => {
    const input = lines("a", "", "", "", "b");
    const r = pruneResult(input, {
      collapseBlankRuns: false,
      stripTrailingWhitespace: false,
      collapseIdenticalRuns: false,
    });
    expect(r.pruned).toBe(input);
  });
});

describe("pruneResult — token accounting method (W2/W3 honesty)", () => {
  it("labels normal OpenAI-model counts as exact", () => {
    const r = pruneResult("line one\nline two\n", { model: "gpt-4o" });
    expect(r.tokenCountMethod).toBe("exact");
  });

  it("labels counts as estimated when input exceeds maxTokenizeChars (bounded)", () => {
    // A 60k-char input with a small cap forces the sample-and-scale estimate;
    // the key property is it stays BOUNDED and is honestly labeled.
    const big = "some log line with words\n".repeat(2500); // ~60k chars
    const r = pruneResult(big, { maxTokenizeChars: 5000, model: "gpt-4o" });
    expect(r.tokenCountMethod).toBe("estimated");
    expect(r.originalTokens).toBeGreaterThan(0);
  });

  it("labels Claude-model counts as estimated (tokenizer is approximate there)", () => {
    const r = pruneResult("hello world\n", { model: "claude-sonnet-4-5-20250929" });
    expect(r.tokenCountMethod).toBe("estimated");
  });
});

describe("pruneResult — byte-identity rejoin (W5)", () => {
  it.each([
    ["lone newline", "\n"],
    ["no trailing newline", "a\nb"],
    ["trailing newline", "a\nb\n"],
    ["two trailing blanks (no collapse)", "a\n\n"],
    ["crlf-ish content", "a\r\nb\r\n"],
    ["unicode", "café ☕\nnaïve\n"],
  ])("collapse-nothing input round-trips byte-for-byte: %s", (_name, input) => {
    // Disable every lossy layer → output must equal input exactly.
    const r = pruneResult(input, {
      collapseIdenticalRuns: false,
      collapseBlankRuns: false,
      collapseBlobs: false,
      stripTrailingWhitespace: false,
      middleElision: false,
    });
    expect(r.pruned).toBe(input);
    expect(r.lossless).toBe(true);
    expect(r.manifest).toHaveLength(0);
  });
});

describe("pruneResult — blob collapse (char-set scan, no regex)", () => {
  const base64ish = (n: number): string => {
    // deterministic pseudo-base64 with mixed classes so it qualifies as opaque
    const alpha =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let s = "";
    for (let i = 0; i < n; i++) s += alpha[(i * 7 + 3) % alpha.length];
    return s;
  };

  it("collapses a long opaque run into a [blob: N chars, sha256 ...] marker", () => {
    const blob = base64ish(800);
    const input = `data: ${blob} end`;
    const r = pruneResult(input);
    expect(r.pruned).toContain("[blob: 800 chars, sha256 ");
    expect(r.pruned.startsWith("data: ")).toBe(true);
    expect(r.pruned.endsWith(" end")).toBe(true);
    const entry = r.manifest.find((m) => m.kind === "blob");
    expect(entry).toBeDefined();
    expect(entry!.removedChars).toBe(800);
    expect(entry!.sha256).toMatch(/^[0-9a-f]{12}$/);
  });

  it("does NOT collapse a long run of pure lowercase letters (looks like a word)", () => {
    // single class, no digits/special/case-mix -> not opaque enough
    const word = "a".repeat(800);
    const input = `${word}`;
    const r = pruneResult(input, { stripTrailingWhitespace: false });
    expect(r.pruned).toBe(input);
    expect(r.manifest.filter((m) => m.kind === "blob")).toHaveLength(0);
  });

  it("does NOT collapse a degenerate low-diversity mixed-case run (e.g. aBaBaB…)", () => {
    // Only 2 distinct symbols, entropy 1.0 — NOT an opaque blob. The old loose
    // heuristic wrongly collapsed this; the structural detector correctly skips
    // it (favoring false negatives — never collapse content that isn't a blob).
    let s = "";
    for (let i = 0; i < 600; i++) s += i % 2 === 0 ? "a" : "B";
    const r = pruneResult(s);
    expect(r.manifest.filter((m) => m.kind === "blob")).toHaveLength(0);
  });

  it("DOES collapse a genuine lowercase hex blob (digest/hash style)", () => {
    // 0-9a-f only, many distinct symbols, high entropy → hex blob.
    const hexAlpha = "0123456789abcdef";
    let hex = "";
    for (let i = 0; i < 600; i++) hex += hexAlpha[(i * 11 + 5) % 16];
    const r = pruneResult(`sha: ${hex} :end`, { stripTrailingWhitespace: false });
    expect(r.manifest.filter((m) => m.kind === "blob")).toHaveLength(1);
    expect(r.pruned).toContain("[blob: 600 chars");
  });

  it("does NOT collapse a long hyphenated lowercase+digit identifier (the false-positive case)", () => {
    // "feature-flag-2024-rollout-…" — has a digit and a special ('-') and would
    // pass the OLD heuristic, but only 2 char classes and low distinct-symbol
    // count, so the structural detector refuses it. No false positive.
    const parts = ["feature", "flag", "2024", "rollout", "config", "alpha"];
    let id = "";
    while (id.length < 800) id += parts[(id.length) % parts.length] + "-";
    const r = pruneResult(id, { stripTrailingWhitespace: false });
    expect(r.manifest.filter((m) => m.kind === "blob")).toHaveLength(0);
  });

  it("does NOT collapse a long run of realistic dotted URLs ('.'/':' break the alphabet)", () => {
    // Real URLs are full of '.' ':' '?' '&' — none are blob chars — so no single
    // 512+ opaque run ever forms, even across a long concatenation.
    const url = "https://cdn.example.com/v2/assets/main.bundle.js?h=ab12 ".repeat(40);
    const r = pruneResult(url, { stripTrailingWhitespace: false });
    expect(r.manifest.filter((m) => m.kind === "blob")).toHaveLength(0);
  });

  it("respects blobMinChars threshold", () => {
    const blob = base64ish(300);
    const input = `x ${blob} y`;
    const below = pruneResult(input, { blobMinChars: 512 });
    expect(below.manifest.filter((m) => m.kind === "blob")).toHaveLength(0);
    const above = pruneResult(input, { blobMinChars: 256 });
    expect(above.manifest.filter((m) => m.kind === "blob")).toHaveLength(1);
  });

  it("handles multiple blobs on one line", () => {
    const a = base64ish(600);
    const b = base64ish(700);
    const input = `${a} middle ${b}`;
    const r = pruneResult(input);
    const blobs = r.manifest.filter((m) => m.kind === "blob");
    expect(blobs).toHaveLength(2);
    expect(r.pruned).toContain(" middle ");
    expect(blobs.map((x) => x.removedChars).sort()).toEqual([600, 700]);
  });

  it("can be disabled", () => {
    const blob = base64ish(800);
    const r = pruneResult(blob, {
      collapseBlobs: false,
      stripTrailingWhitespace: false,
    });
    expect(r.pruned).toBe(blob);
  });

  it("identical blobs hash identically (determinism)", () => {
    const blob = base64ish(600);
    const r1 = pruneResult(blob);
    const r2 = pruneResult(blob);
    expect(r1.pruned).toBe(r2.pruned);
  });
});

describe("pruneResult — trailing whitespace strip", () => {
  it("strips trailing spaces/tabs and marks lossless=false", () => {
    const input = "code here   \tmore";
    const trailing = "value  ";
    const r = pruneResult(trailing, { collapseIdenticalRuns: false });
    expect(r.pruned).toBe("value");
    expect(r.lossless).toBe(false);
    void input;
  });

  it("does not strip leading whitespace", () => {
    const input = "    indented";
    const r = pruneResult(input);
    expect(r.pruned).toBe("    indented");
  });

  it("can be disabled", () => {
    const input = "value   ";
    const r = pruneResult(input, { stripTrailingWhitespace: false });
    expect(r.pruned).toBe(input);
    expect(r.lossless).toBe(true);
  });
});

describe("pruneResult — middle elision (head/tail windowing)", () => {
  it("elides the middle of a very long result", () => {
    const body = Array.from({ length: 3000 }, (_, i) => `line-${i}`);
    const input = body.join("\n");
    const r = pruneResult(input, {
      middleElisionTriggerLines: 100,
      middleElisionKeep: 10,
    });
    const out = r.pruned.split("\n");
    expect(out[0]).toBe("line-0");
    expect(out[9]).toBe("line-9");
    expect(out[10]).toBe(`[${3000 - 20} lines elided]`);
    expect(out[out.length - 1]).toBe("line-2999");
    expect(out).toHaveLength(21); // 10 head + marker + 10 tail
    const entry = r.manifest.find((m) => m.kind === "middle_elision");
    expect(entry).toBeDefined();
    expect(entry!.removedLines).toBe(2980);
    expect(entry!.sha256).toMatch(/^[0-9a-f]{12}$/);
    expect(entry!.atLine).toBe(11);
  });

  it("does not trigger below the threshold", () => {
    const body = Array.from({ length: 50 }, (_, i) => `r${i}`);
    const r = pruneResult(body.join("\n"), {
      middleElisionTriggerLines: 100,
      middleElisionKeep: 10,
    });
    expect(r.manifest.filter((m) => m.kind === "middle_elision")).toHaveLength(0);
  });

  it("can be disabled", () => {
    const body = Array.from({ length: 3000 }, (_, i) => `l${i}`);
    const r = pruneResult(body.join("\n"), {
      middleElision: false,
    });
    expect(r.manifest.filter((m) => m.kind === "middle_elision")).toHaveLength(0);
  });
});

describe("pruneResult — idempotency", () => {
  it("pruning already-pruned output is stable (identical runs)", () => {
    const input = lines(...Array(20).fill("same"), "diff");
    const once = pruneResult(input);
    const twice = pruneResult(once.pruned);
    expect(twice.pruned).toBe(once.pruned);
    expect(twice.manifest).toEqual([]);
    expect(twice.savedTokens).toBe(0);
  });

  it("idempotent over blobs + blanks + middle elision combined", () => {
    const alpha =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let blob = "";
    for (let i = 0; i < 900; i++) blob += alpha[(i * 5 + 1) % alpha.length];
    const parts = [
      "header",
      "", "", "", "",
      ...Array(10).fill("repeat me"),
      `payload ${blob}`,
      ...Array.from({ length: 300 }, (_, i) => `tail-${i}`),
    ];
    const input = parts.join("\n");
    const once = pruneResult(input, {
      middleElisionTriggerLines: 50,
      middleElisionKeep: 5,
    });
    const twice = pruneResult(once.pruned, {
      middleElisionTriggerLines: 50,
      middleElisionKeep: 5,
    });
    expect(twice.pruned).toBe(once.pruned);
  });
});

describe("pruneResult — determinism", () => {
  it("same input + options => identical result object", () => {
    const input = lines(...Array(40).fill("x"), "y", "z");
    const a = pruneResult(input);
    const b = pruneResult(input);
    expect(a).toEqual(b);
  });
});

describe("pruneResult — unicode and newline handling", () => {
  it("handles unicode content without corruption", () => {
    const input = lines("café ☕", "café ☕", "café ☕", "naïve 🎉");
    const r = pruneResult(input);
    expect(r.pruned).toBe(lines("café ☕", "… (×3 identical lines)", "naïve 🎉"));
    expect(r.prunedTokens).toBe(realTokens(r.pruned));
  });

  it("preserves a trailing newline", () => {
    const input = "a\nb\n";
    const r = pruneResult(input);
    expect(r.pruned.endsWith("\n")).toBe(true);
  });

  it("single line with no newline is left intact when no layer applies", () => {
    const input = "just one line";
    const r = pruneResult(input);
    expect(r.pruned).toBe(input);
    expect(r.lossless).toBe(true);
  });
});

describe("pruneResult — manifest accounts for everything removed", () => {
  it("sum of removed lines + blob chars is fully recorded", () => {
    const input = lines(
      ...Array(5).fill("dup"),
      "",
      "",
      "",
      "after"
    );
    const r: PruneResult = pruneResult(input);
    const removedFromRuns = r.manifest
      .filter((m) => m.kind === "identical_run")
      .reduce((a, m) => a + (m.removedLines ?? 0), 0);
    const removedFromBlanks = r.manifest
      .filter((m) => m.kind === "blank_run")
      .reduce((a, m) => a + (m.removedLines ?? 0), 0);
    expect(removedFromRuns).toBe(4); // 5 dup -> 1 kept
    expect(removedFromBlanks).toBe(2); // 3 blanks -> 1 kept
  });

  it("manifest is ordered by atLine", () => {
    const input = lines(
      ...Array(4).fill("top"),
      "mid",
      ...Array(4).fill("bot")
    );
    const r = pruneResult(input);
    const linesWithAtLine = r.manifest
      .filter((m) => m.atLine !== undefined)
      .map((m) => m.atLine!);
    const sortedCopy = [...linesWithAtLine].sort((a, b) => a - b);
    expect(linesWithAtLine).toEqual(sortedCopy);
  });
});

describe("pruneResult — bounded on pathological input", () => {
  // NOTE: pruneResult always tokenizes the FULL input via @prune/tokenizer to
  // report real counts, so wall-clock time is O(input size) in the tokenizer
  // (an honest, intrinsic cost). These tests use inputs large enough to be
  // adversarial yet small enough to tokenize quickly.

  it("handles a single large opaque line without hanging (blob collapse)", () => {
    const alpha =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let huge = "";
    for (let i = 0; i < 60_000; i++) huge += alpha[(i * 11 + 5) % alpha.length];
    const r = pruneResult(huge, { stripTrailingWhitespace: false });
    // one opaque run -> collapsed to a single blob marker
    const blobs = r.manifest.filter((m) => m.kind === "blob");
    expect(blobs).toHaveLength(1);
    expect(blobs[0].removedChars).toBe(60_000);
    expect(r.savedTokens).toBeGreaterThan(0);
  });

  it("skips blob scan for a line above the scan cap (bounded)", () => {
    // An opaque run that exceeds MAX_BLOB_SCAN_LINE_LEN (200k) makes the scan
    // return early, so the line passes through unchanged. This proves the scan
    // is bounded regardless of line length.
    const alpha = "ABCDEFabcdef0123456789+/";
    let overCap = "";
    for (let i = 0; i < 200_001; i++) overCap += alpha[i % alpha.length];
    const r = pruneResult(overCap, { stripTrailingWhitespace: false });
    expect(r.pruned.length).toBe(overCap.length);
    expect(r.manifest.filter((m) => m.kind === "blob")).toHaveLength(0);
  });

  it("handles many short identical lines", () => {
    const input = Array.from({ length: 10000 }, () => "tick").join("\n");
    const r = pruneResult(input, { middleElision: false });
    // all identical -> collapse to 2 lines
    expect(r.pruned).toBe("tick\n… (×10000 identical lines)");
    expect(r.savedTokens).toBeGreaterThan(0);
  });
});

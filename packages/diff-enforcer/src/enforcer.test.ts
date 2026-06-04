import { describe, it, expect } from "vitest";
import { countTokens } from "@prune/tokenizer";
import {
  diffEnforce,
  computeLineEdits,
  splitLinesKeepingEol,
  buildHunks,
  renderUnifiedDiff,
  applyUnifiedDiff,
} from "./index.js";

const MODEL = "gpt-4o";

/** Helper: full round-trip of the serialized diff string. */
function roundTrip(original: string, proposed: string): string | null {
  const aLines = splitLinesKeepingEol(original);
  const bLines = splitLinesKeepingEol(proposed);
  const ops = computeLineEdits(aLines, bLines);
  const diff = renderUnifiedDiff(buildHunks(ops, 3));
  return applyUnifiedDiff(original, diff, aLines);
}

describe("splitLinesKeepingEol — lossless line splitting", () => {
  it("empty string -> zero lines", () => {
    expect(splitLinesKeepingEol("")).toEqual([]);
  });
  it("preserves trailing newline and joins back losslessly", () => {
    const t = "a\nb\nc\n";
    const lines = splitLinesKeepingEol(t);
    expect(lines).toEqual(["a\n", "b\n", "c\n"]);
    expect(lines.join("")).toBe(t);
  });
  it("no trailing newline keeps the final bare line", () => {
    const t = "a\nb\nc";
    const lines = splitLinesKeepingEol(t);
    expect(lines).toEqual(["a\n", "b\n", "c"]);
    expect(lines.join("")).toBe(t);
  });
  it("does not invent a trailing empty line for trailing newline", () => {
    expect(splitLinesKeepingEol("x\n")).toEqual(["x\n"]);
  });
});

describe("LCS edit script — hand-verified small inputs", () => {
  it("classic ABCABBA / CBABAC keep-count equals LCS length 4", () => {
    // Using single-char "lines".
    const a = ["A", "B", "C", "A", "B", "B", "A"];
    const b = ["C", "B", "A", "B", "A", "C"];
    const ops = computeLineEdits(a, b);
    const keeps = ops.filter((o) => o.kind === "keep").length;
    // Known LCS length of ABCABBA vs CBABAC is 4 (e.g. CABA or BABA).
    expect(keeps).toBe(4);
    // Edit script must reconstruct b when applied as ins/del.
    const rebuilt: string[] = [];
    for (const op of ops) {
      if (op.kind === "keep" || op.kind === "ins") rebuilt.push(op.line);
    }
    expect(rebuilt).toEqual(b);
  });

  it("single middle-line edit yields exactly one del + one ins", () => {
    const a = ["l1\n", "l2\n", "l3\n"];
    const b = ["l1\n", "CHANGED\n", "l3\n"];
    const ops = computeLineEdits(a, b);
    expect(ops.filter((o) => o.kind === "del").length).toBe(1);
    expect(ops.filter((o) => o.kind === "ins").length).toBe(1);
    expect(ops.filter((o) => o.kind === "keep").length).toBe(2);
  });

  it("pure append produces only insertions", () => {
    const a = ["a\n", "b\n"];
    const b = ["a\n", "b\n", "c\n", "d\n"];
    const ops = computeLineEdits(a, b);
    expect(ops.filter((o) => o.kind === "del").length).toBe(0);
    expect(ops.filter((o) => o.kind === "ins").length).toBe(2);
  });
});

describe("hunk structure — hand-verified", () => {
  it("single edit in the middle produces one hunk with correct @@ header", () => {
    const a = "a\nb\nc\nd\ne\nf\ng\n";
    const b = "a\nb\nc\nX\ne\nf\ng\n";
    const ops = computeLineEdits(splitLinesKeepingEol(a), splitLinesKeepingEol(b));
    const hunks = buildHunks(ops, 3);
    expect(hunks.length).toBe(1);
    const h = hunks[0];
    // Change is line 4 (1-based); 3 lines context each side -> starts at line 1.
    expect(h.aStart).toBe(1);
    expect(h.bStart).toBe(1);
    const diff = renderUnifiedDiff(hunks);
    expect(diff.startsWith("--- original\n+++ proposed\n@@ -1,7 +1,7 @@\n")).toBe(
      true
    );
    expect(diff).toContain("-d\n");
    expect(diff).toContain("+X\n");
    expect(diff).toContain(" c\n");
  });

  it("two distant edits produce two separate hunks", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line${i}\n`);
    const a = lines.join("");
    const mod = [...lines];
    mod[2] = "EDIT_A\n";
    mod[35] = "EDIT_B\n";
    const b = mod.join("");
    const ops = computeLineEdits(splitLinesKeepingEol(a), splitLinesKeepingEol(b));
    const hunks = buildHunks(ops, 3);
    expect(hunks.length).toBe(2);
  });
});

describe("round-trip correctness (load-bearing safety property)", () => {
  const cases: Array<[string, string, string]> = [
    ["identical", "a\nb\nc\n", "a\nb\nc\n"],
    ["single middle edit", "a\nb\nc\nd\ne\n", "a\nb\nX\nd\ne\n"],
    ["prepend", "b\nc\n", "a\nb\nc\n"],
    ["append", "a\nb\n", "a\nb\nc\nd\n"],
    ["delete first", "a\nb\nc\n", "b\nc\n"],
    ["delete last", "a\nb\nc\n", "a\nb\n"],
    ["full rewrite", "a\nb\nc\n", "x\ny\nz\nw\n"],
    ["empty original -> content", "", "new\ncontent\n"],
    ["content -> empty proposed", "old\nstuff\n", ""],
    ["whitespace-only change", "a\nb\n", "a \nb\n"],
    ["tabs vs spaces", "\tindented\n", "    indented\n"],
    ["trailing newline added", "a\nb", "a\nb\n"],
    ["trailing newline removed", "a\nb\n", "a\nb"],
    ["no trailing newline both", "a\nb\nc", "a\nZ\nc"],
    ["unicode multibyte", "héllo\n世界\n", "héllo\n世界\n🚀\n"],
    ["emoji edit", "🚀 launch\n", "🛸 launch\n"],
    ["crlf preserved", "a\r\nb\r\n", "a\r\nX\r\n"],
    ["blank lines", "a\n\n\nb\n", "a\n\nb\n"],
    ["single line no eol identical-ish", "only", "only line"],
    ["lines beginning with diff markers", "+a\n-b\n c\n", "+a\n-X\n c\n"],
    ["line equal to no-eol sentinel content", "\\ No newline at end of file\nx\n", "\\ No newline at end of file\ny\n"],
  ];

  for (const [name, original, proposed] of cases) {
    it(`reconstructs proposed exactly: ${name}`, () => {
      const rebuilt = roundTrip(original, proposed);
      expect(rebuilt).toBe(proposed);
    });
  }

  it("diffEnforce sets diffVerified=true and round-trips for a normal edit", () => {
    const original = "a\nb\nc\nd\ne\nf\ng\n";
    const proposed = "a\nb\nc\nMODIFIED\ne\nf\ng\n";
    const d = diffEnforce(original, proposed, { model: MODEL });
    expect(d.diffVerified).toBe(true);
    const applied = applyUnifiedDiff(
      original,
      d.diff,
      splitLinesKeepingEol(original)
    );
    expect(applied).toBe(proposed);
  });

  it("fuzz: many random line edits all round-trip exactly", () => {
    let seed = 12345;
    const rand = () => {
      // deterministic LCG
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 200; t++) {
      const n = Math.floor(rand() * 30);
      const orig: string[] = [];
      for (let i = 0; i < n; i++) orig.push(`L${Math.floor(rand() * 8)}\n`);
      const prop: string[] = [];
      for (const l of orig) {
        const r = rand();
        if (r < 0.2) continue; // delete
        if (r < 0.4) prop.push(`X${Math.floor(rand() * 8)}\n`); // replace
        else prop.push(l); // keep
        if (rand() < 0.15) prop.push(`I${Math.floor(rand() * 8)}\n`); // insert
      }
      // occasionally drop trailing newline
      let original = orig.join("");
      let proposed = prop.join("");
      if (rand() < 0.3 && original.endsWith("\n"))
        original = original.slice(0, -1);
      if (rand() < 0.3 && proposed.endsWith("\n"))
        proposed = proposed.slice(0, -1);
      const rebuilt = roundTrip(original, proposed);
      expect(rebuilt, `fuzz iter ${t}`).toBe(proposed);
    }
  });
});

describe("diffEnforce — decisions with REAL token numbers", () => {
  it("identical files -> rewrite no-op, zero saved, verified", () => {
    const t = "function f() {\n  return 1;\n}\n";
    const d = diffEnforce(t, t, { model: MODEL });
    expect(d.recommendation).toBe("rewrite");
    expect(d.reason).toContain("identical");
    expect(d.diff).toBe("");
    expect(d.diffTokens).toBe(0);
    expect(d.savedTokens).toBe(0);
    expect(d.changeRatio).toBe(0);
    expect(d.diffVerified).toBe(true);
    // real rewrite token count is non-zero and matches the tokenizer
    expect(d.rewriteTokens).toBe(countTokens(t, MODEL).tokens);
    expect(d.rewriteTokens).toBeGreaterThan(0);
  });

  it("single-line edit in a large file -> diff wins big and round-trips", () => {
    const lines = Array.from(
      { length: 6000 },
      (_, i) => `const x${i} = compute(${i}, ${i % 7});\n`
    );
    const original = lines.join("");
    const mod = [...lines];
    mod[3000] = "const x3000 = compute(3000, 999); // patched\n";
    const proposed = mod.join("");

    const d = diffEnforce(original, proposed, { model: MODEL });

    expect(d.recommendation).toBe("diff");
    expect(d.diffVerified).toBe(true);
    // Real measured counts: diff must be dramatically smaller.
    expect(d.diffTokens).toBe(countTokens(d.diff, MODEL).tokens);
    expect(d.rewriteTokens).toBe(countTokens(proposed, MODEL).tokens);
    expect(d.diffTokens).toBeLessThan(d.rewriteTokens / 50);
    expect(d.savedTokens).toBeGreaterThan(0);
    expect(d.savedPct).toBeGreaterThan(95);
    // And it genuinely reconstructs.
    expect(
      applyUnifiedDiff(original, d.diff, splitLinesKeepingEol(original))
    ).toBe(proposed);
  });

  it("near-total rewrite -> rewrite (changeRatio guard)", () => {
    const original = Array.from({ length: 20 }, (_, i) => `old line ${i}\n`).join(
      ""
    );
    const proposed = Array.from(
      { length: 20 },
      (_, i) => `brand new content ${i}\n`
    ).join("");
    const d = diffEnforce(original, proposed, { model: MODEL });
    expect(d.recommendation).toBe("rewrite");
    expect(d.changeRatio).toBeGreaterThanOrEqual(0.5);
    expect(d.reason).toContain("changeRatio");
    // counts are still real & populated
    expect(d.rewriteTokens).toBe(countTokens(proposed, MODEL).tokens);
    expect(d.diffTokens).toBeGreaterThan(0);
  });

  it("tiny file single change -> rewrite (diff overhead not worth it)", () => {
    const original = "let a = 1;\n";
    const proposed = "let a = 2;\n";
    const d = diffEnforce(original, proposed, { model: MODEL });
    // The unified-diff header alone costs more than re-sending one short line.
    expect(d.recommendation).toBe("rewrite");
    expect(d.diffVerified).toBe(true);
    expect(d.diffTokens).toBeGreaterThan(d.rewriteTokens);
  });

  it("empty original -> rewrite (everything is new)", () => {
    const d = diffEnforce("", "a\nb\nc\nd\ne\n", { model: MODEL });
    // 100% of lines are insertions -> changeRatio 1 -> rewrite.
    expect(d.recommendation).toBe("rewrite");
    expect(d.changeRatio).toBe(1);
    expect(d.diffVerified).toBe(true);
    expect(d.rewriteTokens).toBeGreaterThan(0);
  });

  it("empty proposed -> rewrite, verified, real zero rewrite tokens", () => {
    const d = diffEnforce("a\nb\nc\n", "", { model: MODEL });
    expect(d.recommendation).toBe("rewrite");
    expect(d.changeRatio).toBe(1);
    expect(d.diffVerified).toBe(true);
    expect(d.rewriteTokens).toBe(0);
  });

  it("medium file, few scattered small edits -> diff wins, verified", () => {
    const lines = Array.from(
      { length: 400 },
      (_, i) => `function handler${i}(req, res) { return process(${i}); }\n`
    );
    const original = lines.join("");
    const mod = [...lines];
    mod[10] = "function handler10(req, res) { return process(10) + 1; }\n";
    mod[200] = "function handler200(req, res) { return process(200) + 1; }\n";
    mod[390] = "function handler390(req, res) { return process(390) + 1; }\n";
    const proposed = mod.join("");
    const d = diffEnforce(original, proposed, { model: MODEL });
    expect(d.recommendation).toBe("diff");
    expect(d.diffVerified).toBe(true);
    expect(d.savedTokens).toBeGreaterThan(0);
    expect(
      applyUnifiedDiff(original, d.diff, splitLinesKeepingEol(original))
    ).toBe(proposed);
  });

  it("whitespace-only change in a large file -> diff wins and round-trips", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `value_${i} = ${i}\n`);
    const original = lines.join("");
    const mod = [...lines];
    mod[1000] = "value_1000 = 1000   \n"; // trailing spaces
    const proposed = mod.join("");
    const d = diffEnforce(original, proposed, { model: MODEL });
    expect(d.recommendation).toBe("diff");
    expect(d.diffVerified).toBe(true);
    expect(d.diff).toContain("-value_1000 = 1000\n");
    expect(d.diff).toContain("+value_1000 = 1000   \n");
  });

  it("unicode/multibyte large file, single edit -> diff wins, verified", () => {
    const lines = Array.from(
      { length: 1500 },
      (_, i) => `行${i}：你好世界 🌏 ${i}\n`
    );
    const original = lines.join("");
    const mod = [...lines];
    mod[750] = "行750：再见世界 🌙 750\n";
    const proposed = mod.join("");
    const d = diffEnforce(original, proposed, { model: MODEL });
    expect(d.recommendation).toBe("diff");
    expect(d.diffVerified).toBe(true);
    expect(
      applyUnifiedDiff(original, d.diff, splitLinesKeepingEol(original))
    ).toBe(proposed);
  });
});

describe("bounded fallback for pathological sizes", () => {
  it("triggers cleanly when n*m exceeds maxCells, never running the DP", () => {
    // Build two different large-ish files and set a tiny maxCells so the guard
    // fires deterministically without actually allocating a huge table.
    const original = Array.from({ length: 500 }, (_, i) => `a${i}\n`).join("");
    const proposed = Array.from({ length: 500 }, (_, i) => `b${i}\n`).join("");
    const d = diffEnforce(original, proposed, { model: MODEL, maxCells: 1000 });
    expect(d.recommendation).toBe("rewrite");
    expect(d.reason).toContain("bounded-fallback");
    expect(d.diff).toBe("");
    expect(d.diffVerified).toBe(false);
    expect(d.changeRatio).toBe(1);
    // rewrite tokens are still REAL and reported.
    expect(d.rewriteTokens).toBe(countTokens(proposed, MODEL).tokens);
    expect(d.rewriteTokens).toBeGreaterThan(0);
  });

  it("just under the bound still computes a real diff", () => {
    const original = Array.from({ length: 30 }, (_, i) => `a${i}\n`).join("");
    const mod = Array.from({ length: 30 }, (_, i) => `a${i}\n`);
    mod[15] = "PATCH\n";
    const proposed = mod.join("");
    // 30 x 30 = 900 <= 1000
    const d = diffEnforce(original, proposed, { model: MODEL, maxCells: 1000 });
    expect(d.diff).not.toBe("");
    expect(d.diffVerified).toBe(true);
  });
});

describe("robustness — never throws, neutral results on odd input", () => {
  it("non-string inputs are coerced, no throw", () => {
    // @ts-expect-error intentional bad input
    const d = diffEnforce(undefined, undefined, { model: MODEL });
    expect(d.recommendation).toBe("rewrite");
    expect(d.diffVerified).toBe(true); // both coerce to "" -> identical
  });

  it("changeRatioThreshold > 1 disables the guard (token decision only)", () => {
    const original = Array.from({ length: 20 }, (_, i) => `old ${i}\n`).join("");
    const proposed = Array.from({ length: 20 }, (_, i) => `new ${i}\n`).join("");
    const d = diffEnforce(original, proposed, {
      model: MODEL,
      changeRatioThreshold: 2,
    });
    // Guard disabled, so decision is purely token-based; diff here is larger
    // than the rewrite (every line changed), so still rewrite — but NOT via the
    // changeRatio reason.
    expect(d.reason).not.toContain("changeRatio");
    expect(d.diffVerified).toBe(true);
  });

  it("savedPct is clamped to [0,100] and consistent with savedTokens", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `row ${i}\n`);
    const original = lines.join("");
    const mod = [...lines];
    mod[2500] = "row 2500 patched\n";
    const proposed = mod.join("");
    const d = diffEnforce(original, proposed, { model: MODEL });
    expect(d.savedPct).toBeGreaterThanOrEqual(0);
    expect(d.savedPct).toBeLessThanOrEqual(100);
    if (d.recommendation === "diff") {
      expect(d.savedTokens).toBe(d.rewriteTokens - d.diffTokens);
    }
  });
});

describe("applyUnifiedDiff — fail-safe on corrupted diffs", () => {
  it("returns null on a diff whose context does not match original", () => {
    const original = "a\nb\nc\n";
    const aLines = splitLinesKeepingEol(original);
    const bogus =
      "--- original\n+++ proposed\n@@ -1,3 +1,3 @@\n MISMATCH\n-b\n+B\n c\n";
    expect(applyUnifiedDiff(original, bogus, aLines)).toBeNull();
  });

  it("returns null on malformed header", () => {
    const original = "a\n";
    const aLines = splitLinesKeepingEol(original);
    expect(
      applyUnifiedDiff(original, "--- original\n+++ proposed\nNOTAHUNK\n", aLines)
    ).toBeNull();
  });

  it("empty diff means no change -> returns original", () => {
    expect(applyUnifiedDiff("a\nb\n", "", splitLinesKeepingEol("a\nb\n"))).toBe(
      "a\nb\n"
    );
  });
});

describe("tokenCountMethod (W3 honesty)", () => {
  it("labels OpenAI-model counts exact and Claude-model counts estimated", () => {
    const a = "one\ntwo\nthree\n";
    const b = "one\ntwo CHANGED\nthree\n";
    expect(diffEnforce(a, b, { model: "gpt-4o" }).tokenCountMethod).toBe("exact");
    expect(diffEnforce(a, b, { model: "claude-sonnet-4-5-20250929" }).tokenCountMethod).toBe(
      "estimated",
    );
  });
});

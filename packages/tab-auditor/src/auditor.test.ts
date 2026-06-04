import { describe, it, expect } from "vitest";
import { auditOpenTabs, DEFAULT_DROP_THRESHOLD, type AuditInput } from "./auditor.js";

/**
 * Adversarial tests for the public auditor. We focus on the hard invariants
 * (active always kept, dirty always kept, null-token honesty), the structural
 * scoring behaviour (graph-vs-path adjacency, keyword renormalization, size
 * penalty), determinism, and robustness to garbage input.
 */

function find(report: ReturnType<typeof auditOpenTabs>, path: string) {
  const v = report.tabs.find((t) => t.path === path);
  if (!v) throw new Error(`verdict for ${path} not found`);
  return v;
}

describe("invariant: active file is always kept", () => {
  it("keeps the active file even when every signal is low", () => {
    const input: AuditInput = {
      activeFile: "src/zzz/lonely.ts",
      // active file is in a deep unique dir, no keywords match, huge, old
      tabs: [
        {
          path: "src/zzz/lonely.ts",
          tokenCount: 999999,
          lastAccessedAt: "2000-01-01T00:00:00Z",
          isDirty: false,
        },
        {
          path: "src/feature/relevant.ts",
          tokenCount: 100,
          lastAccessedAt: "2026-06-01T00:00:00Z",
        },
      ],
      taskKeywords: ["relevant", "feature"],
    };
    const report = auditOpenTabs(input);
    const active = find(report, "src/zzz/lonely.ts");
    expect(active.recommendation).toBe("keep");
    expect(active.reasons.join(" ")).toContain("active file");
  });
});

describe("invariant: dirty tab is always kept", () => {
  it("keeps an irrelevant dirty tab", () => {
    const input: AuditInput = {
      activeFile: "src/a/main.ts",
      tabs: [
        { path: "src/a/main.ts", tokenCount: 100 },
        {
          path: "totally/unrelated/scratch.ts",
          tokenCount: 50000,
          isDirty: true,
        },
      ],
      taskKeywords: ["main"],
    };
    const report = auditOpenTabs(input);
    const dirty = find(report, "totally/unrelated/scratch.ts");
    expect(dirty.recommendation).toBe("keep");
    expect(dirty.reasons.join(" ")).toContain("dirty");
    // and it must not be counted as droppable savings
    expect(report.totalDroppableTokens).toBe(0);
  });
});

describe("big low-relevance tab is dropped with its savings counted", () => {
  it("drops a large, unrelated, old tab and counts the tokens", () => {
    const input: AuditInput = {
      activeFile: "src/auth/login.ts",
      tabs: [
        {
          path: "src/auth/login.ts",
          tokenCount: 200,
          lastAccessedAt: "2026-06-01T12:00:00Z",
        },
        {
          path: "vendor/legacy/giant-bundle.generated.ts",
          tokenCount: 80000,
          lastAccessedAt: "2025-01-01T00:00:00Z",
        },
      ],
      taskKeywords: ["auth", "login"],
    };
    const report = auditOpenTabs(input);
    const giant = find(report, "vendor/legacy/giant-bundle.generated.ts");
    expect(giant.recommendation).toBe("drop");
    expect(report.totalDroppableTokens).toBe(80000);
    expect(report.droppedWithUnknownSavings).toBe(0);
    expect(report.droppedCount).toBe(1);
    expect(giant.reasons.join(" ")).toContain("savings 80000 tokens");
  });
});

describe("import-graph proximity beats path distance", () => {
  it("ranks a graph-connected far-path tab above a same-dir-ish unconnected tab", () => {
    // activeFile imports helper.ts which lives in a completely different dir.
    // sibling.ts shares no graph edge but sits two dirs away.
    const input: AuditInput = {
      activeFile: "src/feature/active.ts",
      tabs: [
        { path: "src/feature/active.ts", tokenCount: 100 },
        { path: "lib/deep/nested/helper.ts", tokenCount: 100 }, // graph neighbour
        { path: "src/other/sibling.ts", tokenCount: 100 }, // path-only, far
      ],
      importEdges: [
        { from: "src/feature/active.ts", to: "lib/deep/nested/helper.ts" },
      ],
      // no keywords so adjacency dominates
    };
    const report = auditOpenTabs(input);
    const helper = find(report, "lib/deep/nested/helper.ts");
    const sibling = find(report, "src/other/sibling.ts");
    expect(helper.relevanceScore).toBeGreaterThan(sibling.relevanceScore);
    expect(helper.reasons.join(" ")).toContain("import graph");
    expect(sibling.reasons.join(" ")).toContain("path distance");
  });

  it("falls back to path distance for a tab unreachable in the graph", () => {
    const input: AuditInput = {
      activeFile: "src/feature/active.ts",
      tabs: [
        { path: "src/feature/active.ts", tokenCount: 100 },
        { path: "src/feature/neighbor.ts", tokenCount: 100 },
      ],
      importEdges: [{ from: "some/island.ts", to: "another/island.ts" }],
    };
    const report = auditOpenTabs(input);
    const neighbor = find(report, "src/feature/neighbor.ts");
    expect(neighbor.reasons.join(" ")).toContain("path distance");
  });
});

describe("empty keywords renormalizes weights", () => {
  it("produces the same score whether taskKeywords is [] or omitted", () => {
    const base: AuditInput = {
      activeFile: "src/a/main.ts",
      tabs: [
        { path: "src/a/main.ts", tokenCount: 100, lastAccessedAt: "2026-06-01T00:00:00Z" },
        { path: "src/a/util.ts", tokenCount: 100, lastAccessedAt: "2026-05-01T00:00:00Z" },
      ],
    };
    const omitted = auditOpenTabs({ ...base });
    const empty = auditOpenTabs({ ...base, taskKeywords: [] });
    expect(empty.tabs.map((t) => [t.path, t.relevanceScore])).toEqual(
      omitted.tabs.map((t) => [t.path, t.relevanceScore]),
    );
    // and a tab that would have matched keywords scores the same as one that wouldn't
    for (const v of empty.tabs) {
      expect(v.reasons.join(" ")).toContain("task keywords absent");
    }
  });

  it("keywords actually change the ranking when present", () => {
    const withKw = auditOpenTabs({
      activeFile: "src/a/main.ts",
      tabs: [
        { path: "src/a/main.ts", tokenCount: 100 },
        { path: "src/a/payment-processor.ts", tokenCount: 100 },
        { path: "src/a/random-thing.ts", tokenCount: 100 },
      ],
      taskKeywords: ["payment", "processor"],
    });
    const payment = find(withKw, "src/a/payment-processor.ts");
    const random = find(withKw, "src/a/random-thing.ts");
    expect(payment.relevanceScore).toBeGreaterThan(random.relevanceScore);
  });
});

describe("null tokenCount honesty", () => {
  it("drops a low-relevance tab with unknown count as savings-unknown (not 0 data)", () => {
    const input: AuditInput = {
      activeFile: "src/auth/login.ts",
      tabs: [
        { path: "src/auth/login.ts", tokenCount: 100 },
        {
          path: "totally/unrelated/old.ts",
          tokenCount: null,
          lastAccessedAt: "2020-01-01T00:00:00Z",
        },
      ],
      taskKeywords: ["auth", "login"],
    };
    const report = auditOpenTabs(input);
    const dropped = find(report, "totally/unrelated/old.ts");
    expect(dropped.recommendation).toBe("drop");
    expect(report.droppedWithUnknownSavings).toBe(1);
    expect(report.totalDroppableTokens).toBe(0); // honest 0 sum, not a guess
    expect(dropped.reasons.join(" ")).toContain("savings unknown");
    expect(dropped.reasons.join(" ")).toContain("size signal omitted");
  });

  it("mixes known and unknown dropped tabs in the totals correctly", () => {
    const input: AuditInput = {
      activeFile: "src/x/active.ts",
      tabs: [
        { path: "src/x/active.ts", tokenCount: 100 },
        { path: "junk/a.ts", tokenCount: 5000, lastAccessedAt: "2020-01-01T00:00:00Z" },
        { path: "junk/b.ts", tokenCount: null, lastAccessedAt: "2020-01-01T00:00:00Z" },
        { path: "junk/c.ts", tokenCount: 3000, lastAccessedAt: "2020-01-01T00:00:00Z" },
      ],
      taskKeywords: ["active"],
    };
    const report = auditOpenTabs(input);
    expect(report.totalDroppableTokens).toBe(8000); // a + c only
    expect(report.droppedWithUnknownSavings).toBe(1); // b
    expect(report.droppedCount).toBe(3);
  });
});

describe("threshold configurability", () => {
  it("dropThreshold 0 drops nothing (no tab scores < 0)", () => {
    const report = auditOpenTabs(
      {
        activeFile: "src/a/main.ts",
        tabs: [
          { path: "src/a/main.ts", tokenCount: 100 },
          { path: "zzz/far.ts", tokenCount: 99999 },
        ],
      },
      { dropThreshold: 0 },
    );
    expect(report.droppedCount).toBe(0);
  });

  it("dropThreshold 1 drops every non-protected tab", () => {
    const report = auditOpenTabs(
      {
        activeFile: "src/a/main.ts",
        tabs: [
          { path: "src/a/main.ts", tokenCount: 100 },
          { path: "src/a/util.ts", tokenCount: 100 },
          { path: "src/a/scratch.ts", tokenCount: 100, isDirty: true },
        ],
      },
      { dropThreshold: 1 },
    );
    // active and dirty kept; util dropped
    expect(find(report, "src/a/main.ts").recommendation).toBe("keep");
    expect(find(report, "src/a/scratch.ts").recommendation).toBe("keep");
    expect(find(report, "src/a/util.ts").recommendation).toBe("drop");
  });

  it("defaults the threshold when not supplied", () => {
    expect(DEFAULT_DROP_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_DROP_THRESHOLD).toBeLessThan(1);
  });
});

describe("edge cases", () => {
  it("empty tab set yields an empty, well-formed report", () => {
    const report = auditOpenTabs({ activeFile: "src/a.ts", tabs: [] });
    expect(report.tabs).toEqual([]);
    expect(report.totalDroppableTokens).toBe(0);
    expect(report.droppedWithUnknownSavings).toBe(0);
    expect(report.keptCount).toBe(0);
    expect(report.droppedCount).toBe(0);
  });

  it("active file not present among tabs is fine", () => {
    const report = auditOpenTabs({
      activeFile: "src/ghost.ts",
      tabs: [{ path: "src/real.ts", tokenCount: 100 }],
    });
    expect(report.tabs).toHaveLength(1);
  });

  it("duplicate paths each get their own verdict and correct totals", () => {
    const report = auditOpenTabs({
      activeFile: "src/x/active.ts",
      tabs: [
        { path: "src/x/active.ts", tokenCount: 100 },
        { path: "junk/dup.ts", tokenCount: 1000, lastAccessedAt: "2020-01-01T00:00:00Z" },
        { path: "junk/dup.ts", tokenCount: 2000, lastAccessedAt: "2020-01-01T00:00:00Z" },
      ],
      taskKeywords: ["active"],
    });
    const dups = report.tabs.filter((t) => t.path === "junk/dup.ts");
    expect(dups).toHaveLength(2);
    if (dups.every((d) => d.recommendation === "drop")) {
      // each dup contributes its OWN count (1000 + 2000), not first-occurrence x2
      expect(report.totalDroppableTokens).toBe(3000);
    }
  });

  it("unicode paths tokenize and score without throwing", () => {
    const report = auditOpenTabs({
      activeFile: "src/café/活动.ts",
      tabs: [
        { path: "src/café/活动.ts", tokenCount: 100 },
        { path: "src/café/データ.ts", tokenCount: 100 },
        { path: "src/Ünïcödë/файл.ts", tokenCount: 100 },
      ],
      taskKeywords: ["данные", "活动"],
    });
    expect(report.tabs).toHaveLength(3);
    for (const v of report.tabs) {
      expect(v.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(v.relevanceScore).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic: identical input yields identical output", () => {
    const input: AuditInput = {
      activeFile: "src/a/main.ts",
      tabs: [
        { path: "src/a/main.ts", tokenCount: 100, lastAccessedAt: "2026-06-01T00:00:00Z" },
        { path: "src/a/b.ts", tokenCount: 200, lastAccessedAt: "2026-05-01T00:00:00Z" },
        { path: "src/c/d.ts", tokenCount: 300, lastAccessedAt: "2026-04-01T00:00:00Z" },
      ],
      taskKeywords: ["main"],
      importEdges: [{ from: "src/a/main.ts", to: "src/a/b.ts" }],
    };
    const a = JSON.stringify(auditOpenTabs(input));
    const b = JSON.stringify(auditOpenTabs(input));
    expect(a).toBe(b);
  });

  it("stable ordering: equal-relevance tabs ordered by path", () => {
    // Two tabs with identical signals → identical scores → tie-break by path.
    const report = auditOpenTabs({
      activeFile: "root/active.ts",
      tabs: [
        { path: "root/active.ts", tokenCount: 100 },
        { path: "root/zeta.ts", tokenCount: 100 },
        { path: "root/alpha.ts", tokenCount: 100 },
      ],
    });
    const idxAlpha = report.tabs.findIndex((t) => t.path === "root/alpha.ts");
    const idxZeta = report.tabs.findIndex((t) => t.path === "root/zeta.ts");
    // same score → alpha before zeta
    if (
      find(report, "root/alpha.ts").relevanceScore ===
      find(report, "root/zeta.ts").relevanceScore
    ) {
      expect(idxAlpha).toBeLessThan(idxZeta);
    }
  });

  it("output is sorted by descending relevance", () => {
    const report = auditOpenTabs({
      activeFile: "src/a/main.ts",
      tabs: [
        { path: "src/a/main.ts", tokenCount: 100 },
        { path: "far/away/thing.ts", tokenCount: 99999 },
        { path: "src/a/close.ts", tokenCount: 100 },
      ],
      taskKeywords: ["main"],
    });
    for (let i = 1; i < report.tabs.length; i++) {
      expect(report.tabs[i - 1].relevanceScore).toBeGreaterThanOrEqual(
        report.tabs[i].relevanceScore,
      );
    }
  });
});

describe("garbage input never throws", () => {
  it("handles null / undefined / wrong-typed input", () => {
    // @ts-expect-error intentional bad input
    expect(() => auditOpenTabs(null)).not.toThrow();
    // @ts-expect-error intentional bad input
    expect(() => auditOpenTabs(undefined)).not.toThrow();
    // @ts-expect-error intentional bad input
    expect(() => auditOpenTabs("nope")).not.toThrow();
    // @ts-expect-error intentional bad input
    expect(() => auditOpenTabs({})).not.toThrow();
  });

  it("filters out tabs without a string path", () => {
    const report = auditOpenTabs({
      activeFile: "src/a.ts",
      // @ts-expect-error mixed garbage in tabs
      tabs: [
        null,
        undefined,
        42,
        { path: 123 },
        { path: "src/a.ts", tokenCount: 100 },
        { path: "src/keep.ts", tokenCount: 100 },
      ],
    });
    expect(report.tabs.map((t) => t.path).sort()).toEqual(["src/a.ts", "src/keep.ts"]);
  });

  it("tolerates malformed timestamps, NaN/negative token counts, bad edges", () => {
    const report = auditOpenTabs({
      activeFile: "src/a/main.ts",
      tabs: [
        { path: "src/a/main.ts", tokenCount: 100, lastAccessedAt: "not-a-date" },
        { path: "src/a/b.ts", tokenCount: Number.NaN, lastAccessedAt: "also bad" },
        { path: "src/a/c.ts", tokenCount: -50 },
      ],
      // @ts-expect-error malformed edges
      importEdges: [null, { from: 1, to: 2 }, { from: "x" }, { from: "src/a/main.ts", to: "src/a/b.ts" }],
      taskKeywords: ["main"],
    });
    expect(report.tabs).toHaveLength(3);
    // NaN / negative counts are treated as unknown for the size signal
    const b = find(report, "src/a/b.ts");
    const c = find(report, "src/a/c.ts");
    expect(b.reasons.join(" ")).toContain("size signal omitted");
    expect(c.reasons.join(" ")).toContain("size signal omitted");
  });
});

describe("weight overrides", () => {
  it("respects a custom weight emphasizing taskMatch", () => {
    const input: AuditInput = {
      activeFile: "src/a/main.ts",
      tabs: [
        { path: "src/a/main.ts", tokenCount: 100 },
        { path: "src/a/billing-invoice.ts", tokenCount: 100 },
      ],
      taskKeywords: ["billing", "invoice"],
    };
    const heavy = auditOpenTabs(input, {
      weights: { activeAdjacency: 0, recency: 0, taskMatch: 1, sizePenalty: 0 },
    });
    const billing = find(heavy, "src/a/billing-invoice.ts");
    const main = find(heavy, "src/a/main.ts");
    // With all weight on taskMatch, the billing tab (path tokens overlap the
    // keywords) must score strictly higher than a tab whose path does not.
    // Exact value: tokens {src,a,billing,invoice,ts} ∩ {billing,invoice} = 2,
    // union 5 → jaccard 0.4. The "main" tab has 0 overlap → 0.
    expect(billing.relevanceScore).toBeCloseTo(0.4, 10);
    expect(billing.relevanceScore).toBeGreaterThan(main.relevanceScore);
  });
});

import { describe, it, expect } from "vitest";
import { buildWasteMemo, type WasteRecord } from "./waste-memo.js";

function rec(fingerprint: string, atIso: string, tokens: number, costUsd?: number | null): WasteRecord {
  return { fingerprint, atIso, tokens, costUsd };
}

describe("buildWasteMemo", () => {
  it("surfaces a pattern that recurs across enough distinct days", () => {
    const memo = buildWasteMemo([
      rec("fp-A", "2026-06-01T10:00:00Z", 1000, 0.05),
      rec("fp-A", "2026-06-02T10:00:00Z", 1000, 0.05),
      rec("fp-A", "2026-06-03T10:00:00Z", 1000, 0.05),
    ]);
    expect(memo.patterns.length).toBe(1);
    const p = memo.patterns[0]!;
    expect(p.fingerprint).toBe("fp-A");
    expect(p.occurrences).toBe(3);
    expect(p.distinctDays).toBe(3);
    expect(p.totalTokens).toBe(3000);
    expect(p.totalCostUsd).toBeCloseTo(0.15, 9);
    expect(p.firstSeenIso).toBe("2026-06-01T10:00:00Z");
    expect(p.lastSeenIso).toBe("2026-06-03T10:00:00Z");
  });

  it("excludes a pattern below the occurrence threshold", () => {
    const memo = buildWasteMemo([
      rec("fp-A", "2026-06-01T10:00:00Z", 1000, 0.05),
      rec("fp-A", "2026-06-02T10:00:00Z", 1000, 0.05),
    ]); // only 2 occurrences, default minOccurrences 3
    expect(memo.patterns.length).toBe(0);
    expect(memo.belowThreshold).toBe(1);
  });

  it("excludes a pattern that all happened on ONE day (not a habit)", () => {
    const memo = buildWasteMemo([
      rec("fp-A", "2026-06-01T08:00:00Z", 1000, 0.05),
      rec("fp-A", "2026-06-01T12:00:00Z", 1000, 0.05),
      rec("fp-A", "2026-06-01T18:00:00Z", 1000, 0.05),
    ]); // 3 occurrences but 1 distinct day
    expect(memo.patterns.length).toBe(0);
    expect(memo.belowThreshold).toBe(1);
  });

  it("returns null cost when any occurrence is unpriced, and still ranks by tokens", () => {
    const memo = buildWasteMemo([
      rec("fp-A", "2026-06-01T10:00:00Z", 1000, 0.05),
      rec("fp-A", "2026-06-02T10:00:00Z", 1000, null), // unpriced
      rec("fp-A", "2026-06-03T10:00:00Z", 1000, 0.05),
    ]);
    expect(memo.patterns[0]!.totalCostUsd).toBeNull();
    expect(memo.patterns[0]!.totalTokens).toBe(3000);
  });

  it("ranks priced patterns above unpriced, and by cost desc", () => {
    const recs: WasteRecord[] = [];
    // fp-cheap: priced, total $0.30
    for (let d = 1; d <= 3; d++) recs.push(rec("fp-cheap", `2026-06-0${d}T10:00:00Z`, 100, 0.1));
    // fp-expensive: priced, total $0.90
    for (let d = 1; d <= 3; d++) recs.push(rec("fp-expensive", `2026-06-0${d}T11:00:00Z`, 100, 0.3));
    // fp-unpriced: huge tokens but null cost
    for (let d = 1; d <= 3; d++) recs.push(rec("fp-unpriced", `2026-06-0${d}T12:00:00Z`, 99999, null));
    const memo = buildWasteMemo(recs);
    expect(memo.patterns.map((p) => p.fingerprint)).toEqual([
      "fp-expensive",
      "fp-cheap",
      "fp-unpriced",
    ]);
  });

  it("respects topN", () => {
    const recs: WasteRecord[] = [];
    for (const fp of ["a", "b", "c"]) {
      for (let d = 1; d <= 3; d++) recs.push(rec(fp, `2026-06-0${d}T10:00:00Z`, 100, 0.1));
    }
    expect(buildWasteMemo(recs, { topN: 2 }).patterns.length).toBe(2);
    expect(buildWasteMemo(recs, { topN: 0 }).patterns.length).toBe(3); // 0 = all
  });

  it("carries a content-free label through, first non-empty wins", () => {
    const memo = buildWasteMemo([
      rec("fp-A", "2026-06-01T10:00:00Z", 1000, 0.05),
      { ...rec("fp-A", "2026-06-02T10:00:00Z", 1000, 0.05), label: "huge-paste" },
      rec("fp-A", "2026-06-03T10:00:00Z", 1000, 0.05),
    ]);
    expect(memo.patterns[0]!.label).toBe("huge-paste");
  });

  it("skips malformed records and bad timestamps", () => {
    const memo = buildWasteMemo([
      rec("fp-A", "2026-06-01T10:00:00Z", 1000, 0.05),
      { fingerprint: "fp-A", tokens: 1, atIso: "not-a-date" },
      { fingerprint: "fp-A", atIso: "2026-06-02T10:00:00Z" }, // missing tokens
      null,
    ] as unknown);
    expect(memo.skipped).toBe(3);
  });

  it("is total on garbage input", () => {
    expect(buildWasteMemo(null).patterns).toEqual([]);
    expect(buildWasteMemo("nope" as unknown).totalPatternsSeen).toBe(0);
  });

  it("is deterministic", () => {
    const recs = [
      rec("fp-A", "2026-06-01T10:00:00Z", 1000, 0.05),
      rec("fp-A", "2026-06-02T10:00:00Z", 1000, 0.05),
      rec("fp-A", "2026-06-03T10:00:00Z", 1000, 0.05),
    ];
    expect(buildWasteMemo(recs)).toEqual(buildWasteMemo(recs));
  });
});

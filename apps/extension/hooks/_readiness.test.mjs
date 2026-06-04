import { describe, it, expect } from "vitest";

import {
  buildReadinessReport,
  normalizeThreshold,
  formatReadiness,
  DEFAULT_READINESS_THRESHOLD,
} from "./_readiness.mjs";
import { parseArgs, runReadiness } from "./flags.mjs";

const IDS = ["f1", "f9", "f10"];
const NAMES = { f1: "trajectoryDiet", f9: "cacheHabits", f10: "mcpProxy" };

describe("normalizeThreshold", () => {
  it("keeps a positive integer", () => {
    expect(normalizeThreshold(10)).toBe(10);
    expect(normalizeThreshold(10.9)).toBe(10); // truncated
  });
  it("falls back to the default for non-positive / non-finite", () => {
    expect(normalizeThreshold(0)).toBe(DEFAULT_READINESS_THRESHOLD);
    expect(normalizeThreshold(-5)).toBe(DEFAULT_READINESS_THRESHOLD);
    expect(normalizeThreshold(NaN)).toBe(DEFAULT_READINESS_THRESHOLD);
    expect(normalizeThreshold(undefined)).toBe(DEFAULT_READINESS_THRESHOLD);
    expect(normalizeThreshold("50")).toBe(DEFAULT_READINESS_THRESHOLD);
  });
});

describe("buildReadinessReport", () => {
  it("marks READY at/above threshold, NOT-READY below", () => {
    const r = buildReadinessReport(IDS, { f1: 50, f9: 49, f10: 100 }, 50);
    expect(r.threshold).toBe(50);
    expect(r.rows).toEqual([
      { id: "f1", count: 50, ready: true }, // == threshold ⇒ READY
      { id: "f9", count: 49, ready: false }, // one short
      { id: "f10", count: 100, ready: true },
    ]);
    expect(r.readyCount).toBe(2);
  });

  it("a feature absent from counts is reported as 0 / NOT-READY (never hidden)", () => {
    const r = buildReadinessReport(IDS, { f9: 60 }, 50);
    expect(r.rows.find((x) => x.id === "f1")).toEqual({
      id: "f1",
      count: 0,
      ready: false,
    });
    expect(r.readyCount).toBe(1);
  });

  it("defensively treats odd count values as 0", () => {
    const r = buildReadinessReport(
      IDS,
      { f1: -3, f9: NaN, f10: "lots" },
      10
    );
    expect(r.rows.every((x) => x.count === 0 && !x.ready)).toBe(true);
    expect(r.readyCount).toBe(0);
  });

  it("uses the default threshold when given a bad one", () => {
    // -1 is invalid ⇒ threshold falls back to the default (50).
    const r = buildReadinessReport(IDS, { f1: 50, f9: 49 }, -1);
    expect(r.threshold).toBe(DEFAULT_READINESS_THRESHOLD); // 50
    // count 50 >= default 50 ⇒ READY; count 49 < 50 ⇒ NOT-READY.
    expect(r.rows.find((x) => x.id === "f1").ready).toBe(true);
    expect(r.rows.find((x) => x.id === "f9").ready).toBe(false);
  });

  it("handles a null/garbage counts map without throwing", () => {
    expect(() => buildReadinessReport(IDS, null, 5)).not.toThrow();
    const r = buildReadinessReport(IDS, undefined, 5);
    expect(r.readyCount).toBe(0);
  });
});

describe("formatReadiness", () => {
  it("prints the 'no telemetry yet' footer when everything is 0", () => {
    const r = buildReadinessReport(IDS, {}, 50);
    const text = formatReadiness(r, (id) => NAMES[id]);
    expect(text).toContain("no telemetry yet");
    expect(text).toContain("threshold: 50");
    expect(text).toMatch(/f1\s+trajectoryDiet\s+events=\s*0\s+NOT-READY/);
  });

  it("prints the non-automatic-promotion footer when some counts exist", () => {
    const r = buildReadinessReport(IDS, { f10: 80 }, 50);
    const text = formatReadiness(r, (id) => NAMES[id]);
    expect(text).toContain("Promotion is NOT automatic");
    expect(text).toContain("1/3 feature(s) at or above threshold");
    expect(text).toMatch(/f10\s+mcpProxy\s+events=\s*80\s+READY/);
  });
});

describe("parseArgs readiness", () => {
  it("parses bare readiness with no --min", () => {
    expect(parseArgs(["readiness"])).toEqual({ kind: "readiness", min: undefined });
  });
  it("parses --min N and --min=N", () => {
    expect(parseArgs(["readiness", "--min", "30"])).toEqual({
      kind: "readiness",
      min: 30,
    });
    expect(parseArgs(["readiness", "--min=25"])).toEqual({
      kind: "readiness",
      min: 25,
    });
  });
  it("rejects a missing/invalid --min value", () => {
    expect(parseArgs(["readiness", "--min"]).error).toBeTruthy();
    expect(parseArgs(["readiness", "--min", "0"]).error).toBeTruthy();
    expect(parseArgs(["readiness", "--min", "-4"]).error).toBeTruthy();
    expect(parseArgs(["readiness", "--min", "abc"]).error).toBeTruthy();
  });
  it("rejects unexpected positional args", () => {
    expect(parseArgs(["readiness", "f9"]).error).toContain("unexpected argument");
  });
});

describe("runReadiness (report-only, injected counts)", () => {
  it("reports counts and exits 0 without touching flags", async () => {
    let printed = "";
    const code = await runReadiness(
      { kind: "readiness", min: 50 },
      {
        env: {},
        out: (s) => (printed += s),
        // Inject the sink read so the test never opens a real DB.
        readCounts: async () => ({ counts: { f10: 90, f9: 10 }, hadDb: true }),
      }
    );
    expect(code).toBe(0);
    expect(printed).toContain("mcpProxy");
    expect(printed).toMatch(/f10\s+mcpProxy\s+events=\s*90\s+READY/);
    expect(printed).toMatch(/f9\s+cacheHabits\s+events=\s*10\s+NOT-READY/);
    expect(printed).toContain("Promotion is NOT automatic");
  });

  it("a missing DB prints a clean no-telemetry report (fail-safe)", async () => {
    let printed = "";
    const code = await runReadiness(
      { kind: "readiness", min: undefined },
      {
        env: {},
        out: (s) => (printed += s),
        readCounts: async () => ({ counts: {}, hadDb: false }),
      }
    );
    expect(code).toBe(0);
    expect(printed).toContain("no telemetry yet");
  });
});

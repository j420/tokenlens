import { describe, expect, it } from "vitest";
import {
  amortizingTtlChooser,
  BREAK_EVEN_READS_PER_HOUR,
  chooseTtl,
  readsPerHour,
  type PrefixReadHistory,
} from "./ttl-amortization.js";

const HISTORY = (reads: number, windowMs: number): PrefixReadHistory => ({
  fingerprint: "fp1",
  reads,
  windowMs,
});

describe("readsPerHour", () => {
  it("12 reads in 1 hour = 12 reads/hour", () => {
    expect(readsPerHour(HISTORY(12, 3_600_000))).toBeCloseTo(12, 5);
  });

  it("6 reads in 30 minutes = 12 reads/hour", () => {
    expect(readsPerHour(HISTORY(6, 1_800_000))).toBeCloseTo(12, 5);
  });

  it("0 reads → 0 reads/hour", () => {
    expect(readsPerHour(HISTORY(0, 3_600_000))).toBe(0);
  });

  it("non-finite window → 0", () => {
    expect(readsPerHour(HISTORY(10, Number.NaN))).toBe(0);
    expect(readsPerHour(HISTORY(10, Number.POSITIVE_INFINITY))).toBe(0);
  });

  it("zero-length window → 0", () => {
    expect(readsPerHour(HISTORY(10, 0))).toBe(0);
  });

  it("negative reads → 0 (defensive)", () => {
    expect(readsPerHour(HISTORY(-1, 3_600_000))).toBe(0);
  });
});

describe("chooseTtl — at and around break-even", () => {
  it("≥ 12 reads/hour picks 1h", () => {
    const d = chooseTtl(HISTORY(12, 3_600_000));
    expect(d.ttl).toBe("1h");
    expect(d.breakEven).toBe(BREAK_EVEN_READS_PER_HOUR);
  });

  it("< 12 reads/hour picks 5m", () => {
    const d = chooseTtl(HISTORY(11, 3_600_000));
    expect(d.ttl).toBe("5m");
  });

  it("missing history → 5m (conservative default)", () => {
    expect(chooseTtl(undefined).ttl).toBe("5m");
  });

  it("custom break-even respected (e.g. 20)", () => {
    expect(chooseTtl(HISTORY(15, 3_600_000), 20).ttl).toBe("5m");
    expect(chooseTtl(HISTORY(25, 3_600_000), 20).ttl).toBe("1h");
  });

  it("invalid break-even (NaN, 0) falls back to default", () => {
    expect(chooseTtl(HISTORY(12, 3_600_000), Number.NaN).breakEven).toBe(12);
    expect(chooseTtl(HISTORY(12, 3_600_000), 0).breakEven).toBe(12);
  });

  it("rationale is non-empty and references the rate", () => {
    const d = chooseTtl(HISTORY(20, 3_600_000));
    expect(d.rationale.length).toBeGreaterThan(0);
    expect(d.rationale).toContain("reads/hour");
  });
});

describe("amortizingTtlChooser", () => {
  it("returns 1h when the fingerprint shows high read rate", () => {
    const histories = new Map<string, PrefixReadHistory>();
    histories.set("fp-A", HISTORY(20, 3_600_000));
    const chooser = amortizingTtlChooser({
      histories,
      keyFor: () => "fp-A",
    });
    expect(
      chooser({
        request: {
          model: "claude-sonnet-4-5-20250929",
          system: [],
          tools: [],
          messages: [],
          max_tokens: 1024,
        },
        candidate: { segment: "system", blockIndex: 0, cumulativeTokens: 5000 },
      })
    ).toBe("1h");
  });

  it("returns the defaultTtl when no history for the fingerprint", () => {
    const chooser = amortizingTtlChooser({
      histories: new Map(),
      keyFor: () => "missing",
      defaultTtl: "5m",
    });
    expect(
      chooser({
        request: {
          model: "claude-sonnet-4-5-20250929",
          system: [],
          tools: [],
          messages: [],
          max_tokens: 1024,
        },
        candidate: { segment: "tools", blockIndex: 0, cumulativeTokens: 1024 },
      })
    ).toBe("5m");
  });

  it("falls back to defaultTtl on empty keyFor", () => {
    const histories = new Map<string, PrefixReadHistory>();
    const chooser = amortizingTtlChooser({
      histories,
      keyFor: () => "",
      defaultTtl: "5m",
    });
    expect(
      chooser({
        request: {
          model: "claude-sonnet-4-5-20250929",
          system: [],
          tools: [],
          messages: [],
          max_tokens: 1024,
        },
        candidate: { segment: "messages", blockIndex: 0, cumulativeTokens: 200 },
      })
    ).toBe("5m");
  });

  it("custom break-even threshold passed through", () => {
    const histories = new Map<string, PrefixReadHistory>();
    histories.set("k", HISTORY(15, 3_600_000)); // 15 reads/hour
    const chooser = amortizingTtlChooser({
      histories,
      keyFor: () => "k",
      breakEven: 20,
    });
    // 15 < 20 ⇒ "5m"
    expect(
      chooser({
        request: {
          model: "x",
          system: [],
          tools: [],
          messages: [],
          max_tokens: 1024,
        },
        candidate: { segment: "system", blockIndex: 0, cumulativeTokens: 1 },
      })
    ).toBe("5m");
  });
});

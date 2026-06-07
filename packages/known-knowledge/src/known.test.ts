import { describe, it, expect } from "vitest";
import {
  emptyKnownStore,
  recordProbe,
  recordFetchBack,
  negotiateSpans,
  type Span,
} from "./known.js";

const M = "claude-sonnet-4-5";
const span = (id: string, sha: string, tokens: number): Span => ({ id, sha, tokens });

describe("known-knowledge negotiation", () => {
  it("stubs a span the offline probe judged model-known", () => {
    let s = emptyKnownStore();
    s = recordProbe(s, { sha: "sha-stdlib", modelId: M, known: true, atIso: "2026-06-01T00:00:00Z" });
    const plan = negotiateSpans(s, [span("a", "sha-stdlib", 500)], { modelId: M, stubTokens: 8 });
    expect(plan.spans[0]!.decision).toBe("stub");
    expect(plan.spans[0]!.savedTokens).toBe(492);
    expect(plan.spans[0]!.reason).toBe("model-knows");
    expect(plan.savedTokens).toBe(492);
    expect(plan.stubbedCount).toBe(1);
  });

  it("sends full for an unprobed span (default is always send-full)", () => {
    const plan = negotiateSpans(emptyKnownStore(), [span("a", "sha-x", 500)], { modelId: M });
    expect(plan.spans[0]!.decision).toBe("full");
    expect(plan.spans[0]!.reason).toBe("not-probed");
  });

  it("sends full for a DIFFERENT sha (an edit invalidates the verdict)", () => {
    let s = emptyKnownStore();
    s = recordProbe(s, { sha: "sha-v1", modelId: M, known: true, atIso: "2026-06-01T00:00:00Z" });
    // the span was edited → new sha → no verdict → full
    const plan = negotiateSpans(s, [span("a", "sha-v2", 500)], { modelId: M });
    expect(plan.spans[0]!.decision).toBe("full");
  });

  it("sends full for a DIFFERENT model (verdicts are per-model)", () => {
    let s = emptyKnownStore();
    s = recordProbe(s, { sha: "sha-x", modelId: M, known: true, atIso: "2026-06-01T00:00:00Z" });
    const plan = negotiateSpans(s, [span("a", "sha-x", 500)], { modelId: "gpt-4o" });
    expect(plan.spans[0]!.decision).toBe("full");
  });

  it("demotes a span after a fetch-back (self-correcting)", () => {
    let s = emptyKnownStore();
    s = recordProbe(s, { sha: "sha-x", modelId: M, known: true, atIso: "2026-06-01T00:00:00Z" });
    s = recordFetchBack(s, { sha: "sha-x", modelId: M, atIso: "2026-06-02T00:00:00Z" });
    // 1 known − 1 fetchback = margin 0 < 1 → demoted
    const plan = negotiateSpans(s, [span("a", "sha-x", 500)], { modelId: M });
    expect(plan.spans[0]!.decision).toBe("full");
    expect(plan.spans[0]!.reason).toBe("demoted-by-fetchback");
  });

  it("re-stubs once known probes outweigh fetch-backs again", () => {
    let s = emptyKnownStore();
    s = recordProbe(s, { sha: "sha-x", modelId: M, known: true, atIso: "2026-06-01T00:00:00Z" });
    s = recordFetchBack(s, { sha: "sha-x", modelId: M, atIso: "2026-06-02T00:00:00Z" });
    s = recordProbe(s, { sha: "sha-x", modelId: M, known: true, atIso: "2026-06-03T00:00:00Z" });
    s = recordProbe(s, { sha: "sha-x", modelId: M, known: true, atIso: "2026-06-04T00:00:00Z" });
    // 3 known − 1 fetchback = 2 >= 1 → stub again
    expect(negotiateSpans(s, [span("a", "sha-x", 500)], { modelId: M }).spans[0]!.decision).toBe("stub");
  });

  it("a not-known probe counts against the margin", () => {
    let s = emptyKnownStore();
    s = recordProbe(s, { sha: "sha-x", modelId: M, known: true, atIso: "2026-06-01T00:00:00Z" });
    s = recordProbe(s, { sha: "sha-x", modelId: M, known: false, atIso: "2026-06-02T00:00:00Z" });
    // 1 known, 1 not-known → margin 0 → full
    expect(negotiateSpans(s, [span("a", "sha-x", 500)], { modelId: M }).spans[0]!.decision).toBe("full");
  });

  it("never inflates: a span no bigger than the stub is sent full", () => {
    let s = emptyKnownStore();
    s = recordProbe(s, { sha: "sha-tiny", modelId: M, known: true, atIso: "2026-06-01T00:00:00Z" });
    const plan = negotiateSpans(s, [span("a", "sha-tiny", 8)], { modelId: M, stubTokens: 8 });
    expect(plan.spans[0]!.decision).toBe("full");
    expect(plan.spans[0]!.reason).toBe("stub-not-smaller");
  });

  it("respects a higher minKnownMargin", () => {
    let s = emptyKnownStore();
    s = recordProbe(s, { sha: "sha-x", modelId: M, known: true, atIso: "2026-06-01T00:00:00Z" });
    // margin 1 but threshold 2 → full
    expect(
      negotiateSpans(s, [span("a", "sha-x", 500)], { modelId: M, minKnownMargin: 2 }).spans[0]!.reason
    ).toBe("below-margin");
  });

  it("skips malformed spans/events without throwing", () => {
    let s = recordProbe(emptyKnownStore(), { sha: "sha-x", modelId: M, known: true, atIso: "bad-date" });
    // bad date → no record folded
    expect(negotiateSpans(s, [span("a", "sha-x", 500)], { modelId: M }).spans[0]!.decision).toBe("full");
    const plan = negotiateSpans(emptyKnownStore(), [span("a", "sha-x", 500), { id: "b" }, null], {
      modelId: M,
    } as unknown as Parameters<typeof negotiateSpans>[2]);
    expect(plan.skippedMalformed).toBe(2);
  });

  it("round-trips through JSON", () => {
    let s = recordProbe(emptyKnownStore(), { sha: "sha-x", modelId: M, known: true, atIso: "2026-06-01T00:00:00Z" });
    const round = recordProbe(JSON.parse(JSON.stringify(s)), { sha: "sha-x", modelId: M, known: true, atIso: "2026-06-02T00:00:00Z" });
    expect(round.records[Object.keys(round.records)[0]!]!.knownProbes).toBe(2);
  });

  it("is total on garbage", () => {
    expect(negotiateSpans(null, null, { modelId: M }).spans).toEqual([]);
    expect(recordProbe(null, null)).toEqual(emptyKnownStore());
  });

  it("is deterministic", () => {
    let s = recordProbe(emptyKnownStore(), { sha: "sha-x", modelId: M, known: true, atIso: "2026-06-01T00:00:00Z" });
    const spans = [span("a", "sha-x", 500)];
    expect(negotiateSpans(s, spans, { modelId: M })).toEqual(negotiateSpans(s, spans, { modelId: M }));
  });
});

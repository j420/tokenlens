/**
 * Tests for the N6 pre-spawn subagent cost predictor.
 *
 * Pins the discipline: caller-supplied numbers only, strict pricing (unpriced
 * model ⇒ null USD, never a default), honest absence (insufficient_data), and
 * uncertainty surfaced as p50/p90/mean rather than a single point.
 */

import { describe, it, expect } from "vitest";
import {
  predictSubagentCost,
  isModelPriced,
  type SubagentCostSample,
} from "./subagent-cost-predictor.js";
import { calculateCost } from "@prune/shared";

const PRICED_MODEL = "claude-sonnet-4-5-20250929";

function sample(tokensIn: number, tokensOut: number, over: Partial<SubagentCostSample> = {}): SubagentCostSample {
  return { tokensIn, tokensOut, ...over };
}

describe("isModelPriced", () => {
  it("is true for a model in the pricing table, false otherwise", () => {
    expect(isModelPriced(PRICED_MODEL)).toBe(true);
    expect(isModelPriced("totally-made-up-model")).toBe(false);
    expect(isModelPriced("")).toBe(false);
  });
});

describe("predictSubagentCost — insufficient data", () => {
  it("empty history ⇒ insufficient_data, all projections null", () => {
    const p = predictSubagentCost({ history: [], proposedCount: 3, model: PRICED_MODEL });
    expect(p.basis).toBe("insufficient_data");
    expect(p.sampleSize).toBe(0);
    expect(p.perSubagentTokens).toBeNull();
    expect(p.perSubagentUsd).toBeNull();
    expect(p.projectedTotalUsd).toBeNull();
    expect(p.projectedTotalTokens).toBeNull();
  });

  it("samples with neither tokens nor explicit cost are skipped", () => {
    const p = predictSubagentCost({
      history: [sample(0, 0), { tokensIn: 0, tokensOut: 0 }],
      proposedCount: 2,
      model: PRICED_MODEL,
    });
    expect(p.basis).toBe("insufficient_data");
    expect(p.sampleSize).toBe(0);
  });
});

describe("predictSubagentCost — token projection", () => {
  it("computes per-subagent token quantiles and scales by proposedCount", () => {
    // totals (in+out): 100, 200, 300, 1000
    const p = predictSubagentCost({
      history: [sample(50, 50), sample(100, 100), sample(150, 150), sample(500, 500)],
      proposedCount: 4,
      model: PRICED_MODEL,
    });
    expect(p.basis).toBe("session-history");
    expect(p.sampleSize).toBe(4);
    expect(p.perSubagentTokens).not.toBeNull();
    // mean of 100,200,300,1000 = 400
    expect(p.perSubagentTokens!.mean).toBeCloseTo(400);
    // nearest-rank p50 over [100,200,300,1000] = rank ceil(0.5*4)=2 ⇒ 200
    expect(p.perSubagentTokens!.p50).toBe(200);
    // p90 = rank ceil(0.9*4)=4 ⇒ 1000
    expect(p.perSubagentTokens!.p90).toBe(1000);
    // projected total = per-subagent * 4
    expect(p.projectedTotalTokens!.mean).toBeCloseTo(1600);
    expect(p.projectedTotalTokens!.p90).toBe(4000);
  });
});

describe("predictSubagentCost — strict pricing", () => {
  it("derives USD from the pricing table for a priced model", () => {
    const hist = [sample(1000, 500), sample(2000, 1000)];
    const p = predictSubagentCost({ history: hist, proposedCount: 2, model: PRICED_MODEL });
    expect(p.priced).toBe(true);
    expect(p.perSubagentUsd).not.toBeNull();
    // mean should equal the average of the two computed costs.
    const c1 = calculateCost("anthropic", PRICED_MODEL, 1000, 500, 0);
    const c2 = calculateCost("anthropic", PRICED_MODEL, 2000, 1000, 0);
    expect(p.perSubagentUsd!.mean).toBeCloseTo((c1 + c2) / 2);
    expect(p.projectedTotalUsd!.mean).toBeCloseTo(((c1 + c2) / 2) * 2);
  });

  it("UNPRICED model ⇒ priced:false, USD null, but tokens still projected", () => {
    const p = predictSubagentCost({
      history: [sample(1000, 500), sample(2000, 1000)],
      proposedCount: 3,
      model: "some-unlisted-model-x",
    });
    expect(p.priced).toBe(false);
    expect(p.perSubagentUsd).toBeNull();
    expect(p.projectedTotalUsd).toBeNull();
    // Tokens are model-independent, so they are still projected.
    expect(p.perSubagentTokens).not.toBeNull();
    expect(p.projectedTotalTokens).not.toBeNull();
  });

  it("uses an explicit costUsd even when the model is unpriced (caller knows best)", () => {
    const p = predictSubagentCost({
      history: [sample(0, 0, { costUsd: 0.10 }), sample(0, 0, { costUsd: 0.30 })],
      proposedCount: 2,
      model: "some-unlisted-model-x",
    });
    expect(p.priced).toBe(true); // explicit cost made USD available
    expect(p.perSubagentUsd!.mean).toBeCloseTo(0.2);
    expect(p.projectedTotalUsd!.mean).toBeCloseTo(0.4);
    // No tokens were supplied, so the token projection is null (honest).
    expect(p.perSubagentTokens).toBeNull();
  });

  it("a WRONG explicit provider does NOT fabricate a default rate (provider-aware strictness)", () => {
    // gpt-4o is in the table under "openai"; passing provider "google" must NOT
    // fall through to calculateCost's DEFAULT_PRICING and invent a rate.
    const wrong = predictSubagentCost({
      history: [sample(1_000_000, 1_000_000)],
      proposedCount: 1,
      model: "gpt-4o",
      provider: "google",
    });
    expect(wrong.priced).toBe(false);
    expect(wrong.perSubagentUsd).toBeNull();
    // With the correct (auto-detected) provider it IS priced at the real rate.
    const right = predictSubagentCost({
      history: [sample(1_000_000, 1_000_000)],
      proposedCount: 1,
      model: "gpt-4o",
    });
    expect(right.priced).toBe(true);
    const expected = calculateCost("openai", "gpt-4o", 1_000_000, 1_000_000, 0);
    expect(right.perSubagentUsd!.mean).toBeCloseTo(expected);
  });

  it("explicit costUsd takes precedence over the derived price", () => {
    const p = predictSubagentCost({
      history: [sample(1000, 500, { costUsd: 99 })],
      proposedCount: 1,
      model: PRICED_MODEL,
    });
    expect(p.perSubagentUsd!.mean).toBe(99);
  });
});

describe("predictSubagentCost — robustness", () => {
  it("defaults proposedCount to 1 when missing/invalid", () => {
    const p = predictSubagentCost({
      history: [sample(100, 100)],
      proposedCount: 0,
      model: PRICED_MODEL,
    });
    expect(p.proposedCount).toBe(1);
    expect(p.projectedTotalTokens!.mean).toBeCloseTo(p.perSubagentTokens!.mean);
  });

  it("ignores NaN/negative token fields without throwing", () => {
    const p = predictSubagentCost({
      history: [
        { tokensIn: Number.NaN as unknown as number, tokensOut: 100 },
        { tokensIn: -50 as unknown as number, tokensOut: 50 },
      ],
      proposedCount: 2,
      model: PRICED_MODEL,
    });
    // First sample: in=0 (NaN→0), out=100 ⇒ 100. Second: in=0 (neg→0), out=50 ⇒ 50.
    expect(p.perSubagentTokens!.mean).toBeCloseTo(75);
  });

  it("never throws on garbage history", () => {
    const garbage = [null, undefined, 42, "x", {}, { tokensIn: "lots" }] as unknown as SubagentCostSample[];
    expect(() =>
      predictSubagentCost({ history: garbage, proposedCount: 5, model: PRICED_MODEL })
    ).not.toThrow();
    const p = predictSubagentCost({ history: garbage, proposedCount: 5, model: PRICED_MODEL });
    expect(p.basis).toBe("insufficient_data");
  });
});

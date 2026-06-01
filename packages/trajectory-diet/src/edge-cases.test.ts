/**
 * Degenerate-input robustness for F1. Empty trajectories, single steps,
 * malformed tool inputs, and missing results must never crash or produce a
 * NaN feature — and must never advise against a step we can't reason about.
 */

import { describe, expect, it } from "vitest";
import type { NormalizedTurn } from "@prune/telemetry";
import {
  adviseStep,
  extractProposedStepFeatures,
  extractStepFeatures,
  summarizeTrajectory,
  TransparentInfluenceModel,
} from "./index.js";

function bareTurn(turnNumber: number, toolUses: NormalizedTurn["toolUses"]): NormalizedTurn {
  return {
    turnNumber,
    assistantMessages: [],
    toolUses,
    toolResults: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    textContent: "",
  };
}

const model = new TransparentInfluenceModel();

describe("F1 empty / single-step trajectories", () => {
  it("empty trajectory ⇒ no features, no crash", () => {
    expect(extractStepFeatures([])).toHaveLength(0);
    const s = summarizeTrajectory([], model);
    expect(s.totalSteps).toBe(0);
    expect(s.dietableFraction).toBe(0);
    expect(s.projectedTokensSaved).toBe(0);
  });

  it("single step has position 0 (no divide-by-zero)", () => {
    const f = extractStepFeatures([
      bareTurn(1, [{ name: "Read", input: { file_path: "a.ts" }, id: "t1" }]),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0].positionInTrajectory).toBe(0);
    expect(Number.isFinite(f[0].positionInTrajectory)).toBe(true);
  });
});

describe("F1 malformed / missing tool inputs", () => {
  it("tolerates a null input", () => {
    const f = extractStepFeatures([
      bareTurn(1, [{ name: "Read", input: null, id: "t1" }]),
    ]);
    expect(f[0].target).toBeNull();
    expect(Number.isFinite(f[0].inputSimilarityToPrior)).toBe(true);
  });

  it("tolerates a non-object input (string/number)", () => {
    const f = extractStepFeatures([
      bareTurn(1, [
        { name: "Bash", input: "ls -la", id: "t1" },
        { name: "Read", input: 42 as unknown, id: "t2" },
      ]),
    ]);
    expect(f).toHaveLength(2);
    for (const step of f) {
      expect(Number.isFinite(step.stepTokenCost)).toBe(true);
      expect(Number.isFinite(step.priorOutputUtilization)).toBe(true);
    }
  });

  it("tool use with no matching result ⇒ zero utilization, no crash", () => {
    const f = extractStepFeatures([
      bareTurn(1, [{ name: "Read", input: { file_path: "x" }, id: "no-result" }]),
    ]);
    expect(f[0].priorOutputUtilization).toBe(0);
    expect(f[0].stepTokenCost).toBe(0);
  });

  it("all feature values stay within their declared ranges", () => {
    const turns: NormalizedTurn[] = [];
    for (let i = 0; i < 10; i++) {
      turns.push(
        bareTurn(i + 1, [
          { name: "Read", input: { file_path: `f${i % 3}.ts` }, id: `t${i}` },
        ])
      );
    }
    for (const step of extractStepFeatures(turns)) {
      for (const v of [
        step.inputSimilarityToPrior,
        step.targetFileNovelty,
        step.positionInTrajectory,
        step.priorOutputUtilization,
        step.intentClassMatch,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("F1 extractProposedStepFeatures (online PreToolUse)", () => {
  it("computes a redundancy signature for a proposed re-read", () => {
    const prior = [
      bareTurn(1, [{ name: "Read", input: { file_path: "auth.ts" }, id: "t1" }]),
      bareTurn(2, [{ name: "Read", input: { file_path: "auth.ts" }, id: "t2" }]),
    ];
    const f = extractProposedStepFeatures(prior, {
      name: "Read",
      input: { file_path: "auth.ts" },
    });
    expect(f.inputSimilarityToPrior).toBeGreaterThan(0.9);
    expect(f.targetFileNovelty).toBeLessThan(0.5); // 3rd touch
  });

  it("the ONLINE advisor is conservative under unknown utilization (by design)", () => {
    // Pre-execution we cannot know if the re-read's result will be used, so
    // utilization is neutral (0.5). The advisor therefore does NOT fire on
    // similarity alone — F1's high-confidence skips come from OFFLINE analysis
    // of completed trajectories (where utilization is observed = 0). This is
    // why the online hook ships shadow-first. Safe direction: no false advice.
    const prior = [
      bareTurn(1, [{ name: "Read", input: { file_path: "auth.ts" }, id: "t1" }]),
      bareTurn(2, [{ name: "Read", input: { file_path: "auth.ts" }, id: "t2" }]),
    ];
    const f = extractProposedStepFeatures(prior, {
      name: "Read",
      input: { file_path: "auth.ts" },
    });
    const score = model.score(f);
    expect(score).toBeGreaterThan(0.15); // conservative — no online advisory
    expect(Number.isFinite(score)).toBe(true);
  });

  it("uses neutral utilization (no fabricated signal) for an unexecuted step", () => {
    const f = extractProposedStepFeatures([], {
      name: "Read",
      input: { file_path: "fresh.ts" },
    });
    expect(f.priorOutputUtilization).toBe(0.5);
    expect(f.stepTokenCost).toBe(0);
    expect(f.targetFileNovelty).toBe(1); // first touch
  });

  it("does not advise against a proposed novel first-touch read", () => {
    const f = extractProposedStepFeatures(
      [bareTurn(1, [{ name: "Read", input: { file_path: "a.ts" }, id: "t1" }])],
      { name: "Read", input: { file_path: "totally-new.ts" } }
    );
    expect(adviseStep(f, model)).toBeNull();
  });
});

describe("F1 advisor never fires on un-reasonable steps", () => {
  it("does not advise against a novel first-touch step even at low score", () => {
    // First touch (novelty 1, no prior similarity): redundancy guard blocks.
    const f = extractStepFeatures([
      bareTurn(1, [{ name: "Read", input: { file_path: "fresh.ts" }, id: "t1" }]),
    ])[0];
    expect(adviseStep(f, model)).toBeNull();
  });
});

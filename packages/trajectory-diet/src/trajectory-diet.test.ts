import { describe, expect, it } from "vitest";
import type { NormalizedTurn } from "@prune/telemetry";
import {
  adviseStep,
  extractStepFeatures,
  finalOutputEquivalent,
  FunctionInfluenceModel,
  summarizeTrajectory,
  TransparentInfluenceModel,
  type StepFeatures,
} from "./index.js";

function turn(
  turnNumber: number,
  toolUses: Array<{ name: string; input: unknown; id: string }>,
  toolResults: Array<{ tool_use_id: string; content: unknown }>,
  textContent = ""
): NormalizedTurn {
  return {
    turnNumber,
    assistantMessages: [],
    toolUses,
    toolResults,
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    textContent,
  };
}

describe("extractStepFeatures", () => {
  it("flags a redundant re-read: high similarity, low novelty, low utilization", () => {
    const fileContent = "export function login() { return token; }";
    const turns: NormalizedTurn[] = [
      turn(
        1,
        [{ name: "Read", input: { file_path: "auth.ts" }, id: "t1" }],
        [{ tool_use_id: "t1", content: fileContent }],
        "Looking at auth.ts to understand login."
      ),
      // ... unrelated work happens, none of which references auth.ts content ...
      turn(
        2,
        [{ name: "Read", input: { file_path: "auth.ts" }, id: "t2" }],
        [{ tool_use_id: "t2", content: fileContent }],
        "The unrelated config change is complete."
      ),
    ];
    const features = extractStepFeatures(turns);
    expect(features).toHaveLength(2);
    const reread = features[1];
    expect(reread.toolName).toBe("Read");
    expect(reread.target).toBe("auth.ts");
    // Identical input ⇒ high similarity to the prior read.
    expect(reread.inputSimilarityToPrior).toBeGreaterThan(0.9);
    // Second touch ⇒ novelty = 1/(1+1) = 0.5.
    expect(reread.targetFileNovelty).toBeCloseTo(0.5, 5);
  });

  it("first touch of a file has novelty 1.0", () => {
    const turns = [
      turn(
        1,
        [{ name: "Read", input: { file_path: "new.ts" }, id: "t1" }],
        [{ tool_use_id: "t1", content: "const x = 1;" }]
      ),
    ];
    const features = extractStepFeatures(turns);
    expect(features[0].targetFileNovelty).toBe(1);
  });

  it("utilization is high when the result is referenced downstream", () => {
    const turns: NormalizedTurn[] = [
      turn(
        1,
        [{ name: "Read", input: { file_path: "config.ts" }, id: "t1" }],
        [{ tool_use_id: "t1", content: "export const TIMEOUT_MILLISECONDS = 5000;" }],
        ""
      ),
      turn(
        2,
        [],
        [],
        "The TIMEOUT_MILLISECONDS constant from config controls the retry budget."
      ),
    ];
    const features = extractStepFeatures(turns);
    expect(features[0].priorOutputUtilization).toBeGreaterThan(0.1);
  });

  it("position is normalized across the trajectory", () => {
    const turns: NormalizedTurn[] = [];
    for (let i = 1; i <= 5; i++) {
      turns.push(
        turn(
          i,
          [{ name: "Read", input: { file_path: `f${i}.ts` }, id: `t${i}` }],
          [{ tool_use_id: `t${i}`, content: "x" }]
        )
      );
    }
    const features = extractStepFeatures(turns);
    expect(features[0].positionInTrajectory).toBe(0);
    expect(features[4].positionInTrajectory).toBe(1);
  });

  it("intent match is neutral (0.5) when no intent supplied", () => {
    const turns = [
      turn(
        1,
        [{ name: "Read", input: { file_path: "a.ts" }, id: "t1" }],
        [{ tool_use_id: "t1", content: "x" }]
      ),
    ];
    expect(extractStepFeatures(turns)[0].intentClassMatch).toBe(0.5);
  });
});

describe("TransparentInfluenceModel", () => {
  const model = new TransparentInfluenceModel();

  function feat(overrides: Partial<StepFeatures>): StepFeatures {
    return {
      stepIndex: 0,
      turnNumber: 1,
      toolName: "Read",
      target: "a.ts",
      inputSimilarityToPrior: 0,
      targetFileNovelty: 1,
      positionInTrajectory: 0.5,
      priorOutputUtilization: 0,
      stepTokenCost: 500,
      intentClassMatch: 0.5,
      ...overrides,
    };
  }

  it("scores a redundant re-read below the 0.15 advisory threshold", () => {
    const redundant = feat({
      inputSimilarityToPrior: 0.9,
      targetFileNovelty: 0.1,
      priorOutputUtilization: 0,
      intentClassMatch: 0.4,
    });
    expect(model.score(redundant)).toBeLessThan(0.15);
  });

  it("scores a novel, downstream-used step above 0.5", () => {
    const influential = feat({
      inputSimilarityToPrior: 0,
      targetFileNovelty: 1,
      priorOutputUtilization: 0.8,
      intentClassMatch: 1,
      stepTokenCost: 1200,
    });
    expect(model.score(influential)).toBeGreaterThan(0.5);
  });

  it("always returns a probability in [0,1]", () => {
    for (let s = 0; s <= 1; s += 0.25) {
      for (let n = 0; n <= 1; n += 0.5) {
        const v = model.score(
          feat({ inputSimilarityToPrior: s, targetFileNovelty: n })
        );
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("exposes its weights for auditability", () => {
    expect(TransparentInfluenceModel.WEIGHTS.similarity).toBeGreaterThan(0);
    expect(TransparentInfluenceModel.WEIGHTS.utilization).toBeGreaterThan(0);
  });
});

describe("FunctionInfluenceModel", () => {
  it("clamps out-of-range scores defensively", () => {
    const m = new FunctionInfluenceModel("rogue", "v9", () => 5);
    expect(m.score({} as StepFeatures)).toBe(1);
    const n = new FunctionInfluenceModel("rogue2", "v9", () => -3);
    expect(n.score({} as StepFeatures)).toBe(0);
  });
});

describe("adviseStep", () => {
  const model = new TransparentInfluenceModel();

  function feat(overrides: Partial<StepFeatures>): StepFeatures {
    return {
      stepIndex: 3,
      turnNumber: 2,
      toolName: "Read",
      target: "auth.ts",
      inputSimilarityToPrior: 0.9,
      targetFileNovelty: 0.2,
      positionInTrajectory: 0.5,
      priorOutputUtilization: 0,
      stepTokenCost: 800,
      intentClassMatch: 0.4,
      ...overrides,
    };
  }

  it("advises against a confidently-redundant step", () => {
    const a = adviseStep(feat({}), model);
    expect(a).not.toBeNull();
    expect(a!.projectedTokensSaved).toBe(800);
    expect(a!.confidence).toBeGreaterThan(0.85);
    expect(a!.message).toContain("advisory");
  });

  it("does NOT advise against a high-influence step", () => {
    const a = adviseStep(
      feat({
        inputSimilarityToPrior: 0,
        targetFileNovelty: 1,
        priorOutputUtilization: 0.9,
        intentClassMatch: 1,
      }),
      model
    );
    expect(a).toBeNull();
  });

  it("withholds advisory for a novel step even if score is low (redundancy guard)", () => {
    // Construct a low score but with a NOVEL target and no prior similarity.
    const m = new FunctionInfluenceModel("low", "v0", () => 0.05);
    const novel = feat({
      inputSimilarityToPrior: 0.0,
      targetFileNovelty: 1.0,
    });
    expect(adviseStep(novel, m, { requireRedundancySignal: true })).toBeNull();
    // With the guard off, the low score alone triggers an advisory.
    expect(adviseStep(novel, m, { requireRedundancySignal: false })).not.toBeNull();
  });
});

describe("summarizeTrajectory", () => {
  it("aggregates advisories and projected savings", () => {
    const model = new TransparentInfluenceModel();
    const features: StepFeatures[] = [
      // influential
      {
        stepIndex: 0,
        turnNumber: 1,
        toolName: "Read",
        target: "main.ts",
        inputSimilarityToPrior: 0,
        targetFileNovelty: 1,
        positionInTrajectory: 0,
        priorOutputUtilization: 0.9,
        stepTokenCost: 1000,
        intentClassMatch: 1,
      },
      // redundant re-read
      {
        stepIndex: 1,
        turnNumber: 3,
        toolName: "Read",
        target: "main.ts",
        inputSimilarityToPrior: 0.95,
        targetFileNovelty: 0.2,
        positionInTrajectory: 1,
        priorOutputUtilization: 0,
        stepTokenCost: 1000,
        intentClassMatch: 0.4,
      },
    ];
    const summary = summarizeTrajectory(features, model);
    expect(summary.totalSteps).toBe(2);
    expect(summary.lowInfluenceSteps).toBe(1);
    expect(summary.dietableFraction).toBe(0.5);
    expect(summary.projectedTokensSaved).toBe(1000);
    expect(summary.totalStepTokens).toBe(2000);
    expect(summary.modelVersion).toBe("v0");
  });
});

describe("finalOutputEquivalent (diet-safety validation)", () => {
  it("confirms equivalence when the dieted output matches", () => {
    const original = "The fix is to add a null check in parseConfig().";
    const dieted = "The fix is to add a null check in parseConfig().";
    expect(finalOutputEquivalent(original, dieted).equivalent).toBe(true);
  });

  it("detects when a diet changed the answer (code)", () => {
    const original = "function f() { return 1; }";
    const dieted = "function f() { return 2; }";
    const r = finalOutputEquivalent(original, dieted, { asCode: true });
    expect(r.equivalent).toBe(false);
  });
});

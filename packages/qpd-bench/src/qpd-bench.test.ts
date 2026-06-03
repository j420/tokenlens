import { describe, expect, it } from "vitest";
import {
  aggregateBenchRun,
  aggregateModel,
  classifyPareto,
  dominates,
  FixtureRunner,
  paretoFrontier,
  recommendForCluster,
  runBenchPlan,
  scoreSample,
  type BenchExecution,
  type BenchPlan,
  type BenchPrompt,
  type ScoredSample,
} from "./index.js";

describe("Pareto frontier", () => {
  it("dominates: cheaper-and-better dominates", () => {
    expect(
      dominates(
        { model: "a", cost: 1, quality: 0.9 },
        { model: "b", cost: 2, quality: 0.8 }
      )
    ).toBe(true);
  });

  it("dominates: identical points do not dominate each other", () => {
    const p = { model: "a", cost: 1, quality: 0.9 };
    const q = { model: "b", cost: 1, quality: 0.9 };
    expect(dominates(p, q)).toBe(false);
    expect(dominates(q, p)).toBe(false);
  });

  it("identifies the frontier of a tier ladder", () => {
    const points = [
      { model: "opus", cost: 0.1, quality: 0.92 },
      { model: "sonnet", cost: 0.02, quality: 0.9 },
      { model: "haiku", cost: 0.004, quality: 0.71 },
      // dominated: more expensive than sonnet, lower quality.
      { model: "legacy", cost: 0.05, quality: 0.85 },
    ];
    const frontier = paretoFrontier(points);
    const names = frontier.map((p) => p.model);
    expect(names).toContain("opus");
    expect(names).toContain("sonnet");
    expect(names).toContain("haiku");
    expect(names).not.toContain("legacy");
    // sorted ascending by cost
    expect(frontier[0].model).toBe("haiku");
  });

  it("classifyPareto records dominators", () => {
    const classified = classifyPareto([
      { model: "good", cost: 1, quality: 0.9 },
      { model: "bad", cost: 2, quality: 0.8 },
    ]);
    const bad = classified.find((c) => c.model === "bad")!;
    expect(bad.onFrontier).toBe(false);
    expect(bad.dominatedBy).toContain("good");
  });
});

describe("scoreSample", () => {
  it("scores an exact-match output as accepted with quality 1", () => {
    const exec: BenchExecution = {
      promptId: "p1",
      model: "sonnet",
      output: "function add(a, b) { return a + b; }",
      costUsd: 0.01,
      testPassed: true,
    };
    const s = scoreSample(exec, "function add(a, b) { return a + b; }", {
      equivalence: { asCode: true },
    });
    expect(s.qualityScore).toBe(1);
    expect(s.accepted).toBe(true);
  });

  it("scores a wrong-literal output below acceptance", () => {
    const exec: BenchExecution = {
      promptId: "p1",
      model: "haiku",
      output: "const timeout = 9999;",
      costUsd: 0.001,
      testPassed: false,
    };
    // Reference has a different literal — structurally non-equivalent.
    const s = scoreSample(exec, "const timeout = 5000;", {
      equivalence: { asCode: true },
      acceptanceThreshold: 0.99,
    });
    expect(s.accepted).toBe(false);
  });
});

describe("aggregateModel", () => {
  it("computes acceptance, TPR, mean cost, and raw QpD", () => {
    const samples: ScoredSample[] = [
      { promptId: "1", model: "m", qualityScore: 1, accepted: true, testPassed: true, costUsd: 0.02 },
      { promptId: "2", model: "m", qualityScore: 0.9, accepted: true, testPassed: true, costUsd: 0.02 },
      { promptId: "3", model: "m", qualityScore: 0.5, accepted: false, testPassed: false, costUsd: 0.02 },
      { promptId: "4", model: "m", qualityScore: 0.95, accepted: true, testPassed: null, costUsd: 0.02 },
    ];
    const agg = aggregateModel("cluster1", "m", samples);
    expect(agg.n).toBe(4);
    expect(agg.acceptanceRate).toBe(0.75);
    expect(agg.testN).toBe(3);
    expect(agg.testPassRate).toBeCloseTo(2 / 3, 5);
    expect(agg.meanCost).toBeCloseTo(0.02, 6);
    expect(agg.qpdRaw).toBeCloseTo(0.75 / 0.02, 4);
  });
});

describe("recommendForCluster — the quality gate", () => {
  // Build an aggregate by hand for precise control.
  function agg(
    model: string,
    n: number,
    acceptanceRate: number,
    meanCost: number,
    tpr: number | null = null
  ) {
    const acceptedCount = Math.round(n * acceptanceRate);
    const testN = tpr === null ? 0 : n;
    const testPassedCount = tpr === null ? 0 : Math.round(n * tpr);
    return {
      model,
      clusterId: "c1",
      n,
      acceptedCount,
      acceptanceRate,
      testPassRate: tpr,
      testN,
      testPassedCount,
      meanCost,
      totalCost: meanCost * n,
      qpdRaw: meanCost > 0 ? acceptanceRate / meanCost : Infinity,
    };
  }

  it("recommends a cheaper, statistically non-inferior model", () => {
    // Sonnet ~ Opus quality at ~20% cost, n=500 ⇒ NI holds at the bench's
    // coarse 5pp screening margin.
    const opus = agg("opus", 500, 0.92, 0.1);
    const sonnet = agg("sonnet", 500, 0.91, 0.02);
    const rec = recommendForCluster(opus, [sonnet]);
    expect(rec.best?.model).toBe("sonnet");
    expect(rec.best?.recommended).toBe(true);
    expect(rec.best?.arGate.passed).toBe(true);
    expect(rec.best?.costGate.passed).toBe(true);
    expect(rec.best!.projectedSavingsPct).toBeGreaterThan(70);
  });

  it("two-tier margin: a 5pp-equivalent model that a 1pp gate would reject", () => {
    // Sonnet 4pp below Opus: passes the bench's coarse 5pp screen, but would
    // NOT pass the production 1pp gate at this sample size. The bench screens;
    // the continuous quality framework is the fine gate after switching.
    const opus = agg("opus", 500, 0.92, 0.1);
    const sonnet = agg("sonnet", 500, 0.9, 0.02); // 2pp below
    const coarse = recommendForCluster(opus, [sonnet]); // default 5pp
    const fine = recommendForCluster(opus, [sonnet], { arMargin: 0.01 });
    expect(coarse.recommendations[0].arGate.passed).toBe(true);
    expect(fine.recommendations[0].arGate.passed).toBe(false);
  });

  it("does NOT recommend a cheaper model that fails quality (big AR drop)", () => {
    const opus = agg("opus", 500, 0.92, 0.1);
    const haiku = agg("haiku", 500, 0.71, 0.004); // 21pp drop — fails even 5pp
    const rec = recommendForCluster(opus, [haiku]);
    const haikuRec = rec.recommendations.find((r) => r.model === "haiku")!;
    expect(haikuRec.recommended).toBe(false);
    expect(haikuRec.arGate.passed).toBe(false);
    expect(rec.best).toBeNull(); // stay on baseline
  });

  it("does NOT recommend a model that is quality-equivalent but not cheap enough", () => {
    const opus = agg("opus", 500, 0.92, 0.1);
    // Same quality but only 10% cheaper — fails cost-dominance (≤0.7).
    const opusLite = agg("opus-lite", 500, 0.915, 0.09);
    const rec = recommendForCluster(opus, [opusLite]);
    const r = rec.recommendations.find((x) => x.model === "opus-lite")!;
    expect(r.costGate.passed).toBe(false);
    expect(r.recommended).toBe(false);
  });

  it("does NOT recommend when sample size is below the minimum", () => {
    const opus = agg("opus", 20, 0.92, 0.1);
    const sonnet = agg("sonnet", 20, 0.91, 0.02);
    const rec = recommendForCluster(opus, [sonnet], { minSamples: 30 });
    const r = rec.recommendations.find((x) => x.model === "sonnet")!;
    expect(r.sampleSizeGate.passed).toBe(false);
    expect(r.recommended).toBe(false);
  });

  it("fails TPR gate when candidate loses test signal the baseline had", () => {
    const opus = agg("opus", 500, 0.92, 0.1, 0.95);
    const sonnet = agg("sonnet", 500, 0.91, 0.02, null); // no test signal
    const rec = recommendForCluster(opus, [sonnet]);
    const r = rec.recommendations.find((x) => x.model === "sonnet")!;
    expect(r.tprGate.passed).toBe(false);
    expect(r.recommended).toBe(false);
  });

  it("passes TPR gate when both arms have equivalent test signal", () => {
    const opus = agg("opus", 500, 0.92, 0.1, 0.95);
    const sonnet = agg("sonnet", 500, 0.91, 0.02, 0.95);
    const rec = recommendForCluster(opus, [sonnet]);
    expect(rec.best?.model).toBe("sonnet");
    expect(rec.best?.tprGate.passed).toBe(true);
  });
});

describe("end-to-end bench pipeline (fixture runner)", () => {
  it("runs a plan, scores, aggregates, and recommends", async () => {
    const prompts: BenchPrompt[] = [];
    const executions: BenchExecution[] = [];
    // 40 prompts; opus and sonnet both produce the reference output; haiku
    // gets a wrong literal on a third of prompts.
    for (let i = 0; i < 40; i++) {
      const ref = `function f${i}() { return ${i}; }`;
      prompts.push({
        promptId: `p${i}`,
        clusterId: "refactor-ts",
        prompt: `write f${i}`,
        referenceOutput: ref,
        referenceTestPassed: true,
      });
      executions.push({ promptId: `p${i}`, model: "opus", output: ref, costUsd: 0.1, testPassed: true });
      executions.push({ promptId: `p${i}`, model: "sonnet", output: ref, costUsd: 0.02, testPassed: true });
      executions.push({
        promptId: `p${i}`,
        model: "haiku",
        output: i % 3 === 0 ? `function f${i}() { return ${i + 1}; }` : ref,
        costUsd: 0.004,
        testPassed: i % 3 !== 0,
      });
    }

    const plan: BenchPlan = {
      clusterId: "refactor-ts",
      prompts,
      models: ["opus", "sonnet", "haiku"],
    };
    const runner = new FixtureRunner(executions);
    const summary = await runBenchPlan(plan, runner);
    expect(summary.executions).toHaveLength(120);

    const aggregates = aggregateBenchRun(summary, {
      equivalence: { asCode: true },
      acceptanceThreshold: 0.99,
    });
    const opus = aggregates.find((a) => a.model === "opus")!;
    const sonnet = aggregates.find((a) => a.model === "sonnet")!;
    const haiku = aggregates.find((a) => a.model === "haiku")!;

    expect(opus.acceptanceRate).toBe(1);
    expect(sonnet.acceptanceRate).toBe(1);
    expect(haiku.acceptanceRate).toBeLessThan(0.7); // ~2/3

    const rec = recommendForCluster(
      opus,
      [sonnet, haiku]
    );
    // Sonnet: equivalent quality at 20% cost ⇒ recommended.
    expect(rec.best?.model).toBe("sonnet");
    // Haiku: quality too low ⇒ not recommended.
    const haikuRec = rec.recommendations.find((r) => r.model === "haiku")!;
    expect(haikuRec.recommended).toBe(false);
  });

  it("FixtureRunner throws on missing data (no silent pass)", async () => {
    const runner = new FixtureRunner([]);
    await expect(
      runner.run(
        {
          promptId: "x",
          clusterId: "c",
          prompt: "p",
          referenceOutput: "r",
          referenceTestPassed: null,
        },
        "opus"
      )
    ).rejects.toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { SpeculativePipeline } from "./pipeline.js";
import { speculationKey } from "./canonical-input.js";
import { buildQualityProof } from "./quality-proof.js";
import type { ToolCall } from "./types.js";

const read = (p: string): ToolCall => ({ name: "Read", input: { file_path: p } });
const edit = (p: string): ToolCall => ({ name: "Edit", input: { file_path: p } });

/** A history where Read(a) → Read(b) is a strong, repeated transition. */
function warmHistory(): ToolCall[] {
  return [read("a"), read("b"), read("a"), read("b"), read("a"), read("b")];
}

describe("SpeculativePipeline — happy path hit", () => {
  it("predicts, records the result, and reports a full hit with latency saved", () => {
    const pipe = new SpeculativePipeline(warmHistory(), { minProbability: 0 });
    const launched = pipe.speculate(read("a"), [], 0);
    expect(launched.length).toBeGreaterThan(0);
    const target = launched.find((s) => s.key === speculationKey(read("b")))!;
    expect(target).toBeDefined();

    // Host finishes the speculative execution.
    pipe.recordResult({ key: target.key, result: "contents of b", elapsedMs: 1800 });

    // The agent's real call is exactly Read(b).
    const outcome = pipe.reconcile(read("b"), 10);
    expect(outcome.hit).toBe(true);
    expect(outcome.result).toBe("contents of b");
    expect(outcome.latencySavedMs).toBe(1800);
    expect(outcome.classification).toBe("hit");

    const stats = pipe.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.totalLatencySavedMs).toBe(1800);
    expect(stats.hitRate).toBe(1);
  });
});

describe("SpeculativePipeline — miss", () => {
  it("classifies an unpredicted real call as a miss and settles the batch wasted", () => {
    const pipe = new SpeculativePipeline(warmHistory(), { minProbability: 0 });
    const launched = pipe.speculate(read("a"), [], 0);
    pipe.recordResult({ key: launched[0]!.key, result: "x", elapsedMs: 500 });
    // The agent actually reads a totally different file.
    const outcome = pipe.reconcile(read("zzz-unexpected"), 10);
    expect(outcome.hit).toBe(false);
    expect(outcome.classification).toBe("miss");
    const stats = pipe.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.wastedSpeculations).toBe(launched.length);
  });

  it("classifies an ineligible real call distinctly from a normal miss", () => {
    const pipe = new SpeculativePipeline(warmHistory(), { minProbability: 0 });
    pipe.speculate(read("a"), [], 0);
    const outcome = pipe.reconcile(edit("a"), 10);
    expect(outcome.classification).toBe("ineligible");
  });
});

describe("SpeculativePipeline — in-flight incomplete", () => {
  it("a correct prediction that hadn't finished is not a hit and not wasted", () => {
    const pipe = new SpeculativePipeline(warmHistory(), { minProbability: 0 });
    const launched = pipe.speculate(read("a"), [], 0);
    const target = launched.find((s) => s.key === speculationKey(read("b")))!;
    // No recordResult — the speculation is still running.
    const outcome = pipe.reconcile(read("b"), 10);
    expect(outcome.classification).toBe("in_flight_incomplete");
    expect(outcome.hit).toBe(false);
    const stats = pipe.getStats();
    expect(stats.inFlightIncomplete).toBe(1);
    expect(stats.hits).toBe(0);
    // The matched (correct) speculation is NOT counted as wasted.
    expect(stats.wastedSpeculations).toBe(launched.length - 1);
    void target;
  });
});

describe("SpeculativePipeline — caller candidates", () => {
  it("merges caller candidates and dedups by canonical key", () => {
    const pipe = new SpeculativePipeline([], { minProbability: 0 });
    const candidate = {
      call: read("hinted-file"),
      key: "ignored-will-be-recomputed",
      probability: 0.9,
      source: "caller-candidate" as const,
    };
    const launched = pipe.speculate(null, [candidate], 0);
    expect(launched.length).toBe(1);
    expect(launched[0]!.key).toBe(speculationKey(read("hinted-file")));
    expect(launched[0]!.source).toBe("caller-candidate");
  });

  it("drops ineligible caller candidates", () => {
    const pipe = new SpeculativePipeline([], { minProbability: 0 });
    const launched = pipe.speculate(
      null,
      [{ call: edit("x"), key: "k", probability: 0.99, source: "caller-candidate" }],
      0
    );
    expect(launched.length).toBe(0);
  });
});

describe("SpeculativePipeline — budget integration", () => {
  it("stops launching at the concurrency cap", () => {
    const pipe = new SpeculativePipeline([], {
      minProbability: 0,
      maxSpeculationsPerTurn: 5,
      budget: { maxConcurrent: 2 },
    });
    const candidates = [
      { call: read("f1"), key: "", probability: 0.9, source: "caller-candidate" as const },
      { call: read("f2"), key: "", probability: 0.8, source: "caller-candidate" as const },
      { call: read("f3"), key: "", probability: 0.7, source: "caller-candidate" as const },
    ];
    const launched = pipe.speculate(null, candidates, 0);
    expect(launched.length).toBe(2); // capped by maxConcurrent
  });

  it("re-speculating discards the prior unsettled batch as wasted", () => {
    const pipe = new SpeculativePipeline([], {
      minProbability: 0,
      budget: { maxConcurrent: 4 },
    });
    pipe.speculate(
      null,
      [{ call: read("f1"), key: "", probability: 0.9, source: "caller-candidate" }],
      0
    );
    // New turn, new speculation — the old batch is flushed as wasted.
    pipe.speculate(
      null,
      [{ call: read("f2"), key: "", probability: 0.9, source: "caller-candidate" }],
      1
    );
    expect(pipe.getStats().wastedSpeculations).toBe(1);
  });
});

describe("SpeculativePipeline — quality proof", () => {
  it("builds an f11 proof from an outcome + stats + budget", () => {
    const pipe = new SpeculativePipeline(warmHistory(), { minProbability: 0 });
    const launched = pipe.speculate(read("a"), [], 0);
    pipe.recordResult({ key: launched[0]!.key, result: "x", elapsedMs: 900 });
    const outcome = pipe.reconcile(launched[0]!.call, 10);
    const proof = buildQualityProof(outcome, pipe.getStats(), pipe.getBudget().decide(10));
    expect(proof.featureId).toBe("f11");
    expect(proof.schemaVersion).toBe(1);
    expect(proof.outcome.classification).toBe(outcome.classification);
    expect(proof.stats.hits).toBe(pipe.getStats().hits);
  });
});

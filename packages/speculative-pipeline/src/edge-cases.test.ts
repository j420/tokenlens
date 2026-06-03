/**
 * Adversarial probes for the speculative pipeline. Phase 7 hard rule #5.
 */

import { describe, expect, it } from "vitest";

import { SpeculativePipeline } from "./pipeline.js";
import { TransitionPredictor } from "./predictor.js";
import { SpeculationBudget } from "./budget.js";
import { speculationKey } from "./canonical-input.js";
import type { ToolCall } from "./types.js";

const read = (p: string): ToolCall => ({ name: "Read", input: { file_path: p } });

describe("edge — pipeline never speculates writes", () => {
  it("an Edit-heavy history yields no Edit speculations", () => {
    const history: ToolCall[] = [];
    for (let i = 0; i < 6; i++) {
      history.push(read("src.ts"));
      history.push({ name: "Edit", input: { file_path: "src.ts" } });
    }
    const pipe = new SpeculativePipeline(history, { minProbability: 0 });
    const launched = pipe.speculate(read("src.ts"), [], 0);
    for (const s of launched) expect(s.call.name).not.toBe("Edit");
  });
});

describe("edge — reconcile with empty batch", () => {
  it("reconciling with no speculations is a clean miss", () => {
    const pipe = new SpeculativePipeline([], { minProbability: 0 });
    const outcome = pipe.reconcile(read("x"), 0);
    expect(outcome.hit).toBe(false);
    expect(outcome.classification).toBe("miss");
    expect(pipe.getStats().wastedSpeculations).toBe(0);
  });
});

describe("edge — late result for a discarded batch is ignored", () => {
  it("recordResult after reconcile does not corrupt the next batch", () => {
    const pipe = new SpeculativePipeline([], { minProbability: 0 });
    const launched = pipe.speculate(
      null,
      [{ call: read("f1"), key: "", probability: 0.9, source: "caller-candidate" }],
      0
    );
    pipe.reconcile(read("other"), 10); // batch cleared
    // A late result arrives for the now-cleared batch.
    pipe.recordResult({ key: launched[0]!.key, result: "late", elapsedMs: 100 });
    // Next turn, a fresh speculation + reconcile is unaffected.
    pipe.speculate(
      null,
      [{ call: read("f1"), key: "", probability: 0.9, source: "caller-candidate" }],
      20
    );
    const outcome = pipe.reconcile(read("f1"), 30);
    // No result was recorded for THIS batch → incomplete, not a stale hit.
    expect(outcome.classification).toBe("in_flight_incomplete");
    expect(outcome.result).toBeNull();
  });
});

describe("edge — hitRate accounting excludes in_flight_incomplete", () => {
  it("hitRate is hits/(hits+misses), incomplete tracked separately", () => {
    const history: ToolCall[] = [read("a"), read("b"), read("a"), read("b")];
    const pipe = new SpeculativePipeline(history, { minProbability: 0 });

    // Turn 1: full hit.
    let launched = pipe.speculate(read("a"), [], 0);
    const bKey = speculationKey(read("b"));
    pipe.recordResult({ key: bKey, result: "B", elapsedMs: 100 });
    pipe.reconcile(read("b"), 1);

    // Turn 2: correct prediction but no result recorded → incomplete.
    launched = pipe.speculate(read("a"), [], 2);
    expect(launched.some((s) => s.key === bKey)).toBe(true);
    pipe.reconcile(read("b"), 3);

    // Turn 3: miss.
    pipe.speculate(read("a"), [], 4);
    pipe.reconcile(read("totally-different"), 5);

    const stats = pipe.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.inFlightIncomplete).toBe(1);
    expect(stats.hitRate).toBe(0.5); // 1 / (1 + 1)
  });
});

describe("edge — predictor smoothing boundary", () => {
  it("a single observed transition favors the observed follower, with valid probabilities", () => {
    // History [Read(a), Read(b)]: after Read(a) the transition model has b as
    // the one observed follower; the global prior also surfaces a (seen once).
    // Both are eligible reads, so both are candidates — b ranks first.
    const pred = new TransitionPredictor([read("a"), read("b")]);
    const out = pred.predict(read("a"), { minProbability: 0, smoothing: 1 });
    expect(out.length).toBe(2);
    expect(out[0]!.key).toBe(speculationKey(read("b")));
    for (const s of out) {
      expect(s.probability).toBeGreaterThan(0);
      expect(s.probability).toBeLessThanOrEqual(1);
    }
  });

  it("high smoothing flattens probabilities toward the prior", () => {
    const history: ToolCall[] = [read("a"), read("b"), read("a"), read("b"), read("a"), read("c")];
    const pred = new TransitionPredictor(history);
    const low = pred.predict(read("a"), { minProbability: 0, smoothing: 0.001 });
    const high = pred.predict(read("a"), { minProbability: 0, smoothing: 1000 });
    // With tiny smoothing the dominant follower (b) is sharply favored; with
    // huge smoothing the top probability is pulled down toward uniform.
    expect(low[0]!.probability).toBeGreaterThan(high[0]!.probability);
  });
});

describe("edge — budget breaker stops speculation end-to-end", () => {
  it("once the breaker opens, speculate launches nothing", () => {
    const pipe = new SpeculativePipeline([], {
      minProbability: 0,
      budget: { maxConcurrent: 10, minSamples: 3, wastedRateThreshold: 0.5, cooldownMs: 10_000 },
    });
    // Three wasted turns to trip the breaker.
    for (let t = 0; t < 3; t++) {
      pipe.speculate(
        null,
        [{ call: read(`f${t}`), key: "", probability: 0.9, source: "caller-candidate" }],
        t
      );
      pipe.reconcile(read("miss"), t);
    }
    // Breaker should now be open.
    expect(pipe.getBudget().isDisabled(3)).toBe(true);
    const launched = pipe.speculate(
      null,
      [{ call: read("fX"), key: "", probability: 0.9, source: "caller-candidate" }],
      3
    );
    expect(launched.length).toBe(0);
  });
});

describe("edge — standalone budget invariant", () => {
  it("settling more than launched never drives inFlight negative", () => {
    const b = new SpeculationBudget({ maxConcurrent: 2 });
    b.launch();
    b.settle(false, 0);
    b.settle(false, 0); // extra settle — must not underflow
    expect(b.activeCount).toBe(0);
  });
});

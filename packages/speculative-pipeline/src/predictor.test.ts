import { describe, expect, it } from "vitest";

import { TransitionPredictor } from "./predictor.js";
import { speculationKey } from "./canonical-input.js";
import type { ToolCall } from "./types.js";

const read = (p: string): ToolCall => ({ name: "Read", input: { file_path: p } });
const grep = (pat: string): ToolCall => ({ name: "Grep", input: { pattern: pat } });
const edit = (p: string): ToolCall => ({ name: "Edit", input: { file_path: p } });

describe("TransitionPredictor", () => {
  it("predicts the most frequent follower of a repeated sequence", () => {
    // Pattern: Read(a) → Read(b) seen twice.
    const history: ToolCall[] = [read("a"), read("b"), read("a"), read("b")];
    const pred = new TransitionPredictor(history);
    const out = pred.predict(read("a"), { minProbability: 0 });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.key).toBe(speculationKey(read("b")));
    expect(out[0]!.source).toBe("transition-model");
  });

  it("never predicts an ineligible (write) follower", () => {
    // Read(a) → Edit(a) repeatedly. Edit is ineligible → must not be predicted.
    const history: ToolCall[] = [read("a"), edit("a"), read("a"), edit("a")];
    const pred = new TransitionPredictor(history);
    const out = pred.predict(read("a"), { minProbability: 0 });
    for (const s of out) {
      expect(s.call.name).not.toBe("Edit");
    }
  });

  it("respects minProbability", () => {
    const history: ToolCall[] = [read("a"), read("b"), read("a"), grep("z")];
    const pred = new TransitionPredictor(history);
    // After Read(a): followers are Read(b) and Grep(z), one each → smoothed
    // probabilities are modest. A high threshold filters them out.
    const out = pred.predict(read("a"), { minProbability: 0.95 });
    expect(out.length).toBe(0);
  });

  it("respects maxSpeculationsPerTurn", () => {
    const history: ToolCall[] = [
      read("a"), read("b"),
      read("a"), grep("c"),
      read("a"), read("d"),
    ];
    const pred = new TransitionPredictor(history);
    const out = pred.predict(read("a"), { minProbability: 0, maxSpeculationsPerTurn: 1 });
    expect(out.length).toBe(1);
  });

  it("returns deterministic, stably-sorted predictions", () => {
    const history: ToolCall[] = [read("a"), read("b"), read("a"), read("b")];
    const pred = new TransitionPredictor(history);
    expect(pred.predict(read("a"), { minProbability: 0 })).toEqual(
      pred.predict(read("a"), { minProbability: 0 })
    );
  });

  it("online observe updates the model", () => {
    const pred = new TransitionPredictor();
    pred.observe(null, read("a"));
    pred.observe(read("a"), read("b"));
    pred.observe(read("a"), read("b"));
    const out = pred.predict(read("a"), { minProbability: 0 });
    expect(out[0]!.key).toBe(speculationKey(read("b")));
  });

  it("with no history, predicts nothing", () => {
    const pred = new TransitionPredictor();
    expect(pred.predict(read("a"), { minProbability: 0 })).toEqual([]);
  });

  it("probabilities are in (0,1]", () => {
    const history: ToolCall[] = [read("a"), read("b"), read("a"), read("b"), read("a"), grep("c")];
    const pred = new TransitionPredictor(history);
    for (const s of pred.predict(read("a"), { minProbability: 0 })) {
      expect(s.probability).toBeGreaterThan(0);
      expect(s.probability).toBeLessThanOrEqual(1);
    }
  });
});

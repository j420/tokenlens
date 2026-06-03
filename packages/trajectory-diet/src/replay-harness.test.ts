import { describe, expect, it } from "vitest";
import {
  runReplayHarness,
  type F1ShadowEvent,
} from "./replay-harness.js";
import type { PairedSession } from "@prune/quality";

function ev(
  sessionId: string,
  predicted: number,
  realized: number,
  decision: "advised_skip" | "kept" = "kept",
  stepTokenCost = 1000,
  pair?: PairedSession
): F1ShadowEvent {
  return {
    sessionId,
    stepIndex: 0,
    predictedInfluence: predicted,
    realizedInfluence: realized,
    decision,
    stepTokenCost,
    pair,
  };
}

function pair(
  sessionId: string,
  controlAccepted: boolean,
  treatmentAccepted: boolean
): PairedSession {
  return {
    sessionId,
    control: { accepted: controlAccepted, pwed: 0, testPassed: null },
    treatment: { accepted: treatmentAccepted, pwed: 0, testPassed: null },
  };
}

describe("runReplayHarness — empty input", () => {
  it("returns zeros for everything", () => {
    const r = runReplayHarness([]);
    expect(r.eligibleEvents).toBe(0);
    expect(r.malformedEvents).toBe(0);
    expect(r.calibration.effectiveN).toBe(0);
    expect(r.calibration.brierScore).toBe(0);
    expect(r.qualityGate).toBeNull();
  });
});

describe("runReplayHarness — calibration math", () => {
  it("perfect predictions give Brier=0, logLoss≈0, ECE=0", () => {
    const events: F1ShadowEvent[] = [
      ev("s1", 0.05, 0),
      ev("s2", 0.05, 0),
      ev("s3", 0.95, 1),
      ev("s4", 0.95, 1),
    ];
    const r = runReplayHarness(events);
    expect(r.calibration.brierScore).toBeLessThan(0.01);
    expect(r.calibration.logLoss).toBeLessThan(0.1);
    expect(r.calibration.expectedCalibrationError).toBeLessThan(0.06);
  });

  it("uniformly wrong predictions give Brier ≈ (1)^2 = 1", () => {
    const events: F1ShadowEvent[] = [
      ev("s1", 1, 0),
      ev("s2", 1, 0),
      ev("s3", 0, 1),
      ev("s4", 0, 1),
    ];
    const r = runReplayHarness(events);
    expect(r.calibration.brierScore).toBeCloseTo(1, 6);
  });

  it("predict 0.5 for everything → Brier = 0.25 regardless of label", () => {
    const events: F1ShadowEvent[] = [
      ev("s1", 0.5, 0),
      ev("s2", 0.5, 1),
      ev("s3", 0.5, 1),
      ev("s4", 0.5, 0),
    ];
    const r = runReplayHarness(events);
    expect(r.calibration.brierScore).toBeCloseTo(0.25, 6);
  });

  it("calibration computed only over labeled events", () => {
    const events: F1ShadowEvent[] = [
      ev("s1", 0.2, 0),
      ev("s2", 0.2, Number.NaN), // unlabeled — drops from calibration
      ev("s3", 0.2, 0),
    ];
    const r = runReplayHarness(events);
    expect(r.calibration.effectiveN).toBe(2);
  });
});

describe("runReplayHarness — well-formedness gating", () => {
  it("drops events with out-of-range predictions", () => {
    const events: F1ShadowEvent[] = [
      ev("s1", 1.5, 0),
      ev("s2", -0.1, 0),
      ev("s3", 0.5, 0),
    ];
    const r = runReplayHarness(events);
    expect(r.eligibleEvents).toBe(1);
    expect(r.malformedEvents).toBe(2);
  });

  it("drops events with NaN predictions", () => {
    const events: F1ShadowEvent[] = [
      ev("s1", Number.NaN, 0),
      ev("s2", 0.5, 0),
    ];
    const r = runReplayHarness(events);
    expect(r.eligibleEvents).toBe(1);
    expect(r.malformedEvents).toBe(1);
  });

  it("drops events with bogus decisions", () => {
    const e: F1ShadowEvent = {
      sessionId: "s",
      stepIndex: 0,
      predictedInfluence: 0.3,
      realizedInfluence: 0,
      decision: "exploded" as never,
      stepTokenCost: 100,
    };
    const r = runReplayHarness([e]);
    expect(r.eligibleEvents).toBe(0);
    expect(r.malformedEvents).toBe(1);
  });

  it("drops events with negative stepTokenCost", () => {
    const events: F1ShadowEvent[] = [
      ev("s1", 0.3, 0, "kept", -100),
      ev("s2", 0.3, 0, "kept", 100),
    ];
    const r = runReplayHarness(events);
    expect(r.eligibleEvents).toBe(1);
  });
});

describe("runReplayHarness — advisory aggregate", () => {
  it("counts true/false low-influence advisories", () => {
    const events: F1ShadowEvent[] = [
      ev("s1", 0.05, 0, "advised_skip", 100), // true positive
      ev("s2", 0.05, 0, "advised_skip", 200), // true positive
      ev("s3", 0.05, 1, "advised_skip", 300), // false positive
      ev("s4", 0.5, 1, "kept", 400), // not advised
    ];
    const r = runReplayHarness(events);
    expect(r.aggregate.totalEvents).toBe(4);
    expect(r.aggregate.advisedSkipCount).toBe(3);
    expect(r.aggregate.trueLowInfluence).toBe(2);
    expect(r.aggregate.falseLowInfluence).toBe(1);
    expect(r.aggregate.tokensAdvisedToSave).toBe(600);
  });
});

describe("runReplayHarness — quality gate plumbing", () => {
  it("skips gate when fewer than minPairsForGate pairs are present", () => {
    const events: F1ShadowEvent[] = [
      ev("s1", 0.1, 0, "advised_skip", 100, pair("s1", true, true)),
      ev("s2", 0.2, 0, "kept", 200, pair("s2", true, true)),
    ];
    const r = runReplayHarness(events, { minPairsForGate: 30 });
    expect(r.qualityGate).toBeNull();
  });

  it("runs the NI gate when enough pairs are present", () => {
    // 40 pairs, all matched ⇒ AR equal between arms ⇒ gate passes
    const events: F1ShadowEvent[] = [];
    for (let i = 0; i < 40; i++) {
      events.push(
        ev(`s${i}`, 0.5, 0, "kept", 100, pair(`s${i}`, true, true))
      );
    }
    const r = runReplayHarness(events, { minPairsForGate: 30 });
    expect(r.qualityGate).not.toBeNull();
    expect(r.qualityGate!.nPairs).toBe(40);
  });

  it("respects custom margins", () => {
    const events: F1ShadowEvent[] = [];
    for (let i = 0; i < 50; i++) {
      events.push(ev(`s${i}`, 0.5, 0, "kept", 100, pair(`s${i}`, true, true)));
    }
    const r = runReplayHarness(events, {
      minPairsForGate: 30,
      margins: { acceptanceRate: 0.05, testPassRate: 0.01, alpha: 0.1 },
    });
    expect(r.qualityGate).not.toBeNull();
  });
});

describe("runReplayHarness — bin count parameter", () => {
  it("recorded numBins propagates through to the report", () => {
    const events: F1ShadowEvent[] = [
      ev("s1", 0.1, 0),
      ev("s2", 0.9, 1),
    ];
    const r = runReplayHarness(events, { numBins: 20 });
    expect(r.calibration.numBins).toBe(20);
  });
});

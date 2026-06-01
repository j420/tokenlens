import { describe, expect, it } from "vitest";
import {
  ContextHealthDetector,
  initialDetectorState,
  replayDetector,
} from "./detector.js";
import { DEFAULT_CONFIG } from "./constants.js";
import { makeTurn, rampSession } from "./test-helpers.js";

const CFG = DEFAULT_CONFIG;

describe("ContextHealthDetector — basic observe", () => {
  it("starts in insufficient_data and reports healthy/warning after observing", () => {
    const det = new ContextHealthDetector(CFG);
    expect(det.current.cusum.regime).toBe("insufficient_data");
    const turn = makeTurn({
      turnNumber: 1,
      sessionId: "s1",
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 60_000, // ECF = 0.3 → still healthy
    });
    const obs = det.observe(turn, [turn]);
    expect(obs.skipped).toBe(false);
    expect(obs.ecfSample.ecf).toBeCloseTo(0.3, 6);
    expect(obs.cusum.regime).toBe("healthy");
  });

  it("promotes regime on a high-ECF turn", () => {
    const det = new ContextHealthDetector(CFG);
    const turn = makeTurn({
      turnNumber: 1,
      sessionId: "s1",
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 180_000, // ECF = 0.9 → critical
    });
    const obs = det.observe(turn, [turn]);
    expect(obs.cusum.regime).toBe("critical");
  });
});

describe("ContextHealthDetector — subagent boundary", () => {
  it("preserves parent walk, starts fresh CUSUM for child session", () => {
    const det = new ContextHealthDetector(CFG);
    const parent1 = makeTurn({
      turnNumber: 1,
      sessionId: "parent",
      inputTokens: 180_000,
    });
    det.observe(parent1, [parent1]);
    expect(det.current.cusum.regime).toBe("critical");

    const child1 = makeTurn({
      turnNumber: 2,
      sessionId: "child",
      inputTokens: 20_000,
    });
    det.observe(child1, [parent1, child1]);
    // Child starts fresh — regime should be healthy
    expect(det.current.cusum.regime).toBe("healthy");
    // Parent walk preserved
    expect(det.current.parentCusum?.regime).toBe("critical");
    expect(det.current.parentSessionId).toBe("parent");
    expect(det.current.sessionId).toBe("child");
  });
});

describe("ContextHealthDetector — compaction", () => {
  it("markCompaction resets CUSUM to healthy", () => {
    const det = new ContextHealthDetector(CFG);
    const turn1 = makeTurn({ turnNumber: 1, inputTokens: 180_000 });
    det.observe(turn1, [turn1]);
    expect(det.current.cusum.regime).toBe("critical");
    det.markCompaction(2);
    expect(det.current.cusum.regime).toBe("healthy");
    expect(det.current.compactionResets).toBe(1);
  });
});

describe("ContextHealthDetector — skip handling", () => {
  it("skips malformed turns (NaN tokens) without crashing or advancing sums", () => {
    const det = new ContextHealthDetector(CFG);
    const turn = makeTurn({ turnNumber: 1, inputTokens: 60_000 });
    // Inject NaN into the usage
    turn.usage = { ...turn.usage, input: Number.NaN };
    const obs = det.observe(turn, [turn]);
    expect(obs.skipped).toBe(true);
    expect(obs.skipReason).toBe("malformed_usage");
    expect(det.current.skippedTurns).toBe(1);
    expect(det.current.observedTurns).toBe(0);
  });

  it("skips unknown-window turns without advancing CUSUM sums", () => {
    const det = new ContextHealthDetector(CFG);
    const turn = makeTurn({
      turnNumber: 1,
      model: "never-heard-of-it",
      inputTokens: 60_000,
    });
    const obs = det.observe(turn, [turn]);
    expect(obs.skipped).toBe(true);
    expect(obs.skipReason).toBe("unknown_window");
    expect(det.current.cusum.sPlus).toBe(0);
    expect(det.current.skippedTurns).toBe(1);
  });
});

describe("ContextHealthDetector — serialization round-trip", () => {
  it("toJSON / fromJSON preserves CUSUM state and regime", () => {
    const det = new ContextHealthDetector(CFG);
    const t = makeTurn({ turnNumber: 1, inputTokens: 180_000 });
    det.observe(t, [t]);
    const json = det.toJSON();
    const revived = ContextHealthDetector.fromJSON(CFG, json);
    expect(revived.current.cusum.regime).toBe("critical");
    expect(revived.current.cusum.sPlus).toBeCloseTo(det.current.cusum.sPlus, 6);
    expect(revived.current.cusum.sMinus).toBeCloseTo(det.current.cusum.sMinus, 6);
  });

  it("fromJSON tolerates malformed input (returns initial state)", () => {
    const revived = ContextHealthDetector.fromJSON(CFG, { junk: 42 });
    expect(revived.current.cusum.regime).toBe("insufficient_data");
    expect(revived.current.observedTurns).toBe(0);
  });

  it("fromJSON tolerates null input", () => {
    const revived = ContextHealthDetector.fromJSON(CFG, null);
    expect(revived.current.cusum.regime).toBe("insufficient_data");
  });
});

describe("replayDetector — full-stream walks", () => {
  it("a ramp from 0 to 1 crosses warning then critical", () => {
    const turns = rampSession({
      count: 10,
      startEcf: 0,
      endEcf: 1.0,
      contextWindow: 200_000,
    });
    const { observations, regime } = replayDetector(turns, CFG);
    expect(observations.length).toBe(10);
    // At the end of a 0→1 ramp, regime is critical
    expect(regime).toBe("critical");

    // Find the first warning and first critical turn indices
    const firstWarning = observations.findIndex(
      (o) => o.cusum.regime === "warning"
    );
    const firstCritical = observations.findIndex(
      (o) => o.cusum.regime === "critical"
    );
    expect(firstWarning).toBeGreaterThan(-1);
    expect(firstCritical).toBeGreaterThan(firstWarning);
  });

  it("a flat low-ECF session stays healthy", () => {
    const turns = rampSession({
      count: 10,
      startEcf: 0.2,
      endEcf: 0.3,
      contextWindow: 200_000,
    });
    const { regime } = replayDetector(turns, CFG);
    expect(regime).toBe("healthy");
  });

  it("a flat 0.55 session promotes to warning early and stays", () => {
    const turns = rampSession({
      count: 5,
      startEcf: 0.55,
      endEcf: 0.55,
      contextWindow: 200_000,
    });
    const { observations, regime } = replayDetector(turns, CFG);
    expect(observations[0]!.cusum.regime).toBe("warning");
    expect(regime).toBe("warning");
  });

  it("resumes from an initial state", () => {
    const turns1 = rampSession({
      count: 3,
      startEcf: 0.55,
      endEcf: 0.65,
      contextWindow: 200_000,
    });
    const replay1 = replayDetector(turns1, CFG);
    expect(replay1.finalState.cusum.regime).toBe("warning");
    // Now resume with two more turns that push to critical
    const turns2 = rampSession({
      count: 2,
      startEcf: 0.85,
      endEcf: 0.9,
      contextWindow: 200_000,
    }).map((t, i) => ({ ...t, turnNumber: 4 + i }));
    const replay2 = replayDetector(turns2, CFG, { initial: replay1.finalState });
    expect(replay2.finalState.cusum.regime).toBe("critical");
  });

  it("initialDetectorState produces a deterministic starting point", () => {
    const a = initialDetectorState();
    const b = initialDetectorState();
    expect(a).toEqual(b);
  });
});

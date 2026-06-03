/**
 * Adversarial probe — F6 must never break the agent and never produce
 * NaN / Infinity / PII / non-deterministic output, no matter the input.
 *
 * These tests are organized by "things an attacker (or a malformed
 * Claude Code transcript) could throw at the detector." Each block
 * pins one invariant.
 */

import { describe, expect, it } from "vitest";
import { computeEcf } from "./ecf.js";
import { CusumDetector, initialCusumState } from "./cusum.js";
import { cusumObserve } from "./index.js";
import {
  cacheHitTrend,
  largeToolResultCause,
  scopeDriftSlope,
} from "./drift.js";
import { ContextHealthDetector, replayDetector } from "./detector.js";
import { buildAdvisory } from "./advisor.js";
import { buildReport } from "./report.js";
import { DEFAULT_CONFIG, resolveConfig } from "./constants.js";
import { makeTurn } from "./test-helpers.js";
import type { EcfSample } from "./types.js";

const CFG = DEFAULT_CONFIG;

describe("edge case: empty / zero-shape inputs", () => {
  it("buildReport([]) returns insufficient_data, never throws", () => {
    expect(() => buildReport([])).not.toThrow();
    expect(buildReport([]).regime).toBe("insufficient_data");
  });

  it("replayDetector([]) returns zero observations", () => {
    expect(replayDetector([], CFG).observations).toEqual([]);
  });

  it("buildAdvisory on a fresh detector state returns null", () => {
    const det = new ContextHealthDetector(CFG);
    // No observations yet — synthesize a sample-less observation
    const fakeObs = {
      turnNumber: 0,
      ecfSample: {
        turnNumber: 0,
        attendedInput: 0,
        discountedCacheRead: 0,
        committedOutput: 0,
        contextWindow: 200_000,
        ecf: 0,
        source: "exact" as const,
      },
      cusum: det.current.cusum,
      signals: { cacheHitTrend: 0, scopeDriftSlope: 0, largeToolResultCause: null },
      skipped: false,
    };
    expect(buildAdvisory(fakeObs)).toBeNull();
  });
});

describe("edge case: NaN / Infinity / negative tokens", () => {
  it("computeEcf clamps NaN attendedInput to 0", () => {
    const turn = makeTurn({ turnNumber: 1, inputTokens: Number.NaN });
    const s = computeEcf(turn, { alpha: 0.5 });
    expect(s.attendedInput).toBe(0);
    expect(Number.isFinite(s.ecf)).toBe(true);
  });

  it("computeEcf clamps Infinity to 0", () => {
    const turn = makeTurn({
      turnNumber: 1,
      cacheReadTokens: Number.POSITIVE_INFINITY,
    });
    const s = computeEcf(turn, { alpha: 0.5 });
    expect(s.discountedCacheRead).toBe(0);
    expect(s.ecf).toBe(0);
  });

  it("CUSUM rejects NaN ecf by clamping (via observe sample with NaN ecf)", () => {
    // ECF samples themselves shouldn't carry NaN, but defensive:
    let state = initialCusumState();
    const bad: EcfSample = {
      turnNumber: 1,
      attendedInput: 0,
      discountedCacheRead: 0,
      committedOutput: 0,
      contextWindow: 200_000,
      ecf: Number.NaN,
      source: "exact",
    };
    state = cusumObserve(state, bad, {
      kWarn: 0.5,
      kCrit: 0.75,
      hWarn: 0.05,
      hCrit: 0.1,
    });
    // sPlus / sMinus stay finite (Math.max(0, NaN+anything) = NaN ⇒ we'd
    // see NaN sums if NaN leaked. Catch that here.)
    expect(Number.isFinite(state.sPlus)).toBe(true);
    expect(Number.isFinite(state.sMinus)).toBe(true);
  });

  it("detector skips a NaN-input turn", () => {
    const det = new ContextHealthDetector(CFG);
    const t = makeTurn({ turnNumber: 1, inputTokens: Number.NaN });
    const obs = det.observe(t, [t]);
    expect(obs.skipped).toBe(true);
  });

  it("detector skips a negative-tokens turn", () => {
    const det = new ContextHealthDetector(CFG);
    const t = makeTurn({ turnNumber: 1, inputTokens: 50_000 });
    t.usage = { ...t.usage, output: -100 };
    const obs = det.observe(t, [t]);
    expect(obs.skipped).toBe(true);
    expect(obs.skipReason).toBe("malformed_usage");
  });
});

describe("edge case: unknown model windows", () => {
  it("report aggregates source=unknown_window for all-unknown stream", () => {
    const turns = [
      makeTurn({ turnNumber: 1, model: "future-model-1", inputTokens: 1000 }),
      makeTurn({ turnNumber: 2, model: "future-model-2", inputTokens: 2000 }),
    ];
    expect(buildReport(turns).source).toBe("unknown_window");
  });

  it("never emits an advisory when source is unknown_window", () => {
    const turns = [
      makeTurn({ turnNumber: 1, model: "future-x", inputTokens: 1_000_000 }),
      makeTurn({ turnNumber: 2, model: "future-x", inputTokens: 1_000_000 }),
    ];
    const r = buildReport(turns);
    expect(r.regime).toBe("insufficient_data");
    expect(r.primaryCause).toBeNull();
  });
});

describe("edge case: malformed tool inputs", () => {
  it("scopeDriftSlope handles null tool inputs", () => {
    const turns = [
      makeTurn({
        turnNumber: 1,
        toolUses: [{ name: "Read", input: null, id: "t1" }],
      }),
      makeTurn({
        turnNumber: 2,
        toolUses: [{ name: "Read", input: undefined, id: "t2" }],
      }),
    ];
    expect(() => scopeDriftSlope(turns, 5)).not.toThrow();
    expect(scopeDriftSlope(turns, 5)).toBe(0);
  });

  it("scopeDriftSlope handles non-object tool inputs (string, number)", () => {
    const turns = [
      makeTurn({
        turnNumber: 1,
        toolUses: [{ name: "X", input: "raw-string", id: "t1" }],
      }),
      makeTurn({
        turnNumber: 2,
        toolUses: [{ name: "X", input: 42, id: "t2" }],
      }),
    ];
    expect(() => scopeDriftSlope(turns, 5)).not.toThrow();
  });

  it("largeToolResultCause handles circular references in content", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const turn = makeTurn({
      turnNumber: 1,
      toolUses: [{ name: "Read", input: {}, id: "t1" }],
      toolResults: [{ tool_use_id: "t1", content: circular }],
    });
    expect(() => largeToolResultCause(turn, 50_000, 0.15)).not.toThrow();
  });
});

describe("edge case: NaN-free secondary signals", () => {
  it("cacheHitTrend returns finite even with all-zero attended turns", () => {
    const turns = [makeTurn({ turnNumber: 1 }), makeTurn({ turnNumber: 2 })];
    const v = cacheHitTrend(turns, 5);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBe(0);
  });

  it("scopeDriftSlope is finite for empty-tools turns", () => {
    const turns = [makeTurn({ turnNumber: 1 }), makeTurn({ turnNumber: 2 })];
    const v = scopeDriftSlope(turns, 5);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBe(0);
  });

  it("cacheHitTrend is finite for single-point input", () => {
    const turns = [
      makeTurn({ turnNumber: 1, cacheReadTokens: 100, inputTokens: 100 }),
    ];
    expect(cacheHitTrend(turns, 5)).toBe(0); // need ≥2 informative points
  });
});

describe("edge case: deterministic advisor", () => {
  it("100 random sessions produce advisories with no PII leak", () => {
    // Probe: random tool inputs with secret-shaped content; advisory
    // text must never contain those secrets.
    const secrets = [
      "AKIA1234567890ABCDEF",          // AWS-style
      "ghp_1234567890abcdef",           // GitHub-style
      "sk-projABCDEF1234567890",        // OpenAI-style
      "Bearer eyJhbGciOiJIUzI1NiIs",   // JWT-style
      "/etc/shadow",                    // path
      "password=hunter2",               // url-encoded form
    ];
    for (let i = 0; i < 100; i++) {
      const secret = secrets[i % secrets.length]!;
      const det = new ContextHealthDetector(CFG);
      const t = makeTurn({
        turnNumber: 1,
        sessionId: "s",
        model: "claude-sonnet-4-5-20250929",
        inputTokens: 180_000,
        toolUses: [
          {
            name: "Read",
            input: { file_path: `/secret/${secret}` },
            id: `t${i}`,
          },
        ],
        toolResults: [
          {
            tool_use_id: `t${i}`,
            content: `BEGIN ${secret} END`.repeat(2000), // dominant
          },
        ],
      });
      const obs = det.observe(t, [t]);
      const advisory = buildAdvisory(obs);
      if (advisory === null) continue;
      expect(advisory.text.includes(secret)).toBe(false);
    }
  });
});

describe("edge case: detector serialization tolerates corruption", () => {
  it("fromJSON ignores invalid regime strings", () => {
    const revived = ContextHealthDetector.fromJSON(CFG, {
      cusum: { sPlus: 0.05, sMinus: 0, lastTurnNumber: 1, regime: "exploded", regimeChangedAtTurn: 1 },
    });
    expect(["healthy", "warning", "critical", "insufficient_data"]).toContain(
      revived.current.cusum.regime
    );
  });

  it("fromJSON ignores NaN sums", () => {
    const revived = ContextHealthDetector.fromJSON(CFG, {
      cusum: {
        sPlus: Number.NaN,
        sMinus: Number.NaN,
        lastTurnNumber: 1,
        regime: "warning",
        regimeChangedAtTurn: 1,
      },
    });
    expect(Number.isFinite(revived.current.cusum.sPlus)).toBe(true);
    expect(Number.isFinite(revived.current.cusum.sMinus)).toBe(true);
  });

  it("fromJSON ignores negative sums", () => {
    const revived = ContextHealthDetector.fromJSON(CFG, {
      cusum: { sPlus: -0.5, sMinus: 0, lastTurnNumber: 1, regime: "healthy", regimeChangedAtTurn: 1 },
    });
    expect(revived.current.cusum.sPlus).toBeGreaterThanOrEqual(0);
  });
});

describe("edge case: subagent boundary preserves parent walk", () => {
  it("a parent walk in critical regime is preserved when child starts", () => {
    const det = new ContextHealthDetector(CFG);
    const parent = makeTurn({ turnNumber: 1, sessionId: "p", inputTokens: 180_000 });
    det.observe(parent, [parent]);
    expect(det.current.cusum.regime).toBe("critical");

    const child = makeTurn({ turnNumber: 2, sessionId: "c", inputTokens: 10_000 });
    det.observe(child, [parent, child]);
    expect(det.current.parentSessionId).toBe("p");
    expect(det.current.parentCusum?.regime).toBe("critical");
    expect(det.current.cusum.regime).toBe("healthy");
  });
});

describe("edge case: resolveConfig env handling", () => {
  it("ignores non-numeric env values for alpha", () => {
    const cfg = resolveConfig({ PRUNE_CONTEXT_HEALTH_ALPHA: "not-a-number" });
    expect(cfg.alpha).toBe(DEFAULT_CONFIG.alpha);
  });

  it("ignores out-of-range alpha (negative)", () => {
    const cfg = resolveConfig({ PRUNE_CONTEXT_HEALTH_ALPHA: "-0.5" });
    expect(cfg.alpha).toBe(DEFAULT_CONFIG.alpha);
  });

  it("ignores out-of-range alpha (>1)", () => {
    const cfg = resolveConfig({ PRUNE_CONTEXT_HEALTH_ALPHA: "1.5" });
    expect(cfg.alpha).toBe(DEFAULT_CONFIG.alpha);
  });

  it("accepts a valid alpha env value", () => {
    const cfg = resolveConfig({ PRUNE_CONTEXT_HEALTH_ALPHA: "0.75" });
    expect(cfg.alpha).toBe(0.75);
  });

  it("overrides win over env", () => {
    const cfg = resolveConfig(
      { PRUNE_CONTEXT_HEALTH_ALPHA: "0.75" },
      { alpha: 0.25 }
    );
    expect(cfg.alpha).toBe(0.25);
  });

  it("rejects NaN-injected via override", () => {
    const cfg = resolveConfig({}, { alpha: Number.NaN });
    expect(cfg.alpha).toBe(DEFAULT_CONFIG.alpha);
  });
});

describe("edge case: CusumDetector idempotence on no-op reset", () => {
  it("resetting an already-reset detector is a no-op (state-wise)", () => {
    const det = new CusumDetector({ kWarn: 0.5, kCrit: 0.75, hWarn: 0.05, hCrit: 0.1 });
    det.reset(1);
    const s1 = det.current;
    det.reset(1);
    const s2 = det.current;
    expect(s1).toEqual(s2);
  });
});

describe("edge case: very long sessions don't accumulate unbounded memory", () => {
  it("recentSamples buffer is capped at rollingWindow", () => {
    const det = new ContextHealthDetector(CFG);
    for (let i = 1; i <= 100; i++) {
      const t = makeTurn({
        turnNumber: i,
        sessionId: "s",
        inputTokens: 50_000,
      });
      det.observe(t, [t]);
    }
    expect(det.current.recentSamples.length).toBeLessThanOrEqual(CFG.rollingWindow);
  });
});

describe("edge case: hostile alpha cannot poison ECF (regression)", () => {
  it("negative alpha falls back to the 0.5 default (input pre-clamp)", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "claude-sonnet-4-5-20250929",
      cacheReadTokens: 100_000,
    });
    const sample = computeEcf(turn, { alpha: -0.5 });
    // Expected: alpha falls back to 0.5 ⇒ discountedCacheRead=50_000;
    // ECF = 50_000 / 200_000 = 0.25
    expect(sample.discountedCacheRead).toBe(50_000);
    expect(sample.ecf).toBeCloseTo(0.25, 6);
  });

  it("NaN alpha falls back to default", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "claude-sonnet-4-5-20250929",
      cacheReadTokens: 100_000,
    });
    const sample = computeEcf(turn, { alpha: Number.NaN });
    expect(sample.discountedCacheRead).toBe(50_000);
  });

  it("alpha > 1 falls back to default (would over-weight cache otherwise)", () => {
    const turn = makeTurn({
      turnNumber: 1,
      model: "claude-sonnet-4-5-20250929",
      cacheReadTokens: 100_000,
    });
    const sample = computeEcf(turn, { alpha: 5 });
    expect(sample.discountedCacheRead).toBe(50_000);
  });
});

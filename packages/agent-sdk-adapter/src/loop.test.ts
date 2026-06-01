/**
 * LoopPolicy tests. The credibility property under test: a halt fires
 * EXACTLY at the configured threshold, on the right kind of evidence, and
 * NEVER on a productive streak — and the error carries actionable context.
 */

import { describe, expect, it } from "vitest";
import type { TurnData } from "@prune/intelligence";
import { LoopPolicy } from "./loop.js";
import { LoopHaltError } from "./types.js";

function productiveTurn(turnNumber: number): TurnData {
  // Signals the ROI classifier reads as productive: files written + tests passed.
  return {
    turnNumber,
    responseContent: `Implemented the feature in src/feature-${turnNumber}.ts; all tests pass.`,
    filesWritten: [`src/feature-${turnNumber}.ts`],
    filesRead: [],
    testsPassed: true,
    errorsPresent: [],
    tokensIn: 800,
    tokensOut: 200,
    timestamp: new Date(),
  };
}

function recursiveTurn(turnNumber: number): TurnData {
  // Same response over and over, no files written, no tests, errors present:
  // the canonical low-ROI signature.
  return {
    turnNumber,
    responseContent:
      "Still investigating the same problem; the type error persists at line 42.",
    filesWritten: [],
    filesRead: ["src/auth.ts"],
    testsPassed: false,
    errorsPresent: ["TypeError: cannot read property 'x' of undefined"],
    tokensIn: 5000,
    tokensOut: 800,
    timestamp: new Date(),
  };
}

describe("LoopPolicy enforcement", () => {
  it("does NOT halt on a productive streak", () => {
    const p = new LoopPolicy({ consecutiveLowRoiThreshold: 3 });
    for (let i = 1; i <= 10; i++) {
      expect(() => p.observe(productiveTurn(i))).not.toThrow();
    }
    expect(p.state.consecutiveLowRoiTurns).toBeLessThan(3);
    expect(p.haltDecisions).toHaveLength(0);
  });

  it("HALTS at exactly the configured threshold WHEN enforce=true is set explicitly", () => {
    const p = new LoopPolicy({
      consecutiveLowRoiThreshold: 3,
      enforce: true, // opt-in (default is now false — never silent halts)
      currentModel: "claude-opus-4-5-20251101",
    });
    p.observe(recursiveTurn(1));
    p.observe(recursiveTurn(2));
    expect(() => p.observe(recursiveTurn(3))).toThrow(LoopHaltError);
    const decision = p.haltDecisions[0];
    expect(decision.halt).toBe(true);
    expect(decision.streak).toBeGreaterThanOrEqual(3);
  });

  it("default (enforce=false) RECORDS but never throws — opt-in safety", () => {
    const p = new LoopPolicy({ consecutiveLowRoiThreshold: 3 }); // enforce defaults false
    p.observe(recursiveTurn(1));
    p.observe(recursiveTurn(2));
    expect(() => p.observe(recursiveTurn(3))).not.toThrow();
    expect(p.haltDecisions.length).toBe(1);
  });

  it("RESET clears all internal state", () => {
    const p = new LoopPolicy({
      consecutiveLowRoiThreshold: 3,
      enforce: false,
    });
    p.observe(recursiveTurn(1));
    p.observe(recursiveTurn(2));
    p.observe(recursiveTurn(3));
    expect(p.haltDecisions.length).toBeGreaterThan(0);
    p.reset();
    expect(p.state.consecutiveLowRoiTurns).toBe(0);
    expect(p.haltDecisions).toHaveLength(0);
  });

  it("shadow mode (enforce=false) RECORDS the decision but does NOT throw", () => {
    const p = new LoopPolicy({
      consecutiveLowRoiThreshold: 3,
      enforce: false,
    });
    p.observe(recursiveTurn(1));
    p.observe(recursiveTurn(2));
    const d = p.observe(recursiveTurn(3));
    expect(d).not.toBeNull();
    expect(d!.halt).toBe(true);
    expect(p.haltDecisions).toHaveLength(1);
  });
});

describe("LoopHaltError", () => {
  it("carries the structured decision for catch-blocks to inspect", () => {
    const p = new LoopPolicy({ consecutiveLowRoiThreshold: 3, enforce: true });
    p.observe(recursiveTurn(1));
    p.observe(recursiveTurn(2));
    try {
      p.observe(recursiveTurn(3));
      throw new Error("should have halted");
    } catch (e) {
      expect(e).toBeInstanceOf(LoopHaltError);
      const halt = (e as LoopHaltError).decision;
      expect(halt.halt).toBe(true);
      expect(halt.reason).toContain("loop-halt");
    }
  });
});

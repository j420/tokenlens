import { describe, it, expect } from "vitest";
import type { TurnData } from "./roi-classifier.js";
import {
  appendToSession,
  deserializeWalk,
  evaluateLoopBlock,
  formatLoopBlockMessage,
  replaySession,
  serializeWalk,
} from "./session-tracker.js";

function recursiveTurn(n: number): TurnData {
  // Identical response content → high similarity → recursive.
  return {
    turnNumber: n,
    responseContent:
      "Let me try again. error: cannot find module 'foo'. Tried install but same error: cannot find module 'foo'.",
    filesWritten: ["src/foo.ts"],
    filesRead: ["src/bar.ts"],
    testsPassed: false,
    errorsPresent: ["cannot find module"],
    tokensIn: 2000,
    tokensOut: 500,
    timestamp: new Date(`2026-05-30T10:0${n}:00Z`),
  };
}

function productiveTurn(n: number): TurnData {
  return {
    turnNumber: n,
    responseContent:
      "Implemented the user service with login and logout methods. Tests passing.",
    filesWritten: [`src/feature-${n}.ts`],
    filesRead: [`src/dep-${n}.ts`],
    testsPassed: true,
    errorsPresent: [],
    tokensIn: 1500,
    tokensOut: 600,
    timestamp: new Date(`2026-05-30T10:0${n}:00Z`),
  };
}

describe("replaySession", () => {
  it("counts a streak of recursive turns", () => {
    const walk = replaySession([
      recursiveTurn(1),
      recursiveTurn(2),
      recursiveTurn(3),
      recursiveTurn(4),
    ]);
    expect(walk.sessionROI.consecutiveLowRoiTurns).toBeGreaterThanOrEqual(3);
    expect(walk.perTurn).toHaveLength(4);
  });

  it("resets the streak on a productive turn", () => {
    const walk = replaySession([
      recursiveTurn(1),
      recursiveTurn(2),
      productiveTurn(3),
    ]);
    expect(walk.sessionROI.consecutiveLowRoiTurns).toBe(0);
  });
});

describe("evaluateLoopBlock", () => {
  it("does not block below the streak threshold", () => {
    const walk = replaySession([recursiveTurn(1), recursiveTurn(2)]);
    const d = evaluateLoopBlock(walk, {
      consecutiveLowRoiThreshold: 3,
      currentModel: "claude-sonnet-4-5-20250929",
    });
    expect(d.shouldBlock).toBe(false);
  });

  it("blocks once the streak hits the threshold and emits a routing suggestion", () => {
    // Turn 1 has no prior to compare against, so recursion only registers
    // from turn 2 onward. 4 recursive turns → streak = 3.
    const walk = replaySession([
      recursiveTurn(1),
      recursiveTurn(2),
      recursiveTurn(3),
      recursiveTurn(4),
    ]);
    const d = evaluateLoopBlock(walk, {
      consecutiveLowRoiThreshold: 3,
      currentModel: "claude-sonnet-4-5-20250929",
    });
    expect(d.shouldBlock).toBe(true);
    expect(d.reason).toContain("circuit-breaker");
    expect(d.suggestion?.model).toBeTruthy();
  });

  it("formats a human-readable block message", () => {
    const walk = replaySession([
      recursiveTurn(1),
      recursiveTurn(2),
      recursiveTurn(3),
      recursiveTurn(4),
    ]);
    const d = evaluateLoopBlock(walk, {
      consecutiveLowRoiThreshold: 3,
      currentModel: "claude-sonnet-4-5-20250929",
    });
    const msg = formatLoopBlockMessage(d);
    expect(msg).toContain("Prune circuit-breaker");
    expect(msg).toContain("Suggested");
  });

  it("returns empty string when not blocking", () => {
    const walk = replaySession([productiveTurn(1)]);
    const d = evaluateLoopBlock(walk, { currentModel: "gpt-4o" });
    expect(formatLoopBlockMessage(d)).toBe("");
  });
});

describe("appendToSession", () => {
  it("incremental ≡ batch — appending turns one by one matches replaySession", () => {
    const allTurns: TurnData[] = [
      productiveTurn(1),
      recursiveTurn(2),
      recursiveTurn(3),
      productiveTurn(4),
      recursiveTurn(5),
    ];
    const batch = replaySession(allTurns);

    // Incremental: walk the first 2, then append the rest one by one.
    let walk = replaySession(allTurns.slice(0, 2));
    const history: TurnData[] = allTurns.slice(0, 2);
    for (const t of allTurns.slice(2)) {
      walk = appendToSession(walk, [t], history);
      history.push(t);
    }

    expect(walk.perTurn).toEqual(batch.perTurn);
    expect(walk.sessionROI).toEqual(batch.sessionROI);
    expect(walk.lastTurn).toEqual(batch.lastTurn);
    expect(walk.lastAnalysis).toEqual(batch.lastAnalysis);
  });

  it("(de)serializeWalk round-trips a walk exactly", () => {
    const walk = replaySession([
      recursiveTurn(1),
      recursiveTurn(2),
      recursiveTurn(3),
      recursiveTurn(4),
    ]);
    const round = deserializeWalk(JSON.parse(JSON.stringify(serializeWalk(walk))));
    expect(round.perTurn).toEqual(walk.perTurn);
    expect(round.sessionROI.cumulativeRoiScore).toBe(
      walk.sessionROI.cumulativeRoiScore
    );
    expect(round.sessionROI.consecutiveLowRoiTurns).toBe(
      walk.sessionROI.consecutiveLowRoiTurns
    );
    expect(round.sessionROI.lowRoiStreak.map((t) => t.turnNumber)).toEqual(
      walk.sessionROI.lowRoiStreak.map((t) => t.turnNumber)
    );
    expect(round.sessionROI.lowRoiStreak[0]?.timestamp).toBeInstanceOf(Date);
  });
});

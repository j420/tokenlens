/**
 * Replay a transcript turn-by-turn to compute the current SessionROI and
 * find the most recent block-worthy state.
 *
 * Wraps the existing turn classifier (`classifyTurnROI`) and session
 * aggregator (`updateSessionROI`) so callers (hooks, MCP tools, SDK adapter)
 * can ask one question — "where are we" — and get an actionable answer.
 */

import {
  classifyTurnROI,
  createEmptySessionROI,
  getModelRoutingSuggestion,
  updateSessionROI,
  type ROIAnalysis,
  type SessionROI,
  type TurnData,
} from "./roi-classifier.js";

export interface SessionROIWalk {
  sessionROI: SessionROI;
  perTurn: ROIAnalysis[];
  lastTurn?: TurnData;
  lastAnalysis?: ROIAnalysis;
}

export function replaySession(turns: TurnData[]): SessionROIWalk {
  let session = createEmptySessionROI();
  const perTurn: ROIAnalysis[] = [];
  const history: TurnData[] = [];
  let lastAnalysis: ROIAnalysis | undefined;
  for (const t of turns) {
    const analysis = classifyTurnROI(t, history);
    session = updateSessionROI(session, analysis, t);
    perTurn.push(analysis);
    history.push(t);
    lastAnalysis = analysis;
  }
  return {
    sessionROI: session,
    perTurn,
    lastTurn: turns[turns.length - 1],
    lastAnalysis,
  };
}

/**
 * Incremental sibling of `replaySession`. Given an existing walk and a
 * batch of new turns to append, run `classifyTurnROI` + `updateSessionROI`
 * only on the new turns. `priorHistory` must contain the TurnData for
 * every turn that produced `walk` — the classifier needs it to compute
 * similarity, redundant reads, and error resolution against past turns.
 *
 * Mathematically equivalent to
 * `replaySession([...priorHistory, ...newTurns])` — see
 * `session-tracker.test.ts:"appendToSession ≡ replaySession"`.
 */
export function appendToSession(
  walk: SessionROIWalk,
  newTurns: TurnData[],
  priorHistory: TurnData[]
): SessionROIWalk {
  let session = walk.sessionROI;
  const perTurn = [...walk.perTurn];
  const history = [...priorHistory];
  let lastAnalysis = walk.lastAnalysis;
  let lastTurn = walk.lastTurn;
  for (const t of newTurns) {
    const analysis = classifyTurnROI(t, history);
    session = updateSessionROI(session, analysis, t);
    perTurn.push(analysis);
    history.push(t);
    lastAnalysis = analysis;
    lastTurn = t;
  }
  return { sessionROI: session, perTurn, lastTurn, lastAnalysis };
}

/**
 * JSON-safe shape of a SessionROIWalk. Dates are stringified to ISO and
 * rehydrated by `deserializeWalk`. Round-trip equivalent to the original.
 */
export interface SerializedSessionROIWalk {
  sessionROI: {
    cumulativeRoiScore: number;
    totalProductiveTokens: number;
    totalRecursiveTokens: number;
    totalTokens: number;
    consecutiveLowRoiTurns: number;
    lowRoiStreak: SerializedTurnData[];
  };
  perTurn: ROIAnalysis[];
  lastTurn?: SerializedTurnData;
  lastAnalysis?: ROIAnalysis;
}

interface SerializedTurnData extends Omit<TurnData, "timestamp"> {
  timestamp: string;
}

function serializeTurn(t: TurnData): SerializedTurnData {
  return { ...t, timestamp: t.timestamp.toISOString() };
}

function deserializeTurn(t: SerializedTurnData): TurnData {
  return { ...t, timestamp: new Date(t.timestamp) };
}

export function serializeWalk(walk: SessionROIWalk): SerializedSessionROIWalk {
  return {
    sessionROI: {
      ...walk.sessionROI,
      lowRoiStreak: walk.sessionROI.lowRoiStreak.map(serializeTurn),
    },
    perTurn: walk.perTurn,
    lastTurn: walk.lastTurn ? serializeTurn(walk.lastTurn) : undefined,
    lastAnalysis: walk.lastAnalysis,
  };
}

export function deserializeWalk(
  walk: SerializedSessionROIWalk
): SessionROIWalk {
  return {
    sessionROI: {
      ...walk.sessionROI,
      lowRoiStreak: walk.sessionROI.lowRoiStreak.map(deserializeTurn),
    },
    perTurn: walk.perTurn,
    lastTurn: walk.lastTurn ? deserializeTurn(walk.lastTurn) : undefined,
    lastAnalysis: walk.lastAnalysis,
  };
}

export interface LoopBlockDecision {
  shouldBlock: boolean;
  reason?: string;
  recursiveSignals: string[];
  consecutiveLowRoiTurns: number;
  suggestion?: {
    model: string | null;
    savingsPercent: number;
    message: string;
  };
}

export interface LoopBlockOptions {
  /** Minimum streak before we block. Default 3. */
  consecutiveLowRoiThreshold?: number;
  /** Model the session is currently using; required for routing suggestion. */
  currentModel?: string;
}

export function evaluateLoopBlock(
  walk: SessionROIWalk,
  opts: LoopBlockOptions = {}
): LoopBlockDecision {
  const threshold = opts.consecutiveLowRoiThreshold ?? 3;
  const streak = walk.sessionROI.consecutiveLowRoiTurns;
  const recursiveSignals = walk.lastAnalysis?.signals.recursive ?? [];

  if (streak < threshold) {
    return {
      shouldBlock: false,
      recursiveSignals,
      consecutiveLowRoiTurns: streak,
    };
  }

  const suggestion = opts.currentModel
    ? getModelRoutingSuggestion(opts.currentModel, streak)
    : null;

  const top = recursiveSignals.slice(0, 3).join("; ");
  const reason =
    `Prune circuit-breaker: ${streak} consecutive low-ROI turns` +
    (top ? ` (signals: ${top})` : "") +
    (suggestion?.suggestedModel
      ? `. Suggested: ${suggestion.suggestedModel} (save ~${suggestion.savingsPercent}%)`
      : ". Suggested: re-scope the request.");

  return {
    shouldBlock: true,
    reason,
    recursiveSignals,
    consecutiveLowRoiTurns: streak,
    suggestion: suggestion
      ? {
          model: suggestion.suggestedModel,
          savingsPercent: suggestion.savingsPercent,
          message: suggestion.message,
        }
      : undefined,
  };
}

export function formatLoopBlockMessage(decision: LoopBlockDecision): string {
  if (!decision.shouldBlock) return "";
  const lines: string[] = [];
  lines.push("🛑 Prune circuit-breaker");
  lines.push("");
  lines.push(
    `Last ${decision.consecutiveLowRoiTurns} turns flagged recursive.`
  );
  if (decision.recursiveSignals.length > 0) {
    lines.push("Signals:");
    for (const s of decision.recursiveSignals.slice(0, 3)) {
      lines.push(`  • ${s}`);
    }
  }
  if (decision.suggestion?.model) {
    lines.push(
      `Suggested: switch to ${decision.suggestion.model} (save ~${decision.suggestion.savingsPercent}%).`
    );
  } else if (decision.suggestion) {
    lines.push(decision.suggestion.message);
  } else {
    lines.push("Suggested: re-scope or break the task into smaller pieces.");
  }
  return lines.join("\n");
}

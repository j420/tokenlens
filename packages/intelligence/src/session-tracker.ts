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

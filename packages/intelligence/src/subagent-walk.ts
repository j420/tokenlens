/**
 * Subagent activity walker — pure transcript analysis. Given a session
 * view's `NormalizedTurn[]`, produces a `SubagentActivity` snapshot that
 * counts active fan-outs, depths, and the spawn-time fingerprint the
 * policy needs.
 *
 * Designed to detect the documented incident class:
 *   - "FAN_OUT_RUNAWAY"   — 49 parallel subagents in 2.5h, $8K-$15K
 *   - "UNATTENDED_LOOP"   — 23 subagents 3 days unattended, $47K
 *   - "DEEP_NESTING"      — recursive Task fan-out
 *
 * Sources: https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code
 *          https://buildtolaunch.substack.com/p/claude-code-token-optimization
 *
 * No I/O. No state. The caller drives I/O via @prune/telemetry.
 */

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MIN;

const TASK_TOOL = "Task";

/**
 * Subset of NormalizedTurn relevant to subagent activity. Importing the
 * full shape would create a cross-package coupling we don't want — keep
 * this surface narrow and adapter-friendly.
 */
export interface SubagentWalkTurn {
  turnNumber: number;
  startedAt?: string;
  endedAt?: string;
  toolUses: Array<{ name: string; input?: unknown; id?: string }>;
  toolResults: Array<{
    tool_use_id?: string;
    content?: unknown;
    is_error?: boolean;
  }>;
}

export interface SubagentInvocation {
  toolUseId: string;
  turnNumber: number;
  startedAt: Date | null;
  endedAt: Date | null;
  /** When the matching tool_result lands; null while in-flight. */
  status: "active" | "completed" | "errored";
  /** From the Task input.subagent_type (default "general-purpose"). */
  subagentType: string;
  /** From the Task input.description (best-effort, optional). */
  description?: string;
  /** Best-known parent context — the parent turn's number. */
  parentTurnNumber: number;
}

export interface SubagentBurst {
  windowStart: Date;
  windowEnd: Date;
  count: number;
  toolUseIds: string[];
}

export interface SubagentActivity {
  invocations: SubagentInvocation[];
  /** Active subagents at `asOf`. */
  activeCount: number;
  /** Cumulative subagent spawns across the whole session. */
  totalCount: number;
  /** The longest currently-active subagent's runtime in minutes, 0 when none. */
  longestActiveMinutes: number;
  /** Highest single-turn fan-out — how many parallel Task uses in one turn. */
  peakParallelInOneTurn: number;
  /** All bursts where >= burstThreshold subagents started inside burstWindowMs. */
  bursts: SubagentBurst[];
}

export interface AnalyzeSubagentsOptions {
  asOf?: Date;
  /** Burst window for FAN_OUT_RUNAWAY detection. Default 60s. */
  burstWindowMs?: number;
  /** Min spawns in window to count as a burst. Default 5. */
  burstThreshold?: number;
}

function safeParseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

function extractSubagentType(input: unknown): string {
  if (input && typeof input === "object") {
    const v = (input as Record<string, unknown>).subagent_type;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "general-purpose";
}

function extractDescription(input: unknown): string | undefined {
  if (input && typeof input === "object") {
    const v = (input as Record<string, unknown>).description;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function analyzeSubagents(
  turns: SubagentWalkTurn[],
  opts: AnalyzeSubagentsOptions = {}
): SubagentActivity {
  const asOf = opts.asOf ?? new Date();
  const burstWindowMs = opts.burstWindowMs ?? 60_000;
  const burstThreshold = opts.burstThreshold ?? 5;

  // Pass 1: enumerate every Task tool_use across the session.
  const invocations: SubagentInvocation[] = [];
  const resultsById = new Map<string, { is_error: boolean; turnNumber: number; endedAt: Date | null }>();

  // Pre-index tool_results by id so we can mark completion.
  for (const t of turns) {
    const endedAt = safeParseDate(t.endedAt);
    for (const r of t.toolResults) {
      if (r.tool_use_id) {
        resultsById.set(r.tool_use_id, {
          is_error: r.is_error === true,
          turnNumber: t.turnNumber,
          endedAt,
        });
      }
    }
  }

  // Per-turn fan-out tracking.
  let peakParallelInOneTurn = 0;

  for (const t of turns) {
    const startedAt = safeParseDate(t.startedAt) ?? safeParseDate(t.endedAt);
    let parallelInThisTurn = 0;
    for (const u of t.toolUses) {
      if (u.name !== TASK_TOOL) continue;
      parallelInThisTurn++;
      const id = u.id ?? `synthetic-${t.turnNumber}-${parallelInThisTurn}`;
      const completion = resultsById.get(id);
      const inv: SubagentInvocation = {
        toolUseId: id,
        turnNumber: t.turnNumber,
        startedAt,
        endedAt: completion?.endedAt ?? null,
        status: !completion ? "active" : completion.is_error ? "errored" : "completed",
        subagentType: extractSubagentType(u.input),
        description: extractDescription(u.input),
        parentTurnNumber: t.turnNumber,
      };
      invocations.push(inv);
    }
    if (parallelInThisTurn > peakParallelInOneTurn) {
      peakParallelInOneTurn = parallelInThisTurn;
    }
  }

  // Active = no matching tool_result yet.
  const active = invocations.filter((i) => i.status === "active");
  const totalCount = invocations.length;
  const activeCount = active.length;

  let longestActiveMinutes = 0;
  for (const inv of active) {
    if (!inv.startedAt) continue;
    const minutes = (asOf.getTime() - inv.startedAt.getTime()) / MS_PER_MIN;
    if (minutes > longestActiveMinutes) longestActiveMinutes = minutes;
  }

  // Burst detection: slide a window over `startedAt` timestamps.
  const bursts: SubagentBurst[] = [];
  const sorted = invocations
    .filter((i) => i.startedAt !== null)
    .slice()
    .sort((a, b) => a.startedAt!.getTime() - b.startedAt!.getTime());

  let i = 0;
  while (i < sorted.length) {
    const windowStart = sorted[i].startedAt!;
    let j = i;
    while (
      j < sorted.length &&
      sorted[j].startedAt!.getTime() - windowStart.getTime() <= burstWindowMs
    ) {
      j++;
    }
    const windowEnd = sorted[j - 1].startedAt!;
    const count = j - i;
    if (count >= burstThreshold) {
      bursts.push({
        windowStart,
        windowEnd,
        count,
        toolUseIds: sorted.slice(i, j).map((s) => s.toolUseId),
      });
      i = j; // skip the rest of this burst; next-bursts must be separated
    } else {
      i++;
    }
  }

  return {
    invocations,
    activeCount,
    totalCount,
    longestActiveMinutes,
    peakParallelInOneTurn,
    bursts,
  };
}

export const SUBAGENT_CONSTANTS = {
  MS_PER_MIN,
  MS_PER_HOUR,
  TASK_TOOL,
};

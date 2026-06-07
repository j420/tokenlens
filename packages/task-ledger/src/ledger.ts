/**
 * Cost-per-Completed-Task Ledger  (F11)
 * =====================================
 * Per-request cost views (attribution rollup, replay-cost what-if) answer
 * "what did THIS request cost?". They cannot answer "what did this TASK cost,
 * including the retries and dead-ends it took to finish?" — because the request
 * is the wrong accounting unit. A task that took five tries to land one accepted
 * change shows up as five independent requests, four of which look "successful".
 *
 * `rollupTaskLedger(events, options?)` is a PURE function that re-aggregates
 * caller-supplied per-request spend events by TASK and divides total spend by
 * the accepted-outcome count, exposing:
 *   - cost-per-accepted-outcome (the real unit price of getting work landed),
 *   - the waste ratio (spend on rejected / retried / abandoned requests),
 *   - per-task and fleet rollups.
 *
 * This is a new DENOMINATOR, not a new dimension — the delta vs attribution
 * (per-request rollup) and replay-cost (per-request what-if).
 *
 * DISCIPLINE:
 *   - Deterministic & total. Same events => same report. Malformed events are
 *     skipped, never thrown on.
 *   - Honest pricing. Cost comes from `@prune/shared` strict pricing; an event
 *     on an UNPRICED model contributes its tokens but NO dollars, and the task
 *     is flagged `costComplete: false` so a cost-per-task is never fabricated
 *     from a partial total (it returns null instead).
 *   - No regex, no model. Outcome is a caller-declared enum, never inferred.
 *   - PII-safe. Operates on ids, token counts, and an outcome enum — no content.
 */

import { getModelPricingStrictByName } from "@prune/shared";

// ============================================================================
// Types
// ============================================================================

/**
 * Terminal disposition of a request, DECLARED by the caller (the host knows it
 * from the accept/reject/edit signal). Only `accepted` counts as landed work.
 */
export type TaskOutcome =
  | "accepted" // the AI output was kept (the ground-truth "done" signal)
  | "rejected" // the user threw the output away
  | "retry" // a re-attempt of the same goal (spend toward an eventual accept)
  | "abandoned" // the task was dropped without an accept
  | "pending"; // not yet resolved (counted in spend, not in the denominator)

/** One request's spend + its outcome. Tokens are caller-supplied (tokenizer). */
export interface SpendEvent {
  /** Task this request belongs to (the accounting unit). */
  taskId: string;
  /** Optional request id (for de-dup / traceability). */
  requestId?: string;
  /** Model the request ran on (drives pricing; unpriced ⇒ no dollars). */
  model: string;
  /** Fresh input tokens. */
  inputTokens: number;
  /** Output tokens. */
  outputTokens: number;
  /** Cache-read input tokens (billed at the cached rate when known). */
  cacheReadTokens?: number;
  /** Cache-write input tokens (billed at the input rate; multiplier handled by caller if needed). */
  cacheWriteTokens?: number;
  /** Terminal disposition. */
  outcome: TaskOutcome;
}

export interface TaskLedgerOptions {
  /**
   * Outcomes counted as "waste" (spend that did not directly land work).
   * Default: rejected + retry + abandoned. `pending` is never waste (unresolved).
   */
  wasteOutcomes?: readonly TaskOutcome[];
}

export interface TaskRollup {
  taskId: string;
  /** Total tokens across all of the task's requests (input+output+cache). */
  totalTokens: number;
  /** Total USD across PRICED requests only. null when no request was priced. */
  costUsd: number | null;
  /** True iff every request in the task was on a priced model. */
  costComplete: boolean;
  /** Number of requests in the task. */
  requestCount: number;
  /** Requests with outcome === "accepted". */
  acceptedCount: number;
  /** USD spent on waste-outcome requests (priced only). null when none priced. */
  wastedCostUsd: number | null;
  /** Tokens spent on waste-outcome requests. */
  wastedTokens: number;
  /**
   * USD per accepted outcome = costUsd / acceptedCount. null when cost is
   * incomplete (unpriced model present) or acceptedCount === 0 (never divide by
   * zero or fabricate a unit price for a task that landed nothing).
   */
  costPerAcceptedUsd: number | null;
  /** wastedTokens / totalTokens in [0,1]; 0 when totalTokens === 0. */
  wasteTokenRatio: number;
}

export interface TaskLedgerReport {
  tasks: TaskRollup[];
  /** Fleet totals across all tasks. */
  totalTokens: number;
  costUsd: number | null; // null when ANY task is cost-incomplete
  costComplete: boolean;
  totalRequests: number;
  totalAccepted: number;
  wastedTokens: number;
  wastedCostUsd: number | null;
  /** Events ignored because they were malformed. */
  skipped: number;
}

// ============================================================================
// rollupTaskLedger
// ============================================================================

const DEFAULT_WASTE: readonly TaskOutcome[] = ["rejected", "retry", "abandoned"];

export function rollupTaskLedger(
  events: unknown,
  options: TaskLedgerOptions = {}
): TaskLedgerReport {
  const wasteSet = new Set<TaskOutcome>(
    Array.isArray(options.wasteOutcomes) && options.wasteOutcomes.length > 0
      ? options.wasteOutcomes
      : DEFAULT_WASTE
  );

  const list: unknown[] = Array.isArray(events) ? events : [];
  let skipped = 0;

  // Group well-formed events by task, preserving insertion order of first sight.
  const byTask = new Map<string, SpendEvent[]>();
  for (const e of list) {
    if (!isSpendEvent(e)) {
      skipped++;
      continue;
    }
    const bucket = byTask.get(e.taskId) ?? [];
    bucket.push(e);
    byTask.set(e.taskId, bucket);
  }

  const tasks: TaskRollup[] = [];
  for (const [taskId, evs] of byTask) {
    tasks.push(rollupOneTask(taskId, evs, wasteSet));
  }

  // Fleet aggregation.
  let fleetTokens = 0;
  let fleetCost = 0;
  let fleetCostComplete = true;
  let fleetRequests = 0;
  let fleetAccepted = 0;
  let fleetWastedTokens = 0;
  let fleetWastedCost = 0;
  let fleetWastedComplete = true;
  for (const t of tasks) {
    fleetTokens += t.totalTokens;
    fleetRequests += t.requestCount;
    fleetAccepted += t.acceptedCount;
    fleetWastedTokens += t.wastedTokens;
    if (t.costComplete && t.costUsd !== null) fleetCost += t.costUsd;
    else fleetCostComplete = false;
    if (t.costComplete && t.wastedCostUsd !== null) fleetWastedCost += t.wastedCostUsd;
    else fleetWastedComplete = false;
  }

  return {
    tasks,
    totalTokens: fleetTokens,
    costUsd: fleetCostComplete ? round(fleetCost) : null,
    costComplete: fleetCostComplete,
    totalRequests: fleetRequests,
    totalAccepted: fleetAccepted,
    wastedTokens: fleetWastedTokens,
    wastedCostUsd: fleetWastedComplete ? round(fleetWastedCost) : null,
    skipped,
  };
}

function rollupOneTask(
  taskId: string,
  events: SpendEvent[],
  wasteSet: Set<TaskOutcome>
): TaskRollup {
  let totalTokens = 0;
  let costUsd = 0;
  let costComplete = true;
  let acceptedCount = 0;
  let wastedTokens = 0;
  let wastedCostUsd = 0;

  for (const e of events) {
    const tokens = eventTokens(e);
    totalTokens += tokens;
    if (e.outcome === "accepted") acceptedCount++;
    const isWaste = wasteSet.has(e.outcome);
    if (isWaste) wastedTokens += tokens;

    const cost = eventCostUsd(e);
    if (cost === null) {
      costComplete = false;
    } else {
      costUsd += cost;
      if (isWaste) wastedCostUsd += cost;
    }
  }

  const taskCost = costComplete ? round(costUsd) : null;
  const taskWasted = costComplete ? round(wastedCostUsd) : null;
  return {
    taskId,
    totalTokens,
    costUsd: taskCost,
    costComplete,
    requestCount: events.length,
    acceptedCount,
    wastedCostUsd: taskWasted,
    wastedTokens,
    costPerAcceptedUsd:
      costComplete && taskCost !== null && acceptedCount > 0
        ? round(taskCost / acceptedCount)
        : null,
    wasteTokenRatio: totalTokens > 0 ? wastedTokens / totalTokens : 0,
  };
}

// ============================================================================
// Pricing (honest — null on unpriced model)
// ============================================================================

/** USD cost of one event, or null when the model is unpriced. */
export function eventCostUsd(e: SpendEvent): number | null {
  const p = getModelPricingStrictByName(e.model);
  if (!p || typeof p.input !== "number" || typeof p.output !== "number") return null;
  const cacheRead = nonNeg(e.cacheReadTokens);
  const cacheWrite = nonNeg(e.cacheWriteTokens);
  // Cache-read billed at cached_input when the model publishes it, else input.
  const cachedRate = typeof p.cached_input === "number" ? p.cached_input : p.input;
  const usd =
    (nonNeg(e.inputTokens) * p.input +
      nonNeg(e.outputTokens) * p.output +
      cacheRead * cachedRate +
      cacheWrite * p.input) /
    1_000_000;
  return usd;
}

function eventTokens(e: SpendEvent): number {
  return (
    nonNeg(e.inputTokens) +
    nonNeg(e.outputTokens) +
    nonNeg(e.cacheReadTokens) +
    nonNeg(e.cacheWriteTokens)
  );
}

// ============================================================================
// Helpers
// ============================================================================

const VALID_OUTCOMES: ReadonlySet<string> = new Set([
  "accepted",
  "rejected",
  "retry",
  "abandoned",
  "pending",
]);

function isSpendEvent(v: unknown): v is SpendEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.taskId === "string" &&
    e.taskId.length > 0 &&
    typeof e.model === "string" &&
    e.model.length > 0 &&
    typeof e.inputTokens === "number" &&
    Number.isFinite(e.inputTokens) &&
    typeof e.outputTokens === "number" &&
    Number.isFinite(e.outputTokens) &&
    typeof e.outcome === "string" &&
    VALID_OUTCOMES.has(e.outcome)
  );
}

function nonNeg(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Round to 6 decimals to keep USD sums free of float dust. */
function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

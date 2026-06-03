/**
 * Secondary diagnostic signals over a NormalizedTurn stream.
 *
 * Three pure functions, each with a rolling window:
 *
 *  - cacheHitTrend(turns, window)    — slope of cacheRead / totalInput
 *                                      over the last `window` turns.
 *                                      Negative ⇒ volatile prefix.
 *  - scopeDriftSlope(turns, window)  — slope of "distinct file paths
 *                                      touched per turn" over the last
 *                                      `window` turns. Positive ⇒ agent
 *                                      scope is widening.
 *  - largeToolResultCause(turn, win) — the largest single tool result
 *                                      in this turn whose token estimate
 *                                      exceeds `fraction × win`; null
 *                                      when no result is dominant.
 *
 * Token estimation for tool results is the byte length of the
 * stringified content divided by 4 — the standard Anthropic
 * "characters / 4" approximation. We never tokenize content with
 * gpt-tokenizer here because (a) it's slow on long results, (b) the
 * detector runs in a hook with a 50ms budget, (c) the *trend* is what
 * matters; absolute precision is not.
 *
 * No regex. All file-path extraction is structural-typed:
 *   toolUses[].input.file_path | input.path
 * — the same shape `extractStepFeatures` already relies on.
 */

import type { NormalizedTurn } from "@prune/telemetry";
import type { SecondarySignals } from "./types.js";

/**
 * Compute slope of cache-hit rate over the last `window` turns. Uses
 * ordinary least squares with x = 0..n-1 (turn index within window).
 * Returns 0 when fewer than 2 turns have any cacheRead or input — no
 * NaN, no Infinity ever escapes.
 */
export function cacheHitTrend(
  turns: ReadonlyArray<NormalizedTurn>,
  window: number
): number {
  const slice = turns.slice(Math.max(0, turns.length - window));
  const points: number[] = [];
  for (const t of slice) {
    const fresh = sanitize(t.usage.input) + sanitize(t.usage.cacheCreate);
    const cached = sanitize(t.usage.cacheRead);
    const total = fresh + cached;
    if (total <= 0) {
      // A turn with zero attended-input is uninformative for the trend
      // (often a user-only message). Skip — don't drag the slope to 0.
      continue;
    }
    points.push(cached / total);
  }
  return slope(points);
}

/**
 * Compute slope of "distinct paths touched per turn" over the last
 * `window` turns. A turn that touches no paths contributes a 0 (not
 * skipped — relevant signal). Returns 0 with fewer than 2 turns.
 */
export function scopeDriftSlope(
  turns: ReadonlyArray<NormalizedTurn>,
  window: number
): number {
  const slice = turns.slice(Math.max(0, turns.length - window));
  const counts: number[] = [];
  for (const t of slice) counts.push(countDistinctPaths(t));
  return slope(counts);
}

/**
 * If any single tool result in this turn dominates the context budget
 * (token estimate ≥ `fraction × contextWindow`), return it. Multiple
 * dominant results → the largest. None → null.
 *
 * `contextWindow === 0` (model unknown) is treated as "no opinion" and
 * always returns null — the regime path is the right primary surface
 * when the window is unknown.
 */
export function largeToolResultCause(
  turn: NormalizedTurn,
  contextWindow: number,
  fraction: number
): SecondarySignals["largeToolResultCause"] {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) return null;
  const limit = fraction * contextWindow;

  const toolUseById = new Map<string, string>();
  for (const tu of turn.toolUses) {
    if (typeof tu.id === "string" && tu.id.length > 0) {
      toolUseById.set(tu.id, tu.name);
    }
  }

  let largest: { id: string; name: string; tokens: number } | null = null;
  for (const tr of turn.toolResults) {
    const tokens = estimateResultTokens(tr.content);
    if (tokens < limit) continue;
    const id = typeof tr.tool_use_id === "string" ? tr.tool_use_id : "";
    const name = toolUseById.get(id) ?? "unknown";
    if (!largest || tokens > largest.tokens) {
      largest = { id, name, tokens };
    }
  }
  if (!largest) return null;
  return {
    turnNumber: turn.turnNumber,
    toolName: largest.name,
    toolResultTokenEstimate: largest.tokens,
  };
}

/** Distinct-path counter (structural, not text-parsed). */
function countDistinctPaths(turn: NormalizedTurn): number {
  const seen = new Set<string>();
  for (const tu of turn.toolUses) {
    const p = pathFromToolInput(tu.input);
    if (p !== null) seen.add(p);
  }
  return seen.size;
}

/**
 * Extract a file-path-shaped field from a tool input. Reads
 * `file_path` (Anthropic Read/Write/Edit), `path` (others). Returns
 * null when neither is a non-empty string — never throws.
 */
function pathFromToolInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (typeof o.file_path === "string" && o.file_path.length > 0) {
    return o.file_path;
  }
  if (typeof o.path === "string" && o.path.length > 0) return o.path;
  return null;
}

/**
 * Estimate token count of a tool_result.content payload. Strings:
 * length / 4. Array of blocks: sum block lengths. Object or other:
 * stringify length / 4 (defensive). NaN-safe.
 */
function estimateResultTokens(content: unknown): number {
  if (content === null || content === undefined) return 0;
  if (typeof content === "string") return Math.ceil(content.length / 4);
  if (Array.isArray(content)) {
    let total = 0;
    for (const block of content) {
      if (typeof block === "string") total += block.length;
      else if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (typeof b.text === "string") total += b.text.length;
        else if (typeof b.content === "string") total += b.content.length;
        else {
          try {
            total += JSON.stringify(block).length;
          } catch {
            // Circular ref or non-serializable; skip safely.
            total += 0;
          }
        }
      }
    }
    return Math.ceil(total / 4);
  }
  if (typeof content === "object") {
    try {
      return Math.ceil(JSON.stringify(content).length / 4);
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Ordinary-least-squares slope for points (0, y_0), (1, y_1), …,
 * (n-1, y_{n-1}). Returns 0 when n < 2 or when the x-variance would
 * cause a division by zero (impossible for our uniform grid but
 * defensive).
 */
function slope(ys: ReadonlyArray<number>): number {
  if (ys.length < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  const n = ys.length;
  for (let i = 0; i < n; i++) {
    const y = sanitize(ys[i]!);
    sumX += i;
    sumY += y;
    sumXX += i * i;
    sumXY += i * y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom <= 0) return 0;
  const m = (n * sumXY - sumX * sumY) / denom;
  if (!Number.isFinite(m)) return 0;
  return m;
}

function sanitize(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

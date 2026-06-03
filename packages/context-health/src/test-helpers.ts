/**
 * Test helpers for @prune/context-health.
 *
 * Shape-only — no fixtures are synthesized data; tests build
 * NormalizedTurn objects directly via these helpers using values
 * derived from real Claude Code transcript shapes (see
 * `packages/telemetry/test/fixtures/session-basic.jsonl` for the
 * canonical schema).
 */

import type { NormalizedTurn } from "@prune/telemetry";

export interface MakeTurnOptions {
  turnNumber: number;
  model?: string;
  sessionId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
  toolUses?: Array<{ name: string; input: unknown; id?: string }>;
  toolResults?: Array<{ tool_use_id?: string; content: unknown; is_error?: boolean }>;
  textContent?: string;
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export function makeTurn(opts: MakeTurnOptions): NormalizedTurn {
  return {
    turnNumber: opts.turnNumber,
    sessionId: opts.sessionId,
    assistantMessages: [],
    toolUses: opts.toolUses ?? [],
    toolResults: opts.toolResults ?? [],
    usage: {
      input: opts.inputTokens ?? 0,
      output: opts.outputTokens ?? 0,
      cacheRead: opts.cacheReadTokens ?? 0,
      cacheCreate: opts.cacheCreateTokens ?? 0,
    },
    model: opts.model ?? DEFAULT_MODEL,
    textContent: opts.textContent ?? "",
  };
}

/**
 * Build a stream of turns that ramps ECF from `startEcf` to `endEcf`
 * linearly over `count` turns, using `contextWindow` as the
 * denominator. Useful for pinning CUSUM thresholds.
 *
 * Every turn carries the same model so the test exercises one
 * detector trajectory cleanly.
 */
export function rampSession(opts: {
  count: number;
  startEcf: number;
  endEcf: number;
  contextWindow: number;
  alpha?: number;
  model?: string;
  sessionId?: string;
}): NormalizedTurn[] {
  const turns: NormalizedTurn[] = [];
  const model = opts.model ?? DEFAULT_MODEL;
  const sessionId = opts.sessionId ?? "sess-ramp";
  const n = Math.max(1, opts.count);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1);
    const ecf = opts.startEcf + (opts.endEcf - opts.startEcf) * t;
    // Place the entire budget in `attendedInput` so cache discounting
    // doesn't perturb the curve. The ramp tests assert the bare
    // ECF math; cache-discounting is tested separately.
    const input = Math.round(ecf * opts.contextWindow);
    turns.push(
      makeTurn({
        turnNumber: i + 1,
        model,
        sessionId,
        inputTokens: input,
      })
    );
  }
  return turns;
}

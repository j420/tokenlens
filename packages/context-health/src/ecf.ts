/**
 * Effective Context Fullness (ECF) — the F6 core metric.
 *
 *   ECF(t) = clamp01( (attendedInput + α·cacheRead + committedOutput) / contextWindow )
 *
 * where
 *   attendedInput    = usage.input_tokens + usage.cache_creation_input_tokens
 *                      (the freshly-attended portion of this turn's prompt)
 *   cacheRead        = usage.cache_read_input_tokens
 *   committedOutput  = usage.output_tokens
 *   contextWindow    = @prune/shared.getContextWindow(model)
 *   α                = config.alpha ∈ [0, 1], default 0.5
 *
 * Pure math, no model call, no regex. NaN-safe: any non-finite or
 * negative usage field is treated as 0 (and the turn is flagged
 * `malformed` so the detector can skip it). An unknown model window
 * surfaces as `source: "unknown_window"` — we never substitute a
 * fabricated default.
 *
 * Why discount cacheRead by α?
 *   Cached prefix tokens are re-presented to the model on every turn
 *   but are not attended at the same fidelity as fresh tokens (Chroma
 *   2026, context-rot study). α=0.5 is the conservative default that
 *   prevents false negatives (i.e. classifying a cache-heavy turn as
 *   safe when its effective fullness is in fact rising).
 */

import { getContextWindow } from "@prune/shared";
import type { NormalizedTurn } from "@prune/telemetry";
import type { EcfSample, EcfSource } from "./types.js";

export interface ComputeEcfOptions {
  /** Cache-fidelity factor α ∈ [0, 1]. */
  alpha: number;
  /**
   * Override the model lookup. Default reads `turn.model` and asks
   * `@prune/shared/getContextWindow`. Tests pass a fixed model to
   * pin the window without modifying the fixture.
   */
  model?: string | null;
  /** Tests can pass a synthetic window without touching pricing.ts. */
  contextWindowOverride?: number | null;
}

/**
 * Compute ECF for a single turn. Returns a fully-populated EcfSample,
 * including the source attribution. Never throws.
 */
export function computeEcf(
  turn: NormalizedTurn,
  options: ComputeEcfOptions
): EcfSample {
  const model = options.model ?? turn.model ?? null;
  const windowFromPricing =
    options.contextWindowOverride !== undefined
      ? options.contextWindowOverride
      : model
        ? getContextWindow(model)
        : null;

  const attendedInput = sanitizeTokens(turn.usage.input + turn.usage.cacheCreate);
  const discountedCacheRead = sanitizeTokens(options.alpha * turn.usage.cacheRead);
  const committedOutput = sanitizeTokens(turn.usage.output);

  if (windowFromPricing === null || windowFromPricing <= 0) {
    return {
      turnNumber: turn.turnNumber,
      attendedInput,
      discountedCacheRead,
      committedOutput,
      contextWindow: 0,
      ecf: 0,
      source: "unknown_window",
    };
  }

  const numerator = attendedInput + discountedCacheRead + committedOutput;
  const ecf = clamp01(numerator / windowFromPricing);

  return {
    turnNumber: turn.turnNumber,
    attendedInput,
    discountedCacheRead,
    committedOutput,
    contextWindow: windowFromPricing,
    ecf,
    source: "exact",
  };
}

/**
 * Compute the ECF series for a stream of turns. The detector consumes
 * this iteratively (one turn at a time) but the MCP report and the
 * test suite need the full series in one call.
 *
 * `model` resolution: if every turn has a model, use the per-turn
 * model. If none do, fall back to `options.model`. If the stream
 * contains a mix, each turn uses its own model.
 */
export function computeEcfSeries(
  turns: ReadonlyArray<NormalizedTurn>,
  options: ComputeEcfOptions
): EcfSample[] {
  const result: EcfSample[] = [];
  for (const turn of turns) {
    result.push(computeEcf(turn, options));
  }
  return result;
}

/**
 * Identify the *dominant model* in a turn stream. Used by the report
 * to render a "model: claude-sonnet-4-5-…" header. Returns null when
 * no turn carries a model. Picks the most-frequent string; ties are
 * resolved by first-occurrence order to keep the result deterministic.
 */
export function dominantModel(turns: ReadonlyArray<NormalizedTurn>): string | null {
  const counts = new Map<string, { count: number; firstIndex: number }>();
  turns.forEach((t, idx) => {
    if (typeof t.model !== "string" || t.model.length === 0) return;
    const entry = counts.get(t.model);
    if (entry) entry.count += 1;
    else counts.set(t.model, { count: 1, firstIndex: idx });
  });
  let best: { model: string; count: number; firstIndex: number } | null = null;
  for (const [model, info] of counts) {
    if (
      !best ||
      info.count > best.count ||
      (info.count === best.count && info.firstIndex < best.firstIndex)
    ) {
      best = { model, ...info };
    }
  }
  return best ? best.model : null;
}

/**
 * Resolve EcfSource for a series: "exact" when ≥2 samples have an
 * exact ECF; "insufficient_data" when fewer than 2 do; "unknown_window"
 * only when *every* sample carries that source (mixed-model streams
 * keep "exact" so the detector can still observe the known turns).
 */
export function aggregateSource(samples: ReadonlyArray<EcfSample>): EcfSource {
  if (samples.length < 2) return "insufficient_data";
  let unknown = 0;
  let exact = 0;
  for (const s of samples) {
    if (s.source === "exact") exact += 1;
    else if (s.source === "unknown_window") unknown += 1;
  }
  if (exact >= 2) return "exact";
  if (unknown === samples.length) return "unknown_window";
  return "insufficient_data";
}

function sanitizeTokens(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Build a ContextHealthReport from a turn stream + the detector's
 * final state. Used by both the MCP `context_health_report` tool and
 * the hook's persisted state log.
 */

import type { NormalizedTurn } from "@prune/telemetry";
import { aggregateSource, dominantModel } from "./ecf.js";
import { replayDetector, type DetectorState } from "./detector.js";
import { inferPrimaryCause } from "./advisor.js";
import { DEFAULT_CONFIG } from "./constants.js";
import type {
  ContextHealthConfig,
  ContextHealthReport,
  EcfSample,
  PrimaryCause,
  Regime,
} from "./types.js";

export interface BuildReportOptions {
  config?: ContextHealthConfig;
  /** Resume from a persisted detector state (set by the hook). */
  initialState?: DetectorState;
}

export function buildReport(
  turns: ReadonlyArray<NormalizedTurn>,
  options: BuildReportOptions = {}
): ContextHealthReport {
  const config = options.config ?? DEFAULT_CONFIG;
  const replay = replayDetector(turns, config, { initial: options.initialState });
  const samples: EcfSample[] = replay.observations.map((o) => o.ecfSample);
  const source = aggregateSource(samples);
  const model = dominantModel(turns);
  const windowFromSamples = firstKnownWindow(samples);

  const ecfCurrent =
    samples.length === 0 ? null : samples[samples.length - 1]!.ecf;

  const regime = computeRegimeFromReplay(replay.regime, source);
  const lastObs =
    replay.observations.length === 0
      ? null
      : replay.observations[replay.observations.length - 1]!;

  const signals = lastObs
    ? lastObs.signals
    : { cacheHitTrend: 0, scopeDriftSlope: 0, largeToolResultCause: null };

  const primaryCause: PrimaryCause | null =
    regime === "warning" || regime === "critical"
      ? lastObs
        ? inferPrimaryCause(lastObs)
        : "rising_ecf"
      : null;

  return {
    regime,
    source,
    ecfCurrent,
    ecfSeries: samples,
    cusum: replay.finalState.cusum,
    signals,
    modelWindow: windowFromSamples,
    model,
    totalTurns: turns.length,
    observedTurns: replay.finalState.observedTurns,
    skippedTurns: replay.finalState.skippedTurns,
    primaryCause,
  };
}

function firstKnownWindow(samples: ReadonlyArray<EcfSample>): number | null {
  for (const s of samples) {
    if (s.source === "exact" && s.contextWindow > 0) return s.contextWindow;
  }
  return null;
}

function computeRegimeFromReplay(walkRegime: Regime, source: ReturnType<typeof aggregateSource>): Regime {
  if (source === "insufficient_data" || source === "unknown_window") {
    return "insufficient_data";
  }
  return walkRegime;
}

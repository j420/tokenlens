/**
 * F1 v2 — Replay Harness.
 *
 * Reads shadow-mode F1 events from the local persistence sink
 * (`feature_id = "f1"`, `quality_proof` carrying the prediction+outcome
 * pair) and produces:
 *
 *  - calibration metrics (Brier score, log-loss, ECE)
 *  - the paired-session input that `@prune/quality.evaluateQualityGate`
 *    expects (treatment = dieted output, control = original output)
 *
 * The harness does NOT train a model — it only measures the current
 * model's behavior on real recorded sessions. Training requires a
 * separate offline pipeline that this codebase does not run inside the
 * container (the data lives in users' local SQLite). The harness is
 * the read-side; the training pipeline is the deferred write-side.
 *
 * Pure functions: no I/O outside the explicit sink reads. Tests pin
 * calibration math against hand-computed expectations.
 */

import {
  evaluateQualityGate,
  type PairedSession,
  type QualityGateResult,
  type QualityMargins,
} from "@prune/quality";

/**
 * Minimal projection of `EventRow` that the harness needs. Caller
 * (the extension or a CI job) reads rows from
 * `@prune/persistence.PersistenceSink` and projects them into this
 * shape. We don't depend on persistence directly to keep this package
 * leaf-only.
 */
export interface F1ShadowEvent {
  /** Identifier for the (session, step) pair. */
  sessionId: string;
  stepIndex: number;
  /** The advisor's predicted P(influential) for this step (0..1). */
  predictedInfluence: number;
  /**
   * The realized outcome: 1 = step was actually used (its content
   * referenced in a later assistant message), 0 = step was not. NaN
   * is treated as "label missing" and the row is dropped from
   * calibration metrics (but still counted under totalEvents).
   */
  realizedInfluence: number;
  /**
   * The advisor's decision at the time the event was recorded:
   * "advised_skip" if an advisory was emitted, "kept" otherwise.
   */
  decision: "advised_skip" | "kept";
  /** Per-step token cost (for projected-savings aggregation). */
  stepTokenCost: number;
  /**
   * Paired-session outcome — populated only for events flagged with
   * `quality_proof.pair = { control: {...}, treatment: {...} }`. When
   * absent, the row contributes to calibration but not to the NI gate.
   */
  pair?: PairedSession;
}

export interface CalibrationMetrics {
  /** Number of events with a finite realized label. */
  effectiveN: number;
  /** Mean( (predicted - realized)^2 ). Lower is better. */
  brierScore: number;
  /** Mean( - [ realized·log(p) + (1-realized)·log(1-p) ] ). Lower is better. */
  logLoss: number;
  /**
   * Expected Calibration Error over `numBins` equal-width bins. Lower
   * is better; 0 ⇒ perfectly calibrated.
   */
  expectedCalibrationError: number;
  /** Number of bins used. */
  numBins: number;
}

export interface AdvisoryAggregate {
  totalEvents: number;
  advisedSkipCount: number;
  /** Of `advisedSkipCount`, how many realized as actually low-influence. */
  trueLowInfluence: number;
  /** Of `advisedSkipCount`, how many turned out to be influential. */
  falseLowInfluence: number;
  /** Token cost across advised-skip steps. */
  tokensAdvisedToSave: number;
}

export interface ReplayHarnessReport {
  calibration: CalibrationMetrics;
  aggregate: AdvisoryAggregate;
  /** Null when fewer than `minPairsForGate` pairs are available. */
  qualityGate: QualityGateResult | null;
  /** The events the harness deemed eligible (predicted ∈ [0,1], finite). */
  eligibleEvents: number;
  /** Events dropped for malformed predictions. */
  malformedEvents: number;
}

export interface ReplayHarnessOptions {
  /** Number of bins for ECE; default 10. */
  numBins?: number;
  /** Minimum paired sessions to evaluate the NI gate; default 30. */
  minPairsForGate?: number;
  /** Override quality margins; defaults to DEFAULT_MARGINS from @prune/quality. */
  margins?: QualityMargins;
}

/**
 * Run the replay harness over the supplied events. Pure — no I/O.
 * Callers stream events in; the harness aggregates. Order-independent.
 */
export function runReplayHarness(
  events: ReadonlyArray<F1ShadowEvent>,
  options: ReplayHarnessOptions = {}
): ReplayHarnessReport {
  const numBins = options.numBins ?? 10;
  const minPairs = options.minPairsForGate ?? 30;

  const eligible: F1ShadowEvent[] = [];
  let malformed = 0;
  for (const e of events) {
    if (!isWellFormed(e)) {
      malformed += 1;
      continue;
    }
    eligible.push(e);
  }

  const labeled = eligible.filter((e) => Number.isFinite(e.realizedInfluence));
  const calibration = computeCalibration(labeled, numBins);
  const aggregate = aggregateAdvisories(eligible);

  const pairs: PairedSession[] = [];
  for (const e of eligible) if (e.pair) pairs.push(e.pair);
  const qualityGate =
    pairs.length >= minPairs
      ? evaluateQualityGate(pairs, options.margins)
      : null;

  return {
    calibration,
    aggregate,
    qualityGate,
    eligibleEvents: eligible.length,
    malformedEvents: malformed,
  };
}

/* ------------------------------------------------------------------ */
/* Calibration math                                                   */
/* ------------------------------------------------------------------ */

function computeCalibration(
  events: ReadonlyArray<F1ShadowEvent>,
  numBins: number
): CalibrationMetrics {
  if (events.length === 0) {
    return {
      effectiveN: 0,
      brierScore: 0,
      logLoss: 0,
      expectedCalibrationError: 0,
      numBins,
    };
  }

  let brierSum = 0;
  let logLossSum = 0;
  const bins = Array.from({ length: numBins }, () => ({
    sumPred: 0,
    sumReal: 0,
    n: 0,
  }));

  for (const e of events) {
    const p = clamp01(e.predictedInfluence);
    const y = e.realizedInfluence > 0.5 ? 1 : 0;
    brierSum += (p - y) * (p - y);
    // log-loss with epsilon to avoid log(0)
    const eps = 1e-12;
    const pe = Math.min(1 - eps, Math.max(eps, p));
    logLossSum += -(y * Math.log(pe) + (1 - y) * Math.log(1 - pe));

    const idx = Math.min(numBins - 1, Math.floor(p * numBins));
    bins[idx]!.sumPred += p;
    bins[idx]!.sumReal += y;
    bins[idx]!.n += 1;
  }

  const n = events.length;
  // ECE = Σ_b (n_b / n) · |mean(p_b) − mean(y_b)|
  let ece = 0;
  for (const b of bins) {
    if (b.n === 0) continue;
    const meanP = b.sumPred / b.n;
    const meanY = b.sumReal / b.n;
    ece += (b.n / n) * Math.abs(meanP - meanY);
  }

  return {
    effectiveN: n,
    brierScore: brierSum / n,
    logLoss: logLossSum / n,
    expectedCalibrationError: ece,
    numBins,
  };
}

function aggregateAdvisories(
  events: ReadonlyArray<F1ShadowEvent>
): AdvisoryAggregate {
  let advised = 0;
  let truePos = 0;
  let falsePos = 0;
  let tokens = 0;
  let total = 0;
  for (const e of events) {
    total += 1;
    if (e.decision === "advised_skip") {
      advised += 1;
      tokens += sanitize(e.stepTokenCost);
      if (Number.isFinite(e.realizedInfluence)) {
        if (e.realizedInfluence <= 0.5) truePos += 1;
        else falsePos += 1;
      }
    }
  }
  return {
    totalEvents: total,
    advisedSkipCount: advised,
    trueLowInfluence: truePos,
    falseLowInfluence: falsePos,
    tokensAdvisedToSave: tokens,
  };
}

function isWellFormed(e: F1ShadowEvent): boolean {
  if (typeof e.predictedInfluence !== "number") return false;
  if (!Number.isFinite(e.predictedInfluence)) return false;
  if (e.predictedInfluence < 0 || e.predictedInfluence > 1) return false;
  if (typeof e.stepTokenCost !== "number" || !Number.isFinite(e.stepTokenCost) || e.stepTokenCost < 0) {
    return false;
  }
  if (e.decision !== "advised_skip" && e.decision !== "kept") return false;
  return true;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function sanitize(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

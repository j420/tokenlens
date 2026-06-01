/**
 * ContextHealthDetector — the F6 state machine.
 *
 * Wraps:
 *   - per-turn ECF computation        (ecf.ts)
 *   - streaming two-threshold CUSUM   (cusum.ts)
 *   - secondary signals               (drift.ts)
 *
 * State transitions handled here (not inside CUSUM, which is dumb-stream):
 *   1. Compaction event detected by the caller (flatMessages.length
 *      shrank between two SessionCache snapshots) ⇒ `markCompaction()`
 *      resets the CUSUM walk back to "healthy" at the current turn.
 *   2. Subagent boundary: when a new turn carries a `sessionId` that
 *      differs from the last observed one, the detector starts a fresh
 *      CUSUM walk *for that child*. The parent's walk is preserved
 *      under `parentState` so the report can re-emit it.
 *   3. Malformed usage (NaN, negative tokens) ⇒ turn skipped, regime
 *      preserved, `skippedTurns` incremented.
 *
 * The detector is fully serializable (toJSON / fromJSON) so the hook
 * can persist its state under `~/.prune/cache/context-health-<sha>.json`
 * between invocations.
 */

import type { NormalizedTurn } from "@prune/telemetry";
import { computeEcf } from "./ecf.js";
import {
  CusumDetector,
  initialCusumState,
  observe,
  resetCusum,
} from "./cusum.js";
import {
  cacheHitTrend,
  largeToolResultCause,
  scopeDriftSlope,
} from "./drift.js";
import type {
  ContextHealthConfig,
  CusumState,
  DetectorObservation,
  EcfSample,
  Regime,
  SecondarySignals,
} from "./types.js";

export interface DetectorState {
  /** CUSUM walk for the active session (parent or, after boundary, child). */
  cusum: CusumState;
  /** Active session id; null until a turn carrying one is observed. */
  sessionId: string | null;
  /**
   * The parent CUSUM walk preserved across a subagent boundary. null
   * when no boundary has been observed.
   */
  parentCusum: CusumState | null;
  /** Parent session id, when `parentCusum !== null`. */
  parentSessionId: string | null;
  /** Number of turns successfully advanced through CUSUM. */
  observedTurns: number;
  /** Number of turns the detector deliberately skipped (malformed / unknown window). */
  skippedTurns: number;
  /** Number of compaction resets observed in this stream. */
  compactionResets: number;
  /** Rolling-window of recent ECF samples (length ≤ config.rollingWindow). */
  recentSamples: EcfSample[];
}

export function initialDetectorState(): DetectorState {
  return {
    cusum: initialCusumState(),
    sessionId: null,
    parentCusum: null,
    parentSessionId: null,
    observedTurns: 0,
    skippedTurns: 0,
    compactionResets: 0,
    recentSamples: [],
  };
}

export class ContextHealthDetector {
  private state: DetectorState;
  // Keep a parallel CusumDetector instance for convenience; the
  // canonical state remains `state.cusum`.
  private cusumDetector: CusumDetector;

  constructor(
    private readonly config: ContextHealthConfig,
    initial: DetectorState = initialDetectorState()
  ) {
    this.state = cloneState(initial);
    this.cusumDetector = new CusumDetector({
      kWarn: config.kWarn,
      kCrit: config.kCrit,
      hWarn: config.hWarn,
      hCrit: config.hCrit,
    });
    // CusumDetector starts at initialCusumState; sync it to whatever
    // state we were resumed from.
    this.cusumDetector["state"] = cloneCusum(this.state.cusum);
  }

  /**
   * Observe a single turn. The caller has already grouped messages
   * into turns via @prune/telemetry. Returns the observation result
   * (skipped or otherwise) without throwing.
   */
  observe(turn: NormalizedTurn, recentTurns: ReadonlyArray<NormalizedTurn>): DetectorObservation {
    // 1. Subagent boundary detection — sessionId changed.
    const incomingSessionId =
      typeof turn.sessionId === "string" && turn.sessionId.length > 0
        ? turn.sessionId
        : null;
    let skipReason: DetectorObservation["skipReason"] | undefined;
    if (
      incomingSessionId !== null &&
      this.state.sessionId !== null &&
      incomingSessionId !== this.state.sessionId
    ) {
      this.markSubagentBoundary(incomingSessionId, turn.turnNumber);
      skipReason = "subagent_boundary";
    } else if (incomingSessionId !== null && this.state.sessionId === null) {
      this.state.sessionId = incomingSessionId;
    }

    // 2. Compute ECF.
    const sample = computeEcf(turn, {
      alpha: this.config.alpha,
      model: turn.model ?? null,
    });

    // 3. Skip when window is unknown — advance counter, don't update sums.
    if (sample.source === "unknown_window") {
      this.state.skippedTurns += 1;
      this.state.cusum = observe(this.state.cusum, sample, this.cusumOpts());
      this.cusumDetector["state"] = cloneCusum(this.state.cusum);
      this.pushRecent(sample);
      const signals = this.signals(turn, recentTurns, sample.contextWindow);
      return {
        turnNumber: turn.turnNumber,
        ecfSample: sample,
        cusum: cloneCusum(this.state.cusum),
        signals,
        skipped: true,
        skipReason: skipReason ?? "unknown_window",
      };
    }

    // 4. Skip on malformed usage (we treat any NaN-derived 0 ECF in
    //    the presence of nonzero raw usage as malformed). The
    //    sanitizer inside computeEcf clamps NaN → 0, so the only way
    //    we can detect malformation here is via the raw turn fields.
    if (isMalformedUsage(turn)) {
      this.state.skippedTurns += 1;
      // Advance turn counter without moving CUSUM sums.
      this.state.cusum = {
        ...this.state.cusum,
        lastTurnNumber: turn.turnNumber,
      };
      this.cusumDetector["state"] = cloneCusum(this.state.cusum);
      const signals = this.signals(turn, recentTurns, sample.contextWindow);
      return {
        turnNumber: turn.turnNumber,
        ecfSample: sample,
        cusum: cloneCusum(this.state.cusum),
        signals,
        skipped: true,
        skipReason: skipReason ?? "malformed_usage",
      };
    }

    // 5. Healthy path — CUSUM observe.
    this.state.cusum = observe(this.state.cusum, sample, this.cusumOpts());
    this.cusumDetector["state"] = cloneCusum(this.state.cusum);
    this.state.observedTurns += 1;
    this.pushRecent(sample);

    const signals = this.signals(turn, recentTurns, sample.contextWindow);
    return {
      turnNumber: turn.turnNumber,
      ecfSample: sample,
      cusum: cloneCusum(this.state.cusum),
      signals,
      skipped: skipReason !== undefined,
      skipReason,
    };
  }

  /**
   * Explicit compaction notification. Called by the hook when it
   * detects `flatMessages.length` shrank between two SessionCache
   * snapshots. Resets CUSUM at the given turn.
   */
  markCompaction(atTurn: number): void {
    this.state.cusum = resetCusum(this.state.cusum, atTurn);
    this.cusumDetector["state"] = cloneCusum(this.state.cusum);
    this.state.compactionResets += 1;
  }

  /**
   * Subagent boundary — preserve parent walk, start fresh for child.
   */
  private markSubagentBoundary(childSessionId: string, atTurn: number): void {
    this.state.parentCusum = cloneCusum(this.state.cusum);
    this.state.parentSessionId = this.state.sessionId;
    this.state.cusum = resetCusum(initialCusumState(), atTurn);
    this.state.sessionId = childSessionId;
    this.cusumDetector["state"] = cloneCusum(this.state.cusum);
  }

  get current(): DetectorState {
    return cloneState(this.state);
  }

  toJSON(): DetectorState {
    return cloneState(this.state);
  }

  static fromJSON(config: ContextHealthConfig, raw: unknown): ContextHealthDetector {
    if (!raw || typeof raw !== "object") {
      return new ContextHealthDetector(config);
    }
    const candidate = raw as Partial<DetectorState>;
    const state = mergeState(candidate);
    return new ContextHealthDetector(config, state);
  }

  private cusumOpts() {
    return {
      kWarn: this.config.kWarn,
      kCrit: this.config.kCrit,
      hWarn: this.config.hWarn,
      hCrit: this.config.hCrit,
    };
  }

  private signals(
    turn: NormalizedTurn,
    recentTurns: ReadonlyArray<NormalizedTurn>,
    contextWindow: number
  ): SecondarySignals {
    return {
      cacheHitTrend: cacheHitTrend(recentTurns, this.config.rollingWindow),
      scopeDriftSlope: scopeDriftSlope(recentTurns, this.config.rollingWindow),
      largeToolResultCause: largeToolResultCause(
        turn,
        contextWindow,
        this.config.largeToolResultFraction
      ),
    };
  }

  private pushRecent(sample: EcfSample): void {
    this.state.recentSamples.push(sample);
    while (this.state.recentSamples.length > this.config.rollingWindow) {
      this.state.recentSamples.shift();
    }
  }
}

/**
 * Run the detector over a full series of turns. Used by the MCP tool
 * and the test suite. Compaction events between consecutive turns are
 * detected here by comparing `recentTurns[i-1].assistantMessages.length`
 * against the prior cumulative — but in practice the hook drives this
 * via explicit `markCompaction` from SessionCache, so this helper
 * trusts the input as a linear stream.
 */
export interface ReplayResult {
  observations: DetectorObservation[];
  finalState: DetectorState;
  regime: Regime;
}

export function replayDetector(
  turns: ReadonlyArray<NormalizedTurn>,
  config: ContextHealthConfig,
  options: { initial?: DetectorState } = {}
): ReplayResult {
  const detector = new ContextHealthDetector(config, options.initial);
  const observations: DetectorObservation[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const recent = turns.slice(0, i + 1);
    observations.push(detector.observe(turn, recent));
  }
  const finalState = detector.current;
  return {
    observations,
    finalState,
    regime: finalState.cusum.regime,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function isMalformedUsage(turn: NormalizedTurn): boolean {
  const fields = [
    turn.usage.input,
    turn.usage.output,
    turn.usage.cacheRead,
    turn.usage.cacheCreate,
  ];
  for (const f of fields) {
    if (typeof f !== "number" || Number.isNaN(f) || f < 0) return true;
  }
  return false;
}

function cloneCusum(c: CusumState): CusumState {
  return {
    sPlus: c.sPlus,
    sMinus: c.sMinus,
    lastTurnNumber: c.lastTurnNumber,
    regime: c.regime,
    regimeChangedAtTurn: c.regimeChangedAtTurn,
  };
}

function cloneState(s: DetectorState): DetectorState {
  return {
    cusum: cloneCusum(s.cusum),
    sessionId: s.sessionId,
    parentCusum: s.parentCusum ? cloneCusum(s.parentCusum) : null,
    parentSessionId: s.parentSessionId,
    observedTurns: s.observedTurns,
    skippedTurns: s.skippedTurns,
    compactionResets: s.compactionResets,
    recentSamples: s.recentSamples.map((x) => ({ ...x })),
  };
}

function mergeState(c: Partial<DetectorState>): DetectorState {
  const base = initialDetectorState();
  if (c.cusum && typeof c.cusum === "object") {
    base.cusum = sanitizeCusum(c.cusum as Partial<CusumState>);
  }
  if (typeof c.sessionId === "string") base.sessionId = c.sessionId;
  if (c.parentCusum && typeof c.parentCusum === "object") {
    base.parentCusum = sanitizeCusum(c.parentCusum as Partial<CusumState>);
  }
  if (typeof c.parentSessionId === "string") base.parentSessionId = c.parentSessionId;
  if (Number.isFinite(c.observedTurns)) base.observedTurns = c.observedTurns as number;
  if (Number.isFinite(c.skippedTurns)) base.skippedTurns = c.skippedTurns as number;
  if (Number.isFinite(c.compactionResets)) base.compactionResets = c.compactionResets as number;
  if (Array.isArray(c.recentSamples)) {
    base.recentSamples = (c.recentSamples as EcfSample[]).filter(
      (s) => s && typeof s === "object"
    );
  }
  return base;
}

function sanitizeCusum(c: Partial<CusumState>): CusumState {
  const fresh = initialCusumState();
  return {
    sPlus: Number.isFinite(c.sPlus) ? Math.max(0, c.sPlus as number) : fresh.sPlus,
    sMinus: Number.isFinite(c.sMinus) ? Math.max(0, c.sMinus as number) : fresh.sMinus,
    lastTurnNumber: Number.isFinite(c.lastTurnNumber)
      ? (c.lastTurnNumber as number)
      : fresh.lastTurnNumber,
    regime:
      c.regime === "healthy" ||
      c.regime === "warning" ||
      c.regime === "critical" ||
      c.regime === "insufficient_data"
        ? c.regime
        : fresh.regime,
    regimeChangedAtTurn: Number.isFinite(c.regimeChangedAtTurn)
      ? (c.regimeChangedAtTurn as number)
      : fresh.regimeChangedAtTurn,
  };
}

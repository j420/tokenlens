/**
 * Two-threshold streaming CUSUM detector for ECF inflection.
 *
 * One-sided CUSUM with two parallel detectors (warning + critical),
 * each accumulating positive excess over its own reference level k:
 *
 *   S+_t  = max(0, S+_{t-1} + (ECF_t − k+))   (warning;   k+ = 0.50)
 *   S−_t  = max(0, S−_{t-1} + (ECF_t − k−))   (critical;  k− = 0.75)
 *
 * Regime promotion is monotone-with-reset:
 *   - S−_t ≥ h_crit  → critical
 *   - else S+_t ≥ h_warn → warning
 *   - else carry the previous regime (healthy if never promoted)
 *
 * `reset()` is called on (a) a compaction event (`flatMessages.length`
 * shrank) and (b) a subagent boundary (sessionId change). Reset zeros
 * both sums and demotes regime back to "healthy".
 *
 * This is a textbook one-sided CUSUM (Page 1954); the only non-standard
 * piece is the two-threshold layering, which simply runs two independent
 * detectors and reports the higher tier. No randomness, no priors.
 */

import type { CusumState, EcfSample, Regime } from "./types.js";

export interface CusumOptions {
  kWarn: number;
  kCrit: number;
  hWarn: number;
  hCrit: number;
}

/**
 * Build an initial CUSUM state. Pure factory — never read or written
 * to disk.
 */
export function initialCusumState(): CusumState {
  return {
    sPlus: 0,
    sMinus: 0,
    lastTurnNumber: -1,
    regime: "insufficient_data",
    regimeChangedAtTurn: -1,
  };
}

/**
 * One-step CUSUM update. Pure (state, sample, options) → state.
 * Never mutates the input state. Caller composes with their own state
 * machine (the ContextHealthDetector).
 *
 * "insufficient_data" → "healthy" transition happens here on the first
 * `source === "exact"` sample; subsequent transitions only go upward
 * (healthy → warning, warning → critical, healthy → critical) until
 * the next reset.
 */
export function observe(
  state: CusumState,
  sample: EcfSample,
  opts: CusumOptions
): CusumState {
  // Unknown-window samples advance the turn counter but never the sums.
  // Non-finite ECF (NaN / Infinity — shouldn't happen because computeEcf
  // clamps, but defensive) is treated the same way to prevent poison
  // from leaking into the sums.
  if (sample.source !== "exact" || !Number.isFinite(sample.ecf)) {
    return {
      ...state,
      lastTurnNumber: sample.turnNumber,
    };
  }

  const sPlus = Math.max(0, state.sPlus + (sample.ecf - opts.kWarn));
  const sMinus = Math.max(0, state.sMinus + (sample.ecf - opts.kCrit));

  let regime: Regime;
  if (sMinus >= opts.hCrit) regime = "critical";
  else if (sPlus >= opts.hWarn) regime = "warning";
  else if (state.regime === "critical" || state.regime === "warning") {
    // Sticky regime: once promoted, stay promoted until reset.
    regime = state.regime;
  } else {
    regime = "healthy";
  }

  const regimeChangedAtTurn =
    regime !== state.regime ? sample.turnNumber : state.regimeChangedAtTurn;

  return {
    sPlus,
    sMinus,
    lastTurnNumber: sample.turnNumber,
    regime,
    regimeChangedAtTurn,
  };
}

/**
 * Hard reset — both sums to zero, regime back to "healthy" (NOT
 * insufficient_data; we keep the turn counter so callers can correlate
 * the reset event with its turn in the report).
 *
 * Used on compaction (transcript window shrank) and on a subagent
 * boundary (sessionId changed). Each context partition gets its own
 * CUSUM walk.
 */
export function resetCusum(state: CusumState, atTurn: number): CusumState {
  return {
    sPlus: 0,
    sMinus: 0,
    lastTurnNumber: atTurn,
    regime: "healthy",
    regimeChangedAtTurn: atTurn,
  };
}

/**
 * Streaming detector class. Stateful wrapper around `observe` for
 * callers who want an OO interface. Pure helpers (`observe`,
 * `resetCusum`) are also exported for tests that pin against
 * specific (state, sample, opts) triples.
 */
export class CusumDetector {
  private state: CusumState;

  constructor(private readonly opts: CusumOptions) {
    this.state = initialCusumState();
  }

  step(sample: EcfSample): CusumState {
    this.state = observe(this.state, sample, this.opts);
    return this.state;
  }

  reset(atTurn: number): CusumState {
    this.state = resetCusum(this.state, atTurn);
    return this.state;
  }

  get current(): CusumState {
    return this.state;
  }
}

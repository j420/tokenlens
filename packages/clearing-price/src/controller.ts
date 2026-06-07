/**
 * The PID price loop. Pure: (state, observation, config) → new state. The price
 * lambda is a positional PID output centered on the midpoint of [min,max], so a
 * settled loop at the setpoint sits at a neutral price rather than the floor:
 *
 *   error      = utilization - setpoint          (over budget ⇒ positive)
 *   integral  += error            (clamped, anti-windup)
 *   derivative = error - lastError
 *   lambda     = clamp(min, max, mid + kp*error + ki*integral + kd*derivative)
 *
 * Positive error (over budget) raises lambda → actuators get stingier; negative
 * error (under budget) lowers it → actuators get generous. No randomness.
 */

import type {
  BudgetObservation,
  ControllerConfig,
  ControllerState,
} from "./types.js";

export const DEFAULT_CONFIG: ControllerConfig = {
  gains: { kp: 0.6, ki: 0.1, kd: 0.05 },
  lambdaMin: 0,
  lambdaMax: 1,
  setpoint: 1,
  integralLimit: 5,
};

function clamp(lo: number, hi: number, x: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/** Initial state — price starts at the midpoint of the allowed range. */
export function initialState(config: ControllerConfig = DEFAULT_CONFIG): ControllerState {
  return {
    lambda: (config.lambdaMin + config.lambdaMax) / 2,
    integral: 0,
    lastError: 0,
    utilization: null,
  };
}

/**
 * One control step. A non-positive or non-finite budget can't be priced, so the
 * state is returned unchanged (the loop simply doesn't move on a bad reading).
 */
export function updatePrice(
  state: ControllerState,
  obs: BudgetObservation,
  config: ControllerConfig = DEFAULT_CONFIG
): ControllerState {
  if (!(obs.budget > 0) || !Number.isFinite(obs.spent)) {
    return state;
  }

  const utilization = Math.max(0, obs.spent) / obs.budget;
  const error = utilization - config.setpoint;

  const integral = clamp(
    -config.integralLimit,
    config.integralLimit,
    state.integral + error
  );
  const derivative = error - state.lastError;

  const mid = (config.lambdaMin + config.lambdaMax) / 2;
  const raw =
    mid +
    config.gains.kp * error +
    config.gains.ki * integral +
    config.gains.kd * derivative;

  return {
    lambda: clamp(config.lambdaMin, config.lambdaMax, raw),
    integral,
    lastError: error,
    utilization,
  };
}

/** The current price. */
export function quote(state: ControllerState): number {
  return state.lambda;
}

/**
 * Types for the Token Clearing-Price Controller (F18).
 *
 * The controller holds one scalar, lambda — the price of a token expressed in
 * quality units. Every actuator (pruner, router, effort selector) decides the
 * same way: spend the tokens iff the quality they buy is worth at least their
 * price, i.e. qualityGain >= lambda * tokenCost. Because they all consult one
 * price, they are coordinated without knowing about each other; adding a new
 * actuator just means it bids against lambda too.
 *
 * lambda is paced by a PID loop toward a budget setpoint: over budget pushes
 * lambda up (be stingier — demand more quality per token); under budget pulls it
 * down (be generous). When quality can't be estimated the controller returns a
 * null quote and consumers no-op, so it never forces a change it cannot price.
 */

export interface PidGains {
  kp: number;
  ki: number;
  kd: number;
}

export interface ControllerConfig {
  gains: PidGains;
  /** Hard floor on lambda (>= 0). */
  lambdaMin: number;
  /** Hard ceiling on lambda. */
  lambdaMax: number;
  /**
   * Target budget utilization in [0,1] the loop drives toward (e.g. 1.0 = spend
   * exactly the budget by window end; 0.9 = leave 10% headroom).
   */
  setpoint: number;
  /** Anti-windup clamp on the integral term (absolute value). */
  integralLimit: number;
}

export interface ControllerState {
  lambda: number;
  integral: number;
  lastError: number;
  /** Last observed utilization, for diagnostics. null before the first update. */
  utilization: number | null;
}

/** A budget reading used to update the price. */
export interface BudgetObservation {
  /** Tokens (or cost) spent so far in the current window. */
  spent: number;
  /** Total budget for the window (> 0). */
  budget: number;
}

export type SpendAction = "spend" | "skip" | "abstain";

/**
 * The result of a bid. `abstain` means the controller could not price the
 * decision (null lambda or unknown quality) — the actuator must fall back to its
 * own default and NOT treat this as a directive.
 */
export interface SpendDecision {
  action: SpendAction;
  /** The price used, or null when abstaining. */
  lambda: number | null;
  /** qualityGain - lambda*tokenCost (the surplus); null when abstaining. */
  surplus: number | null;
  reason: string;
}

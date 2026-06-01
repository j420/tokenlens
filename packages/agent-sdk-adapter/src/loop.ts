/**
 * Loop-halt policy.
 *
 * Reuses the production-tested @prune/intelligence ROI classifier. After each
 * turn, the policy updates the running SessionROI and, if N consecutive
 * low-ROI turns have stacked, decides to halt the in-process loop by throwing
 * LoopHaltError. The thrown error carries enough detail for a caller to:
 *
 *   - log a structured audit record,
 *   - surface a routing suggestion in the UI,
 *   - decide whether to retry with a different model.
 *
 * Pure decision, no I/O. The Agent harness wires this in by calling
 * `policy.observe(turn)` after each model response.
 */

import {
  classifyTurnROI,
  createEmptySessionROI,
  getModelRoutingSuggestion,
  updateSessionROI,
  type SessionROI,
  type TurnData,
} from "@prune/intelligence";
import { LoopHaltError, type LoopHaltDecision } from "./types.js";

export interface LoopPolicyOptions {
  /** Consecutive low-ROI turns required to halt. Default 3. */
  consecutiveLowRoiThreshold?: number;
  /** Optional override of the model used for routing suggestions. */
  currentModel?: string;
  /** When false, observe() never throws; it only RECORDS the decision. */
  enforce?: boolean;
}

export class LoopPolicy {
  private session: SessionROI = createEmptySessionROI();
  private prior: TurnData[] = [];
  private readonly threshold: number;
  private readonly enforce: boolean;
  readonly haltDecisions: LoopHaltDecision[] = [];

  constructor(private readonly options: LoopPolicyOptions = {}) {
    this.threshold = options.consecutiveLowRoiThreshold ?? 3;
    // Default OFF: a halt that throws inside an agent loop is a high-impact
    // action; the caller must opt in explicitly. Mirrors the program rule
    // that nothing decides silently — `enforce: true` is a deliberate flag.
    this.enforce = options.enforce ?? false;
  }

  get state(): Readonly<SessionROI> {
    return this.session;
  }

  /**
   * Observe a completed turn. Updates session ROI; if the threshold is met,
   * builds a halt decision and (when enforce=true) throws LoopHaltError. The
   * decision is recorded regardless so shadow-mode callers can audit.
   */
  observe(turn: TurnData): LoopHaltDecision | null {
    const analysis = classifyTurnROI(turn, this.prior);
    this.session = updateSessionROI(this.session, analysis, turn);
    this.prior = [...this.prior, turn];
    if (this.session.consecutiveLowRoiTurns < this.threshold) return null;

    const sug = this.options.currentModel
      ? getModelRoutingSuggestion(
          this.options.currentModel,
          this.session.consecutiveLowRoiTurns
        )
      : null;

    const decision: LoopHaltDecision = {
      halt: true,
      reason:
        `loop-halt: ${this.session.consecutiveLowRoiTurns} consecutive low-ROI turns` +
        (sug?.message ? ` — ${sug.message}` : ""),
      suggestedModel: sug?.suggestedModel ?? null,
      streak: this.session.consecutiveLowRoiTurns,
    };
    this.haltDecisions.push(decision);
    if (this.enforce) {
      throw new LoopHaltError(decision.reason, decision);
    }
    return decision;
  }

  reset(): void {
    this.session = createEmptySessionROI();
    this.prior = [];
    this.haltDecisions.length = 0;
  }
}

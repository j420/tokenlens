/**
 * Speculation budget + breaker.
 *
 * Speculation trades host CPU for latency. Unbounded, a bad predictor would
 * burn CPU on misses. The budget enforces the SRE-style guard the @prune/slo
 * breaker formalizes for cost: a concurrency cap plus a rolling wasted-rate
 * circuit-breaker that auto-disables speculation when too many speculations
 * miss, with a cooldown — mirroring @prune/intelligence's speculative-cache
 * auto-disable.
 *
 * Pure state machine; the host advances wall-clock by passing `now`.
 */

export interface SpeculationBudgetOptions {
  /** Max concurrent in-flight speculations. Default 4. */
  maxConcurrent?: number;
  /** Rolling window size for the wasted-rate computation. Default 50. */
  windowSize?: number;
  /** Wasted-rate (0..1) at/above which speculation auto-disables. Default 0.6. */
  wastedRateThreshold?: number;
  /** Cooldown (ms) speculation stays disabled after tripping. Default 5 min. */
  cooldownMs?: number;
  /** Minimum samples before the breaker can trip. Default 10. */
  minSamples?: number;
}

export type BudgetVerdict = "allow" | "at_capacity" | "circuit_open";

export interface BudgetDecision {
  verdict: BudgetVerdict;
  rule: string;
  rationale: string;
  /** Concurrency slots currently free. */
  freeSlots: number;
  /** Rolling wasted rate, in [0,1]. */
  wastedRate: number;
}

const DEFAULTS: Required<SpeculationBudgetOptions> = {
  maxConcurrent: 4,
  windowSize: 50,
  wastedRateThreshold: 0.6,
  cooldownMs: 5 * 60_000,
  minSamples: 10,
};

export class SpeculationBudget {
  private readonly opts: Required<SpeculationBudgetOptions>;
  private inFlight = 0;
  /** Ring buffer of recent outcomes: true = wasted (missed), false = useful (hit). */
  private readonly window: boolean[] = [];
  private disabledUntil = 0;

  constructor(options: SpeculationBudgetOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
    if (this.opts.maxConcurrent < 1) {
      throw new Error("SpeculationBudget: maxConcurrent must be ≥ 1");
    }
  }

  /** In-flight speculation count. */
  get activeCount(): number {
    return this.inFlight;
  }

  /** Rolling wasted rate over the window, in [0,1]. */
  get wastedRate(): number {
    if (this.window.length === 0) return 0;
    const wasted = this.window.reduce((n, w) => n + (w ? 1 : 0), 0);
    return wasted / this.window.length;
  }

  /**
   * Decide whether a new speculation may be launched right now. Pure read +
   * cooldown check against `now`.
   */
  decide(now: number = Date.now()): BudgetDecision {
    if (now < this.disabledUntil) {
      return {
        verdict: "circuit_open",
        rule: "rule:circuit_open_cooldown",
        rationale:
          `Speculation disabled until ${new Date(this.disabledUntil).toISOString()} ` +
          `after wasted-rate breach. Cooling down to stop burning CPU on misses.`,
        freeSlots: 0,
        wastedRate: this.wastedRate,
      };
    }
    const free = this.opts.maxConcurrent - this.inFlight;
    if (free <= 0) {
      return {
        verdict: "at_capacity",
        rule: "rule:concurrency_cap",
        rationale: `All ${this.opts.maxConcurrent} speculation slots in flight.`,
        freeSlots: 0,
        wastedRate: this.wastedRate,
      };
    }
    return {
      verdict: "allow",
      rule: "rule:allow",
      rationale: `${free} of ${this.opts.maxConcurrent} speculation slots free.`,
      freeSlots: free,
      wastedRate: this.wastedRate,
    };
  }

  /** Reserve a concurrency slot. Throws if none free (caller must `decide` first). */
  launch(): void {
    if (this.inFlight >= this.opts.maxConcurrent) {
      throw new Error("SpeculationBudget: no free slot — call decide() first");
    }
    this.inFlight++;
  }

  /**
   * Settle a launched speculation. `wasted=true` when it never matched the
   * agent's real call. Frees the slot, updates the rolling window, and trips
   * the breaker if the wasted rate exceeds the threshold over enough samples.
   */
  settle(wasted: boolean, now: number = Date.now()): void {
    if (this.inFlight > 0) this.inFlight--;
    this.window.push(wasted);
    if (this.window.length > this.opts.windowSize) this.window.shift();
    if (
      this.window.length >= this.opts.minSamples &&
      this.wastedRate >= this.opts.wastedRateThreshold
    ) {
      this.disabledUntil = now + this.opts.cooldownMs;
    }
  }

  /** Is speculation currently disabled by the breaker? */
  isDisabled(now: number = Date.now()): boolean {
    return now < this.disabledUntil;
  }
}

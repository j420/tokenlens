import { describe, expect, it } from "vitest";

import {
  evaluateIdleGuard,
  heartbeatThreshold,
  TTL_WINDOW_MS,
  type IdleGuardInput,
} from "./idle-guard.js";

const SONNET = "claude-sonnet-4-5-20250929"; // input $3/1M

function base(overrides: Partial<IdleGuardInput> = {}): IdleGuardInput {
  return {
    ttl: "5m",
    model: SONNET,
    cacheablePrefixTokens: 10_000,
    idleMs: 4 * 60_000, // 4 min into a 5 min window → within the 1 min margin
    continuationProbability: 0.5,
    maxHeartbeats: 6,
    heartbeatsSoFar: 0,
    ...overrides,
  };
}

describe("heartbeatThreshold", () => {
  it("derives the 5m threshold as READ/(WRITE_5m − READ)", () => {
    // 0.10 / (1.25 − 0.10) = 0.086956…
    expect(heartbeatThreshold("5m")).toBeCloseTo(0.1 / 1.15, 10);
  });
  it("derives the 1h threshold as READ/(WRITE_1h − READ)", () => {
    // 0.10 / (2.00 − 0.10) = 0.052631…
    expect(heartbeatThreshold("1h")).toBeCloseTo(0.1 / 1.9, 10);
  });
  it("1h has a lower threshold than 5m (higher write premium → more worth saving)", () => {
    expect(heartbeatThreshold("1h")).toBeLessThan(heartbeatThreshold("5m"));
  });
});

describe("evaluateIdleGuard — actions", () => {
  it("heartbeats when within margin and continuation clears the threshold", () => {
    const d = evaluateIdleGuard(base({ continuationProbability: 0.5 }));
    expect(d.action).toBe("heartbeat");
    expect(d.heartbeatEvUsd!).toBeGreaterThan(0);
  });

  it("lets expire when continuation is below the threshold", () => {
    const d = evaluateIdleGuard(base({ continuationProbability: 0.05 }));
    expect(d.action).toBe("let_expire");
    expect(d.heartbeatEvUsd!).toBeLessThanOrEqual(0);
  });

  it("treats p exactly at the threshold as let_expire (strict >)", () => {
    const t = heartbeatThreshold("5m");
    const d = evaluateIdleGuard(base({ continuationProbability: t }));
    expect(d.action).toBe("let_expire");
    expect(d.heartbeatEvUsd!).toBeCloseTo(0, 9);
  });

  it("waits when expiry is further away than the margin", () => {
    // 2 min into a 5 min window → 3 min to expiry > 1 min default margin.
    const d = evaluateIdleGuard(base({ idleMs: 2 * 60_000 }));
    expect(d.action).toBe("wait");
  });

  it("reports already_expired once the window has elapsed", () => {
    const d = evaluateIdleGuard(base({ idleMs: TTL_WINDOW_MS["5m"] + 1 }));
    expect(d.action).toBe("already_expired");
    expect(d.timeToExpiryMs).toBe(0);
  });

  it("refuses once the heartbeat budget is spent", () => {
    const d = evaluateIdleGuard(base({ heartbeatsSoFar: 6, maxHeartbeats: 6 }));
    expect(d.action).toBe("budget_exhausted");
  });

  it("refuses immediately when maxHeartbeats <= 0", () => {
    expect(evaluateIdleGuard(base({ maxHeartbeats: 0 })).action).toBe("budget_exhausted");
  });

  it("returns nothing_to_protect when there is no cacheable prefix", () => {
    const d = evaluateIdleGuard(base({ cacheablePrefixTokens: 0 }));
    expect(d.action).toBe("nothing_to_protect");
  });

  it("budget check takes precedence over the wait/heartbeat evaluation", () => {
    // Within margin AND high continuation, but budget spent → budget_exhausted.
    const d = evaluateIdleGuard(
      base({ heartbeatsSoFar: 6, maxHeartbeats: 6, continuationProbability: 0.99 })
    );
    expect(d.action).toBe("budget_exhausted");
  });
});

describe("evaluateIdleGuard — economics (exact)", () => {
  it("computes heartbeat cost, rewrite-avoided, and EV for a priced model", () => {
    // prefix 10_000, sonnet input 3, 5m writeMult 1.25.
    // heartbeatCost      = 10000*3*0.10/1e6           = 0.003
    // rewriteAvoided     = 10000*3*(1.25-0.10)/1e6    = 0.0345
    // EV @ p=0.5         = 0.5*0.0345 - 0.003          = 0.01425
    const d = evaluateIdleGuard(base({ continuationProbability: 0.5 }));
    expect(d.heartbeatCostUsd).toBeCloseTo(0.003, 10);
    expect(d.rewriteCostAvoidedUsd).toBeCloseTo(0.0345, 10);
    expect(d.heartbeatEvUsd).toBeCloseTo(0.01425, 10);
  });

  it("EV sign agrees with the action by construction", () => {
    for (const p of [0.0, 0.05, 0.087, 0.1, 0.5, 1.0]) {
      const d = evaluateIdleGuard(base({ continuationProbability: p }));
      if (d.action === "heartbeat") expect(d.heartbeatEvUsd!).toBeGreaterThan(0);
      if (d.action === "let_expire") expect(d.heartbeatEvUsd!).toBeLessThanOrEqual(0);
    }
  });

  it("the ACTION is price- and size-independent (threshold cancels both)", () => {
    // Same continuation, wildly different prefix sizes and an unpriced model:
    // the action must be identical even though the USD figures differ/none.
    const small = evaluateIdleGuard(base({ cacheablePrefixTokens: 1_200 }));
    const huge = evaluateIdleGuard(base({ cacheablePrefixTokens: 500_000 }));
    const unpriced = evaluateIdleGuard(base({ model: "some-unknown-model" }));
    expect(small.action).toBe("heartbeat");
    expect(huge.action).toBe("heartbeat");
    expect(unpriced.action).toBe("heartbeat");
  });

  it("unpriced model yields null USD but still a sound action", () => {
    const d = evaluateIdleGuard(base({ model: "some-unknown-model" }));
    expect(d.heartbeatCostUsd).toBeNull();
    expect(d.rewriteCostAvoidedUsd).toBeNull();
    expect(d.heartbeatEvUsd).toBeNull();
    expect(d.action).toBe("heartbeat");
  });
});

describe("evaluateIdleGuard — input hygiene", () => {
  it("clamps a negative continuation probability to 0 (→ let_expire)", () => {
    expect(evaluateIdleGuard(base({ continuationProbability: -5 })).action).toBe("let_expire");
  });

  it("clamps a NaN continuation probability to 0 (no fabricated heartbeat)", () => {
    expect(evaluateIdleGuard(base({ continuationProbability: Number.NaN })).action).toBe(
      "let_expire"
    );
  });

  it("clamps a >1 continuation probability to 1", () => {
    const d = evaluateIdleGuard(base({ continuationProbability: 5 }));
    expect(d.action).toBe("heartbeat");
  });

  it("honors a custom margin", () => {
    // 4 min idle → 1 min to expiry. With a 30s margin, 1 min > 30s → wait.
    const d = evaluateIdleGuard(base({ idleMs: 4 * 60_000, marginMs: 30_000 }));
    expect(d.action).toBe("wait");
  });

  it("clamps a margin larger than the window down to the window", () => {
    // Huge margin → effectively always 'within margin' → evaluate continuation.
    const d = evaluateIdleGuard(base({ idleMs: 1_000, marginMs: 10 * 60_000 }));
    expect(d.action).toBe("heartbeat");
  });

  it("clamps negative idleMs to 0", () => {
    const d = evaluateIdleGuard(base({ idleMs: -1000 }));
    expect(d.timeToExpiryMs).toBe(TTL_WINDOW_MS["5m"]);
  });

  it("is deterministic for the same input", () => {
    const i = base();
    expect(evaluateIdleGuard(i)).toEqual(evaluateIdleGuard(i));
  });
});

describe("evaluateIdleGuard — 1h tier", () => {
  it("heartbeats at a lower continuation probability than 5m would", () => {
    // p = 0.07: above 1h threshold (0.0526), below 5m threshold (0.087).
    const oneHour = evaluateIdleGuard(
      base({ ttl: "1h", idleMs: 59 * 60_000, continuationProbability: 0.07 })
    );
    const fiveMin = evaluateIdleGuard(base({ continuationProbability: 0.07 }));
    expect(oneHour.action).toBe("heartbeat");
    expect(fiveMin.action).toBe("let_expire");
  });
});

import { describe, expect, it } from "vitest";
import {
  CusumDetector,
  cusumObserve,
  initialCusumState,
  resetCusum,
} from "./index.js";
import type { EcfSample } from "./types.js";
import { DEFAULT_CONFIG } from "./constants.js";

const OPTS = {
  kWarn: DEFAULT_CONFIG.kWarn,
  kCrit: DEFAULT_CONFIG.kCrit,
  hWarn: DEFAULT_CONFIG.hWarn,
  hCrit: DEFAULT_CONFIG.hCrit,
};

function sample(ecf: number, turnNumber = 1): EcfSample {
  return {
    turnNumber,
    attendedInput: 0,
    discountedCacheRead: 0,
    committedOutput: 0,
    contextWindow: 200_000,
    ecf,
    source: "exact",
  };
}

describe("CUSUM — warning detector", () => {
  it("stays healthy when ECF stays below k+", () => {
    let state = initialCusumState();
    for (let i = 1; i <= 10; i++) {
      state = cusumObserve(state, sample(0.4, i), OPTS);
    }
    expect(state.regime === "healthy" || state.regime === "insufficient_data").toBe(
      true
    );
    expect(state.sPlus).toBe(0);
    expect(state.sMinus).toBe(0);
  });

  it("promotes to warning after enough cumulative excess over k+", () => {
    // ECF = 0.55 each turn; excess over k+ = 0.05 per turn.
    // With h_warn = 0.05, regime should promote on the very first turn.
    let state = initialCusumState();
    state = cusumObserve(state, sample(0.55, 1), OPTS);
    // sPlus = max(0, 0 + (0.55 - 0.50)) = 0.05 ≥ h_warn = 0.05 → warning
    expect(state.sPlus).toBeCloseTo(0.05, 6);
    expect(state.regime).toBe("warning");
    expect(state.regimeChangedAtTurn).toBe(1);
  });

  it("does NOT promote when ECF < k+ even with many turns", () => {
    let state = initialCusumState();
    for (let i = 1; i <= 20; i++) {
      state = cusumObserve(state, sample(0.49, i), OPTS);
    }
    expect(state.sPlus).toBe(0); // never went positive
    expect(state.regime).toBe("healthy");
  });

  it("promotes warning after several below-k+ turns mixed with a spike", () => {
    let state = initialCusumState();
    state = cusumObserve(state, sample(0.4, 1), OPTS);
    state = cusumObserve(state, sample(0.4, 2), OPTS);
    state = cusumObserve(state, sample(0.4, 3), OPTS);
    expect(state.regime).toBe("healthy");
    // Sudden 0.6 turn pushes excess to 0.10
    state = cusumObserve(state, sample(0.6, 4), OPTS);
    expect(state.sPlus).toBeCloseTo(0.1, 6);
    expect(state.regime).toBe("warning");
  });
});

describe("CUSUM — critical detector", () => {
  it("promotes to critical after enough cumulative excess over k-", () => {
    let state = initialCusumState();
    state = cusumObserve(state, sample(0.9, 1), OPTS);
    // sPlus = max(0, 0 + (0.90 - 0.50)) = 0.40 → warning fires
    // sMinus = max(0, 0 + (0.90 - 0.75)) = 0.15 ≥ h_crit = 0.10 → critical
    expect(state.regime).toBe("critical");
    expect(state.regimeChangedAtTurn).toBe(1);
  });

  it("warning then critical promotes through both tiers", () => {
    let state = initialCusumState();
    state = cusumObserve(state, sample(0.55, 1), OPTS);
    expect(state.regime).toBe("warning");
    state = cusumObserve(state, sample(0.9, 2), OPTS);
    expect(state.regime).toBe("critical");
    // regimeChangedAtTurn updates on the upgrade
    expect(state.regimeChangedAtTurn).toBe(2);
  });
});

describe("CUSUM — stickiness (sticky promotion until reset)", () => {
  it("stays warning even when ECF drops back below k+ (sticky)", () => {
    let state = initialCusumState();
    state = cusumObserve(state, sample(0.6, 1), OPTS);
    expect(state.regime).toBe("warning");
    // ECF drops; sPlus drains but regime stays
    for (let i = 2; i <= 10; i++) {
      state = cusumObserve(state, sample(0.3, i), OPTS);
    }
    expect(state.sPlus).toBe(0); // sums drained
    expect(state.regime).toBe("warning"); // but regime is sticky
  });

  it("reset() returns regime to healthy and zeros sums", () => {
    let state = initialCusumState();
    state = cusumObserve(state, sample(0.9, 1), OPTS);
    expect(state.regime).toBe("critical");
    state = resetCusum(state, 5);
    expect(state.sPlus).toBe(0);
    expect(state.sMinus).toBe(0);
    expect(state.regime).toBe("healthy");
    expect(state.regimeChangedAtTurn).toBe(5);
    expect(state.lastTurnNumber).toBe(5);
  });
});

describe("CUSUM — unknown_window samples advance turn but not sums", () => {
  it("doesn't move sums when sample.source !== 'exact'", () => {
    let state = initialCusumState();
    const unknown: EcfSample = {
      turnNumber: 1,
      attendedInput: 0,
      discountedCacheRead: 0,
      committedOutput: 0,
      contextWindow: 0,
      ecf: 0,
      source: "unknown_window",
    };
    state = cusumObserve(state, unknown, OPTS);
    expect(state.sPlus).toBe(0);
    expect(state.sMinus).toBe(0);
    expect(state.lastTurnNumber).toBe(1);
    expect(state.regime).toBe("insufficient_data");
  });
});

describe("CusumDetector class", () => {
  it("wraps observe() and tracks current state", () => {
    const det = new CusumDetector(OPTS);
    const s = det.step(sample(0.9, 1));
    expect(s.regime).toBe("critical");
    expect(det.current.regime).toBe("critical");
    det.reset(2);
    expect(det.current.sPlus).toBe(0);
    expect(det.current.regime).toBe("healthy");
  });
});

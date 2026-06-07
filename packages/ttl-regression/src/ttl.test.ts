import { describe, it, expect } from "vitest";
import { detectTtlRegression } from "./ttl.js";

describe("detectTtlRegression", () => {
  it("flags a 1h→~5m silent downgrade as regressed", () => {
    const r = detectTtlRegression({ configuredTtlSeconds: 3600, observedTtlSeconds: 300 });
    expect(r.verdict).toBe("regressed");
    expect(r.shortfallSeconds).toBe(3300);
    expect(r.ratio).toBeCloseTo(300 / 3600, 6);
  });

  it("reports ok when the observed TTL honors the configured one", () => {
    const r = detectTtlRegression({ configuredTtlSeconds: 3600, observedTtlSeconds: 3500 });
    expect(r.verdict).toBe("ok");
  });

  it("tolerates small timing noise within the tolerance band", () => {
    // 3300/3600 = 0.917 >= 1-0.1 → ok
    expect(detectTtlRegression({ configuredTtlSeconds: 3600, observedTtlSeconds: 3300 }).verdict).toBe(
      "ok"
    );
    // just below the band → regressed
    expect(detectTtlRegression({ configuredTtlSeconds: 3600, observedTtlSeconds: 3200 }).verdict).toBe(
      "regressed"
    );
  });

  it("honors a custom tolerance", () => {
    // with tolerance 0, anything strictly less than configured regresses
    expect(
      detectTtlRegression({ configuredTtlSeconds: 3600, observedTtlSeconds: 3599 }, { tolerance: 0 }).verdict
    ).toBe("regressed");
  });

  it("returns insufficient_signal when the observed TTL is unknown", () => {
    const r = detectTtlRegression({ configuredTtlSeconds: 3600, observedTtlSeconds: null });
    expect(r.verdict).toBe("insufficient_signal");
    expect(r.shortfallSeconds).toBeNull();
    expect(r.ratio).toBeNull();
  });

  it("returns insufficient_signal when configured TTL is missing/invalid", () => {
    expect(detectTtlRegression({ observedTtlSeconds: 300 }).verdict).toBe("insufficient_signal");
    expect(detectTtlRegression({ configuredTtlSeconds: 0, observedTtlSeconds: 300 }).verdict).toBe(
      "insufficient_signal"
    );
  });

  it("is total on garbage and deterministic", () => {
    expect(detectTtlRegression(null).verdict).toBe("insufficient_signal");
    const input = { configuredTtlSeconds: 3600, observedTtlSeconds: 300 };
    expect(detectTtlRegression(input)).toEqual(detectTtlRegression(input));
  });
});

import { describe, it, expect } from "vitest";
import {
  checkPrunerCacheBust,
  checkSkipStarvesCapture,
  checkResqueezePrefixBust,
} from "./guardrails.js";

describe("G1 pruner-vs-cache-bust", () => {
  it("allows pruning a non-anchor result cleanly", () => {
    const r = checkPrunerCacheBust({ pruneSavingTokens: 500, isCacheAnchor: false, bustedCacheTokens: 9999 });
    expect(r.safe).toBe(true);
    expect(r.netTokens).toBe(500);
  });

  it("blocks pruning an anchor when the bust costs more than the prune saves", () => {
    const r = checkPrunerCacheBust({ pruneSavingTokens: 300, isCacheAnchor: true, bustedCacheTokens: 4000 });
    expect(r.verdict).toBe("blocked");
    expect(r.netTokens).toBe(300 - 4000);
    expect(r.reason).toContain("re-establish");
  });

  it("allows pruning an anchor when the saving still beats the bust", () => {
    const r = checkPrunerCacheBust({ pruneSavingTokens: 5000, isCacheAnchor: true, bustedCacheTokens: 1000 });
    expect(r.safe).toBe(true);
    expect(r.netTokens).toBe(4000);
  });

  it("uses the cheaper of bust vs re-pin as the induced cost", () => {
    // bust 4000 but repin only 500 → induced 500 → net 300-500 = -200 (blocked)
    const r = checkPrunerCacheBust({
      pruneSavingTokens: 300,
      isCacheAnchor: true,
      bustedCacheTokens: 4000,
      reestablishTokens: 500,
    });
    expect(r.netTokens).toBe(-200);
    expect(r.verdict).toBe("blocked");
    // repin 100 → induced 100 → net 200 (safe)
    expect(checkPrunerCacheBust({ pruneSavingTokens: 300, isCacheAnchor: true, bustedCacheTokens: 4000, reestablishTokens: 100 }).safe).toBe(true);
  });

  it("is total on garbage", () => {
    expect(checkPrunerCacheBust(null).safe).toBe(true);
  });
});

describe("G2 skip-retrieval-starves-skill-capture", () => {
  it("blocks skipping a step the skill-library is capturing", () => {
    const r = checkSkipStarvesCapture({ stepId: "read:auth.ts", captureInProgressSteps: ["read:auth.ts", "read:db.ts"] });
    expect(r.verdict).toBe("blocked");
    expect(r.reason).toContain("starve");
  });

  it("allows skipping a step not in any capture set", () => {
    expect(checkSkipStarvesCapture({ stepId: "read:noise.ts", captureInProgressSteps: ["read:auth.ts"] }).safe).toBe(true);
  });

  it("is safe when no step id is supplied", () => {
    expect(checkSkipStarvesCapture({ captureInProgressSteps: ["x"] }).safe).toBe(true);
    expect(checkSkipStarvesCapture(null).safe).toBe(true);
  });
});

describe("G3 re-squeeze-prefix-bust", () => {
  it("blocks re-squeezing content anchored in the cached prefix", () => {
    const r = checkResqueezePrefixBust({ contentId: "repo-map.md", anchoredContentIds: ["repo-map.md", "system.md"] });
    expect(r.verdict).toBe("blocked");
    expect(r.reason).toContain("busts the prefix");
  });

  it("allows squeezing non-anchored content", () => {
    expect(checkResqueezePrefixBust({ contentId: "scratch.ts", anchoredContentIds: ["repo-map.md"] }).safe).toBe(true);
  });

  it("is total on garbage", () => {
    expect(checkResqueezePrefixBust(null).safe).toBe(true);
  });
});

describe("all guards are deterministic and labelled", () => {
  it("stamp their guard id and are reproducible", () => {
    const g1 = checkPrunerCacheBust({ pruneSavingTokens: 1, isCacheAnchor: true, bustedCacheTokens: 9 });
    expect(g1.guard).toBe("G1");
    expect(checkSkipStarvesCapture({ stepId: "a", captureInProgressSteps: ["a"] }).guard).toBe("G2");
    expect(checkResqueezePrefixBust({ contentId: "a", anchoredContentIds: ["a"] }).guard).toBe("G3");
    expect(checkPrunerCacheBust({ pruneSavingTokens: 1, isCacheAnchor: true, bustedCacheTokens: 9 })).toEqual(g1);
  });
});

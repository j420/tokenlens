import { describe, expect, it } from "vitest";

import { projectLibrarySaving, projectSkillSaving } from "./savings.js";
import { crudSkill, makeSkill } from "./test-helpers.js";

describe("projectSkillSaving", () => {
  it("computes saved USD per reuse at the model input rate", () => {
    // crudSkill discoveryTokens = 1200 + 800 + 400 = 2400.
    // sonnet input = $3/1M → 2400 * 3 / 1e6 = 0.0072 USD per reuse.
    const skill = crudSkill();
    const proj = projectSkillSaving(skill, "claude-sonnet-4-5-20250929");
    expect(proj.discoveryTokens).toBe(2400);
    expect(proj.savedUsdPerReuse).toBeCloseTo(0.0072, 10);
    expect(proj.cumulativeSavedUsd).toBe(0); // useCount 0
  });

  it("cumulative scales with useCount", () => {
    const skill = { ...crudSkill(), useCount: 10 };
    const proj = projectSkillSaving(skill, "claude-sonnet-4-5-20250929");
    expect(proj.cumulativeSavedUsd).toBeCloseTo(0.072, 10);
  });

  it("returns null USD for an unpriced model but keeps token figure", () => {
    const proj = projectSkillSaving(crudSkill(), "unknown-model-xyz");
    expect(proj.savedUsdPerReuse).toBeNull();
    expect(proj.cumulativeSavedUsd).toBeNull();
    expect(proj.discoveryTokens).toBe(2400);
  });
});

describe("projectLibrarySaving", () => {
  it("aggregates cumulative savings across priced skills", () => {
    const a = { ...crudSkill(), useCount: 2 }; // 2400 tokens * 2
    const b = {
      ...makeSkill("another endpoint crud router task", "b", [
        { toolName: "Read", target: "x", tokenFootprint: 1000 },
      ]),
      useCount: 3,
    };
    const proj = projectLibrarySaving([a, b], "claude-sonnet-4-5-20250929");
    // a: 2400*3*2/1e6 = 0.0144 ; b: 1000*3*3/1e6 = 0.009 → 0.0234
    expect(proj.totalCumulativeSavedUsd).toBeCloseTo(0.0234, 10);
    expect(proj.totalDiscoveryTokens).toBe(3400);
    expect(proj.pricedSkills).toBe(2);
    expect(proj.skippedUnpriced).toBe(0);
  });

  it("reports unpriced model with null total but real token sum", () => {
    const proj = projectLibrarySaving([crudSkill()], "unknown-model");
    expect(proj.totalCumulativeSavedUsd).toBeNull();
    expect(proj.skippedUnpriced).toBe(1);
    expect(proj.totalDiscoveryTokens).toBe(2400);
  });
});

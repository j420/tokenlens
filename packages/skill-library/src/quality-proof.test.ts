import { describe, expect, it } from "vitest";

import {
  buildCaptureProof,
  buildReplayProof,
  QUALITY_PROOF_SCHEMA_VERSION,
  SKILL_LIBRARY_FEATURE_ID,
} from "./quality-proof.js";
import { evaluateReplay } from "./replay-guard.js";
import { projectSkillSaving } from "./savings.js";
import { SkillLibrary } from "./library.js";
import { crudSkill } from "./test-helpers.js";
import type { ReplayPrecondition } from "./types.js";

describe("buildCaptureProof", () => {
  it("records capture metadata under f10 schema v1, PII-safe", () => {
    const skill = crudSkill();
    const proof = buildCaptureProof(skill);
    expect(proof.schemaVersion).toBe(QUALITY_PROOF_SCHEMA_VERSION);
    expect(proof.featureId).toBe(SKILL_LIBRARY_FEATURE_ID);
    expect(proof.event).toBe("capture");
    expect(proof.skillId).toBe(skill.id);
    expect(proof.stepCount).toBe(3);
    expect(proof.discoveryTokens).toBe(2400);
    expect(proof.signed).toBe(false);
    // PII-safe: the raw prompt text is never in the proof.
    expect(JSON.stringify(proof).includes("invoices to the REST router")).toBe(false);
  });
});

describe("buildReplayProof", () => {
  it("records a matched + guarded replay under f10", () => {
    const lib = new SkillLibrary();
    lib.add(crudSkill());
    const match = lib.match("add a CRUD endpoint for invoices to the router", {
      threshold: 0.3,
    })[0]!;
    const captured: ReplayPrecondition[] = [
      { target: "src/router.ts", freshnessToken: "A" },
      { target: "src/models/invoice.ts", freshnessToken: "B" },
    ];
    const current: ReplayPrecondition[] = [
      { target: "src/router.ts", freshnessToken: "A" },
      { target: "src/models/invoice.ts", freshnessToken: "B" },
    ];
    const guard = evaluateReplay(match.skill, captured, current);
    const saving = projectSkillSaving(match.skill, "claude-sonnet-4-5-20250929");
    const proof = buildReplayProof(match, guard, saving);
    expect(proof.event).toBe("replay");
    expect(proof.guardSafe).toBe(true);
    expect(proof.staleTargetCount).toBe(0);
    expect(proof.savedUsdPerReuse).toBeCloseTo(0.0072, 10);
    expect(proof.matchedTermCount).toBeGreaterThan(0);
  });

  it("captures an unsafe guard verdict", () => {
    const lib = new SkillLibrary();
    lib.add(crudSkill());
    const match = lib.match("add a CRUD endpoint for invoices to the router", {
      threshold: 0.3,
    })[0]!;
    const guard = evaluateReplay(
      match.skill,
      [{ target: "src/router.ts", freshnessToken: "A" }, { target: "src/models/invoice.ts", freshnessToken: "B" }],
      [{ target: "src/router.ts", freshnessToken: "CHANGED" }, { target: "src/models/invoice.ts", freshnessToken: "B" }]
    );
    const saving = projectSkillSaving(match.skill, "claude-sonnet-4-5-20250929");
    const proof = buildReplayProof(match, guard, saving);
    expect(proof.guardSafe).toBe(false);
    expect(proof.staleTargetCount).toBe(1);
  });
});

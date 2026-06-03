import { describe, expect, it } from "vitest";

import { evaluateReplay } from "./replay-guard.js";
import { crudSkill, makeSkill } from "./test-helpers.js";
import type { ReplayPrecondition } from "./types.js";

const pre = (target: string, token: string): ReplayPrecondition => ({
  target,
  freshnessToken: token,
});

describe("evaluateReplay", () => {
  it("is safe when all target tokens match capture", () => {
    const skill = crudSkill();
    const captured = [
      pre("src/router.ts", "sha-A"),
      pre("src/models/invoice.ts", "sha-B"),
    ];
    const current = [
      pre("src/router.ts", "sha-A"),
      pre("src/models/invoice.ts", "sha-B"),
    ];
    const r = evaluateReplay(skill, captured, current);
    expect(r.safe).toBe(true);
    expect(r.staleTargets).toEqual([]);
    expect(r.reason).toBeNull();
  });

  it("is unsafe when a target changed since capture", () => {
    const skill = crudSkill();
    const captured = [pre("src/router.ts", "sha-A"), pre("src/models/invoice.ts", "sha-B")];
    const current = [pre("src/router.ts", "sha-CHANGED"), pre("src/models/invoice.ts", "sha-B")];
    const r = evaluateReplay(skill, captured, current);
    expect(r.safe).toBe(false);
    expect(r.staleTargets).toContain("src/router.ts");
    expect(r.reason).toMatch(/changed since capture/);
  });

  it("is unsafe (default) when a current token is missing — unverifiable", () => {
    const skill = crudSkill();
    const captured = [pre("src/router.ts", "sha-A"), pre("src/models/invoice.ts", "sha-B")];
    const current = [pre("src/router.ts", "sha-A")]; // invoice.ts not probed
    const r = evaluateReplay(skill, captured, current);
    expect(r.safe).toBe(false);
    expect(r.unverifiableTargets).toContain("src/models/invoice.ts");
  });

  it("allows unverifiable targets when allowUnverifiable is set", () => {
    const skill = crudSkill();
    const captured = [pre("src/router.ts", "sha-A"), pre("src/models/invoice.ts", "sha-B")];
    const current = [pre("src/router.ts", "sha-A")];
    const r = evaluateReplay(skill, captured, current, { allowUnverifiable: true });
    expect(r.safe).toBe(true);
    expect(r.unverifiableTargets).toContain("src/models/invoice.ts");
  });

  it("a pure-reasoning skill (no targets) is always safe", () => {
    const skill = makeSkill("reason about the architecture tradeoffs", "reason", [
      { toolName: "Think", target: null, tokenFootprint: 100 },
    ]);
    const r = evaluateReplay(skill, [], []);
    expect(r.safe).toBe(true);
  });

  it("reports both stale and unverifiable in the reason", () => {
    const skill = crudSkill();
    const captured = [pre("src/router.ts", "sha-A"), pre("src/models/invoice.ts", "sha-B")];
    const current = [pre("src/router.ts", "sha-X")]; // router changed; invoice unprobed
    const r = evaluateReplay(skill, captured, current);
    expect(r.safe).toBe(false);
    expect(r.staleTargets).toContain("src/router.ts");
    expect(r.unverifiableTargets).toContain("src/models/invoice.ts");
    expect(r.reason).toMatch(/changed since capture/);
    expect(r.reason).toMatch(/could not be verified/);
  });
});

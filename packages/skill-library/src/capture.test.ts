import { describe, expect, it } from "vitest";

import {
  captureSkillFromSteps,
  captureSkillFromTrajectory,
} from "./capture.js";
import { skillContentHash } from "./provenance.js";

describe("captureSkillFromSteps", () => {
  it("builds a skill with summed discovery tokens and ordered steps", () => {
    const skill = captureSkillFromSteps({
      taskPrompt: "add a CRUD endpoint for invoices",
      label: "add-crud-endpoint",
      influentialSteps: [
        { toolName: "Read", target: "src/router.ts", tokenFootprint: 1200 },
        { toolName: "Edit", target: "src/router.ts", tokenFootprint: 400 },
      ],
      capturedAtTurn: 7,
      at: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(skill.discoveryTokens).toBe(1600);
    expect(skill.steps.map((s) => s.order)).toEqual([0, 1]);
    expect(skill.steps[0]!.toolName).toBe("Read");
    expect(skill.useCount).toBe(0);
    expect(skill.signature).toBeNull();
    expect(skill.capturedAtTurn).toBe(7);
  });

  it("derives a stable content hash + id from identity fields", () => {
    const mk = () =>
      captureSkillFromSteps({
        taskPrompt: "add a CRUD endpoint for invoices",
        label: "add-crud-endpoint",
        influentialSteps: [{ toolName: "Read", target: "src/router.ts", tokenFootprint: 1200 }],
        capturedAtTurn: 7,
        at: new Date("2026-06-01T00:00:00.000Z"),
      });
    expect(mk().contentHash).toBe(mk().contentHash);
    expect(mk().id).toBe(mk().contentHash.slice(0, 16));
  });

  it("content hash ignores timestamp + turn (only identity fields matter)", () => {
    const a = captureSkillFromSteps({
      taskPrompt: "add a CRUD endpoint",
      label: "x",
      influentialSteps: [{ toolName: "Read", target: "f", tokenFootprint: 1 }],
      capturedAtTurn: 1,
      at: new Date("2026-06-01T00:00:00.000Z"),
    });
    const b = captureSkillFromSteps({
      taskPrompt: "add a CRUD endpoint",
      label: "x",
      influentialSteps: [{ toolName: "Read", target: "f", tokenFootprint: 1 }],
      capturedAtTurn: 99,
      at: new Date("2026-12-31T23:59:59.000Z"),
    });
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("clamps negative token footprints to 0", () => {
    const skill = captureSkillFromSteps({
      taskPrompt: "task",
      label: "x",
      influentialSteps: [{ toolName: "Read", target: "f", tokenFootprint: -50 }],
      capturedAtTurn: 1,
    });
    expect(skill.steps[0]!.tokenFootprint).toBe(0);
    expect(skill.discoveryTokens).toBe(0);
  });

  it("throws on zero influential steps", () => {
    expect(() =>
      captureSkillFromSteps({
        taskPrompt: "task",
        label: "x",
        influentialSteps: [],
        capturedAtTurn: 1,
      })
    ).toThrow(/zero influential steps/);
  });

  it("throws on missing label", () => {
    expect(() =>
      captureSkillFromSteps({
        taskPrompt: "task",
        label: "",
        influentialSteps: [{ toolName: "Read", target: "f", tokenFootprint: 1 }],
        capturedAtTurn: 1,
      })
    ).toThrow(/label is required/);
  });
});

describe("captureSkillFromTrajectory", () => {
  // Minimal StepFeatures-shaped objects (only the fields capture reads).
  const feat = (stepIndex: number, toolName: string, target: string | null, cost: number) => ({
    stepIndex,
    turnNumber: 1,
    toolName,
    target,
    inputSimilarityToPrior: 0,
    targetFileNovelty: 1,
    positionInTrajectory: 0,
    priorOutputUtilization: 0,
    stepTokenCost: cost,
    intentClassMatch: 0.5,
  });
  const advisory = (stepIndex: number) => ({
    stepIndex,
    turnNumber: 1,
    toolName: "Read",
    target: null,
    predictedInfluence: 0.05,
    confidence: 0.95,
    projectedTokensSaved: 100,
    message: "",
  });

  it("keeps only steps NOT flagged by the advisor (the influential complement)", () => {
    const features = [
      feat(0, "Read", "a.ts", 500),
      feat(1, "Grep", "grep:foo", 300), // will be flagged low-influence
      feat(2, "Edit", "a.ts", 200),
    ];
    const advisories = [advisory(1)];
    const skill = captureSkillFromTrajectory({
      taskPrompt: "fix the auth bug in a.ts",
      label: "fix-auth",
      features,
      advisories,
      capturedAtTurn: 4,
    });
    // Step 1 (Grep) excluded; steps 0 and 2 retained.
    expect(skill.steps.map((s) => s.toolName)).toEqual(["Read", "Edit"]);
    expect(skill.discoveryTokens).toBe(700);
  });

  it("keeps all steps when there are no advisories", () => {
    const features = [feat(0, "Read", "a.ts", 500), feat(1, "Edit", "a.ts", 200)];
    const skill = captureSkillFromTrajectory({
      taskPrompt: "edit a.ts",
      label: "edit",
      features,
      advisories: [],
      capturedAtTurn: 2,
    });
    expect(skill.steps.length).toBe(2);
  });

  it("throws when every step was advised against (nothing influential to capture)", () => {
    const features = [feat(0, "Read", "a.ts", 500)];
    expect(() =>
      captureSkillFromTrajectory({
        taskPrompt: "task",
        label: "x",
        features,
        advisories: [advisory(0)],
        capturedAtTurn: 1,
      })
    ).toThrow(/zero influential steps/);
  });
});

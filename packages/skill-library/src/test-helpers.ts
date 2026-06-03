/**
 * Test-only builders for skill-library. Construct skills from explicit
 * influential-step descriptors (pure-logic inputs, not session-transcript
 * fixtures).
 */

import { captureSkillFromSteps } from "./capture.js";
import type { Skill } from "./types.js";

export function makeSkill(
  taskPrompt: string,
  label: string,
  steps: Array<{ toolName: string; target: string | null; tokenFootprint: number }>,
  opts: { capturedAtTurn?: number; at?: Date } = {}
): Skill {
  return captureSkillFromSteps({
    taskPrompt,
    label,
    influentialSteps: steps,
    capturedAtTurn: opts.capturedAtTurn ?? 5,
    at: opts.at ?? new Date("2026-06-01T00:00:00.000Z"),
  });
}

/** A canonical "add a CRUD endpoint" skill used across the matcher tests. */
export function crudSkill(at = new Date("2026-06-01T00:00:00.000Z")): Skill {
  return makeSkill(
    "add a new CRUD endpoint for invoices to the REST router",
    "add-crud-endpoint",
    [
      { toolName: "Read", target: "src/router.ts", tokenFootprint: 1200 },
      { toolName: "Read", target: "src/models/invoice.ts", tokenFootprint: 800 },
      { toolName: "Edit", target: "src/router.ts", tokenFootprint: 400 },
    ],
    { at }
  );
}

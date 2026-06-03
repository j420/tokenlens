/**
 * Skill capture — distill a completed trajectory into a reusable skill.
 *
 * The influential subset is the COMPLEMENT of trajectory-diet's advisories:
 * the advisor flags LOW-influence steps to skip, so the steps it does NOT flag
 * are the ones that shaped the output — exactly the trace worth replaying.
 *
 * Two entry points:
 *   - `captureSkillFromSteps`: low-level, takes plain step descriptors. No
 *     trajectory-diet dependency at the value level.
 *   - `captureSkillFromTrajectory`: convenience that consumes trajectory-diet's
 *     `StepFeatures[]` + `StepAdvisory[]` (type-only import) and computes the
 *     influential subset for you.
 */

import { skillContentHash, skillId } from "./provenance.js";
import { tokenizeIntent } from "./tokenize.js";
import type { Skill, SkillStep } from "./types.js";
// Type-only import — composes with trajectory-diet without a runtime dep edge.
import type { StepAdvisory, StepFeatures } from "@prune/trajectory-diet";

export interface CaptureInput {
  /** The task prompt that this session solved — fingerprinted for matching. */
  taskPrompt: string;
  /** Human-facing label for the skill (the classified intent). */
  label: string;
  /** The influential steps, in execution order. */
  influentialSteps: ReadonlyArray<{
    toolName: string;
    target: string | null;
    tokenFootprint: number;
  }>;
  /** Turn at which the session succeeded. */
  capturedAtTurn: number;
  /** Override capture timestamp (mostly for tests). */
  at?: Date;
}

/**
 * Build a skill from explicit influential steps. Pure. The step order is the
 * array order; tokenFootprints are summed into discoveryTokens.
 */
export function captureSkillFromSteps(input: CaptureInput): Skill {
  if (!input.label) throw new Error("skill-library: label is required");
  if (input.influentialSteps.length === 0) {
    throw new Error(
      "skill-library: cannot capture a skill with zero influential steps"
    );
  }
  const steps: SkillStep[] = input.influentialSteps.map((s, i) => ({
    order: i,
    toolName: s.toolName,
    target: s.target,
    tokenFootprint: Math.max(0, s.tokenFootprint),
  }));
  const discoveryTokens = steps.reduce((sum, s) => sum + s.tokenFootprint, 0);
  const intentSignature = tokenizeIntent(input.taskPrompt);
  const contentHash = skillContentHash({
    label: input.label,
    intentSignature,
    steps,
  });
  const capturedAtIso = (input.at ?? new Date()).toISOString();
  return {
    id: skillId(contentHash),
    label: input.label,
    intentSignature,
    steps,
    discoveryTokens,
    capturedAtTurn: input.capturedAtTurn,
    capturedAtIso,
    contentHash,
    useCount: 0,
    signature: null,
  };
}

export interface CaptureFromTrajectoryInput {
  taskPrompt: string;
  label: string;
  /** The full per-step features from trajectory-diet's feature extractor. */
  features: readonly StepFeatures[];
  /** The advisories from trajectory-diet's advisor (LOW-influence flags). */
  advisories: readonly StepAdvisory[];
  capturedAtTurn: number;
  at?: Date;
}

/**
 * Convenience: compute the influential subset from trajectory-diet output.
 * A step is INFLUENTIAL when the advisor did NOT flag it for skipping. We key
 * the advisory set on `stepIndex` (the stable cross-session step id).
 */
export function captureSkillFromTrajectory(input: CaptureFromTrajectoryInput): Skill {
  const flagged = new Set<number>(input.advisories.map((a) => a.stepIndex));
  const influentialSteps = input.features
    .filter((f) => !flagged.has(f.stepIndex))
    .map((f) => ({
      toolName: f.toolName,
      target: f.target,
      tokenFootprint: f.stepTokenCost,
    }));
  return captureSkillFromSteps({
    taskPrompt: input.taskPrompt,
    label: input.label,
    influentialSteps,
    capturedAtTurn: input.capturedAtTurn,
    at: input.at,
  });
}

/**
 * `quality_proof` schema for skill-library, recorded under `feature_id = "f12"`.
 *
 * Two event shapes share the schema:
 *   - CAPTURE: a skill was distilled from a session.
 *   - REPLAY:  a skill was matched + guard-evaluated for a new task.
 *
 * Both are PII-safe: they carry the intent TERMS (already tokenized, not the
 * raw prompt), the skill content hash, token/cost figures, and the guard
 * verdict — never the prompt body or file contents.
 */

import type {
  ReplayGuardResult,
  Skill,
  SkillMatch,
  SkillSavingProjection,
} from "./types.js";

export const SKILL_LIBRARY_FEATURE_ID = "f12" as const;
export const QUALITY_PROOF_SCHEMA_VERSION = 1 as const;

export interface SkillCaptureProof {
  schemaVersion: 1;
  featureId: "f12";
  event: "capture";
  skillId: string;
  contentHash: string;
  label: string;
  intentTermCount: number;
  stepCount: number;
  discoveryTokens: number;
  signed: boolean;
}

export interface SkillReplayProof {
  schemaVersion: 1;
  featureId: "f12";
  event: "replay";
  skillId: string;
  contentHash: string;
  similarity: number;
  matchedTermCount: number;
  guardSafe: boolean;
  staleTargetCount: number;
  unverifiableTargetCount: number;
  savedUsdPerReuse: number | null;
}

export function buildCaptureProof(skill: Skill): SkillCaptureProof {
  return {
    schemaVersion: QUALITY_PROOF_SCHEMA_VERSION,
    featureId: SKILL_LIBRARY_FEATURE_ID,
    event: "capture",
    skillId: skill.id,
    contentHash: skill.contentHash,
    label: skill.label,
    intentTermCount: skill.intentSignature.length,
    stepCount: skill.steps.length,
    discoveryTokens: skill.discoveryTokens,
    signed: skill.signature !== null,
  };
}

export function buildReplayProof(
  match: SkillMatch,
  guard: ReplayGuardResult,
  saving: SkillSavingProjection
): SkillReplayProof {
  return {
    schemaVersion: QUALITY_PROOF_SCHEMA_VERSION,
    featureId: SKILL_LIBRARY_FEATURE_ID,
    event: "replay",
    skillId: match.skill.id,
    contentHash: match.skill.contentHash,
    similarity: match.similarity,
    matchedTermCount: match.matchedTerms.length,
    guardSafe: guard.safe,
    staleTargetCount: guard.staleTargets.length,
    unverifiableTargetCount: guard.unverifiableTargets.length,
    savedUsdPerReuse: saving.savedUsdPerReuse,
  };
}

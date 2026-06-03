/**
 * Skill provenance — content hashing + optional signing.
 *
 * Reuses @prune/replay-vault's RFC-8785 canonicalization + SHA-256 so a skill's
 * content hash is reproducible by any party and matches the compliance vault's
 * notion of "same bytes." The optional signer lets a deployment bind skills to
 * a keypair (e.g. so a team only replays skills its own CI captured); the
 * library never requires it.
 */

import { canonicalize, sha256Hex } from "@prune/replay-vault";

import type { Skill, SkillStep } from "./types.js";

/** The subset of a skill that defines its identity (hash inputs). */
interface SkillIdentity {
  label: string;
  intentSignature: readonly string[];
  steps: ReadonlyArray<Pick<SkillStep, "order" | "toolName" | "target" | "tokenFootprint">>;
}

/**
 * Deterministic content hash over a skill's identity-defining fields. Excludes
 * mutable bookkeeping (useCount, timestamps, signature) so reusing or
 * re-capturing the same logical skill yields a stable id.
 */
export function skillContentHash(identity: SkillIdentity): string {
  const canonical = canonicalize({
    label: identity.label,
    intentSignature: [...identity.intentSignature],
    steps: identity.steps.map((s) => ({
      order: s.order,
      toolName: s.toolName,
      target: s.target,
      tokenFootprint: s.tokenFootprint,
    })),
  });
  return sha256Hex(canonical);
}

/** The stable skill id is a 16-char prefix of the content hash. */
export function skillId(contentHash: string): string {
  return contentHash.slice(0, 16);
}

/**
 * Optional signer hook. A caller supplies a function that signs the content
 * hash (e.g. wrapping @prune/replay-vault's signEd25519). Kept as an injected
 * function so this package needs no key management of its own.
 */
export type SkillSigner = (contentHash: string) => string;

export function signSkill(skill: Skill, signer: SkillSigner): Skill {
  return { ...skill, signature: signer(skill.contentHash) };
}

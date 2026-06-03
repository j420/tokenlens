/**
 * @prune/skill-library (E4)
 *
 * Cross-session typed skill library. Captures the influential subset of a
 * completed trajectory (from @prune/trajectory-diet's influence labels),
 * fingerprints the task intent, and replays the typed skill on a matching
 * future task — turning O(N) per-session discovery into O(1) reuse.
 *
 * Safety by construction:
 *   - Replay is ADVISORY: the library hands the agent cached guidance; it never
 *     forces a tool call.
 *   - Replay is GUARDED: a stale freshness precondition (evaluateReplay) forces
 *     a fall-back to normal discovery.
 *   - Outcomes are GATED: @prune/equivalence compares a replayed result to the
 *     captured one when the caller wants to verify convergence.
 *   A wrong skill can at most waste the tokens of one ignored hint.
 *
 * Discipline: no regex (char-code tokenizer), no model call, deterministic,
 * provenance-hashed via @prune/replay-vault. Public surface consumed by hooks /
 * MCP server; downstream packages should not reach into source modules.
 */

export * from "./types.js";
export {
  tokenizeIntent,
  jaccard,
} from "./tokenize.js";
export {
  skillContentHash,
  skillId,
  signSkill,
  type SkillSigner,
} from "./provenance.js";
export {
  captureSkillFromSteps,
  captureSkillFromTrajectory,
  type CaptureInput,
  type CaptureFromTrajectoryInput,
} from "./capture.js";
export {
  evaluateReplay,
} from "./replay-guard.js";
export {
  SkillLibrary,
  type MatchOptions,
  type PruneOptions,
} from "./library.js";
export {
  projectSkillSaving,
  projectLibrarySaving,
} from "./savings.js";
export {
  buildCaptureProof,
  buildReplayProof,
  SKILL_LIBRARY_FEATURE_ID,
  QUALITY_PROOF_SCHEMA_VERSION,
  type SkillCaptureProof,
  type SkillReplayProof,
} from "./quality-proof.js";

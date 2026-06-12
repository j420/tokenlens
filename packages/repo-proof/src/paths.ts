/**
 * Proof-state layout — the single source of truth for where repo-proof reads
 * and writes inside a target repository. Everything lives under the target
 * repo (never the global home directory), so a proof is self-contained,
 * inspectable, and removable with one `rm -rf .prune/proof`.
 */

import { join, resolve } from "node:path";

export interface ProofPaths {
  /** Absolute repo root the proof targets. */
  repoRoot: string;
  /** `<repo>/.prune/proof` — all proof state. */
  root: string;
  /** Mining output (JSONL, one CandidateCommit per line). */
  candidates: string;
  /** Mining coverage rows (JSON array of CoverageRow). */
  coverage: string;
  /** Human-curated task manifests (`<taskId>.json`, outcome-bench schema). */
  tasksDir: string;
  /** Three-state verdicts (`<taskId>.json`). */
  verifyDir: string;
  /** Append-only trial log (outcome-bench JSONL; resume for free). */
  trialLog: string;
  /** OutcomeAnalysis JSON from the last prove run. */
  analysis: string;
  /** SignedAttestation JSON from the last prove run. */
  attestation: string;
  /** Prove run metadata (governed feature ids, abort label, model pins). */
  proveMeta: string;
  /** Verbatim governed-arm context briefs, one file per task. */
  briefsDir: string;
  /** Rendered repo-map artifact (`prune-proof map`). */
  repoMap: string;
  /** Rendered markdown report. */
  report: string;
  /** PromotionRecord (written on pass AND fail). */
  promotion: string;
  /** Repo-LOCAL feature flags file promote writes (actuation target). */
  flagsFile: string;
  /** Project Claude Code settings promote wires (actuation target). */
  settingsFile: string;
}

export function proofPaths(repoRoot: string): ProofPaths {
  const abs = resolve(repoRoot);
  const root = join(abs, ".prune", "proof");
  return {
    repoRoot: abs,
    root,
    candidates: join(root, "candidates.jsonl"),
    coverage: join(root, "coverage.json"),
    tasksDir: join(root, "tasks"),
    verifyDir: join(root, "verify"),
    trialLog: join(root, "trials.jsonl"),
    analysis: join(root, "analysis.json"),
    attestation: join(root, "attestation.json"),
    proveMeta: join(root, "prove-meta.json"),
    briefsDir: join(root, "briefs"),
    repoMap: join(root, "repo-map.md"),
    report: join(root, "report.md"),
    promotion: join(root, "promotion.json"),
    flagsFile: join(abs, ".prune", "feature-flags.json"),
    settingsFile: join(abs, ".claude", "settings.json"),
  };
}

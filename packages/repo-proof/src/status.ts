/**
 * Status — the read side of repo-proof. Assembles everything a human (or the
 * MCP tool) needs to audit a proof's state, with two disciplines:
 *
 *  - Trust nothing stored: the attestation signature is RE-VERIFIED on every
 *    read; a stored "valid" verdict is never repeated.
 *  - Degrade, never throw: every section reports null/absent for a fresh or
 *    partially-populated repo. A status read must never fail.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadManifestDir, loadTrialLog } from "@prune/outcome-bench";
import { validateFlags } from "@prune/shared";
import {
  verifyAttestation,
  type SignedAttestation,
  type VerifyResult,
} from "@prune/wastebench";
import { proofPaths, type ProofPaths } from "./paths.js";
import {
  CoverageRowSchema,
  PromotionRecordSchema,
  ThreeStateVerdictSchema,
  type CoverageRow,
  type PromotionRecord,
  type ThreeStateVerdict,
} from "./types.js";

export interface ProofState {
  repoRoot: string;
  /** Mined candidate count; null when mining has not run. */
  candidates: number | null;
  coverage: CoverageRow[] | null;
  tasks: { ready: number; draft: number; errors: number };
  verdicts: ThreeStateVerdict[];
  trials: { total: number; anyFixture: boolean } | null;
  promotion: PromotionRecord | null;
  /** Fresh re-verification of the stored attestation; null when absent. */
  attestationVerify: VerifyResult | null;
  /**
   * Promoted-feature provenance from the REPO-LOCAL flags file: id, mode,
   * and the recorded reason. null when no repo-local flags file exists.
   * Note: a user-level PRUNE_FLAGS_PATH export takes precedence over the
   * project settings env at hook runtime — provenance here describes what
   * THIS repo's settings wire up.
   */
  flagProvenance: Array<{
    id: string;
    mode: string;
    reason: string | null;
  }> | null;
  /** Verbatim brief artifacts persisted by prove (task ids). */
  briefs: string[];
}

function readJsonSafe(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function countLines(path: string): number {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

export function readProofState(repoRoot: string): ProofState {
  const paths = proofPaths(repoRoot);

  const candidates = existsSync(paths.candidates)
    ? countLines(paths.candidates)
    : null;

  let coverage: CoverageRow[] | null = null;
  const coverageRaw = readJsonSafe(paths.coverage);
  if (Array.isArray(coverageRaw)) {
    const rows: CoverageRow[] = [];
    for (const row of coverageRaw) {
      const parsed = CoverageRowSchema.safeParse(row);
      if (parsed.success) rows.push(parsed.data);
    }
    coverage = rows;
  }

  let tasks = { ready: 0, draft: 0, errors: 0 };
  if (existsSync(paths.tasksDir)) {
    const loaded = loadManifestDir(paths.tasksDir);
    tasks = {
      ready: loaded.tasks.filter((t) => t.status === "ready").length,
      draft: loaded.tasks.filter((t) => t.status === "draft").length,
      errors: loaded.errors.length,
    };
  }

  const verdicts: ThreeStateVerdict[] = [];
  if (existsSync(paths.verifyDir)) {
    for (const f of readdirSync(paths.verifyDir).sort()) {
      if (!f.endsWith(".json")) continue;
      const parsed = ThreeStateVerdictSchema.safeParse(
        readJsonSafe(join(paths.verifyDir, f))
      );
      if (parsed.success) verdicts.push(parsed.data);
    }
  }

  let trials: ProofState["trials"] = null;
  if (existsSync(paths.trialLog)) {
    const records = loadTrialLog(paths.trialLog);
    trials = {
      total: records.length,
      anyFixture: records.some((r) => r.fixture),
    };
  }

  let promotion: PromotionRecord | null = null;
  const promotionRaw = readJsonSafe(paths.promotion);
  if (promotionRaw !== null) {
    const parsed = PromotionRecordSchema.safeParse(promotionRaw);
    if (parsed.success) promotion = parsed.data;
  }

  let attestationVerify: VerifyResult | null = null;
  const attRaw = readJsonSafe(paths.attestation);
  if (attRaw !== null && typeof attRaw === "object") {
    attestationVerify = verifyAttestation(attRaw as SignedAttestation);
  }

  let flagProvenance: ProofState["flagProvenance"] = null;
  const flagsRaw = readJsonSafe(paths.flagsFile);
  if (flagsRaw !== null) {
    const flags = validateFlags(flagsRaw);
    flagProvenance = Object.entries(flags.features)
      .filter(([, s]) => s.mode === "general" && s.enabled)
      .map(([id, s]) => ({ id, mode: s.mode, reason: s.reason ?? null }));
  }

  let briefs: string[] = [];
  if (existsSync(paths.briefsDir)) {
    briefs = readdirSync(paths.briefsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();
  }

  return {
    repoRoot: paths.repoRoot,
    candidates,
    coverage,
    tasks,
    verdicts,
    trials,
    promotion,
    attestationVerify,
    flagProvenance,
    briefs,
  };
}

// ============================================================================
// Markdown rendering
// ============================================================================

export function renderStatusMd(
  state: ProofState,
  analysisReportMd: string | null
): string {
  const L: string[] = [];
  L.push(`# repo-proof status — ${state.repoRoot}`);
  L.push("");

  L.push("## Tasks");
  L.push("");
  L.push(
    `- Manifests: **${state.tasks.ready} ready**, ${state.tasks.draft} draft` +
      (state.tasks.errors > 0
        ? `, **${state.tasks.errors} invalid file(s)** (fix before proving)`
        : "")
  );
  L.push(
    `- Candidates mined: ${state.candidates === null ? "mining has not run" : state.candidates}`
  );
  L.push("");

  if (state.verdicts.length > 0) {
    L.push("## Three-state verification");
    L.push("");
    L.push("| Task | S1 (base clean) | S2 (base+hidden) | S3 (ref+hidden) | Verdict |");
    L.push("|---|---|---|---|---|");
    for (const v of state.verdicts) {
      L.push(
        `| ${v.taskId} | ${v.s1} | ${v.s2} | ${v.s3} | ${v.valid ? "VALID" : "**INVALID**"} |`
      );
    }
    L.push("");
  }

  if (state.coverage !== null && state.coverage.length > 0) {
    L.push("## Mining coverage (where this repo can prove things)");
    L.push("");
    L.push("| Group | Commits scanned | Candidates |");
    L.push("|---|---|---|");
    for (const row of state.coverage) {
      L.push(
        `| ${row.group} | ${row.commitsScanned} | ${row.candidates === 0 ? "0 — unprovable (no test-bearing fix commits in window)" : row.candidates} |`
      );
    }
    L.push("");
  }

  L.push("## Proof");
  L.push("");
  if (state.trials === null) {
    L.push("- No trials have run.");
  } else {
    L.push(
      `- Trials: ${state.trials.total}` +
        (state.trials.anyFixture
          ? " — **contains fixture records (dry-run); cannot promote**"
          : " (real)")
    );
  }
  if (state.attestationVerify !== null) {
    L.push(
      `- Attestation (re-verified fresh on this read): ${
        state.attestationVerify.valid
          ? "**valid**"
          : `**INVALID** — ${state.attestationVerify.reason}`
      }`
    );
  }
  if (state.briefs.length > 0) {
    L.push(
      `- Verbatim governed-arm briefs persisted for: ${state.briefs.join(", ")} (.prune/proof/briefs/)`
    );
  }
  L.push("");

  L.push("## Promotion");
  L.push("");
  if (state.promotion === null) {
    L.push("- No promotion decision recorded.");
  } else {
    const d = state.promotion.decision;
    L.push(
      `- Decision (${d.decidedAt}): ${d.pass ? "**PROMOTED**" : "**gates not met — honest no-op**"}`
    );
    for (const c of d.checks) {
      L.push(`  - ${c.pass ? "✓" : "✗"} ${c.id}: ${c.detail}`);
    }
    if (state.promotion.flagsPromoted.length > 0) {
      L.push(
        `- Promoted: ${state.promotion.flagsPromoted.join(", ")} (attestation sha256:${d.attestationSha256.slice(0, 12)}…)`
      );
    }
  }
  if (state.flagProvenance !== null && state.flagProvenance.length > 0) {
    L.push("- Repo-local flag provenance:");
    for (const f of state.flagProvenance) {
      L.push(`  - ${f.id} → ${f.mode}${f.reason ? ` (${f.reason})` : ""}`);
    }
    L.push(
      "- Precedence note: a user-level PRUNE_FLAGS_PATH environment export overrides this repo's settings env at hook runtime."
    );
  }
  L.push("");

  if (analysisReportMd !== null) {
    L.push("---");
    L.push("");
    L.push(analysisReportMd);
  }
  return L.join("\n");
}

/**
 * Promote — the f20 actuator. Converts a passing, attested proof into a
 * REPO-LOCAL flag promotion (`shadow → general`), with the attestation hash
 * as the auditable reason. Pure gate → pure plan → thin atomic executor.
 *
 * Gate discipline:
 *  - All five checks are ALWAYS evaluated — never short-circuited — so a
 *    failed promotion reports the complete picture, not the first miss.
 *  - Fixture data is a hard floor: dry-run numbers can never actuate.
 *  - The attestation signature is re-verified HERE, against the exact bytes
 *    that were signed; the provenance hash is sha256 over those same bytes.
 *  - A failed gate still writes promotion.json — the honest no-op leaves the
 *    same audit trail as a promotion.
 *
 * Actuation discipline:
 *  - Only the feature ids the governed arm ACTUALLY RAN are promoted (passed
 *    in from prove-meta, not re-read from a constant that may have widened
 *    since the proof was produced).
 *  - Writes are repo-local: `<repo>/.prune/feature-flags.json` plus the
 *    project `.claude/settings.json` (hook wiring via the injected canonical
 *    installer + `env.PRUNE_FLAGS_PATH` pointing hooks at the repo-local
 *    flags). The user's global `~/.prune` is never touched.
 *  - Every write is tmp+rename atomic and byte-stable (idempotent re-runs).
 */

import { createHash } from "node:crypto";
import {
  resolveFeatureId,
  validateFlags,
  withFeatureMutation,
  type TcrpFeatureFlags,
} from "@prune/shared";
import { verifyAttestation, type SignedAttestation } from "@prune/wastebench";
import type { OutcomeAnalysis } from "@prune/outcome-bench";
import type { ProofPaths } from "./paths.js";
import type {
  GateCheck,
  PromoteGateDecision,
  PromotionRecord,
} from "./types.js";
import { persistAtomic } from "./prove.js";

// ============================================================================
// Gate-input validation (artifacts read back from disk)
// ============================================================================

/**
 * Structural check of exactly the fields the gate reads, so a corrupt or
 * hand-edited analysis.json/attestation.json produces a typed REFUSAL
 * ("re-run prove") instead of a TypeError inside the gate. Deliberately not
 * a full schema: the gate must not silently depend on fields it never reads.
 */
export function parseGateInputs(
  analysisRaw: unknown,
  attestationRaw: unknown
):
  | { analysis: OutcomeAnalysis; attestation: SignedAttestation }
  | { error: string } {
  const a = analysisRaw as Partial<OutcomeAnalysis> | null;
  const finite = (x: unknown): x is number =>
    typeof x === "number" && Number.isFinite(x);
  if (
    a === null ||
    typeof a !== "object" ||
    typeof a.fixtureData !== "boolean" ||
    typeof a.metricUsed !== "string" ||
    a.wilcoxon === undefined ||
    typeof a.wilcoxon.reject !== "boolean" ||
    !finite(a.wilcoxon.pValue) ||
    a.nonInferiority === undefined ||
    typeof a.nonInferiority.reject !== "boolean" ||
    !finite(a.nonInferiority.pValue) ||
    a.preRegistration === undefined ||
    !finite(a.preRegistration.alpha) ||
    !finite(a.preRegistration.niMargin) ||
    a.power === undefined ||
    !(a.medianSavingsPct === null || finite(a.medianSavingsPct))
  ) {
    return {
      error:
        "analysis.json is missing or malformed in a gate-relevant field — re-run prove",
    };
  }
  const t = attestationRaw as Partial<SignedAttestation> | null;
  if (
    t === null ||
    typeof t !== "object" ||
    typeof t.canonical !== "string" ||
    typeof t.signature !== "string" ||
    t.manifest === undefined ||
    t.manifest.slo === undefined ||
    typeof t.manifest.slo.ok !== "boolean"
  ) {
    return {
      error:
        "attestation.json is missing or malformed in a gate-relevant field — re-run prove",
    };
  }
  return {
    analysis: a as OutcomeAnalysis,
    attestation: t as SignedAttestation,
  };
}

// ============================================================================
// Pure gate
// ============================================================================

export function evaluatePromoteGate(
  analysis: OutcomeAnalysis,
  attestation: SignedAttestation,
  opts: { now?: () => string } = {}
): PromoteGateDecision {
  const now = opts.now ?? (() => new Date().toISOString());

  const verify = verifyAttestation(attestation);
  const checks: GateCheck[] = [
    {
      id: "realData",
      pass: analysis.fixtureData === false,
      detail:
        analysis.fixtureData === false
          ? "no fixture records in the analysis"
          : "analysis contains fixture (dry-run) records — fixture numbers can never promote",
    },
    {
      id: "savingsSignificant",
      pass: analysis.wilcoxon.reject === true,
      detail: `paired Wilcoxon one-sided p = ${analysis.wilcoxon.pValue.toExponential(3)} at α = ${analysis.preRegistration.alpha} (${analysis.wilcoxon.reject ? "significant" : "not significant"}; metric: ${analysis.metricUsed})`,
    },
    {
      id: "niScreeningPass",
      pass: analysis.nonInferiority.reject === true,
      detail: `success NI at ${analysis.preRegistration.niMargin * 100}pp margin: p = ${analysis.nonInferiority.pValue.toFixed(4)} (${analysis.nonInferiority.reject ? "concluded" : "NOT concluded"}); power: ${
        analysis.power.adequatelyPowered === null
          ? "indeterminate"
          : analysis.power.adequatelyPowered
            ? "adequate"
            : `screening tier (${analysis.power.actualPerArm}/${analysis.power.requiredPerArm} per arm)`
      } — power is reported, not gated`,
    },
    {
      id: "attestationValid",
      pass: verify.valid,
      detail: verify.valid
        ? "Ed25519 signature verifies against the canonical bytes"
        : `attestation verification failed: ${verify.reason}`,
    },
    {
      id: "overheadSloPass",
      pass: attestation.manifest.slo.ok,
      detail: `reflexive overhead SLO: ${attestation.manifest.slo.reason} (ratio ${attestation.manifest.slo.overheadRatio ?? "n/a"}, budget ${attestation.manifest.slo.budget})`,
    },
  ];

  return {
    pass: checks.every((c) => c.pass),
    checks,
    attestationSha256: createHash("sha256")
      .update(attestation.canonical, "utf8")
      .digest("hex"),
    medianSavingsPct: analysis.medianSavingsPct,
    decidedAt: now(),
  };
}

// ============================================================================
// Pure planning
// ============================================================================

export interface PromotionPlan {
  decision: PromoteGateDecision;
  /** Files to write, in order. Gate fail ⇒ only promotion.json. */
  writes: Array<{ path: string; content: string }>;
  flagsPromoted: string[];
}

/**
 * Plan the promotion writes. `settingsAfterHooks` is the result of running
 * the canonical hook installer (computeHooksInstall) over the existing
 * project settings — injected so this module stays pure and free of the
 * app-local .mjs import.
 */
export function planPromotion(
  decision: PromoteGateDecision,
  governedFeatureIds: string[],
  currentFlagsRaw: unknown,
  settingsAfterHooks: unknown,
  paths: ProofPaths
): PromotionPlan {
  const recordWrite = (
    flagsPromoted: string[],
    extraWrites: Array<{ path: string; content: string }>
  ): PromotionPlan => {
    const record: PromotionRecord = {
      decision,
      flagsPromoted,
      filesWritten: [
        ...extraWrites.map((w) => w.path),
        paths.promotion,
      ],
    };
    return {
      decision,
      flagsPromoted,
      writes: [
        ...extraWrites,
        {
          path: paths.promotion,
          content: JSON.stringify(record, null, 2) + "\n",
        },
      ],
    };
  };

  if (!decision.pass) {
    return recordWrite([], []);
  }

  // Promote exactly what the governed arm ran. Unknown ids are refused, not
  // skipped silently — a typo in prove-meta must surface.
  let flags: TcrpFeatureFlags = validateFlags(currentFlagsRaw);
  const promoted: string[] = [];
  for (const rawId of governedFeatureIds) {
    const id = resolveFeatureId(rawId);
    if (id === undefined) {
      throw new Error(
        `planPromotion: governed feature id "${rawId}" is not in the TCRP registry — refusing to promote an unknown feature`
      );
    }
    flags = withFeatureMutation(
      flags,
      id,
      {
        enabled: true,
        mode: "general",
        reason: `repo-proof ${decision.decidedAt} attestation sha256:${decision.attestationSha256}`,
      },
      "local"
    );
    promoted.push(id);
  }

  // Layer env.PRUNE_FLAGS_PATH over the hook-wired settings, preserving any
  // existing env entries. The settings object is treated as opaque except
  // for the env key.
  const settingsBase =
    settingsAfterHooks && typeof settingsAfterHooks === "object"
      ? (settingsAfterHooks as Record<string, unknown>)
      : {};
  const envBase =
    settingsBase.env && typeof settingsBase.env === "object"
      ? (settingsBase.env as Record<string, unknown>)
      : {};
  const settings = {
    ...settingsBase,
    env: { ...envBase, PRUNE_FLAGS_PATH: paths.flagsFile },
  };

  return recordWrite(promoted, [
    { path: paths.flagsFile, content: JSON.stringify(flags, null, 2) + "\n" },
    {
      path: paths.settingsFile,
      content: JSON.stringify(settings, null, 2) + "\n",
    },
  ]);
}

// ============================================================================
// Thin executor
// ============================================================================

export interface ExecutePromotionDeps {
  writeAtomic?: (path: string, content: string) => void;
}

export function executePromotion(
  plan: PromotionPlan,
  deps: ExecutePromotionDeps = {}
): { written: string[] } {
  const write = deps.writeAtomic ?? persistAtomic;
  const written: string[] = [];
  for (const { path, content } of plan.writes) {
    write(path, content);
    written.push(path);
  }
  return { written };
}

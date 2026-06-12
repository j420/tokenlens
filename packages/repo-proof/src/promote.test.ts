import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRE_REGISTRATION,
  analyzeOutcomes,
  buildAttestation,
  type OutcomeAnalysis,
} from "@prune/outcome-bench";
import { isFeatureEnabled, validateFlags } from "@prune/shared";
import type { SignedAttestation } from "@prune/wastebench";

import { proofPaths } from "./paths.js";
import {
  evaluatePromoteGate,
  executePromotion,
  parseGateInputs,
  planPromotion,
} from "./promote.js";
import { syntheticMatrix } from "./synthetic-records.js";

// ============================================================================
// Shaped inputs
// ============================================================================

function realPassingProof(): {
  analysis: OutcomeAnalysis;
  attestation: SignedAttestation;
} {
  // 6 tasks × 2 arms × 10 trials, fixture: false, governed cheaper at equal
  // success — every gate should pass on this shape.
  const records = syntheticMatrix({ tasks: 6, trialsPerTask: 10, fixture: false });
  const analysis = analyzeOutcomes(records, PRE_REGISTRATION);
  const overhead = new Map(analysis.tasks.map((t) => [t.taskId, 500]));
  const attestation = buildAttestation(analysis, overhead, {
    issuedAt: "2026-06-11T00:00:00.000Z",
  });
  return { analysis, attestation };
}

const NOW = () => "2026-06-11T12:00:00.000Z";

// ============================================================================
// Gate
// ============================================================================

describe("evaluatePromoteGate", () => {
  it("passes all five checks on a real, significant, attested, SLO-clean proof", () => {
    const { analysis, attestation } = realPassingProof();
    const d = evaluatePromoteGate(analysis, attestation, { now: NOW });
    expect(d.checks.map((c) => `${c.id}:${c.pass}`)).toEqual([
      "realData:true",
      "savingsSignificant:true",
      "niScreeningPass:true",
      "attestationValid:true",
      "overheadSloPass:true",
    ]);
    expect(d.pass).toBe(true);
    expect(d.attestationSha256).toBe(
      createHash("sha256").update(attestation.canonical, "utf8").digest("hex")
    );
    expect(d.medianSavingsPct).toBeGreaterThan(0.4);
  });

  it("fixture data is a hard floor — identical numbers, fixture flag set, gate fails", () => {
    const records = syntheticMatrix({ tasks: 6, trialsPerTask: 10, fixture: true });
    const analysis = analyzeOutcomes(records, PRE_REGISTRATION);
    const attestation = buildAttestation(analysis, new Map(), {
      issuedAt: NOW(),
    });
    const d = evaluatePromoteGate(analysis, attestation, { now: NOW });
    expect(d.checks.find((c) => c.id === "realData")?.pass).toBe(false);
    expect(d.pass).toBe(false);
    // Every other check is STILL evaluated — no short-circuit.
    expect(d.checks).toHaveLength(5);
  });

  it("fails savingsSignificant when governed is more expensive (and still reports the rest)", () => {
    const records = syntheticMatrix({
      tasks: 6,
      trialsPerTask: 10,
      fixture: false,
      governedWorse: true,
    });
    const analysis = analyzeOutcomes(records, PRE_REGISTRATION);
    const attestation = buildAttestation(analysis, new Map(), { issuedAt: NOW() });
    const d = evaluatePromoteGate(analysis, attestation, { now: NOW });
    expect(d.checks.find((c) => c.id === "savingsSignificant")?.pass).toBe(false);
    expect(d.checks.find((c) => c.id === "niScreeningPass")?.pass).toBe(true);
    expect(d.pass).toBe(false);
  });

  it("fails niScreeningPass when the governed arm's success rate collapses", () => {
    const records = syntheticMatrix({
      tasks: 6,
      trialsPerTask: 10,
      fixture: false,
      governedFailTaskRatio: 0.5,
    });
    const analysis = analyzeOutcomes(records, PRE_REGISTRATION);
    const attestation = buildAttestation(analysis, new Map(), { issuedAt: NOW() });
    const d = evaluatePromoteGate(analysis, attestation, { now: NOW });
    expect(d.checks.find((c) => c.id === "niScreeningPass")?.pass).toBe(false);
    expect(d.pass).toBe(false);
  });

  it("fails attestationValid on a tampered canonical (signature re-verified here)", () => {
    const { analysis, attestation } = realPassingProof();
    const tampered: SignedAttestation = {
      ...attestation,
      canonical: attestation.canonical + " ",
    };
    const d = evaluatePromoteGate(analysis, tampered, { now: NOW });
    expect(d.checks.find((c) => c.id === "attestationValid")?.pass).toBe(false);
    expect(d.pass).toBe(false);
  });

  it("fails overheadSloPass when governance overhead swamps the savings", () => {
    const { analysis } = realPassingProof();
    // Overhead far beyond 10% of gross savings → reflexive SLO must fail.
    const hugeOverhead = new Map(
      analysis.tasks.map((t) => [t.taskId, 10_000_000])
    );
    const attestation = buildAttestation(analysis, hugeOverhead, {
      issuedAt: NOW(),
    });
    const d = evaluatePromoteGate(analysis, attestation, { now: NOW });
    expect(d.checks.find((c) => c.id === "overheadSloPass")?.pass).toBe(false);
    expect(d.pass).toBe(false);
  });
});

// ============================================================================
// Gate-input validation (disk artifacts)
// ============================================================================

describe("parseGateInputs", () => {
  it("accepts a real analysis+attestation pair (JSON round-trip safe)", () => {
    const { analysis, attestation } = realPassingProof();
    const r = parseGateInputs(
      JSON.parse(JSON.stringify(analysis)),
      JSON.parse(JSON.stringify(attestation))
    );
    expect("error" in r).toBe(false);
  });

  it("refuses corrupt/hand-edited artifacts with a typed error, never a TypeError", () => {
    const { analysis, attestation } = realPassingProof();
    const a = JSON.parse(JSON.stringify(analysis));
    const t = JSON.parse(JSON.stringify(attestation));
    for (const broken of [
      null,
      42,
      {},
      { ...a, wilcoxon: { ...a.wilcoxon, pValue: null } }, // the JSON-null trap
      { ...a, wilcoxon: null }, // null OBJECT (typeof null === "object" trap)
      { ...a, nonInferiority: null },
      { ...a, power: null },
      { ...a, power: {} }, // present but field-less
      { ...a, fixtureData: "no" },
      { ...a, nonInferiority: undefined },
      { ...a, wilcoxon: { ...a.wilcoxon, pValue: Number.NaN } }, // non-finite
    ]) {
      const r = parseGateInputs(broken, t);
      expect(r, JSON.stringify(broken)?.slice(0, 80)).toHaveProperty("error");
    }
    for (const broken of [
      null,
      {},
      { ...t, canonical: 7 },
      { ...t, manifest: {} },
      { ...t, manifest: null }, // null OBJECT again
      { ...t, manifest: { ...t.manifest, slo: null } },
    ]) {
      const r = parseGateInputs(a, broken);
      expect(r).toHaveProperty("error");
    }
  });
});

// ============================================================================
// Plan
// ============================================================================

describe("planPromotion", () => {
  const paths = proofPaths("/repo");

  it("on PASS: promotes exactly the governed ids with the attestation hash as reason, wires settings env", () => {
    const { analysis, attestation } = realPassingProof();
    const decision = evaluatePromoteGate(analysis, attestation, { now: NOW });
    const existingSettings = {
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "node x.mjs" }] }] },
      env: { EXISTING: "1" },
      unrelated: true,
    };
    const plan = planPromotion(
      decision,
      ["f15", "f16"],
      null, // no existing flags file
      existingSettings,
      paths
    );
    expect(plan.flagsPromoted).toEqual(["f15", "f16"]);
    expect(plan.writes.map((w) => w.path)).toEqual([
      paths.flagsFile,
      paths.settingsFile,
      paths.promotion,
    ]);

    // Flags content survives the shared validator and carries provenance.
    const flags = validateFlags(JSON.parse(plan.writes[0].content));
    expect(isFeatureEnabled(flags, "f15")).toBe(true);
    expect(isFeatureEnabled(flags, "f16")).toBe(true);
    expect(flags.features.f15.reason).toContain(
      `attestation sha256:${decision.attestationSha256}`
    );
    expect(flags.policySource).toBe("local");
    // f20 itself is NOT promoted — only what the governed arm ran.
    expect(isFeatureEnabled(flags, "f20")).toBe(false);

    // Settings: hooks + existing keys preserved, env layered.
    const settings = JSON.parse(plan.writes[1].content);
    expect(settings.unrelated).toBe(true);
    expect(settings.hooks).toBeDefined();
    expect(settings.env.EXISTING).toBe("1");
    expect(settings.env.PRUNE_FLAGS_PATH).toBe(paths.flagsFile);
  });

  it("accepts feature NAMES as well as ids (registry resolution)", () => {
    const { analysis, attestation } = realPassingProof();
    const decision = evaluatePromoteGate(analysis, attestation, { now: NOW });
    const plan = planPromotion(decision, ["observationMask"], null, {}, paths);
    expect(plan.flagsPromoted).toEqual(["f15"]);
  });

  it("REFUSES an unknown feature id — never promotes outside the registry", () => {
    const { analysis, attestation } = realPassingProof();
    const decision = evaluatePromoteGate(analysis, attestation, { now: NOW });
    expect(() => planPromotion(decision, ["f99"], null, {}, paths)).toThrow(
      "not in the TCRP registry"
    );
  });

  it("on FAIL: writes ONLY promotion.json (the honest no-op is still recorded)", () => {
    const records = syntheticMatrix({ tasks: 6, trialsPerTask: 10, fixture: true });
    const analysis = analyzeOutcomes(records, PRE_REGISTRATION);
    const attestation = buildAttestation(analysis, new Map(), { issuedAt: NOW() });
    const decision = evaluatePromoteGate(analysis, attestation, { now: NOW });
    const plan = planPromotion(decision, ["f15", "f16"], null, {}, paths);
    expect(plan.flagsPromoted).toEqual([]);
    expect(plan.writes.map((w) => w.path)).toEqual([paths.promotion]);
    const record = JSON.parse(plan.writes[0].content);
    expect(record.decision.pass).toBe(false);
    expect(record.filesWritten).toEqual([paths.promotion]);
  });

  it("preserves an existing repo-local flags file's unrelated mutations", () => {
    const { analysis, attestation } = realPassingProof();
    const decision = evaluatePromoteGate(analysis, attestation, { now: NOW });
    const existingFlags = validateFlags(null);
    existingFlags.features.f9 = { enabled: true, mode: "canary" };
    const plan = planPromotion(decision, ["f15"], existingFlags, {}, paths);
    const flags = validateFlags(JSON.parse(plan.writes[0].content));
    expect(flags.features.f9.mode).toBe("canary"); // untouched
    expect(flags.features.f15.mode).toBe("general");
  });
});

// ============================================================================
// Executor
// ============================================================================

describe("executePromotion", () => {
  it("writes atomically and is byte-identical on re-run (idempotent)", () => {
    const dir = mkdtempSync(join(tmpdir(), "repo-proof-promote-"));
    const paths = proofPaths(dir);
    const { analysis, attestation } = realPassingProof();
    const decision = evaluatePromoteGate(analysis, attestation, { now: NOW });
    const plan = planPromotion(decision, ["f15", "f16"], null, {}, paths);

    const first = executePromotion(plan);
    expect(first.written).toHaveLength(3);
    for (const p of first.written) expect(existsSync(p)).toBe(true);
    const bytes1 = first.written.map((p) => readFileSync(p, "utf8"));

    const second = executePromotion(plan);
    const bytes2 = second.written.map((p) => readFileSync(p, "utf8"));
    expect(bytes2).toEqual(bytes1);

    // No torn tmp files left behind.
    for (const p of first.written) {
      expect(existsSync(`${p}.tmp-${process.pid}`)).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRE_REGISTRATION,
  analyzeOutcomes,
  buildAttestation,
} from "@prune/outcome-bench";
import { validateFlags, withFeatureMutation } from "@prune/shared";

import { proofPaths } from "./paths.js";
import { readProofState, renderStatusMd } from "./status.js";
import { syntheticMatrix, syntheticTrial } from "./synthetic-records.js";

describe("readProofState", () => {
  it("degrades to all-absent on a fresh repo and renders without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "repo-proof-status-empty-"));
    const state = readProofState(dir);
    expect(state.candidates).toBeNull();
    expect(state.coverage).toBeNull();
    expect(state.tasks).toEqual({ ready: 0, draft: 0, errors: 0 });
    expect(state.verdicts).toEqual([]);
    expect(state.trials).toBeNull();
    expect(state.promotion).toBeNull();
    expect(state.attestationVerify).toBeNull();
    expect(state.flagProvenance).toBeNull();
    const md = renderStatusMd(state, null);
    expect(md).toContain("mining has not run");
    expect(md).toContain("No trials have run");
    expect(md).toContain("No promotion decision recorded");
  });

  it("reads a populated tree; the attestation is RE-verified, not trusted", () => {
    const dir = mkdtempSync(join(tmpdir(), "repo-proof-status-full-"));
    const paths = proofPaths(dir);
    mkdirSync(paths.root, { recursive: true });
    mkdirSync(paths.verifyDir, { recursive: true });
    mkdirSync(paths.briefsDir, { recursive: true });

    // Coverage + a verdict + a trial log with one fixture record.
    writeFileSync(
      paths.coverage,
      JSON.stringify([
        { group: "src/billing", commitsScanned: 10, candidates: 2 },
        { group: "src/legacy", commitsScanned: 5, candidates: 0 },
      ])
    );
    writeFileSync(
      join(paths.verifyDir, "t1.json"),
      JSON.stringify({
        taskId: "t1",
        s1: "pass",
        s2: "fail",
        s3: "pass",
        valid: true,
        checkedAt: "2026-06-11T00:00:00Z",
        failures: [],
      })
    );
    writeFileSync(
      paths.trialLog,
      JSON.stringify(
        syntheticTrial({
          taskId: "t1",
          arm: "naive",
          trialIndex: 0,
          inputTokens: 100,
          oracle: "pass",
          billedUsd: 0.1,
        })
      ) + "\n"
    );
    writeFileSync(join(paths.briefsDir, "t1.md"), "brief bytes\n");

    // A real attestation… then TAMPER with it on disk.
    const analysis = analyzeOutcomes(
      syntheticMatrix({ tasks: 6, trialsPerTask: 2, fixture: true }),
      PRE_REGISTRATION
    );
    const att = buildAttestation(analysis, new Map(), {
      issuedAt: "2026-06-11T00:00:00Z",
    });
    writeFileSync(
      paths.attestation,
      JSON.stringify({ ...att, canonical: att.canonical + "tampered" })
    );

    // Repo-local flags with provenance.
    const flags = withFeatureMutation(
      validateFlags(null),
      "f16",
      { enabled: true, mode: "general", reason: "repo-proof test attestation sha256:abc" },
      "local"
    );
    mkdirSync(join(dir, ".prune"), { recursive: true });
    writeFileSync(paths.flagsFile, JSON.stringify(flags));

    const state = readProofState(dir);
    expect(state.coverage).toHaveLength(2);
    expect(state.verdicts[0]).toMatchObject({ taskId: "t1", valid: true });
    expect(state.trials).toEqual({ total: 1, anyFixture: true });
    expect(state.briefs).toEqual(["t1"]);
    // The stored attestation was tampered: fresh verification catches it.
    expect(state.attestationVerify?.valid).toBe(false);
    // Provenance lists promoted features with reasons (f5 ships general by
    // default; f16 is the promoted one with a reason).
    const f16 = state.flagProvenance?.find((f) => f.id === "f16");
    expect(f16?.reason).toContain("sha256:abc");

    const md = renderStatusMd(state, "## embedded analysis report");
    expect(md).toContain("0 — unprovable");
    expect(md).toContain("INVALID");
    expect(md).toContain("contains fixture records (dry-run); cannot promote");
    expect(md).toContain("PRUNE_FLAGS_PATH environment export overrides");
    expect(md).toContain("embedded analysis report");
  });

  it("ignores corrupt JSON artifacts instead of throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "repo-proof-status-corrupt-"));
    const paths = proofPaths(dir);
    mkdirSync(paths.root, { recursive: true });
    writeFileSync(paths.coverage, "{ not json");
    writeFileSync(paths.promotion, "also not json");
    writeFileSync(paths.attestation, "nope");
    const state = readProofState(dir);
    expect(state.coverage).toBeNull();
    expect(state.promotion).toBeNull();
    expect(state.attestationVerify).toBeNull();
  });
});

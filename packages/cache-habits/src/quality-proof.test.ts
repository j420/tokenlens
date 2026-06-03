import { describe, expect, it } from "vitest";

import {
  buildQualityProof,
  CACHE_HABITS_FEATURE_ID,
  QUALITY_PROOF_SCHEMA_VERSION,
} from "./quality-proof.js";
import { lint } from "./linter.js";
import { buildAction, buildSnapshot } from "./test-helpers.js";

describe("buildQualityProof", () => {
  it("captures verdict, findings, totals, and inputs/snapshot for replay", () => {
    const action = buildAction({
      model: "claude-haiku-3.5",
      modelFamily: "haiku",
      pastedBlocks: [{ tokens: 5_000, source: "clipboard" }],
    });
    const snapshot = buildSnapshot({
      currentModel: "claude-sonnet-4-5-20250929",
      cacheCreationTokensSoFar: 5_000,
    });
    const report = lint(action, snapshot);
    const proof = buildQualityProof(report, action, snapshot);

    expect(proof.schemaVersion).toBe(QUALITY_PROOF_SCHEMA_VERSION);
    expect(proof.featureId).toBe(CACHE_HABITS_FEATURE_ID);
    expect(proof.verdict).toBe(report.verdict);
    expect(proof.findings.length).toBe(report.findings.length);
    expect(proof.totals.findingCount).toBe(report.findings.length);
    expect(proof.inputs.model).toBe("claude-haiku-3.5");
    expect(proof.inputs.pastedTokens).toBe(5_000);
    expect(proof.snapshot.cacheCreationTokensSoFar).toBe(5_000);
  });

  it("is deterministic across two builds of the same report", () => {
    const action = buildAction();
    const snapshot = buildSnapshot();
    const report = lint(action, snapshot);
    expect(buildQualityProof(report, action, snapshot)).toEqual(
      buildQualityProof(report, action, snapshot)
    );
  });

  it("never includes the prompt body verbatim (PII-safe)", () => {
    const sensitivePrompt = "my-secret-prompt-content-XYZ-1234";
    const action = buildAction({ promptText: sensitivePrompt });
    const snapshot = buildSnapshot();
    const report = lint(action, snapshot);
    const proof = buildQualityProof(report, action, snapshot);
    const serialized = JSON.stringify(proof);
    expect(serialized.includes(sensitivePrompt)).toBe(false);
  });
});

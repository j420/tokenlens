import { describe, expect, it } from "vitest";

import {
  buildQualityProof,
  QUALITY_PROOF_SCHEMA_VERSION,
  REPLAY_COST_FEATURE_ID,
} from "./quality-proof.js";
import { compareOutputs } from "./equivalence-gate.js";
import { planReplay } from "./whatif.js";
import { canonicalSession } from "./test-helpers.js";

describe("buildQualityProof", () => {
  it("captures divergence + cost + root hashes under f9 schema v1", () => {
    const original = canonicalSession();
    const plan = planReplay(original, { atIndex: 3, newPayload: { role: "user", content: "v" } });
    const proof = buildQualityProof(original.rootHash, plan);
    expect(proof.schemaVersion).toBe(QUALITY_PROOF_SCHEMA_VERSION);
    expect(proof.featureId).toBe(REPLAY_COST_FEATURE_ID);
    expect(proof.baselineRootHash).toBe(original.rootHash);
    expect(proof.modifiedRootHash).toBe(plan.modified.rootHash);
    expect(proof.divergence.divergenceIndex).toBe(3);
    expect(proof.cost.savedUsd).toBeCloseTo(0.0206625, 10);
    expect(proof.comparison).toBeNull();
  });

  it("includes the output comparison when supplied", () => {
    const original = canonicalSession();
    const plan = planReplay(original, { atIndex: 3, newPayload: { role: "user", content: "v" } });
    const cmp = compareOutputs("same output", "same output");
    const proof = buildQualityProof(original.rootHash, plan, cmp);
    expect(proof.comparison).not.toBeNull();
    expect(proof.comparison!.verdict).toBe("no_change");
  });

  it("is PII-safe — never serializes segment payloads or output text", () => {
    const original = canonicalSession();
    const secret = "SENSITIVE-PROMPT-CONTENT-9f3a";
    const plan = planReplay(original, {
      atIndex: 3,
      newPayload: { role: "user", content: secret },
    });
    const cmp = compareOutputs("OUTPUT-SECRET-zzz", "OUTPUT-SECRET-yyy");
    const proof = buildQualityProof(original.rootHash, plan, cmp);
    const serialized = JSON.stringify(proof);
    expect(serialized.includes(secret)).toBe(false);
    expect(serialized.includes("OUTPUT-SECRET")).toBe(false);
  });

  it("is deterministic across two builds of the same plan", () => {
    const original = canonicalSession();
    const plan = planReplay(original, { atIndex: 3, newPayload: { role: "user", content: "v" } });
    expect(buildQualityProof(original.rootHash, plan)).toEqual(
      buildQualityProof(original.rootHash, plan)
    );
  });
});

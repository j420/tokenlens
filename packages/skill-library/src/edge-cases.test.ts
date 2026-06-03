/**
 * Adversarial probes for skill-library. Phase 7 hard rule #5.
 */

import { describe, expect, it } from "vitest";

import { SkillLibrary } from "./library.js";
import { captureSkillFromSteps } from "./capture.js";
import { evaluateReplay } from "./replay-guard.js";
import { tokenizeIntent, jaccard } from "./tokenize.js";
import { signSkill } from "./provenance.js";
import { crudSkill, makeSkill } from "./test-helpers.js";

describe("edge — matcher robustness", () => {
  it("an empty-term task matches nothing (no NaN similarity)", () => {
    const lib = new SkillLibrary();
    lib.add(crudSkill());
    // A prompt of only stop-words / short tokens → empty signature.
    const matches = lib.match("a to be it", { threshold: 0.01 });
    expect(matches).toEqual([]);
  });

  it("a skill captured from an empty-term prompt has an empty signature and never matches", () => {
    const skill = captureSkillFromSteps({
      taskPrompt: "a to be",
      label: "degenerate",
      influentialSteps: [{ toolName: "Read", target: "f", tokenFootprint: 1 }],
      capturedAtTurn: 1,
    });
    expect(skill.intentSignature).toEqual([]);
    const lib = new SkillLibrary([skill]);
    expect(lib.match("add crud endpoint router", { threshold: 0.01 })).toEqual([]);
  });

  it("identical prompts yield similarity 1.0", () => {
    const lib = new SkillLibrary();
    lib.add(crudSkill());
    const matches = lib.match("add a new CRUD endpoint for invoices to the REST router", {
      threshold: 0.99,
    });
    expect(matches[0]!.similarity).toBe(1);
  });

  it("match is a pure read — does not bump useCount", () => {
    const lib = new SkillLibrary();
    const s = crudSkill();
    lib.add(s);
    lib.match("add a CRUD endpoint for invoices", { threshold: 0.1 });
    expect(lib.get(s.contentHash)!.useCount).toBe(0);
  });
});

describe("edge — provenance + signing", () => {
  it("signSkill attaches a signature without changing the content hash", () => {
    const s = crudSkill();
    const signed = signSkill(s, (hash) => `sig(${hash.slice(0, 8)})`);
    expect(signed.signature).toBe(`sig(${s.contentHash.slice(0, 8)})`);
    expect(signed.contentHash).toBe(s.contentHash);
  });

  it("two skills differing only in step ORDER hash differently", () => {
    const a = makeSkill("task crud endpoint router", "x", [
      { toolName: "Read", target: "a", tokenFootprint: 1 },
      { toolName: "Edit", target: "b", tokenFootprint: 2 },
    ]);
    const b = makeSkill("task crud endpoint router", "x", [
      { toolName: "Edit", target: "b", tokenFootprint: 2 },
      { toolName: "Read", target: "a", tokenFootprint: 1 },
    ]);
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

describe("edge — replay guard corner cases", () => {
  it("duplicate targets across steps are deduped in the guard", () => {
    // crudSkill reads src/router.ts AND edits src/router.ts → one unique target.
    const skill = crudSkill();
    const r = evaluateReplay(
      skill,
      [{ target: "src/router.ts", freshnessToken: "A" }, { target: "src/models/invoice.ts", freshnessToken: "B" }],
      [{ target: "src/router.ts", freshnessToken: "A" }, { target: "src/models/invoice.ts", freshnessToken: "B" }]
    );
    expect(r.safe).toBe(true);
    // router.ts appears in two steps but is checked once (no duplicate in stale list).
    expect(r.staleTargets).toEqual([]);
  });

  it("captured precondition missing → unverifiable (no false 'safe')", () => {
    const skill = crudSkill();
    const r = evaluateReplay(
      skill,
      [{ target: "src/router.ts", freshnessToken: "A" }], // invoice.ts has no baseline
      [{ target: "src/router.ts", freshnessToken: "A" }, { target: "src/models/invoice.ts", freshnessToken: "B" }]
    );
    expect(r.safe).toBe(false);
    expect(r.unverifiableTargets).toContain("src/models/invoice.ts");
  });
});

describe("edge — tokenizer/jaccard invariants", () => {
  it("tokenizer never emits a sub-minLength term", () => {
    for (const t of tokenizeIntent("ab cd ef ghi jklmn")) {
      expect(t.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("jaccard of a set with itself is exactly 1", () => {
    const terms = tokenizeIntent("refactor the auth middleware and rate limiter");
    expect(jaccard(terms, terms).similarity).toBe(1);
  });
});

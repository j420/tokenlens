import { describe, expect, it } from "vitest";
import {
  compareInventories,
  evaluateRewardIntegrity,
  maxSeverity,
} from "./integrity.js";
import { inventoryAssertions } from "./assertions.js";
import type { ProposedWrite } from "./types.js";

const inv = (code: string) => inventoryAssertions(code, "ts");

describe("maxSeverity", () => {
  it("orders violation > suspicious > ok", () => {
    expect(maxSeverity("ok", "suspicious")).toBe("suspicious");
    expect(maxSeverity("suspicious", "violation")).toBe("violation");
    expect(maxSeverity("violation", "ok")).toBe("violation");
  });
});

describe("compareInventories", () => {
  it("flags tautology introduction as a violation", () => {
    const before = inv(`expect(sum(2,2)).toBe(4);`);
    const after = inv(`expect(true).toBe(true);`);
    const v = compareInventories(before, after);
    expect(v.severity).toBe("violation");
    expect(v.findings.some((f) => f.code === "tautology_introduced")).toBe(true);
  });

  it("flags assertion removal as suspicious (not violation)", () => {
    const before = inv(`expect(a).toBe(1); expect(b).toBe(2);`);
    const after = inv(`expect(a).toBe(1);`);
    const v = compareInventories(before, after);
    expect(v.severity).toBe("suspicious");
    expect(v.findings.some((f) => f.code === "assertions_removed")).toBe(true);
  });

  it("flags newly disabled tests as suspicious", () => {
    const before = inv(`it("a", () => { expect(x).toBe(1); });`);
    const after = inv(`it.skip("a", () => { expect(x).toBe(1); });`);
    const v = compareInventories(before, after);
    expect(v.findings.some((f) => f.code === "tests_disabled")).toBe(true);
  });

  it("returns ok for a legitimate refactor that keeps the assertions", () => {
    const before = inv(`it("a", () => { expect(add(1,2)).toBe(3); });`);
    const after = inv(`it("adds", () => { const r = add(1,2); expect(r).toBe(3); });`);
    const v = compareInventories(before, after);
    expect(v.severity).toBe("ok");
    expect(v.findings).toHaveLength(0);
  });

  it("returns ok when assertions are ADDED", () => {
    const before = inv(`expect(a).toBe(1);`);
    const after = inv(`expect(a).toBe(1); expect(b).toBe(2);`);
    expect(compareInventories(before, after).severity).toBe("ok");
  });

  it("is inconclusive (never violation) when the after side won't parse", () => {
    const before = inv(`expect(a).toBe(1);`);
    const after = inventoryAssertions(`this ( is { not code`, "ts");
    const v = compareInventories(before, after);
    expect(v.severity).toBe("inconclusive");
  });

  it("flags a brand-new file full of tautologies", () => {
    const after = inv(`it("x", () => { expect(true).toBe(true); });`);
    const v = compareInventories(null, after);
    expect(v.severity).toBe("violation");
  });
});

describe("evaluateRewardIntegrity", () => {
  it("flags a write to a designated grader as a violation", () => {
    const write: ProposedWrite = {
      path: "repo/eval/grader.ts",
      before: "export const grade = () => true;",
      after: "export const grade = () => true; // tweak",
    };
    const r = evaluateRewardIntegrity(write, { graderPaths: ["eval/grader.ts"] });
    expect(r.isGrader).toBe(true);
    expect(r.severity).toBe("violation");
    expect(r.findings.some((f) => f.code === "grader_write")).toBe(true);
  });

  it("runs the structural verdict for a test file", () => {
    const write: ProposedWrite = {
      path: "src/auth.test.ts",
      before: `expect(login()).toBe(true);`,
      after: `expect(true).toBe(true);`,
    };
    const r = evaluateRewardIntegrity(write);
    expect(r.isTestFile).toBe(true);
    expect(r.severity).toBe("violation");
  });

  it("flags test-file deletion as suspicious", () => {
    const write: ProposedWrite = {
      path: "src/auth.test.ts",
      before: `expect(x).toBe(1);`,
      after: null,
    };
    const r = evaluateRewardIntegrity(write);
    expect(r.findings.some((f) => f.code === "test_file_deleted")).toBe(true);
  });

  it("returns ok/no-verdict for an ordinary source write", () => {
    const write: ProposedWrite = {
      path: "src/auth.ts",
      before: "export const x = 1;",
      after: "export const x = 2;",
    };
    const r = evaluateRewardIntegrity(write);
    expect(r.isTestFile).toBe(false);
    expect(r.isGrader).toBe(false);
    expect(r.verdict).toBeNull();
    expect(r.severity).toBe("ok");
  });
});

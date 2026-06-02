import { describe, expect, it } from "vitest";
import { runEquivalenceHarness, type CodeModeTaskOutcome } from "./equivalence-harness.js";

const TASK = (
  taskId: string,
  control: string,
  treatment: string,
  cb = control.length,
  tb = treatment.length
): CodeModeTaskOutcome => ({
  taskId,
  controlOutput: control,
  treatmentOutput: treatment,
  controlBytes: cb,
  treatmentBytes: tb,
});

describe("runEquivalenceHarness — empty corpus", () => {
  it("returns zero counts, 0 passRate, no NaN", () => {
    const r = runEquivalenceHarness([]);
    expect(r.totalTasks).toBe(0);
    expect(r.equivalentCount).toBe(0);
    expect(r.passRate).toBe(0);
    expect(Number.isFinite(r.meanReductionPct)).toBe(true);
    expect(r.meanReductionPct).toBe(0);
  });
});

describe("runEquivalenceHarness — basic verdicts", () => {
  it("byte-identical outputs ⇒ equivalent", () => {
    const r = runEquivalenceHarness([TASK("t1", "result", "result", 100, 20)]);
    expect(r.equivalentCount).toBe(1);
    expect(r.passRate).toBe(1);
    expect(r.verdicts[0]!.byteReduction).toBe(80);
    expect(r.verdicts[0]!.reductionPct).toBe(80);
  });

  it("clearly different outputs ⇒ not_equivalent", () => {
    const r = runEquivalenceHarness([
      TASK("t1", "hello world", "totally different output bytes here"),
    ]);
    expect(r.notEquivalentCount).toBe(1);
    expect(r.passRate).toBe(0);
  });

  it("similar prose may match under default text strategy", () => {
    // Same content with whitespace difference — text strategy tolerates it
    const r = runEquivalenceHarness([
      TASK("t1", "hello world", "hello  world"),
    ]);
    expect(r.equivalentCount + r.notEquivalentCount).toBe(1);
  });
});

describe("runEquivalenceHarness — execution errors", () => {
  it("execution error ⇒ verdict=error, never equivalent", () => {
    const outcomes: CodeModeTaskOutcome[] = [
      {
        taskId: "t1",
        controlOutput: "a",
        treatmentOutput: "a",
        controlBytes: 1,
        treatmentBytes: 1,
        executionError: { kind: "denied_fs", message: "fs.read denied" },
      },
    ];
    const r = runEquivalenceHarness(outcomes);
    expect(r.errorCount).toBe(1);
    expect(r.equivalentCount).toBe(0);
    expect(r.verdicts[0]!.verdict).toBe("error");
    expect(r.sandboxEscapeAttempts).toBe(1);
  });

  it("non-denied execution errors don't count as sandbox escapes", () => {
    const outcomes: CodeModeTaskOutcome[] = [
      {
        taskId: "t1",
        controlOutput: "a",
        treatmentOutput: "a",
        controlBytes: 1,
        treatmentBytes: 1,
        executionError: { kind: "result_too_large", message: "x" },
      },
    ];
    const r = runEquivalenceHarness(outcomes);
    expect(r.sandboxEscapeAttempts).toBe(0);
  });
});

describe("runEquivalenceHarness — aggregation", () => {
  it("mean reduction percentage uses total bytes, not per-task average", () => {
    const r = runEquivalenceHarness([
      TASK("t1", "x", "y", 100, 50),
      TASK("t2", "x", "y", 200, 100),
    ]);
    // (300 - 150) / 300 = 50%
    expect(r.meanReductionPct).toBeCloseTo(50, 5);
  });

  it("pass rate over a mixed corpus", () => {
    const r = runEquivalenceHarness([
      TASK("t1", "a", "a"),
      TASK("t2", "b", "b"),
      TASK("t3", "completely orthogonal A", "completely different B output"),
    ]);
    expect(r.passRate).toBeCloseTo(2 / 3, 5);
  });
});

describe("runEquivalenceHarness — malformed outcomes", () => {
  it("non-object outcome counts as error without throwing", () => {
    const r = runEquivalenceHarness([null as never]);
    expect(r.errorCount).toBe(1);
  });

  it("negative controlBytes is rejected", () => {
    const r = runEquivalenceHarness([
      {
        taskId: "t1",
        controlOutput: "a",
        treatmentOutput: "a",
        controlBytes: -1,
        treatmentBytes: 1,
      },
    ]);
    expect(r.errorCount).toBe(1);
  });

  it("non-string taskId becomes <malformed> in the verdict", () => {
    const r = runEquivalenceHarness([
      { taskId: 42 as never, controlOutput: "", treatmentOutput: "" } as never,
    ]);
    expect(r.verdicts[0]!.taskId).toBe("<malformed>");
  });
});

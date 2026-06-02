/**
 * Equivalence-proof harness for code-mode vs direct-tool-call.
 *
 * For each task in the corpus:
 *   1. Run the "control" path: the agent calls one or more MCP tools
 *      directly, the outputs are concatenated.
 *   2. Run the "treatment" path: the agent emits a code-mode script;
 *      we execute it in the sandbox; the script makes the same tool
 *      calls and returns a result.
 *   3. Compare control vs treatment via @prune/equivalence (configurable
 *      strategy; default `equivalent()` dispatcher with code-detection).
 *
 * Aggregates:
 *   - per-task verdict (equivalent | not_equivalent | error)
 *   - pass rate
 *   - token reduction estimate (sum of stringified-tool-call bytes
 *     vs sum of code-mode-script bytes + final-result bytes)
 *   - sandbox-escape probe count (failed executions where the error
 *     kind was a denied global access)
 *
 * Pure logic: the harness does NOT call any model — the caller
 * supplies both arms' outputs. The harness verifies equivalence.
 *
 * This is the safety net the user sees: "98.7% Anthropic-reported
 * reduction is great, but show me that the answer doesn't change."
 * The harness *is* the proof.
 */

import { equivalent, type EquivalenceOptions } from "@prune/equivalence";

export interface CodeModeTaskOutcome {
  taskId: string;
  /** Original tool-call path output (e.g., concatenated tool outputs). */
  controlOutput: string;
  /** Code-mode script output (the script's return value, stringified). */
  treatmentOutput: string;
  /** Bytes of the equivalent direct-tool-call exchange. */
  controlBytes: number;
  /** Bytes of the code-mode script + final result. */
  treatmentBytes: number;
  /**
   * Any error encountered during code-mode execution. When set,
   * the verdict is forced to "error" regardless of output similarity.
   */
  executionError?: { kind: string; message: string };
}

export interface TaskVerdict {
  taskId: string;
  verdict: "equivalent" | "not_equivalent" | "error";
  similarity: number;
  strategy: string;
  controlBytes: number;
  treatmentBytes: number;
  byteReduction: number;
  reductionPct: number;
  detail?: Record<string, unknown>;
}

export interface HarnessReport {
  totalTasks: number;
  equivalentCount: number;
  notEquivalentCount: number;
  errorCount: number;
  /** equivalentCount / totalTasks; 0 when totalTasks=0. */
  passRate: number;
  totalControlBytes: number;
  totalTreatmentBytes: number;
  /** (totalControlBytes - totalTreatmentBytes) / totalControlBytes. */
  meanReductionPct: number;
  /** Sandbox-escape probes: executionErrors whose kind starts with "denied_". */
  sandboxEscapeAttempts: number;
  verdicts: TaskVerdict[];
}

export interface HarnessOptions {
  equivalence?: EquivalenceOptions;
}

export function runEquivalenceHarness(
  outcomes: ReadonlyArray<CodeModeTaskOutcome>,
  options: HarnessOptions = {}
): HarnessReport {
  const verdicts: TaskVerdict[] = [];
  let totalControlBytes = 0;
  let totalTreatmentBytes = 0;
  let equivalentCount = 0;
  let notEquivalentCount = 0;
  let errorCount = 0;
  let sandboxEscapeAttempts = 0;

  for (const o of outcomes) {
    if (!isWellFormed(o)) {
      errorCount += 1;
      verdicts.push({
        taskId: typeof o?.taskId === "string" ? o.taskId : "<malformed>",
        verdict: "error",
        similarity: 0,
        strategy: "byte",
        controlBytes: 0,
        treatmentBytes: 0,
        byteReduction: 0,
        reductionPct: 0,
        detail: { reason: "malformed_outcome" },
      });
      continue;
    }

    totalControlBytes += o.controlBytes;
    totalTreatmentBytes += o.treatmentBytes;

    if (o.executionError) {
      errorCount += 1;
      if (
        typeof o.executionError.kind === "string" &&
        o.executionError.kind.startsWith("denied_")
      ) {
        sandboxEscapeAttempts += 1;
      }
      verdicts.push({
        taskId: o.taskId,
        verdict: "error",
        similarity: 0,
        strategy: "byte",
        controlBytes: o.controlBytes,
        treatmentBytes: o.treatmentBytes,
        byteReduction: o.controlBytes - o.treatmentBytes,
        reductionPct: reductionPct(o.controlBytes, o.treatmentBytes),
        detail: { error: o.executionError },
      });
      continue;
    }

    const eq = equivalent(o.controlOutput, o.treatmentOutput, options.equivalence);
    if (eq.equivalent) {
      equivalentCount += 1;
    } else {
      notEquivalentCount += 1;
    }
    verdicts.push({
      taskId: o.taskId,
      verdict: eq.equivalent ? "equivalent" : "not_equivalent",
      similarity: eq.similarity,
      strategy: eq.strategy,
      controlBytes: o.controlBytes,
      treatmentBytes: o.treatmentBytes,
      byteReduction: o.controlBytes - o.treatmentBytes,
      reductionPct: reductionPct(o.controlBytes, o.treatmentBytes),
      detail: eq.detail,
    });
  }

  const totalTasks = outcomes.length;
  return {
    totalTasks,
    equivalentCount,
    notEquivalentCount,
    errorCount,
    passRate: totalTasks > 0 ? equivalentCount / totalTasks : 0,
    totalControlBytes,
    totalTreatmentBytes,
    meanReductionPct: reductionPct(totalControlBytes, totalTreatmentBytes),
    sandboxEscapeAttempts,
    verdicts,
  };
}

function isWellFormed(o: CodeModeTaskOutcome): boolean {
  if (!o || typeof o !== "object") return false;
  if (typeof o.taskId !== "string" || o.taskId.length === 0) return false;
  if (typeof o.controlOutput !== "string") return false;
  if (typeof o.treatmentOutput !== "string") return false;
  if (!Number.isFinite(o.controlBytes) || o.controlBytes < 0) return false;
  if (!Number.isFinite(o.treatmentBytes) || o.treatmentBytes < 0) return false;
  return true;
}

function reductionPct(control: number, treatment: number): number {
  if (!Number.isFinite(control) || control <= 0) return 0;
  const pct = ((control - treatment) / control) * 100;
  if (!Number.isFinite(pct)) return 0;
  return pct;
}

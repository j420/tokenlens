/**
 * Shared result types. Scenarios are pure functions that return a ScenarioResult;
 * the .test.ts files assert on it and report.ts/demo.ts render it. One source of
 * truth — assertions and the narrated demo never drift apart.
 */

export type StepStatus = "ok" | "warn" | "block" | "info";

/** A single invariant the step proves. Efficacy = all checks passed. */
export interface Check {
  label: string;
  passed: boolean;
}

/**
 * Code-quality-degradation signal from the feature's OWN gate.
 *   preserved === true  → the transform proved non-degrading (e.g. isValid,
 *                         diffVerified, lossless, equivalent).
 *   preserved === false → degradation/loss occurred.
 *   preserved === null  → not a transform / no quality gate applies (n/a).
 */
export interface Quality {
  label: string;
  preserved: boolean | null;
  detail?: string;
}

export interface Step {
  /** Short label, e.g. "Smart Copy" or "cache_habits_from_transcript → Opus". */
  name: string;
  /** One-line, human-readable account of what happened (the demo prints this). */
  detail: string;
  /** Outcome flavor, drives the demo's glyphs. */
  status: StepStatus;
  /** The real input fed to the feature (shown in the UI, expandable). */
  input?: unknown;
  /** The real output the feature returned (shown in the UI, expandable). */
  output?: unknown;
  /** Invariants this step proves — the single source of truth for efficacy. */
  checks?: Check[];
  /** Quality / no-degradation signal from the feature's own gate, or null. */
  quality?: Quality | null;
  /** Structured outputs the tests assert on (real values from real cores). */
  data?: Record<string, unknown>;
}

export interface ScenarioResult {
  /** Flow name: "Extension" | "MCP" | "Hooks" | "Dashboard" | "Edge Cases". */
  flow: string;
  /** One-line headline for the demo section. */
  summary: string;
  steps: Step[];
}

export function step(
  name: string,
  status: StepStatus,
  detail: string,
  data?: Record<string, unknown>
): Step {
  return { name, status, detail, data };
}

/** Fraction of a step's checks that passed (1 when there are no checks). */
export function efficacy(s: Step): number {
  if (!s.checks || s.checks.length === 0) return 1;
  return s.checks.filter((c) => c.passed).length / s.checks.length;
}

/** True when every check passed — i.e. the feature did its job 100%. */
export function passedFully(s: Step): boolean {
  return !!s.checks && s.checks.length > 0 && s.checks.every((c) => c.passed);
}

/** All steps whose feature gate reports degradation (quality.preserved === false). */
export function degradations(results: ScenarioResult[]): Step[] {
  return results.flatMap((r) => r.steps).filter((s) => s.quality?.preserved === false);
}

/** Find a step by exact name (tests use this to assert on a specific step). */
export function findStep(result: ScenarioResult, name: string): Step {
  const s = result.steps.find((x) => x.name === name);
  if (!s) {
    throw new Error(
      `step "${name}" not found in flow "${result.flow}". Steps: ${result.steps
        .map((x) => x.name)
        .join(", ")}`
    );
  }
  return s;
}

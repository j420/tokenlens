/**
 * Shared result types. Scenarios are pure functions that return a ScenarioResult;
 * the .test.ts files assert on it and report.ts/demo.ts render it. One source of
 * truth — assertions and the narrated demo never drift apart.
 */

export type StepStatus = "ok" | "warn" | "block" | "info";

export interface Step {
  /** Short label, e.g. "Smart Copy" or "cache_habits_from_transcript → Opus". */
  name: string;
  /** One-line, human-readable account of what happened (the demo prints this). */
  detail: string;
  /** Outcome flavor, drives the demo's glyphs. */
  status: StepStatus;
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

/**
 * F4 — bench runner.
 *
 * The bench replays the user's own prompts through candidate models and scores
 * the outputs. Actually executing a model requires a live API (the Anthropic
 * SDK + a key) and a shadow-spend budget — that orchestration belongs to the
 * agent-sdk-adapter and is NOT exercised in CI. This module defines the
 * BenchRunner contract and a deterministic FixtureRunner so the scoring +
 * recommender pipeline is fully testable without any network call.
 *
 * Honesty note: there is no faked live runner here. A live runner is a thin
 * adapter that implements BenchRunner over a real SDK client; until it exists,
 * the bench runs on captured fixtures only.
 */

import type { BenchExecution } from "./scoring.js";

export interface BenchPrompt {
  promptId: string;
  clusterId: string;
  /** The full prompt/context to replay. */
  prompt: string;
  /** The user's accepted output for this prompt — the quality reference. */
  referenceOutput: string;
  /** Whether a test suite ran for the reference, and its result. */
  referenceTestPassed: boolean | null;
}

export interface BenchRunner {
  /** Execute one prompt against one model, returning the realized output+cost. */
  run(prompt: BenchPrompt, model: string): Promise<BenchExecution>;
}

/**
 * Deterministic runner backed by pre-recorded executions. Keyed by
 * `${promptId}::${model}`. Throws on a missing key so tests can't silently
 * pass on absent data.
 */
export class FixtureRunner implements BenchRunner {
  private readonly fixtures: Map<string, BenchExecution>;

  constructor(executions: BenchExecution[]) {
    this.fixtures = new Map(
      executions.map((e) => [`${e.promptId}::${e.model}`, e])
    );
  }

  async run(prompt: BenchPrompt, model: string): Promise<BenchExecution> {
    const key = `${prompt.promptId}::${model}`;
    const hit = this.fixtures.get(key);
    if (!hit) {
      throw new Error(`FixtureRunner: no execution recorded for ${key}`);
    }
    return hit;
  }
}

export interface BenchPlan {
  clusterId: string;
  prompts: BenchPrompt[];
  /** Models to evaluate (includes the baseline). */
  models: string[];
  /** Per-day shadow-spend cap; the orchestrator must honor it. */
  dailyBudgetUsd?: number;
}

export interface BenchRunSummary {
  clusterId: string;
  /** Raw executions, ready to be scored. */
  executions: BenchExecution[];
  /** Reference outputs keyed by promptId, for scoring. */
  references: Map<string, BenchPrompt>;
  modelsRun: string[];
}

/**
 * Run a bench plan through a runner, collecting executions. Pure orchestration
 * over whatever runner is supplied (fixture in tests, live adapter in prod).
 */
export async function runBenchPlan(
  plan: BenchPlan,
  runner: BenchRunner
): Promise<BenchRunSummary> {
  const executions: BenchExecution[] = [];
  const references = new Map<string, BenchPrompt>();
  for (const prompt of plan.prompts) {
    references.set(prompt.promptId, prompt);
    for (const model of plan.models) {
      executions.push(await runner.run(prompt, model));
    }
  }
  return {
    clusterId: plan.clusterId,
    executions,
    references,
    modelsRun: plan.models,
  };
}

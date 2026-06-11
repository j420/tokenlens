/**
 * Deterministic fixture suite for dry-run mode.
 *
 * Generates synthetic Claude Code transcripts (valid against the
 * @prune/telemetry schema) with HARDCODED usage numbers, so the entire
 * pipeline — accounting, stats, report, attestation — can be exercised with
 * zero model spend and byte-stable expectations. Every record produced from
 * these transcripts is marked `fixture: true`; the report banners it.
 *
 * The numbers are deliberately shaped like the hypothesis (governed arm
 * cheaper, success parity) because the fixtures test the PIPELINE, not the
 * claim. They are not evidence and the report says so.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskManifest } from "./types.js";
import { trialKey, type FixtureCell } from "./runner.js";

/** A model present in the strict pricing table (USD path exercised). */
export const FIXTURE_PRICED_MODEL = "claude-sonnet-4-5-20250929";
/** A model absent from the pricing table (null-honest path exercised). */
export const FIXTURE_UNPRICED_MODEL = "fixture-unpriced-model";

const SYNTHETIC_SHA = "0000000000000000000000000000000000000000";

export function fixtureTask(taskId: string, prompt: string): TaskManifest {
  return {
    taskId,
    track: "self",
    status: "ready",
    repoUrl: null,
    baseCommit: SYNTHETIC_SHA,
    testRefCommit: SYNTHETIC_SHA,
    testPaths: [],
    setupCmds: [],
    prompt,
    oracleCmd: "true",
    oracleCwd: ".",
    intentClass: "debug",
    referenceCommit: SYNTHETIC_SHA,
    maxTurns: 40,
    maxBudgetUsd: 2,
    cutoffSafe: true,
    notes: "synthetic fixture task — dry-run only, never a real workspace",
  };
}

interface TranscriptSpec {
  model: string;
  /** Per-assistant-step usage rows. */
  steps: Array<{
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreate?: number;
    readFile?: string;
    text?: string;
  }>;
}

function renderTranscript(spec: TranscriptSpec): string {
  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "Fix the failing behavior." },
      timestamp: "2026-06-11T00:00:00Z",
      sessionId: "fixture-session",
    })
  );
  spec.steps.forEach((s, i) => {
    const content: unknown[] = [];
    if (s.readFile) {
      content.push({
        type: "tool_use",
        id: `tu-${i}`,
        name: "Read",
        input: { file_path: s.readFile },
      });
    }
    content.push({
      type: "text",
      text: s.text ?? `step ${i + 1}`,
    });
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content,
          usage: {
            input_tokens: s.input,
            output_tokens: s.output,
            cache_read_input_tokens: s.cacheRead ?? 0,
            cache_creation_input_tokens: s.cacheCreate ?? 0,
          },
          model: spec.model,
        },
        timestamp: `2026-06-11T00:00:${String(i + 1).padStart(2, "0")}Z`,
        sessionId: "fixture-session",
      })
    );
    if (s.readFile) {
      lines.push(
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: `tu-${i}`,
                content: `contents of ${s.readFile}`,
              },
            ],
          },
          timestamp: `2026-06-11T00:00:${String(i + 1).padStart(2, "0")}Z`,
          sessionId: "fixture-session",
        })
      );
    }
  });
  return lines.join("\n") + "\n";
}

export interface FixtureSuite {
  tasks: TaskManifest[];
  cells: Map<string, FixtureCell>;
}

/**
 * The standard 3-task × 2-arm × K=2 suite on a PRICED model. Shapes:
 *  - governed arm ~60-75% cheaper with explicit overhead tokens on the books;
 *  - success parity except one discordant task (naive fail, governed pass)
 *    and one governed-arm single-trial failure (exercises non-perfect rates).
 */
export function writeFixtureSuite(dir: string): FixtureSuite {
  mkdirSync(dir, { recursive: true });
  const tasks = [
    fixtureTask("fx-cache-rule", "Fix the cache rule false positive."),
    fixtureTask("fx-cusum-drift", "Fix the CUSUM drift detection bug."),
    fixtureTask("fx-ledger-null", "Fix the ledger null-cost rollup."),
  ];
  const cells = new Map<string, FixtureCell>();

  const put = (
    taskId: string,
    arm: "naive" | "governed",
    k: number,
    spec: TranscriptSpec,
    oracle: "pass" | "fail",
    overheadTokens = 0
  ): void => {
    const path = join(dir, `${taskId}-${arm}-${k}.jsonl`);
    writeFileSync(path, renderTranscript(spec));
    cells.set(trialKey(taskId, arm, k), {
      transcriptPath: path,
      oracle,
      overheadTokens,
      wallTimeMs: 60_000,
    });
  };

  const naiveSteps = (file: string) => [
    { input: 12_000, output: 900, cacheCreate: 2_000, readFile: file },
    { input: 14_000, output: 1_100, cacheRead: 8_000, readFile: file },
    { input: 16_000, output: 1_300, cacheRead: 9_000, text: `patched ${file}` },
  ];
  const governedSteps = (file: string) => [
    { input: 4_000, output: 700, cacheCreate: 1_200, readFile: file },
    { input: 5_000, output: 900, cacheRead: 3_000, text: `patched ${file}` },
  ];

  for (const [i, t] of tasks.entries()) {
    const file = `packages/example-${i}/src/core.ts`;
    for (const k of [0, 1]) {
      // Naive: more steps, more tokens; fails both trials of task 2.
      put(
        t.taskId,
        "naive",
        k,
        { model: FIXTURE_PRICED_MODEL, steps: naiveSteps(file) },
        i === 2 ? "fail" : "pass"
      );
      // Governed: cheaper; one single-trial failure on task 1, trial 1.
      put(
        t.taskId,
        "governed",
        k,
        { model: FIXTURE_PRICED_MODEL, steps: governedSteps(file) },
        i === 1 && k === 1 ? "fail" : "pass",
        450 // brief + advisory injection, on the books as overhead
      );
    }
  }
  return { tasks, cells };
}

/** One task on an UNPRICED model — forces the token-metric fallback. */
export function writeUnpricedFixture(dir: string): FixtureSuite {
  mkdirSync(dir, { recursive: true });
  const task = fixtureTask("fx-unpriced", "Fix the thing on a mystery model.");
  const cells = new Map<string, FixtureCell>();
  for (const arm of ["naive", "governed"] as const) {
    const path = join(dir, `${task.taskId}-${arm}-0.jsonl`);
    writeFileSync(
      path,
      renderTranscript({
        model: FIXTURE_UNPRICED_MODEL,
        steps:
          arm === "naive"
            ? [{ input: 9_000, output: 800 }]
            : [{ input: 3_000, output: 600 }],
      })
    );
    cells.set(trialKey(task.taskId, arm, 0), {
      transcriptPath: path,
      oracle: "pass",
      overheadTokens: arm === "governed" ? 200 : 0,
    });
  }
  return { tasks: [task], cells };
}

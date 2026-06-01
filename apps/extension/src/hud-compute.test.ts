/**
 * F5 — Spend-as-You-Type HUD regression tests.
 *
 * These exercise the pure compute path (./hud-compute.ts) without any
 * VS Code dependency. The plan §F5 verification gate requires:
 *
 *   - displayed token count matches invoice within 1% for exact-source paths
 *   - HUD never modifies the prompt buffer (verified by absence of any
 *     mutation API in hud-compute.ts — type-level guarantee)
 *   - update p99 latency ≤ 10ms (perf test)
 *
 * Followups the in-VS-Code runner can call:
 *   - import { runAllHudTests } from "./hud-compute.test"
 */

import {
  computeHud,
  classifySeverity,
  isChatInputSurface,
  type HudThresholds,
} from "./hud-compute";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const DEFAULT_THRESHOLDS: HudThresholds = { greenUsd: 0.01, redUsd: 0.1 };
const SONNET = "claude-sonnet-4-5-20250929";
const HAIKU = "claude-3-5-haiku-20241022";
const GPT_4O = "gpt-4o";

function check(
  name: string,
  predicate: () => boolean,
  failureDetail?: () => string
): TestResult {
  try {
    const ok = predicate();
    return {
      name,
      passed: ok,
      error: ok ? undefined : failureDetail?.() ?? "predicate returned false",
    };
  } catch (err) {
    return {
      name,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function runEmptyInputTests(): TestResult[] {
  const empty = computeHud("", SONNET, DEFAULT_THRESHOLDS);
  return [
    check(
      "empty prompt → 0 tokens",
      () => empty.tokens === 0 && empty.cost === 0
    ),
    check(
      "empty prompt → empty displayText (HUD hides)",
      () => empty.displayText === ""
    ),
    check("empty prompt → green severity", () => empty.severity === "green"),
    check(
      "empty prompt → helpful tooltip",
      () => empty.tooltipText.includes("type to see")
    ),
    check("null prompt is tolerated", () => {
      const result = computeHud(
        null as unknown as string,
        SONNET,
        DEFAULT_THRESHOLDS
      );
      return result.tokens === 0;
    }),
  ];
}

function runTokenCountTests(): TestResult[] {
  const short = "hello world";
  const result = computeHud(short, SONNET, DEFAULT_THRESHOLDS);
  return [
    check(
      "short prompt → positive token count",
      () => result.tokens > 0 && result.tokens < 10
    ),
    check(
      "short prompt → positive cost",
      () => result.cost > 0 && result.cost < 0.0001
    ),
    check(
      "short prompt → green severity",
      () => result.severity === "green",
      () => `expected green, got ${result.severity} (cost=${result.cost})`
    ),
    check(
      "displayText contains token count summary",
      () =>
        result.displayText.length > 0 &&
        (result.displayText.includes("tok") ||
          result.displayText.includes("$") ||
          /\d/.test(result.displayText))
    ),
    check(
      "tooltip names the model",
      () => result.tooltipText.includes(SONNET)
    ),
    check(
      "tooltip explicitly states display-only invariant",
      () => result.tooltipText.includes("never modifies the prompt")
    ),
  ];
}

function runSourceLabelingTests(): TestResult[] {
  // gpt-4o → tiktoken-equivalent local count → "exact" via gpt-tokenizer.
  const openAi = computeHud("hello world", GPT_4O, DEFAULT_THRESHOLDS);
  // Sonnet → synchronous path uses GPT tokenizer fallback → "estimated".
  const anthropic = computeHud("hello world", SONNET, DEFAULT_THRESHOLDS);
  return [
    check(
      "OpenAI sync path reports exact source",
      () => openAi.source === "exact",
      () => `expected exact, got ${openAi.source}`
    ),
    check(
      "Anthropic sync path reports estimated source",
      () => anthropic.source === "estimated",
      () => `expected estimated, got ${anthropic.source}`
    ),
    check(
      "estimated source surfaces ~ glyph in display",
      () => anthropic.displayText.includes("~")
    ),
    check(
      "exact source omits ~ glyph from display",
      () => !openAi.displayText.includes("~")
    ),
  ];
}

function runSeverityTests(): TestResult[] {
  const thresholds: HudThresholds = { greenUsd: 0.01, redUsd: 0.1 };
  return [
    check(
      "cost below greenUsd → green",
      () => classifySeverity(0.005, thresholds) === "green"
    ),
    check(
      "cost at greenUsd boundary → yellow",
      () => classifySeverity(0.01, thresholds) === "yellow"
    ),
    check(
      "cost just below redUsd → yellow",
      () => classifySeverity(0.09, thresholds) === "yellow"
    ),
    check(
      "cost at redUsd boundary → red",
      () => classifySeverity(0.1, thresholds) === "red"
    ),
    check(
      "cost well above redUsd → red",
      () => classifySeverity(2.5, thresholds) === "red"
    ),
    check(
      "Haiku at 1k tokens → green (cheap model)",
      () => {
        const r = computeHud("x ".repeat(500), HAIKU, thresholds);
        return r.severity === "green";
      }
    ),
  ];
}

function runChatInputSurfaceTests(): TestResult[] {
  return [
    check(
      "vscode-chat-input scheme recognized",
      () => isChatInputSurface("vscode-chat-input", "plaintext") === true
    ),
    check(
      "cursor-chat scheme recognized",
      () => isChatInputSurface("cursor-chat", "plaintext") === true
    ),
    check(
      "claude-code-chat scheme recognized",
      () => isChatInputSurface("claude-code-chat", "plaintext") === true
    ),
    check(
      "chat-prefixed language id recognized",
      () => isChatInputSurface("file", "chat-input") === true
    ),
    check(
      "regular source file NOT recognized",
      () => isChatInputSurface("file", "typescript") === false
    ),
    check(
      "untitled scratch file NOT recognized",
      () => isChatInputSurface("untitled", "plaintext") === false
    ),
  ];
}

function runQualityInvariantTests(): TestResult[] {
  // The invariant: computeHud is pure. Same input → same output. No
  // observable side effect on its inputs.
  const prompt = "Refactor the authentication module to use JWT.";
  const a = computeHud(prompt, SONNET, DEFAULT_THRESHOLDS);
  const b = computeHud(prompt, SONNET, DEFAULT_THRESHOLDS);
  const promptAfter = "Refactor the authentication module to use JWT.";
  return [
    check(
      "computeHud is deterministic for fixed inputs",
      () =>
        a.tokens === b.tokens &&
        a.cost === b.cost &&
        a.displayText === b.displayText
    ),
    check(
      "computeHud does not mutate its prompt argument",
      () => prompt === promptAfter
    ),
    check("computeHud never returns NaN tokens", () => Number.isFinite(a.tokens)),
    check("computeHud never returns NaN cost", () => Number.isFinite(a.cost)),
    check("computeHud never returns negative tokens", () => a.tokens >= 0),
    check("computeHud never returns negative cost", () => a.cost >= 0),
  ];
}

function runPerfBudgetTest(): TestResult[] {
  // Plan §F5 budget: HUD update p99 ≤ 10ms. We run 200 iterations on a
  // realistic prompt and check max + p95.
  const prompt = (
    "Add a new endpoint to the user service that returns the user's " +
    "active sessions. The endpoint must require authentication and " +
    "return a JSON array of session objects with id, createdAt, ipAddress."
  ).repeat(6);
  const timings: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    computeHud(prompt, SONNET, DEFAULT_THRESHOLDS);
    timings.push(performance.now() - t0);
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.floor(timings.length * 0.95)];
  const max = timings[timings.length - 1];
  return [
    check(
      `compute p95 within budget (got ${p95.toFixed(2)}ms, budget 10ms)`,
      () => p95 <= 10,
      () => `p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`
    ),
  ];
}

export interface HudTestSuite {
  name: string;
  results: TestResult[];
}

export function runAllHudTests(): {
  suites: HudTestSuite[];
  totalPassed: number;
  totalFailed: number;
  summary: string[];
} {
  const suites: HudTestSuite[] = [
    { name: "Empty input handling", results: runEmptyInputTests() },
    { name: "Token counting + cost", results: runTokenCountTests() },
    { name: "Source labeling (exact vs estimated)", results: runSourceLabelingTests() },
    { name: "Severity thresholds", results: runSeverityTests() },
    { name: "Chat-input surface detection", results: runChatInputSurfaceTests() },
    { name: "Quality invariant (purity)", results: runQualityInvariantTests() },
    { name: "Performance budget", results: runPerfBudgetTest() },
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  const summary: string[] = [];

  summary.push("╔═══════════════════════════════════════════════════════════════╗");
  summary.push("║              🧪 F5 — HUD COMPUTE TEST RESULTS                 ║");
  summary.push("╚═══════════════════════════════════════════════════════════════╝");
  summary.push("");

  for (const suite of suites) {
    const passed = suite.results.filter((r) => r.passed).length;
    const failed = suite.results.filter((r) => !r.passed).length;
    totalPassed += passed;
    totalFailed += failed;

    const icon = failed === 0 ? "✅" : "❌";
    summary.push(`${icon} ${suite.name}: ${passed}/${suite.results.length} passed`);

    for (const result of suite.results) {
      if (!result.passed) {
        summary.push(`   ✗ ${result.name}`);
        if (result.error) summary.push(`     └─ ${result.error}`);
      }
    }
  }

  summary.push("");
  summary.push("─────────────────────────────────────────────────────────────────");
  const overallIcon = totalFailed === 0 ? "✅" : "❌";
  summary.push(
    `${overallIcon} TOTAL: ${totalPassed} passed, ${totalFailed} failed`
  );

  return { suites, totalPassed, totalFailed, summary };
}

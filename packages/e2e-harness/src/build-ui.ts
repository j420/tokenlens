/**
 * Generates `qa-ui.html` — the interactive QA explorer. Invoked by `npm run ui`,
 * which first writes `vitest-results.json` (assertion pass/fail) and then runs
 * this to drive the scenarios, capture repo health, and render the UI.
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSession } from "./fixtures/session";
import { runExtensionScenario } from "./scenarios/extension";
import { runMcpScenario } from "./scenarios/mcp";
import { runHooksScenario } from "./scenarios/hooks";
import { runDashboardScenario } from "./scenarios/dashboard";
import { runEdgeCaseScenario } from "./scenarios/edge-cases";
import { loadDashboard } from "./drivers/dashboard-driver";
import { captureRepoHealth } from "./repo-health";
import { renderUi, type VitestSummary, type RunData } from "./qa-ui";
import type { ScenarioResult } from "./types";

function readVitest(): VitestSummary | null {
  const path = join(process.cwd(), "vitest-results.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<VitestSummary>;
    if (!Array.isArray(raw.testResults)) return null;
    return {
      numTotalTests: raw.numTotalTests ?? 0,
      numPassedTests: raw.numPassedTests ?? 0,
      numFailedTests: raw.numFailedTests ?? 0,
      testResults: raw.testResults.map((f) => ({
        name: f.name ?? "(suite)",
        status: f.status ?? "",
        assertionResults: Array.isArray(f.assertionResults)
          ? f.assertionResults.map((a) => ({ title: a.title ?? "(test)", status: a.status ?? "", duration: a.duration, failureMessages: a.failureMessages }))
          : [],
      })),
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  process.env.HOME = mkdtempSync(join(tmpdir(), "prune-e2e-ui-home-"));

  const fx = buildSession();
  const flows: ScenarioResult[] = [];
  try {
    flows.push(runExtensionScenario(fx));
    const mcpOut = await runMcpScenario(fx);
    flows.push(mcpOut.result);
    const lib = await loadDashboard();
    flows.push(await runDashboardScenario(lib, mcpOut.proofs));
    flows.push(await runHooksScenario(fx));
    flows.push(await runEdgeCaseScenario(fx, lib));
  } finally {
    fx.cleanup();
  }

  const vitest = readVitest();
  const harnessTests = vitest ? { passed: vitest.numPassedTests, total: vitest.numTotalTests } : null;
  const health = captureRepoHealth(harnessTests, { skipMonorepo: process.env.PRUNE_UI_SKIP_REPO === "1" });

  const run: RunData = { generatedAt: new Date().toISOString(), flows, vitest, health };
  const out = join(process.cwd(), "qa-ui.html");
  writeFileSync(out, renderUi(run));
  console.log(`QA UI written: ${out}`);
  console.log(`flows=${flows.length} steps=${flows.reduce((n, f) => n + f.steps.length, 0)} tests=${harnessTests ? harnessTests.passed + "/" + harnessTests.total : "n/a"} repoHealth=${health.allGreen ? "green" : "red"}`);
}

main().catch((err) => {
  console.error("UI build failed:", err);
  process.exit(1);
});

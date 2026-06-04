/**
 * Generates `report.html` — the viewable test+scenario report. Run via
 * `npm run report`, which first writes `vitest-results.json` (the assertion
 * pass/fail) and then runs this to render scenarios + embed those results.
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
import { renderHtml, type VitestSummary } from "./html-report";
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
          ? f.assertionResults.map((a) => ({
              title: a.title ?? "(test)",
              status: a.status ?? "",
              duration: a.duration,
              failureMessages: a.failureMessages,
            }))
          : [],
      })),
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  process.env.HOME = mkdtempSync(join(tmpdir(), "prune-e2e-report-home-"));

  const fx = buildSession();
  const results: ScenarioResult[] = [];
  try {
    results.push(runExtensionScenario(fx));
    const mcpOut = await runMcpScenario(fx);
    results.push(mcpOut.result);
    const lib = await loadDashboard();
    results.push(await runDashboardScenario(lib, mcpOut.proofs));
    results.push(await runHooksScenario(fx));
    results.push(await runEdgeCaseScenario(fx, lib));
  } finally {
    fx.cleanup();
  }

  const vitest = readVitest();
  const html = renderHtml(results, vitest);
  const out = join(process.cwd(), "report.html");
  writeFileSync(out, html);
  console.log(`report written: ${out}`);
  if (vitest) {
    console.log(`tests: ${vitest.numPassedTests}/${vitest.numTotalTests} passed, ${vitest.numFailedTests} failed`);
  } else {
    console.log("tests: no vitest-results.json found (run `npm test` first, or use `npm run report`)");
  }
}

main().catch((err) => {
  console.error("report build failed:", err);
  process.exit(1);
});

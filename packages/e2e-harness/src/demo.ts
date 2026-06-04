/**
 * The narrated demo: run one synthetic session through every flow and print the
 * real outputs. Run with `npm run demo` (which preloads the vscode resolve hook).
 *
 *   Extension → MCP → Dashboard (closed loop, fed by the MCP proofs) → Hooks →
 *   Edge cases.
 *
 * This is the "show outputs" artifact; the .test.ts files assert on the same
 * scenario functions.
 */

import { buildSession } from "./fixtures/session";
import { runExtensionScenario } from "./scenarios/extension";
import { runMcpScenario } from "./scenarios/mcp";
import { runHooksScenario } from "./scenarios/hooks";
import { runDashboardScenario } from "./scenarios/dashboard";
import { runEdgeCaseScenario } from "./scenarios/edge-cases";
import { loadDashboard } from "./drivers/dashboard-driver";
import { renderReport } from "./report";
import type { ScenarioResult } from "./types";

async function main(): Promise<void> {
  // Keep the demo hermetic too: redirect HOME so transcript-reading tools cache
  // under tmp, not the real ~/.prune.
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.HOME = mkdtempSync(join(tmpdir(), "prune-e2e-demo-home-"));

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

  console.log(renderReport(results));
}

main().catch((err) => {
  console.error("demo failed:", err);
  process.exit(1);
});

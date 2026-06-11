/**
 * Surface ↔ dashboard-catalog sync enforcement.
 *
 * Two real dashboard gaps shipped this week because nothing enforced sync
 * between shipped surfaces and the dashboard's curated catalog
 * (apps/dashboard/src/lib/tcrp-catalog.ts + surfaces.ts). This test makes
 * drift a CI failure in both directions:
 *
 *  1. NO PHANTOMS: every catalog ref must be a real handle — a real MCP
 *     tool name, a real hook file in HOOK_REGISTRY, a real contributed
 *     extension command. (The repo's honesty bar, mechanized.)
 *  2. NO SILENT OMISSIONS: every shipped surface must either appear in the
 *     catalog or be EXPLICITLY listed below with a reason. Shipping a new
 *     tool/hook/command then forces a decision: list it on the dashboard,
 *     or consciously record why not. Forgetting is no longer an option.
 *
 * The extraction reads the source files as text using the codebase's own
 * literal conventions (`    name: "x"` inside the TOOLS array; `surface:`/
 * `ref:` pairs in catalog lines). If those conventions change, this test
 * fails loudly — which is correct: the convention IS the contract.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(process.cwd(), "..", "..");

function mcpToolNames(): string[] {
  const src = readFileSync(join(repoRoot, "apps/mcp-server/src/index.ts"), "utf8");
  const names: string[] = [];
  for (const raw of src.split("\n")) {
    if (!raw.startsWith("    name: \"")) continue;
    const open = raw.indexOf("\"") + 1;
    names.push(raw.slice(open, raw.indexOf("\"", open)));
  }
  // The server's own registration name shares the indentation convention.
  return names.filter((n) => n !== "prune-mcp-server");
}

function catalogRefs(): Array<{ surface: string; ref: string }> {
  const src = readFileSync(
    join(repoRoot, "apps/dashboard/src/lib/tcrp-catalog.ts"),
    "utf8"
  );
  const out: Array<{ surface: string; ref: string }> = [];
  for (const line of src.split("\n")) {
    const si = line.indexOf("surface: \"");
    const ri = line.indexOf("ref: \"");
    if (si === -1 || ri === -1) continue;
    out.push({
      surface: line.slice(si + 10, line.indexOf("\"", si + 10)),
      ref: line.slice(ri + 6, line.indexOf("\"", ri + 6)),
    });
  }
  return out;
}

function dashboardCommandRefs(): string[] {
  const src = readFileSync(
    join(repoRoot, "apps/dashboard/src/lib/surfaces.ts"),
    "utf8"
  );
  const refs: string[] = [];
  for (const line of src.split("\n")) {
    const ri = line.indexOf("ref: \"prune.");
    if (ri !== -1) refs.push(line.slice(ri + 6, line.indexOf("\"", ri + 6)));
  }
  return refs;
}

async function hookFiles(): Promise<string[]> {
  const mod = (await import(
    join(repoRoot, "apps/extension/hooks/install.mjs")
  )) as { HOOK_REGISTRY: Array<{ file: string }> };
  return [...new Set(mod.HOOK_REGISTRY.map((h) => h.file))];
}

function contributedCommands(): string[] {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, "apps/extension/package.json"), "utf8")
  ) as { contributes: { commands: Array<{ command: string }> } };
  return pkg.contributes.commands.map((c) => c.command);
}

// ============================================================================
// Conscious-omission registry. Every entry is a DECISION with a reason; a new
// surface that is neither cataloged nor recorded here fails the build.
// ============================================================================

const UNLISTED_TOOLS: Record<string, string> = {
  // Core utility tools, surfaced on the features page via editor commands
  // (the catalog covers TCRP/value levers, not the base toolbox).
  analyze_context: "base toolbox; editor command equivalent (Context Analysis)",
  squeeze_files: "base toolbox; editor command equivalent (Code Squeezer)",
  check_budget: "base toolbox; budget surfaces covered by budget_status entry pair",
  cache_report: "base toolbox report variant",
  cache_copilot: "report variant of the cache-habits entry",
  loop_status: "status variant of the identical-action/loop-breaker entry",
  routing_suggestion: "suggestion variant of the routing entry (routing_decide unlisted too)",
  routing_decide: "covered conceptually by the router library entry",
  diff_context: "diff variant of the base toolbox",
  slo_define: "sibling of the SLO entry (one entry covers define/check/status)",
  slo_check: "sibling of the SLO entry",
  slo_status: "sibling of the SLO entry",
  attribution_rollup: "covered by the attribution library entry",
  export_focus_csv: "exporter pair covered by the export entry",
  export_otel_genai: "exporter pair covered by the export entry",
  sentinel_scan_prompt: "sibling pair covered by the sentinel entry",
  sentinel_scan_mcp: "sibling pair covered by the sentinel entry",
  replay_verify: "sibling of the replay entry",
  replay_list: "sibling of the replay entry",
  subagent_status: "sibling of the subagent predictor entry",
  subagent_cost_predict: "covered by the subagent predictor entry",
  budget_status: "sibling of the budget entry",
  budget_configure: "sibling of the budget entry",
  compaction_check: "editor command equivalent (Compaction Recovery)",
  tool_audit: "covered by the tool-def auditor entry (f2)",
  qpd_report: "covered by the QpD bench entry (f4)",
  code_mode_generate_api: "sibling pair covered by the code-mode entry (f8)",
  code_mode_harness: "sibling pair covered by the code-mode entry (f8)",
  semantic_cache_probe: "covered by the semantic-cache entry (f7)",
  trajectory_replay_report: "covered by the trajectory-diet entry (f1)",
  context_health_report: "covered by the context-health entry (f6)",
  replay_cost_plan: "covered by the replay-cost entry (f11)",
  mcp_proxy_trim: "covered by the mcp-proxy entry (f10)",
  cache_habits_from_transcript: "transcript variant of the cache-habits entry (f9)",
  reasoning_effort_route: "covered by the effort-router entry (P8d)",
  result_prune: "covered by the tool-result pruner entry (P8a)",
  max_tokens_calibrate: "covered by the calibrator entry (P8b)",
  diff_vs_rewrite: "covered by the diff-enforcer entry (P8c)",
  open_tab_audit: "covered by the tab-auditor entry (P8e)",
  memory_get: "sibling of the asset-store entry (ref memory_search)",
  memory_store: "sibling of the asset-store entry",
  memory_validate: "sibling of the asset-store entry",
};

const UNLISTED_HOOKS: Record<string, string> = {
  "sentinel-prompt.mjs": "safety pair covered by the sentinel catalog entry",
  "sentinel-mcp.mjs": "safety pair covered by the sentinel catalog entry",
  "cache-stabilize.mjs": "covered by the cache-habits family entries",
  "cache-habits-advisor.mjs": "hook face of the cache-habits entry (f9)",
  "context-health-advisor.mjs": "hook face of the context-health entry (f6)",
  "observation-mask.mjs": "hook face of the observation-mask entry (f15)",
  "read-gate.mjs": "hook face of the read-gate entry (f16)",
  "reward-integrity.mjs": "hook face of the reward-integrity entry (f14)",
  "trajectory-diet.mjs": "hook face of the trajectory-diet entry (f1)",
  "skill-advisor.mjs": "hook face of the skill-library entry (f12)",
  "skill-capture.mjs": "recorder for the skill-library entry (f12)",
  "speculative-prune.mjs": "hook face of the speculative-pipeline entry (f13)",
  "speculative-record.mjs": "recorder for the speculative-pipeline entry (f13)",
  "replay-recorder.mjs": "recorder for the replay entries (f11)",
  "budget-gate.mjs": "hook face of the budget entries",
  "slo-breaker.mjs": "hook face of the SLO entry",
  "subagent-warden.mjs": "hook face of the subagent predictor entry",
  "compaction-recover.mjs": "editor command equivalent (Compaction Recovery)",
  "telemetry-forward.mjs": "internal infrastructure (telemetry sink forwarder)",
  "preturn-forecast.mjs": "cost-security family; covered by the forecast detectors group",
  "edit-amplification.mjs": "cost-security family; covered by the detectors group",
  "thrash-detector.mjs": "cost-security family; covered by the detectors group",
};

const UNLISTED_COMMANDS: Record<string, string> = {
  "prune.analyzeSelection": "variant of Token Counter (analyzeFile)",
  "prune.runTests": "developer utility, not a product lever",
  "prune.resetSession": "session-memory utility paired with sessionStats",
  "prune.trackDecision": "input side of Compaction Recovery",
  "prune.disableFeature": "flag plumbing (operator utility)",
  "prune.enableFeature": "flag plumbing (operator utility)",
  "prune.listFeatures": "flag plumbing (operator utility)",
  "prune.installHooks": "setup utility, surfaced in onboarding instead",
};

// ============================================================================

describe("dashboard catalog ↔ shipped surfaces", () => {
  it("extraction conventions still hold (guards the guard)", async () => {
    expect(mcpToolNames().length).toBeGreaterThan(50);
    expect((await hookFiles()).length).toBeGreaterThan(20);
    expect(catalogRefs().length).toBeGreaterThan(30);
    expect(dashboardCommandRefs().length).toBeGreaterThan(5);
  });

  it("every catalog MCP ref is a real tool (no phantoms)", () => {
    const tools = new Set(mcpToolNames());
    for (const { surface, ref } of catalogRefs()) {
      if (surface !== "MCP tool") continue;
      expect(tools.has(ref), `catalog lists MCP tool "${ref}" which does not exist`).toBe(true);
    }
  });

  it("every catalog Hook ref is a registered hook file (no phantoms)", async () => {
    const hooks = new Set(await hookFiles());
    for (const { surface, ref } of catalogRefs()) {
      if (surface !== "Hook") continue;
      expect(hooks.has(ref), `catalog lists hook "${ref}" which is not in HOOK_REGISTRY`).toBe(true);
    }
  });

  it("every dashboard command ref is a contributed extension command (no phantoms)", () => {
    const commands = new Set(contributedCommands());
    for (const ref of dashboardCommandRefs()) {
      expect(commands.has(ref), `dashboard lists command "${ref}" which is not contributed`).toBe(true);
    }
  });

  it("every shipped MCP tool is cataloged OR consciously recorded as unlisted", () => {
    const listed = new Set(
      catalogRefs().filter((r) => r.surface === "MCP tool").map((r) => r.ref)
    );
    const missing = mcpToolNames().filter(
      (t) => !listed.has(t) && UNLISTED_TOOLS[t] === undefined
    );
    expect(
      missing,
      `new MCP tool(s) shipped without a dashboard decision: ${missing.join(", ")} — add to tcrp-catalog.ts or record a reason in UNLISTED_TOOLS`
    ).toEqual([]);
  });

  it("every shipped hook is cataloged OR consciously recorded as unlisted", async () => {
    const listed = new Set(
      catalogRefs().filter((r) => r.surface === "Hook").map((r) => r.ref)
    );
    const missing = (await hookFiles()).filter(
      (h) => !listed.has(h) && UNLISTED_HOOKS[h] === undefined
    );
    expect(
      missing,
      `new hook(s) shipped without a dashboard decision: ${missing.join(", ")} — add to tcrp-catalog.ts or record a reason in UNLISTED_HOOKS`
    ).toEqual([]);
  });

  it("every contributed command is on the dashboard OR consciously recorded as unlisted", () => {
    const listed = new Set(dashboardCommandRefs());
    const missing = contributedCommands().filter(
      (c) => !listed.has(c) && UNLISTED_COMMANDS[c] === undefined
    );
    expect(
      missing,
      `new command(s) shipped without a dashboard decision: ${missing.join(", ")} — add to surfaces.ts COMMANDS or record a reason in UNLISTED_COMMANDS`
    ).toEqual([]);
  });

  it("the conscious-omission registries carry no dead entries (stale reasons rot too)", async () => {
    const tools = new Set(mcpToolNames());
    for (const t of Object.keys(UNLISTED_TOOLS)) {
      expect(tools.has(t), `UNLISTED_TOOLS entry "${t}" no longer exists — remove it`).toBe(true);
    }
    const hooks = new Set(await hookFiles());
    for (const h of Object.keys(UNLISTED_HOOKS)) {
      expect(hooks.has(h), `UNLISTED_HOOKS entry "${h}" no longer exists — remove it`).toBe(true);
    }
    const commands = new Set(contributedCommands());
    for (const c of Object.keys(UNLISTED_COMMANDS)) {
      expect(commands.has(c), `UNLISTED_COMMANDS entry "${c}" no longer exists — remove it`).toBe(true);
    }
  });
});

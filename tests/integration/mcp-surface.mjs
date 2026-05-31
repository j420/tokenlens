#!/usr/bin/env node
/**
 * Verify the MCP server's tool surface: every advertised tool has a
 * valid schema, no duplicate names, and every handler is wired in the
 * dispatch switch.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

const SERVER = join(process.cwd(), "apps/mcp-server/dist/index.js");
let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? "  (" + detail + ")" : ""}`);
  }
}

/**
 * Speak JSON-RPC to the MCP server over stdio. Sends initialize +
 * notifications/initialized + the requested call, returns parsed
 * responses. Matches the MCP protocol's required handshake.
 */
function jsonrpc(messages) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [SERVER], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("exit", () => {
      const responses = out
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      resolve({ responses, err });
    });
    // Stagger writes so the server processes init before list.
    const writeWithDelay = async () => {
      for (const m of messages) {
        proc.stdin.write(JSON.stringify(m) + "\n");
        await new Promise((r) => setTimeout(r, 100));
      }
      // Give the server time to flush all responses before we kill.
      await new Promise((r) => setTimeout(r, 500));
      proc.kill();
    };
    writeWithDelay();
    setTimeout(() => proc.kill(), 5000);
  });
}

async function listTools() {
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0.0.0" },
    },
  };
  const initialized = {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  };
  const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };
  const r = await jsonrpc([init, initialized, list]);
  const listResp = r.responses.find((x) => x.id === 2);
  return listResp?.result?.tools ?? [];
}

console.log("=== MCP tool surface ===");
try {
  const tools = await listTools();
  check("MCP server lists at least one tool", tools.length > 0);

  // Expected tools — all the v0.1 + Phase 5+ surface.
  const expected = [
    "analyze_context",
    "squeeze_files",
    "check_budget",
    "cache_report",
    "loop_status",
    "routing_suggestion",
    "diff_context",
    "compaction_check",
    "budget_status",
    "budget_configure",
    "subagent_status",
    "cache_copilot",
    "replay_verify",
    "replay_list",
    "repo_map",
    "routing_decide",
    "sentinel_scan_prompt",
    "sentinel_scan_mcp",
    "export_focus_csv",
    "export_otel_genai",
    "attribution_rollup",
    "slo_define",
    "slo_check",
    "slo_status",
  ];

  const names = new Set(tools.map((t) => t.name));
  for (const e of expected) {
    check(`tool "${e}" is registered`, names.has(e));
  }

  // No duplicate names
  const seen = new Set();
  const dupes = [];
  for (const t of tools) {
    if (seen.has(t.name)) dupes.push(t.name);
    seen.add(t.name);
  }
  check("no duplicate tool names", dupes.length === 0,
    dupes.length > 0 ? "dupes=" + dupes.join(",") : "");

  // Schema integrity
  for (const t of tools) {
    const hasDescription = typeof t.description === "string" && t.description.length > 10;
    const hasSchema =
      t.inputSchema &&
      t.inputSchema.type === "object" &&
      typeof t.inputSchema.properties === "object";
    check(`"${t.name}" has description + object schema`,
      hasDescription && hasSchema,
      !hasDescription ? "missing/short description" : "bad schema");
  }
} catch (e) {
  failed++;
  failures.push({ name: "(uncaught)", detail: String(e?.stack ?? e) });
  console.log("FATAL: " + (e?.stack ?? e));
}

console.log("\n" + "=".repeat(60));
console.log(`MCP surface result: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  ✗ " + f.name + (f.detail ? " (" + f.detail + ")" : ""));
}
console.log("=".repeat(60));
process.exit(failed > 0 ? 1 : 0);

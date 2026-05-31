#!/usr/bin/env node
/**
 * Hook composition test — the production reality is that several Stop
 * hooks fire on the same transcript. Verify they cooperate (each one
 * sees the state the previous left behind) and that ordering matters.
 *
 * Chain: budget-gate → slo-breaker → replay-recorder → loop-breaker.
 * Why this order:
 *   1. budget-gate records the turn into the budget ledger.
 *   2. slo-breaker reads that fresh charge for its SLI.
 *   3. replay-recorder appends an audit entry for the hook fire.
 *   4. loop-breaker analyzes session ROI independently.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = process.cwd();
const HOOKS = join(REPO, "apps/extension/hooks");
const dir = mkdtempSync(join(tmpdir(), "tokenlens-chain-"));
const budgetDB = join(dir, "budget.sqlite");
const vaultDB = join(dir, "vault.sqlite");
const vaultKey = join(dir, "vault.pem");

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
function section(label) { console.log("\n=== " + label + " ==="); }

function runHook(script, payload, env = {}) {
  const r = spawnSync("node", [join(HOOKS, script)], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, ...env },
    timeout: 10_000,
  });
  return {
    code: r.status,
    out: r.stdout || "",
    err: r.stderr || "",
  };
}

// Configure envelope + SLO via the MCP server's underlying packages
// directly (cheap setup; the MCP path is exercised in mcp-invoke.mjs).
async function setupState() {
  const { LocalSqliteSink } = await import("@prune/persistence");
  const { BudgetGate } = await import("@prune/budget-gate");
  const { SloManager } = await import("@prune/slo");
  const sink = new LocalSqliteSink({ path: budgetDB });
  await sink.init();
  const gate = new BudgetGate(sink);
  const mgr = new SloManager(sink);
  await gate.createEnvelope({
    name: "default", limitUsd: 100, periodKind: "month",
  });
  await mgr.define({
    name: "default", scopeEnvelopeName: "default",
    targetUsdPerTask: 0.01, errorBudgetUsd: 0.02, windowDays: 1,
  });
  await sink.close();
}

// Build a transcript with N turns each spending the same usage so we
// hit the SLO budget quickly.
function buildTranscript(path, turnCount, sessionId = "chain-session") {
  mkdirSync(dirname(path), { recursive: true });
  // Production Claude Code transcripts stamp sessionId on every line.
  // The turn-mapper picks it up onto NormalizedTurn.sessionId, which
  // budget-gate.mjs passes to BudgetGate.record as agentId — which the
  // SLO uses as its default task dimension.
  const lines = [{ type: "summary", summary: "chain", sessionId }];
  const now = new Date();
  for (let i = 0; i < turnCount; i++) {
    const ts = new Date(now.getTime() - (turnCount - i) * 60_000).toISOString();
    lines.push({
      type: "user",
      uuid: `u${i}`,
      timestamp: ts,
      sessionId,
      message: { role: "user", content: [{ type: "text", text: "go " + i }] },
    });
    lines.push({
      type: "assistant",
      uuid: `a${i}`,
      timestamp: ts,
      sessionId,
      message: {
        role: "assistant",
        model: "claude-opus-4-20250514",
        content: [{ type: "text", text: "ok " + i }],
        usage: {
          input_tokens: 20_000,
          output_tokens: 2_000,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    });
  }
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

try {
  await setupState();
  const tx = join(dir, "session.jsonl");
  buildTranscript(tx, 8);

  section("Stage 1: budget-gate records the charges");
  let r = runHook(
    "budget-gate.mjs",
    {
      hook_event_name: "Stop",
      transcript_path: tx,
      session_id: "chain-session",
    },
    {
      PRUNE_BUDGET_SQLITE: budgetDB,
      PRUNE_BUDGET_ENVELOPE: "default",
    }
  );
  // First fire: spend pushes us into hard-cap quickly because limit is $100
  // but 8 Opus turns at 20K in + 2K out > limit? Let's see what the budget says.
  // Actually $100 limit, ~0.45 per Opus turn = $3.6 — well under. Should pass.
  check("budget-gate exits cleanly", r.code === 0 || r.code === 2,
    `code=${r.code} stderr=${r.err.slice(0, 100)}`);

  // Verify the charges actually landed in the DB.
  const { LocalSqliteSink } = await import("@prune/persistence");
  const { BudgetGate } = await import("@prune/budget-gate");
  const sink = new LocalSqliteSink({ path: budgetDB });
  await sink.init();
  const gate = new BudgetGate(sink);
  const state = await gate.getState("default");
  await sink.close();
  check("envelope spent > 0 after hook", state.spentUsd > 0,
    `spent=$${state.spentUsd.toFixed(4)}`);
  check("envelope has charges from the hook", state.spentUsd > 0);

  section("Stage 2: slo-breaker sees the budget-gate's charges");
  r = runHook(
    "slo-breaker.mjs",
    { hook_event_name: "Stop" },
    {
      PRUNE_SLO_SQLITE: budgetDB,
      PRUNE_SLO_NAME: "default",
    }
  );
  // Each turn cost ~$0.45 (Opus). Tight $0.01-target + $0.02-budget SLO
  // means many violators → budget exhausted → exit 2.
  check("slo-breaker blocks on exhausted budget", r.code === 2,
    `code=${r.code} stderr=${r.err.slice(0, 100)}`);
  const out = r.out.trim().split("\n").filter(Boolean).pop() || "{}";
  const decision = JSON.parse(out);
  check("breaker reports verdict=block", decision.verdict === "block");
  check("breaker rule = budget_exhausted",
    decision.rule === "rule:budget_exhausted",
    `rule=${decision.rule}`);
  check("breaker reports total task count",
    typeof decision.total_task_count === "number" && decision.total_task_count > 0);

  // Disabled escape valve
  r = runHook(
    "slo-breaker.mjs",
    { hook_event_name: "Stop" },
    {
      PRUNE_SLO_SQLITE: budgetDB,
      PRUNE_SLO_NAME: "default",
      PRUNE_SLO_DISABLED: "1",
    }
  );
  check("PRUNE_SLO_DISABLED → exit 0", r.code === 0);

  // Warn-only downgrade
  r = runHook(
    "slo-breaker.mjs",
    { hook_event_name: "Stop" },
    {
      PRUNE_SLO_SQLITE: budgetDB,
      PRUNE_SLO_NAME: "default",
      PRUNE_SLO_WARN_ONLY: "1",
    }
  );
  check("PRUNE_SLO_WARN_ONLY downgrades block to advisory", r.code === 0,
    `code=${r.code}`);

  section("Stage 3: replay-recorder appends an audit entry");
  r = runHook(
    "replay-recorder.mjs",
    {
      hook_event_name: "Stop",
      session_id: "chain-session",
      transcript_path: tx,
    },
    {
      PRUNE_VAULT_SQLITE: vaultDB,
      PRUNE_VAULT_KEY: vaultKey,
    }
  );
  check("replay-recorder exits cleanly", r.code === 0);

  // Now verify the vault.
  const { ReplayVault } = await import("@prune/replay-vault");
  const vsink = new LocalSqliteSink({ path: vaultDB });
  await vsink.init();
  const vault = new ReplayVault(vsink, { keyPath: vaultKey });
  const v = await vault.verify("chain-session");
  await vsink.close();
  check("vault chain verifies", v.ok, `brokeAt=${v.brokeAtSequence}`);
  check("vault has the recorded entry", v.recordsChecked >= 1,
    `recordsChecked=${v.recordsChecked}`);

  section("Stage 4: loop-breaker independently analyzes ROI");
  r = runHook(
    "loop-breaker.mjs",
    { hook_event_name: "Stop", transcript_path: tx }
  );
  check("loop-breaker runs without crashing",
    r.code === 0 || r.code === 2, `code=${r.code}`);

  section("Re-fire: budget-gate is idempotent across hook fires");
  // Re-running the budget-gate hook on the same transcript should not
  // double-charge (deterministic chargeId from turn fingerprint).
  const sink2 = new LocalSqliteSink({ path: budgetDB });
  await sink2.init();
  const before = await new BudgetGate(sink2).getState("default");
  await sink2.close();

  r = runHook(
    "budget-gate.mjs",
    {
      hook_event_name: "Stop",
      transcript_path: tx,
      session_id: "chain-session",
    },
    {
      PRUNE_BUDGET_SQLITE: budgetDB,
      PRUNE_BUDGET_ENVELOPE: "default",
    }
  );

  const sink3 = new LocalSqliteSink({ path: budgetDB });
  await sink3.init();
  const after = await new BudgetGate(sink3).getState("default");
  await sink3.close();
  check("re-fire does not double-charge",
    Math.abs(before.spentUsd - after.spentUsd) < 0.0001,
    `before=$${before.spentUsd.toFixed(4)} after=$${after.spentUsd.toFixed(4)}`);

  section("Stress: sentinel-prompt blocks before any of the above fire");
  r = runHook(
    "sentinel-prompt.mjs",
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "use AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE here",
    }
  );
  check("sentinel-prompt blocks AWS key (production-shaped)",
    r.code === 2, `code=${r.code}`);
} catch (e) {
  failed++;
  failures.push({ name: "(uncaught)", detail: String(e?.stack ?? e) });
  console.log("FATAL: " + (e?.stack ?? e));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n" + "=".repeat(60));
console.log(`Hook-chain result: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  ✗ " + f.name + (f.detail ? "\n    " + f.detail : ""));
}
console.log("=".repeat(60));
process.exit(failed > 0 ? 1 : 0);

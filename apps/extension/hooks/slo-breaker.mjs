#!/usr/bin/env node
/**
 * SLO Breaker hook — Stop event.
 *
 * Reads the named SLO, computes the SLI from the sink, and emits a
 * `decision:block` when the error budget is exhausted, or
 * `additionalContext` when the warning threshold trips. Designed to run
 * AFTER budget-gate.mjs in the Stop chain so the latest turn's charge
 * is already recorded.
 *
 * Reference: Google SRE Workbook "Implementing SLOs"
 * (https://sre.google/workbook/implementing-slos/). Decisions are
 * explainable — every block reason names the numbers that fired and
 * lists remediations the user can act on.
 *
 * Config:
 *   PRUNE_SLO_NAME       Name of the SLO to enforce (default "default").
 *   PRUNE_SLO_SQLITE     Override the budget-gate sink path.
 *   PRUNE_SLO_DISABLED   "1" → no-op.
 *   PRUNE_SLO_WARN_ONLY  "1" → never block, only emit advisory.
 */

import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { LocalSqliteSink } from "@prune/persistence";
import { SloManager, formatBreakerMessage } from "@prune/slo";

import {
  emitAdditionalContext,
  emitBlock,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

const DEFAULT_DB = join(homedir(), ".prune", "budget.sqlite");

function resolveDbPath() {
  const p = process.env.PRUNE_SLO_SQLITE || process.env.PRUNE_BUDGET_SQLITE || DEFAULT_DB;
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

safeRun(async () => {
  if (process.env.PRUNE_SLO_DISABLED === "1") return emitNoop();
  const sloName = process.env.PRUNE_SLO_NAME || "default";
  void (await readHookPayload());

  const sink = new LocalSqliteSink({ path: resolveDbPath() });
  try {
    await sink.init();
  } catch {
    return emitNoop();
  }

  const mgr = new SloManager(sink);
  const slo = await mgr.get(sloName);
  if (!slo) {
    await sink.close();
    return emitAdditionalContext(
      `SLO Breaker: SLO "${sloName}" not configured — running advisory-only. ` +
        "Define one with the slo_define MCP tool.",
      "Stop"
    );
  }

  const decision = await mgr.check(sloName);
  await sink.close();

  if (decision.verdict === "block") {
    const warnOnly = process.env.PRUNE_SLO_WARN_ONLY === "1";
    if (warnOnly) {
      return emitAdditionalContext(formatBreakerMessage(decision), "Stop", {
        slo: sloName,
        verdict: "block",
        downgraded_to_warn: true,
      });
    }
    return emitBlock(formatBreakerMessage(decision), {
      slo: sloName,
      verdict: decision.verdict,
      rule: decision.rule,
      excess_spend_usd: decision.sli.excessSpendUsd,
      error_budget_remaining_usd: decision.sli.errorBudgetRemainingUsd,
      total_task_count: decision.sli.totalTaskCount,
      violating_task_count: decision.sli.violatingTaskCount,
    });
  }

  if (decision.verdict === "warn") {
    return emitAdditionalContext(formatBreakerMessage(decision), "Stop", {
      slo: sloName,
      verdict: decision.verdict,
      error_budget_remaining_usd: decision.sli.errorBudgetRemainingUsd,
    });
  }

  return emitNoop();
});

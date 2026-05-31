#!/usr/bin/env node
/**
 * BudgetGate hook — Stop / PostToolUse hook for Claude Code.
 *
 * Reads the active session transcript, records each new assistant turn's
 * usage as a charge against a named budget envelope, and emits a
 * `decision:block` when the envelope's hard cap would be breached by
 * continuing the session. On soft-cap or burn-rate warnings, emits
 * additionalContext so the agent (and the user) see the projection
 * without being interrupted.
 *
 * Designed for the post-June-15-2026 Agent SDK metered-credits world:
 * the user has a fixed monthly envelope ($20 / $100 / $200 depending on
 * plan), and this hook is the active enforcement layer that pure logging
 * tools (ccusage, claude-usage, cccost) cannot provide.
 *
 * Config (env vars):
 *   PRUNE_BUDGET_ENVELOPE   Name of the envelope to enforce (default "default").
 *                           The envelope must already exist; create via the
 *                           `budget_status` MCP tool or the BudgetGate API.
 *   PRUNE_BUDGET_SQLITE     Path to the LocalSqliteSink db file
 *                           (default ~/.prune/budget.sqlite).
 *   PRUNE_BUDGET_DISABLED   Set to "1" to make this hook a no-op (escape valve).
 *
 * Exit codes follow the Claude Code hook protocol via the shared runtime.
 */

import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { loadCachedSessionView } from "@prune/telemetry";
import { LocalSqliteSink } from "@prune/persistence";
import { BudgetGate } from "@prune/budget-gate";

import {
  emitAdditionalContext,
  emitBlock,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

const DEFAULT_DB = join(homedir(), ".prune", "budget.sqlite");

function resolveDbPath() {
  const p = process.env.PRUNE_BUDGET_SQLITE || DEFAULT_DB;
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/**
 * Build a deterministic charge id so re-running the hook for the same
 * turn (which can happen — Stop hook may fire repeatedly during retries)
 * INSERT OR REPLACE-s instead of double-charging.
 */
function chargeIdForTurn(sessionId, turnNumber, model, usage) {
  const key = [
    sessionId ?? "no-session",
    String(turnNumber),
    model ?? "unknown",
    String(usage.input ?? 0),
    String(usage.output ?? 0),
    String(usage.cacheRead ?? 0),
    String(usage.cacheCreate ?? 0),
  ].join("|");
  // SHA-256 → first 32 chars formatted as UUID-shape for human reading.
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function formatProjection(state) {
  const lines = [
    `Budget envelope: ${state.envelope.name}`,
    `Spent:           $${state.spentUsd.toFixed(4)} of $${state.envelope.limit_usd.toFixed(2)} (${(state.pctSpent * 100).toFixed(1)}%)`,
    `Remaining:       $${state.remainingUsd.toFixed(4)}`,
    `Burn rate:       $${state.burnRatePerDay.toFixed(2)}/day`,
    `Period ends:     ${state.envelope.period_end.slice(0, 10)} (${state.daysLeftInPeriod.toFixed(1)}d left)`,
  ];
  if (state.projectedExhaustionAt) {
    lines.push(
      `Projected exhaustion: ${state.projectedExhaustionAt.toISOString().slice(0, 10)} (before period end)`
    );
  } else {
    lines.push(`Projected end-of-period spend: $${state.projectedSpendAtPeriodEnd.toFixed(2)}`);
  }
  return lines.join("\n");
}

safeRun(async () => {
  if (process.env.PRUNE_BUDGET_DISABLED === "1") return emitNoop();
  const envelopeName = process.env.PRUNE_BUDGET_ENVELOPE || "default";

  const payload = await readHookPayload();
  if (!payload.transcript_path) return emitNoop();

  // Open the local sink (the proper-lockfile init lets multiple hook
  // processes coexist safely — the first hook to fire after a fresh
  // session creates the schema; subsequent firings are no-op on init).
  const sink = new LocalSqliteSink({ path: resolveDbPath() });
  try {
    await sink.init();
  } catch (e) {
    // Another process holds the init lock; that's fine — they'll write,
    // we just don't enforce this fire. Don't break the agent for it.
    return emitAdditionalContext(
      "BudgetGate: another process is initializing the cost database; skipped this fire.",
      "Stop"
    );
  }

  const gate = new BudgetGate(sink);
  const envelope = await gate.getEnvelope(envelopeName);
  if (!envelope) {
    // No configured envelope → no enforcement. Surface a one-line hint
    // so the user knows the hook is wired but inert.
    await sink.close();
    return emitAdditionalContext(
      `BudgetGate: envelope "${envelopeName}" is not configured; running advisory-only. ` +
        `Create one via the budget_status MCP tool or the BudgetGate API.`,
      "Stop"
    );
  }

  // Load the session view and record any new turns as charges.
  // gate.record() computes cost via the accountant and rolls up to
  // parent envelopes. The deterministic chargeId ensures hook re-fires
  // don't double-charge.
  const { turns } = await loadCachedSessionView(payload.transcript_path);
  for (const turn of turns) {
    const tokensIn = turn.usage.input ?? 0;
    const tokensOut = turn.usage.output ?? 0;
    const tokensCached = turn.usage.cacheRead ?? 0;
    const tokensCacheCreate = turn.usage.cacheCreate ?? 0;
    if (
      tokensIn === 0 &&
      tokensOut === 0 &&
      tokensCached === 0 &&
      tokensCacheCreate === 0
    ) {
      continue;
    }

    const chargeId = chargeIdForTurn(turn.sessionId, turn.turnNumber, turn.model, turn.usage);
    await gate.record({
      envelopeName,
      chargeId,
      usage: {
        model: turn.model ?? "unknown",
        tokensIn,
        tokensOut,
        tokensCached,
        tokensCacheCreation: tokensCacheCreate,
      },
      agentId: turn.sessionId ?? undefined,
      at: turn.endedAt ? new Date(turn.endedAt) : undefined,
      metadata: { turn: turn.turnNumber, source: "stop-hook" },
    });
  }

  // After charges are recorded, evaluate state and decide.
  const state = await gate.getState(envelopeName);

  // Hard block: spent already over hard cap.
  if (state.spentUsd >= state.envelope.limit_usd * state.envelope.hard_cap_pct) {
    await sink.close();
    return emitBlock(
      `Budget envelope "${state.envelope.name}" exhausted: ` +
        `$${state.spentUsd.toFixed(2)} spent of $${state.envelope.limit_usd.toFixed(2)} ` +
        `(${(state.pctSpent * 100).toFixed(0)}% — hard cap ${(state.envelope.hard_cap_pct * 100).toFixed(0)}% reached). ` +
        `Set PRUNE_BUDGET_DISABLED=1 to override or raise the envelope limit.\n\n${formatProjection(state)}`,
      {
        envelope: state.envelope.name,
        spent_usd: state.spentUsd,
        limit_usd: state.envelope.limit_usd,
      }
    );
  }

  // Soft warnings — emit context, don't block.
  const softCapUsd = state.envelope.limit_usd * state.envelope.soft_cap_pct;
  if (
    state.spentUsd >= softCapUsd ||
    (state.projectedExhaustionAt &&
      state.projectedExhaustionAt.getTime() < new Date(state.envelope.period_end).getTime())
  ) {
    await sink.close();
    return emitAdditionalContext(
      `⚠ BudgetGate soft-cap warning:\n${formatProjection(state)}`,
      "Stop",
      {
        envelope: state.envelope.name,
        spent_usd: state.spentUsd,
        pct_spent: state.pctSpent,
        burn_rate_per_day: state.burnRatePerDay,
      }
    );
  }

  await sink.close();
  return emitNoop();
});

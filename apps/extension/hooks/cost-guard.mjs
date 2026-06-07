#!/usr/bin/env node
/**
 * Cost-Guard — PostToolUse hook  (Cost-Security: "defend the bill").
 *
 * Inspects each tool / MCP result for the two ways a single result inflates the
 * token bill, using the deterministic, fail-open guard in @prune/cost-security:
 *
 *   - TOKEN BOMB     — a megabyte dump that floods context (billed as fresh
 *                      input now and on every cached turn after).
 *   - EXPANSION BOMB — a small-but-explosive, near-constant / deeply-repeated
 *                      payload (the textual analogue of a zip bomb).
 *
 * It is ADVISORY by design. A PostToolUse hook fires after the result already
 * exists, so it cannot byte-substitute the payload (that belongs to the
 * request-assembly adapter). What it CAN do autonomously, with zero per-use
 * action, is: (1) detect the bill attack deterministically, (2) warn the agent
 * not to re-read or rely on the bloated result — preventing the far larger
 * downstream re-spend — and (3) meter the saving opportunity to telemetry.
 *
 * Fail-open: never blocks. Honest: real token counts; USD null on unpriced
 * model. Config:
 *   PRUNE_COST_GUARD_DISABLED   "1" → no-op.
 *   PRUNE_COST_GUARD_TOKEN_CEIL  override the bound threshold (tokens).
 *   PRUNE_COST_GUARD_MODEL       tokenizer/pricing model (default gpt-4o).
 */

import { guardToolResult } from "@prune/cost-security";

import {
  emitAdditionalContext,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";
import {
  deriveSessionId,
  recordFeatureEventBestEffort,
  stableId,
} from "./_telemetry.mjs";

/** Mirror sentinel-mcp's extraction so we read the same PostToolUse field. */
function extractToolResultText(payload) {
  if (typeof payload.tool_response === "string") return payload.tool_response;
  if (typeof payload.tool_result_content === "string") return payload.tool_result_content;
  if (Array.isArray(payload.tool_response)) {
    return payload.tool_response
      .map((b) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : ""))
      .join("\n");
  }
  if (typeof payload.tool_response === "object" && payload.tool_response) {
    try {
      return JSON.stringify(payload.tool_response);
    } catch {
      return "";
    }
  }
  return "";
}

function posIntEnv(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

safeRun(async () => {
  if (process.env.PRUNE_COST_GUARD_DISABLED === "1") return emitNoop();

  const start = Date.now();
  const payload = await readHookPayload();
  const text = extractToolResultText(payload);
  if (!text) return emitNoop();

  const model =
    typeof process.env.PRUNE_COST_GUARD_MODEL === "string" && process.env.PRUNE_COST_GUARD_MODEL
      ? process.env.PRUNE_COST_GUARD_MODEL
      : "gpt-4o";

  const result = guardToolResult(text, {
    model,
    toolName: typeof payload.tool_name === "string" ? payload.tool_name : undefined,
    tokenCeiling: posIntEnv("PRUNE_COST_GUARD_TOKEN_CEIL"),
  });

  if (result.verdict === "allow") return emitNoop();

  // Meter the saving opportunity (best-effort, PII-safe: counts + signals only).
  await recordFeatureEventBestEffort({
    featureId: "cost-guard",
    qualityProof: {
      schemaVersion: 1,
      featureId: "cost-guard",
      verdict: result.verdict,
      signals: result.signals,
      tokenCountMethod: result.tokenCountMethod,
    },
    sessionId: deriveSessionId(payload),
    eventId: `cost-guard-${stableId(payload.transcript_path ?? "", payload.tool_name ?? "", result.sha256 ?? "")}`,
    model,
    estimatedCostUsd: result.estimatedSavedUsd ?? 0,
    latencyMs: Date.now() - start,
  });

  const approx = result.tokenCountMethod === "estimated" ? "~" : "";
  const tool = payload.tool_name ? `"${payload.tool_name}"` : "a tool";

  if (result.verdict === "quarantine") {
    return emitAdditionalContext(
      `🛡 Cost-guard: the result from ${tool} looks like a token/expansion bomb ` +
        `(${result.rawBytes.toLocaleString()} bytes, ${approx}${result.estimatedTokens.toLocaleString()} tokens; ` +
        `signals: ${result.signals.join(", ")}). Do NOT re-read or rely on its bulk — ` +
        `treat it as withheld and request only the specific part you need ` +
        `(sha256:${result.sha256 ?? "n/a"}).`,
      payload.hook_event_name ?? "PostToolUse",
      { verdict: result.verdict, signals: result.signals, est_saved_tokens: result.savedTokens }
    );
  }

  // verdict === "truncate"
  return emitAdditionalContext(
    `⚠ Cost-guard: ${tool} returned an oversized result ` +
      `(${approx}${result.estimatedTokens.toLocaleString()} tokens). Avoid re-reading it; ` +
      `a bounded head/tail (~${result.savedTokens.toLocaleString()} tokens recoverable) is sufficient for most tasks.`,
    payload.hook_event_name ?? "PostToolUse",
    { verdict: result.verdict, signals: result.signals, est_saved_tokens: result.savedTokens }
  );
});

#!/usr/bin/env node
/**
 * Sentinel MCP Shield — PostToolUse hook.
 *
 * Inspects the tool_result payload of MCP / external tools for
 * prompt-injection signatures. Pattern matches the documented Jan 20
 * 2026 RCE in Anthropic's Git MCP server (path traversal + argument
 * injection chain achieving RCE through prompt injection alone —
 * CVE-2025-68143/68144/68145, Cyata; attack class surveyed in
 * arXiv 2601.17548). Default policy blocks SHADOWING +
 * PATH_TRAVERSAL + ARGUMENT_INJECTION; warns on HIDDEN_HTML +
 * INDIRECT_MARKUP.
 *
 * Config:
 *   PRUNE_SENTINEL_MCP_DISABLED   "1" → no-op.
 *   PRUNE_SENTINEL_MCP_WARN_ONLY  "1" → never block; only emit advisory.
 */

import { scanMcpResponseForInjection } from "@prune/sentinel";

import {
  emitAdditionalContext,
  emitBlock,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

function extractToolResultText(payload) {
  // Claude Code PostToolUse payload exposes `tool_response` or
  // `tool_result_content`. Coerce to string for scanning.
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

safeRun(async () => {
  if (process.env.PRUNE_SENTINEL_MCP_DISABLED === "1") return emitNoop();
  const payload = await readHookPayload();
  const text = extractToolResultText(payload);
  if (!text) return emitNoop();

  const report = scanMcpResponseForInjection(text);
  if (report.verdict === "allow") return emitNoop();

  const warnOnly = process.env.PRUNE_SENTINEL_MCP_WARN_ONLY === "1";

  if (report.verdict === "block" && !warnOnly) {
    return emitBlock(
      `🛡 Sentinel MCP shield blocked.\n${report.reason}\n\n` +
        "If this is a false positive (e.g. legitimate path in tool docs), " +
        "set PRUNE_SENTINEL_MCP_WARN_ONLY=1 to demote to advisory.",
      {
        verdict: report.verdict,
        finding_count: report.injectionFindings.length,
        categories: [...new Set(report.injectionFindings.map((f) => f.category))],
        tool_name: payload.tool_name ?? null,
      }
    );
  }

  return emitAdditionalContext(
    `⚠ Sentinel MCP advisory: ${report.reason}`,
    payload.hook_event_name ?? "PostToolUse",
    {
      verdict: report.verdict,
      finding_count: report.injectionFindings.length,
    }
  );
});

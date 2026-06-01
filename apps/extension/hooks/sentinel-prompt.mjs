#!/usr/bin/env node
/**
 * Sentinel Prompt — UserPromptSubmit hook.
 *
 * Scans the submitted prompt for vendor API keys, private keys, and
 * other documented secret patterns BEFORE the model context picks
 * them up. Blocks on hard matches; warns on high-entropy tokens.
 * Pure pattern library (gitleaks/TruffleHog-style); deterministic
 * decisions a platform engineer can audit.
 *
 * Context: GitGuardian's State of Secrets Sprawl 2026 found
 * AI-assisted commits leak secrets at 3.2% vs 1.5% human baseline
 * (https://oecd.ai/en/incidents/2026-03-17-2273). This hook catches
 * the leak BEFORE it enters the model context — earlier than the
 * pre-commit gates the data is measured against.
 *
 * Config:
 *   PRUNE_SENTINEL_DISABLED   "1" → no-op.
 *   PRUNE_SENTINEL_WARN_ONLY  "1" → never block; only emit advisory.
 */

import { scanPromptForSecrets } from "@prune/sentinel";

import {
  emitAdditionalContext,
  emitBlock,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

safeRun(async () => {
  if (process.env.PRUNE_SENTINEL_DISABLED === "1") return emitNoop();
  const payload = await readHookPayload();
  const text = payload.prompt ?? payload.user_prompt ?? "";
  if (!text || typeof text !== "string") return emitNoop();

  const report = scanPromptForSecrets(text);
  if (report.verdict === "allow") return emitNoop();

  const warnOnly = process.env.PRUNE_SENTINEL_WARN_ONLY === "1";

  if (report.verdict === "block" && !warnOnly) {
    return emitBlock(
      `🛡 Sentinel blocked send.\n${report.reason}\n\n` +
        "If this is a false positive, allowlist the pattern id via " +
        "`PRUNE_SENTINEL_DISABLED=1` or pass `block_on_pattern_ids: []` " +
        "to the sentinel_scan_prompt MCP tool.",
      {
        verdict: report.verdict,
        secret_finding_count: report.secretFindings.length,
        entropy_finding_count: report.entropyFindings.length,
        pattern_ids: [...new Set(report.secretFindings.map((f) => f.patternId))],
      }
    );
  }

  // warn (or block-downgraded-to-warn).
  return emitAdditionalContext(
    `⚠ Sentinel advisory: ${report.reason}`,
    payload.hook_event_name ?? "UserPromptSubmit",
    {
      verdict: report.verdict,
      secret_finding_count: report.secretFindings.length,
      entropy_finding_count: report.entropyFindings.length,
    }
  );
});

#!/usr/bin/env node
/**
 * Edit-Payload Amplification — PreToolUse(Write) hook  (Cost-Security).
 *
 * Before a Write that REWRITES a whole file, check whether a targeted edit would
 * cost far fewer tokens. A one-line change shipped as a full-file rewrite
 * re-sends every line (billed as output) — the "sent" payload dwarfs what
 * "changed". This realizes the roadmap's diff-enforcer-as-PreToolUse advisory
 * (U1), using the sound, round-trip-verified @prune/diff-enforcer via
 * assessEditAmplification.
 *
 * Advisory by default (records the saving opportunity; surfaces where the host
 * supports PreToolUse context). Opt-in hard enforcement via env. Fail-open: any
 * error or non-Write tool passes through untouched.
 *
 * Config:
 *   PRUNE_EDIT_AMP_DISABLED "1" → no-op.
 *   PRUNE_EDIT_AMP_BLOCK    "1" → block the rewrite (exit 2) instead of advising.
 *   PRUNE_EDIT_AMP_MODEL    token model (default gpt-4o).
 */

import { readFileSync, existsSync } from "node:fs";

import { assessEditAmplification } from "@prune/cost-security";

import { emitAdditionalContext, emitBlock, emitNoop, readHookPayload, safeRun } from "./_runtime.mjs";
import { deriveSessionId, recordFeatureEventBestEffort, stableId } from "./_telemetry.mjs";

safeRun(async () => {
  if (process.env.PRUNE_EDIT_AMP_DISABLED === "1") return emitNoop();

  const start = Date.now();
  const payload = await readHookPayload();
  if (payload.tool_name !== "Write") return emitNoop();

  const input = payload.tool_input ?? {};
  const file = typeof input.file_path === "string" ? input.file_path : input.path;
  const proposed = typeof input.content === "string" ? input.content : null;
  if (typeof file !== "string" || proposed === null) return emitNoop();

  // Original = current file content (a brand-new file has no amplification).
  let original = "";
  try {
    if (existsSync(file)) original = readFileSync(file, "utf8");
  } catch {
    return emitNoop();
  }
  if (!original) return emitNoop();

  const model =
    typeof process.env.PRUNE_EDIT_AMP_MODEL === "string" && process.env.PRUNE_EDIT_AMP_MODEL
      ? process.env.PRUNE_EDIT_AMP_MODEL
      : "gpt-4o";

  const report = assessEditAmplification(original, proposed, { model });

  await recordFeatureEventBestEffort({
    featureId: "edit-amplification",
    qualityProof: {
      schemaVersion: 1,
      featureId: "edit-amplification",
      amplified: report.amplified,
      ratio: report.ratio,
      savedTokens: report.savedTokens,
    },
    sessionId: deriveSessionId(payload),
    eventId: `edit-amp-${stableId(payload.transcript_path ?? "", file, String(proposed.length))}`,
    model,
    latencyMs: Date.now() - start,
  });

  if (!report.amplified || !report.advice) return emitNoop();

  const message =
    `✏️ Cost-guard (edit-amplification): ${report.advice} ` +
    `Prefer a targeted Edit over re-writing "${file}" in full.`;

  if (process.env.PRUNE_EDIT_AMP_BLOCK === "1") {
    return emitBlock(message, {
      saved_tokens: report.savedTokens,
      ratio: report.ratio,
      rewrite_tokens: report.rewriteTokens,
      diff_tokens: report.diffTokens,
    });
  }

  return emitAdditionalContext(message, payload.hook_event_name ?? "PreToolUse", {
    saved_tokens: report.savedTokens,
    ratio: report.ratio,
  });
});

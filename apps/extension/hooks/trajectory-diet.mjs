#!/usr/bin/env node
/**
 * F1 — Trajectory Diet hook (PreToolUse).
 *
 * Scores the PROPOSED tool call for predicted influence on the final output.
 * SHIPS SHADOW-FIRST: it records the prediction (for later calibration) and,
 * only once the feature is promoted past shadow, surfaces an advisory. It
 * NEVER blocks and NEVER skips the step — the agent always decides. The online
 * advisor is conservative (utilization is unknowable pre-execution), so F1's
 * high-confidence skips come from offline trajectory analysis; this hook is
 * the online surface for those, gated by the feature flag.
 */

import { loadCachedSessionView } from "@prune/telemetry";
import {
  extractProposedStepFeatures,
  adviseStep,
  TransparentInfluenceModel,
} from "@prune/trajectory-diet";
import { isFeatureEnabled, validateFlags } from "@prune/shared";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  emitAdditionalContext,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

const FLAG_PATH = join(homedir(), ".prune", "feature-flags.json");

function flagsFromDisk() {
  try {
    return validateFlags(JSON.parse(readFileSync(FLAG_PATH, "utf8")));
  } catch {
    return validateFlags(null); // defaults: F1 shadow (not user-visible)
  }
}

safeRun(async () => {
  const payload = await readHookPayload();
  const toolName = payload.tool_name;
  const toolInput = payload.tool_input;
  if (!toolName || !payload.transcript_path) return emitNoop();

  const { turns } = await loadCachedSessionView(payload.transcript_path);
  const features = extractProposedStepFeatures(turns, {
    name: toolName,
    input: toolInput,
  });
  const advisory = adviseStep(features, new TransparentInfluenceModel());

  // Shadow mode: feature not user-visible yet → record nothing surfaced.
  // (Prediction logging to the sink is wired separately; the hook stays a
  // no-op advisory surface until F1 is promoted past shadow.)
  if (!isFeatureEnabled(flagsFromDisk(), "f1")) return emitNoop();

  if (!advisory) return emitNoop();
  return emitAdditionalContext(
    advisory.message,
    payload.hook_event_name ?? "PreToolUse"
  );
});

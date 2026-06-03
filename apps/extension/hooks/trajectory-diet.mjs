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
  modulateAdvisorOptions,
  TransparentInfluenceModel,
} from "@prune/trajectory-diet";
import { readPersistedRegime } from "@prune/context-health";
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
import {
  deriveSessionId,
  recordFeatureEventBestEffort,
  stableId,
} from "./_telemetry.mjs";

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

  const startedAt = performance.now();
  const { turns } = await loadCachedSessionView(payload.transcript_path);
  const features = extractProposedStepFeatures(turns, {
    name: toolName,
    input: toolInput,
  });
  // F1 v2 — graceful degradation: read the F6 regime persisted by the
  // context-health hook and modulate the advisor threshold. When F6
  // hasn't observed anything yet (or context-health isn't installed),
  // readPersistedRegime returns "insufficient_data" ⇒ baseline behavior.
  const regime = readPersistedRegime(payload.transcript_path);
  const options = modulateAdvisorOptions(undefined, regime);
  const advisory = adviseStep(features, new TransparentInfluenceModel(), options);
  const latencyMs = performance.now() - startedAt;

  // Shadow-aware f1 telemetry: record ONLY when the advisor actually fired —
  // this is a PreToolUse hook, so recording every no-op call would be noise.
  // Records regardless of the flag (shadow collects); only the surfaced
  // advisory below is flag-gated. PII-safe: tool name + scores, never the
  // tool input body.
  if (advisory) {
    await recordFeatureEventBestEffort({
      featureId: "f1",
      qualityProof: {
        schemaVersion: 1,
        featureId: "f1",
        toolName,
        regime,
        predictedInfluence: advisory.predictedInfluence,
        projectedTokensSaved: advisory.projectedTokensSaved,
      },
      sessionId: deriveSessionId(payload),
      eventId: `f1-${stableId(payload.transcript_path, String(advisory.stepIndex))}`,
      latencyMs,
    });
  }

  // Shadow mode: feature not user-visible yet → record nothing surfaced.
  if (!isFeatureEnabled(flagsFromDisk(), "f1")) return emitNoop();

  if (!advisory) return emitNoop();
  return emitAdditionalContext(
    advisory.message,
    payload.hook_event_name ?? "PreToolUse"
  );
});

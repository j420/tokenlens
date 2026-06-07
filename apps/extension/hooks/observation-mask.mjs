#!/usr/bin/env node
/**
 * F15 — Observation-Mask Advisor hook (UserPromptSubmit).
 *
 * Reads the live transcript, projects each tool result into an observation with
 * a MEASURED token count (@prune/tokenizer) and a content hash, and runs the
 * @prune/observation-mask planner over a sliding window. The plan says how many
 * stale observations could be collapsed to placeholders and how many tokens
 * that reclaims — capping the transcript's O(n^2) growth at O(n*window).
 *
 * The hook itself never rewrites the transcript (a hook can't); the actuator is
 * the `observation_mask_plan` MCP tool / the agent control plane. This advisor's
 * job is to (a) record shadow telemetry of reclaimable tokens and (b), once
 * promoted, surface a non-blocking advisory recommending masking.
 *
 *   - disabled         → no-op.
 *   - shadow (default) → measure + record telemetry; no user-facing output.
 *   - canary | general → advisory when reclaimable tokens clear the threshold.
 *
 * Config:
 *   PRUNE_OBS_MASK_WINDOW       sliding window in turns (default 6).
 *   PRUNE_OBS_MASK_MIN_RECLAIM  advise only above this reclaim (default 2000).
 *
 * Deterministic (measured tokens + hashes), fail-safe, never calls a model.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { loadCachedSessionView } from "@prune/telemetry";
import { countTokens } from "@prune/tokenizer";
import { sha256Hex } from "@prune/shared/node";
import { isFeatureEnabled, isFeatureInShadow, validateFlags } from "@prune/shared";
import { planMask, DEFAULT_WINDOW_TURNS } from "@prune/observation-mask";

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

const FEATURE_ID = "f15";
const FLAG_PATH = join(homedir(), ".prune", "feature-flags.json");

function flagsFromDisk() {
  try {
    return validateFlags(JSON.parse(readFileSync(FLAG_PATH, "utf8")));
  } catch {
    return validateFlags(null);
  }
}

/** Stringify a tool-result content block deterministically for measurement. */
function observationText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        typeof b === "string"
          ? b
          : b && typeof b.text === "string"
            ? b.text
            : safeJson(b)
      )
      .join("\n");
  }
  return safeJson(content);
}

function safeJson(v) {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

/** Project the transcript's tool results into a measured observation buffer. */
function projectObservations(turns) {
  const observations = [];
  for (const t of turns) {
    const results = Array.isArray(t.toolResults) ? t.toolResults : [];
    let idx = 0;
    for (const r of results) {
      const text = observationText(r?.content);
      if (!text) {
        idx++;
        continue;
      }
      observations.push({
        id: r?.tool_use_id ? String(r.tool_use_id) : `${t.turnNumber}-${idx}`,
        turn: t.turnNumber,
        tokens: countTokens(text),
        contentHash: sha256Hex(text),
      });
      idx++;
    }
  }
  return observations;
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

safeRun(async () => {
  const payload = await readHookPayload();
  if (typeof payload.transcript_path !== "string") return emitNoop();

  const flags = flagsFromDisk();
  const enabled = isFeatureEnabled(flags, FEATURE_ID);
  const shadow = isFeatureInShadow(flags, FEATURE_ID);
  if (!enabled && !shadow) return emitNoop();

  const view = await loadCachedSessionView(payload.transcript_path);
  const turns = Array.isArray(view?.turns) ? view.turns : [];
  if (turns.length === 0) return emitNoop();

  const observations = projectObservations(turns);
  if (observations.length === 0) return emitNoop();

  const currentTurn = turns[turns.length - 1].turnNumber;
  const windowTurns = intEnv("PRUNE_OBS_MASK_WINDOW", DEFAULT_WINDOW_TURNS);
  const plan = planMask(observations, { currentTurn, windowTurns });

  if (plan.reclaimedTokens > 0) {
    await recordFeatureEventBestEffort({
      featureId: FEATURE_ID,
      qualityProof: {
        kind: "observation-mask",
        observations: observations.length,
        masked: plan.masked.length,
        reclaimedTokens: plan.reclaimedTokens,
        retainedTokens: plan.retainedTokens,
        totalTokens: plan.totalTokens,
        windowTurns,
      },
      sessionId: deriveSessionId(payload),
      eventId: `f15-${currentTurn}-${stableId(String(plan.reclaimedTokens)).slice(0, 12)}`,
      model: payload.model ?? null,
      latencyMs: 0,
    });
  }

  if (!enabled) return emitNoop();

  const minReclaim = intEnv("PRUNE_OBS_MASK_MIN_RECLAIM", 2000);
  if (plan.reclaimedTokens < minReclaim) return emitNoop();

  return emitAdditionalContext(
    `⚡ Observation-mask advisory: ${plan.masked.length} stale tool result(s) ` +
      `older than ${windowTurns} turns can be collapsed to placeholders, ` +
      `reclaiming ~${plan.reclaimedTokens} tokens ` +
      `(retained ${plan.retainedTokens} of ${plan.totalTokens}). ` +
      `Use the observation_mask_plan tool to apply.`,
    payload.hook_event_name ?? "UserPromptSubmit",
    { reclaimed_tokens: plan.reclaimedTokens, masked: plan.masked.length }
  );
});

#!/usr/bin/env node
/**
 * E4 / F12 — Skill Capture hook (Stop).
 *
 * When a session ends, distill its INFLUENTIAL trajectory into a reusable
 * typed skill and persist it to the local skill library. The influential
 * subset is the complement of @prune/trajectory-diet's low-influence
 * advisories — the steps that actually shaped the output.
 *
 * Persistence: ~/.prune/skills/library.json (atomic tmp+rename), the same
 * durability discipline the context-health hook uses for its detector state.
 * Capture is idempotent — re-capturing the same logical skill dedups by
 * content hash, so re-running a session never grows the library spuriously.
 *
 * SHADOW SAFETY: building the library is a harmless local write, so capture
 * runs regardless of the flag. The library is only ever SURFACED to the agent
 * by skill-advisor.mjs, which is gated on f12 being enabled. This hook never
 * emits user-facing context, never blocks, never throws, never calls a model.
 *
 * Config (env vars):
 *   PRUNE_SKILLS_PATH    Library JSON path (default ~/.prune/skills/library.json).
 *   PRUNE_SKILLS_DISABLED Set "1" to make this hook a no-op.
 *   PRUNE_SKILLS_MAX     Cap on stored skills (default 200; LRU-by-use prune).
 */

import { homedir } from "node:os";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

import { loadCachedSessionView } from "@prune/telemetry";
import {
  extractStepFeatures,
  summarizeTrajectory,
  TransparentInfluenceModel,
} from "@prune/trajectory-diet";
import {
  SkillLibrary,
  captureSkillFromTrajectory,
  buildCaptureProof,
  SKILL_LIBRARY_FEATURE_ID,
} from "@prune/skill-library";

import { emitNoop, readHookPayload, safeRun } from "./_runtime.mjs";
import {
  deriveSessionId,
  recordFeatureEventBestEffort,
} from "./_telemetry.mjs";

const DEFAULT_PATH = join(homedir(), ".prune", "skills", "library.json");
const MAX_SKILLS = intFromEnv("PRUNE_SKILLS_MAX", 200);

function intFromEnv(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function libraryPath() {
  return process.env.PRUNE_SKILLS_PATH || DEFAULT_PATH;
}

function loadLibrary(path) {
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    return SkillLibrary.fromState(state);
  } catch {
    return new SkillLibrary();
  }
}

function saveLibrary(path, lib) {
  mkdirSync(dirname(path), { recursive: true });
  const json = JSON.stringify(lib.serialize());
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, json, "utf8");
  renameSync(tmp, path);
}

/** Extract the first user prompt's text — the skill's task description. */
function firstUserPrompt(turns) {
  for (const turn of turns) {
    const m = turn.userMessage;
    if (!m) continue;
    const text = flatMessageText(m);
    if (text.trim().length > 0) return text;
  }
  return "";
}

function flatMessageText(m) {
  const c = m?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((b) => (b && typeof b === "object" && typeof b.text === "string" ? b.text : ""))
      .join("\n");
  }
  return "";
}

/** A short, stable label derived from the task prompt's leading words. */
function deriveLabel(prompt) {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .slice(0, 4);
  return words.length > 0 ? words.join("-") : "session-skill";
}

safeRun(async () => {
  if (process.env.PRUNE_SKILLS_DISABLED === "1") return emitNoop();
  const payload = await readHookPayload();
  if (!payload.transcript_path) return emitNoop();

  // Measure REAL analysis wall-clock (load → extract → capture → persist).
  const analysisStart = performance.now();

  const view = await loadCachedSessionView(payload.transcript_path);
  if (view.turns.length < 2) return emitNoop();

  const taskPrompt = firstUserPrompt(view.turns);
  if (taskPrompt.trim().length === 0) return emitNoop();

  const features = extractStepFeatures(view.turns);
  if (features.length === 0) return emitNoop();

  const model = new TransparentInfluenceModel();
  const summary = summarizeTrajectory(features, model);

  // Capture only when there is at least one influential (non-advised) step.
  // captureSkillFromTrajectory throws on an empty influential set; guard first.
  const flagged = new Set(summary.advisories.map((a) => a.stepIndex));
  const hasInfluential = features.some((f) => !flagged.has(f.stepIndex));
  if (!hasInfluential) return emitNoop();

  const lastTurn = view.turns[view.turns.length - 1];
  const skill = captureSkillFromTrajectory({
    taskPrompt,
    label: deriveLabel(taskPrompt),
    features,
    advisories: summary.advisories,
    capturedAtTurn: lastTurn?.turnNumber ?? view.turns.length,
  });

  const path = libraryPath();
  const lib = loadLibrary(path);
  lib.add(skill);
  lib.prune({ maxSkills: MAX_SKILLS });
  saveLibrary(path, lib);

  // Elapsed analysis time (ms) — measured, never fabricated.
  const latencyMs = performance.now() - analysisStart;

  // Best-effort shadow telemetry: record the capture under f12. Keyed by the
  // skill's content hash so re-capturing the same skill upserts (idempotent).
  await recordFeatureEventBestEffort({
    featureId: SKILL_LIBRARY_FEATURE_ID,
    qualityProof: buildCaptureProof(skill),
    sessionId: deriveSessionId(payload),
    eventId: `f12-capture-${skill.contentHash}`,
    tokensIn: skill.discoveryTokens,
    latencyMs,
  });

  return emitNoop();
});

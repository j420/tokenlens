#!/usr/bin/env node
/**
 * E4 / F12 — Skill Advisor hook (UserPromptSubmit).
 *
 * When the user submits a new prompt, fingerprint it and match against the
 * local skill library (built by skill-capture.mjs). If a sufficiently-similar
 * prior skill exists, emit an `additionalContext` advisory that surfaces the
 * cached trajectory so the agent can skip re-discovering the same steps.
 *
 * ADVISORY ONLY. The hint names the influential tool sequence and the projected
 * saving; the agent is free to ignore it. A wrong match costs at most the
 * tokens of one ignored suggestion — never a changed or wrong action. The
 * replay guard (target-freshness) is the host's responsibility before it acts
 * on any suggested step; this hook only surfaces the match.
 *
 * Gated on f12 being enabled (general | canary). In shadow/disabled mode the
 * hook is a pure no-op at the user surface.
 *
 * Config (env vars):
 *   PRUNE_SKILLS_PATH        Library JSON path (default ~/.prune/skills/library.json).
 *   PRUNE_SKILLS_DISABLED    Set "1" to make this hook a no-op.
 *   PRUNE_SKILLS_THRESHOLD   Jaccard match threshold (default 0.5).
 *   PRUNE_SKILLS_MODEL       Model id for the saving projection (default
 *                            claude-sonnet-4-5-20250929).
 *
 * Never blocks, never throws, never calls a model.
 */

import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isFeatureEnabled, validateFlags } from "@prune/shared";
import {
  SkillLibrary,
  projectSkillSaving,
} from "@prune/skill-library";

import {
  emitAdditionalContext,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

const FLAG_PATH = join(homedir(), ".prune", "feature-flags.json");
const DEFAULT_PATH = join(homedir(), ".prune", "skills", "library.json");
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

function flagsFromDisk() {
  try {
    return validateFlags(JSON.parse(readFileSync(FLAG_PATH, "utf8")));
  } catch {
    return validateFlags(null);
  }
}

function loadLibrary(path) {
  try {
    return SkillLibrary.fromState(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return new SkillLibrary();
  }
}

function floatFromEnv(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

safeRun(async () => {
  if (process.env.PRUNE_SKILLS_DISABLED === "1") return emitNoop();
  const payload = await readHookPayload();
  // UserPromptSubmit supplies the prompt text directly.
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (prompt.trim().length === 0) return emitNoop();

  const path = process.env.PRUNE_SKILLS_PATH || DEFAULT_PATH;
  const lib = loadLibrary(path);
  if (lib.size === 0) return emitNoop();

  const threshold = floatFromEnv("PRUNE_SKILLS_THRESHOLD", 0.5);
  const matches = lib.match(prompt, { threshold, limit: 1 });
  if (matches.length === 0) return emitNoop();

  // Surface only when the flag is live.
  const flags = flagsFromDisk();
  if (!isFeatureEnabled(flags, "f12")) return emitNoop();

  const top = matches[0];
  const model = process.env.PRUNE_SKILLS_MODEL || DEFAULT_MODEL;
  const saving = projectSkillSaving(top.skill, model);

  const steps = top.skill.steps
    .map((s) => (s.target ? `${s.toolName}(${s.target})` : s.toolName))
    .join(" → ");
  const savedStr =
    saving.savedUsdPerReuse !== null
      ? ` (~${saving.discoveryTokens} tokens, ~$${saving.savedUsdPerReuse.toFixed(4)})`
      : ` (~${saving.discoveryTokens} tokens)`;

  const text =
    `Prune skill match: "${top.skill.label}" ` +
    `(${Math.round(top.similarity * 100)}% similar, used ${top.skill.useCount}×). ` +
    `A prior session solved a close task with this influential sequence:\n` +
    `  ${steps}\n` +
    `Reusing it can skip the discovery phase${savedStr}. ` +
    `Verify each target still exists before acting on it.`;

  return emitAdditionalContext(
    text,
    payload.hook_event_name ?? "UserPromptSubmit"
  );
});

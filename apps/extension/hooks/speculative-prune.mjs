#!/usr/bin/env node
/**
 * F3 — Speculative Action Pruner hook (PreToolUse), ADVISORY surface.
 *
 * On Claude Code a PreToolUse hook cannot return a tool *result* (only block
 * or modify input), so here F3 is advisory: when the proposed read-only call
 * targets a source that is byte-identical to what was already read this
 * session (freshness token matches the cached entry), it nudges the agent that
 * it already has the current content — saving the re-read's tokens without
 * ever substituting unverified content. Hard, verified substitution lives in
 * the Agent SDK adapter (per the per-surface honesty matrix).
 *
 * Cache is persisted by the PostToolUse recorder (speculative-record.mjs);
 * this hook only reads it. Gated by the F3 feature flag (shadow default ⇒ no-op).
 */

import {
  SpeculativeCache,
  scopeForToolUse,
  contentToken,
} from "@prune/intelligence";
import { isFeatureEnabled, validateFlags } from "@prune/shared";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  emitAdditionalContext,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";

const PRUNE_DIR = join(homedir(), ".prune");
const FLAG_PATH = join(PRUNE_DIR, "feature-flags.json");

function flags() {
  try {
    return validateFlags(JSON.parse(readFileSync(FLAG_PATH, "utf8")));
  } catch {
    return validateFlags(null);
  }
}

function cachePath(transcriptPath) {
  const h = createHash("sha256").update(transcriptPath).digest("hex").slice(0, 16);
  return join(PRUNE_DIR, "cache", `spec-${h}.json`);
}

safeRun(async () => {
  const payload = await readHookPayload();
  const toolName = payload.tool_name;
  const toolInput = payload.tool_input ?? {};
  if (!toolName || !payload.transcript_path) return emitNoop();
  if (!isFeatureEnabled(flags(), "f3")) return emitNoop(); // shadow ⇒ silent

  const scope = scopeForToolUse(toolName, toolInput);
  if (scope !== "Read") return emitNoop(); // advisory only for sound content-SHA scope

  const file = toolInput.file_path ?? toolInput.path;
  if (!file || !existsSync(file)) return emitNoop();

  // Load the session cache the recorder built.
  const cp = cachePath(payload.transcript_path);
  if (!existsSync(cp)) return emitNoop();
  const cache = new SpeculativeCache({ enabledScopes: ["Read"] });
  try {
    cache.loadState(JSON.parse(readFileSync(cp, "utf8")));
  } catch {
    return emitNoop();
  }

  // Probe current freshness from the live file and ask the cache.
  const current = contentToken(readFileSync(file, "utf8"));
  const decision = cache.decide(toolName, toolInput, current);
  if (!decision.substitute) return emitNoop();

  return emitAdditionalContext(
    `Prune (F3): ${file} is unchanged since you read it earlier this session — ` +
      `you already have its current content in context (~${decision.estimatedTokensSaved} ` +
      `tokens). Re-reading is redundant; skip unless you need it re-shown.`,
    payload.hook_event_name ?? "PreToolUse"
  );
});

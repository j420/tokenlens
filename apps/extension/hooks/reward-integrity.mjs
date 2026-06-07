#!/usr/bin/env node
/**
 * F14 — Reward-Integrity Interlock hook (PreToolUse on Write / Edit / MultiEdit).
 *
 * Before a write lands, reconstruct the proposed before/after content and run
 * @prune/reward-integrity over it. The interlock catches an agent weakening,
 * disabling, or tautologizing the tests/grader it is judged against — the
 * classic "make the suite green by editing the suite" reward-hack.
 *
 * Enforcement ladder (driven by the f14 flag mode):
 *   - disabled            → no-op.
 *   - shadow  (default)   → analyze + record telemetry, but NEVER affect the
 *                           write. Pure observation until promoted.
 *   - canary | general    → active. A `violation` (tautology insertion or a
 *                           write to a designated grader) BLOCKS the tool call;
 *                           a `suspicious` change emits a non-blocking advisory.
 *                           Set PRUNE_REWARD_INTEGRITY_WARN_ONLY=1 to demote a
 *                           violation from block to advisory.
 *
 * Config:
 *   PRUNE_REWARD_GRADER_PATHS    comma-separated grader/oracle path suffixes the
 *                                agent must never write.
 *   PRUNE_REWARD_TEST_SUFFIXES   comma-separated extra test-file suffixes.
 *   PRUNE_REWARD_INTEGRITY_WARN_ONLY  "1" → never block; advisory only.
 *
 * Determinism: AST + content-hash only (no regex, no model). Fail-safe: any
 * error exits 0 (the write proceeds) — the interlock must never break the agent.
 */

import { readFileSync } from "node:fs";

import { evaluateRewardIntegrity } from "@prune/reward-integrity";
import { isFeatureEnabled, isFeatureInShadow, validateFlags } from "@prune/shared";

import {
  emitAdditionalContext,
  emitBlock,
  emitNoop,
  readHookPayload,
  safeRun,
} from "./_runtime.mjs";
import {
  deriveSessionId,
  recordFeatureEventBestEffort,
  stableId,
} from "./_telemetry.mjs";
import { homedir } from "node:os";
import { join } from "node:path";

const FEATURE_ID = "f14";
const FLAG_PATH = join(homedir(), ".prune", "feature-flags.json");
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

function flagsFromDisk() {
  try {
    return validateFlags(JSON.parse(readFileSync(FLAG_PATH, "utf8")));
  } catch {
    return validateFlags(null);
  }
}

/** Read on-disk content, or null when the file does not yet exist. */
function readBefore(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Apply a single string edit deterministically (no regex). Null if the anchor
 * is absent (we then skip rather than guess). */
function applyEdit(content, oldString, newString, replaceAll) {
  if (typeof oldString !== "string" || typeof newString !== "string") return null;
  if (oldString === "") return null;
  if (replaceAll) return content.split(oldString).join(newString);
  const idx = content.indexOf(oldString);
  if (idx < 0) return null;
  return content.slice(0, idx) + newString + content.slice(idx + oldString.length);
}

/** Reconstruct { path, before, after } for the proposed write, or null. */
function proposedWrite(toolName, input) {
  if (!input || typeof input.file_path !== "string") return null;
  const path = input.file_path;

  if (toolName === "Write") {
    const after = typeof input.content === "string" ? input.content : null;
    return { path, before: readBefore(path), after };
  }

  if (toolName === "Edit") {
    const before = readBefore(path);
    if (before === null) return null; // editing a file we can't read: skip
    const after = applyEdit(before, input.old_string, input.new_string, input.replace_all === true);
    return after === null ? null : { path, before, after };
  }

  if (toolName === "MultiEdit") {
    const before = readBefore(path);
    if (before === null || !Array.isArray(input.edits)) return null;
    let cur = before;
    for (const e of input.edits) {
      const next = applyEdit(cur, e?.old_string, e?.new_string, e?.replace_all === true);
      if (next === null) return null;
      cur = next;
    }
    return { path, before, after: cur };
  }

  return null;
}

function splitList(envValue) {
  if (typeof envValue !== "string" || envValue.length === 0) return [];
  return envValue
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

safeRun(async () => {
  const payload = await readHookPayload();
  const toolName = payload.tool_name;
  if (!WRITE_TOOLS.has(toolName)) return emitNoop();

  const flags = flagsFromDisk();
  const enabled = isFeatureEnabled(flags, FEATURE_ID);
  const shadow = isFeatureInShadow(flags, FEATURE_ID);
  if (!enabled && !shadow) return emitNoop();

  const write = proposedWrite(toolName, payload.tool_input);
  if (!write) return emitNoop();

  const report = evaluateRewardIntegrity(write, {
    graderPaths: splitList(process.env.PRUNE_REWARD_GRADER_PATHS),
    extraTestSuffixes: splitList(process.env.PRUNE_REWARD_TEST_SUFFIXES),
  });

  // Telemetry in both shadow and active modes (best-effort, never throws).
  if (report.severity !== "ok") {
    await recordFeatureEventBestEffort({
      featureId: FEATURE_ID,
      qualityProof: {
        kind: "reward-integrity",
        path: report.path,
        severity: report.severity,
        codes: report.findings.map((f) => f.code),
      },
      sessionId: deriveSessionId(payload),
      eventId: `f14-${report.severity}-${stableId(write.path + (write.after ?? "")).slice(0, 16)}`,
      model: payload.model ?? null,
      latencyMs: 0,
    });
  }

  // Shadow: observe only, never touch the write.
  if (!enabled) return emitNoop();

  if (report.severity === "ok" || report.severity === "inconclusive") {
    return emitNoop();
  }

  const reason = report.findings.map((f) => `• [${f.code}] ${f.message}`).join("\n");
  const warnOnly = process.env.PRUNE_REWARD_INTEGRITY_WARN_ONLY === "1";

  if (report.severity === "violation" && !warnOnly) {
    return emitBlock(
      `🛡 Reward-Integrity Interlock blocked this write.\n${reason}\n\n` +
        "If this is legitimate (e.g. intentionally retiring a test), set " +
        "PRUNE_REWARD_INTEGRITY_WARN_ONLY=1 to demote to advisory.",
      {
        path: report.path,
        severity: report.severity,
        codes: report.findings.map((f) => f.code),
      }
    );
  }

  return emitAdditionalContext(
    `⚠ Reward-Integrity advisory (${report.severity}):\n${reason}`,
    payload.hook_event_name ?? "PreToolUse",
    { severity: report.severity, path: report.path }
  );
});

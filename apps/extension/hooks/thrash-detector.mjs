#!/usr/bin/env node
/**
 * Thrash Detector — PostToolUse hook  (Cost-Security).
 *
 * Detects file-state oscillation: an agent rewriting a file to state B, then
 * back to a previous state A, then to B again (A->B->A->B...). Each lap re-reads
 * and re-sends the file and burns an output rewrite for ZERO net progress — pure
 * waste that can run for many turns before a human notices.
 *
 * After each Write/Edit/MultiEdit this hook hashes the file's NEW content
 * (deterministically, from disk — no content stored, only the SHA), appends it
 * to the per-session timeline, and runs the deterministic oscillation detector
 * in @prune/cost-security. On a confirmed loop it advises the agent to step
 * back and change approach rather than continue the cycle.
 *
 * Fail-open: never blocks. Config:
 *   PRUNE_THRASH_DISABLED   "1" → no-op.
 *   PRUNE_THRASH_MIN_CYCLES override the oscillation threshold (default 2).
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { detectThrash } from "@prune/cost-security";

import { emitAdditionalContext, emitNoop, readHookPayload, safeRun } from "./_runtime.mjs";
import { deriveSessionId, recordFeatureEventBestEffort, stableId } from "./_telemetry.mjs";
import { updateSessionStore } from "./_session-store.mjs";

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

function sha12(content) {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12);
}

function posIntEnv(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

safeRun(async () => {
  if (process.env.PRUNE_THRASH_DISABLED === "1") return emitNoop();

  const start = Date.now();
  const payload = await readHookPayload();
  const toolName = payload.tool_name;
  if (!EDIT_TOOLS.has(toolName)) return emitNoop();

  const input = payload.tool_input ?? {};
  const file = typeof input.file_path === "string" ? input.file_path : input.path;
  if (typeof file !== "string" || !file) return emitNoop();

  // Hash the post-edit content from disk (the file already changed). Content is
  // never stored — only its SHA — so the timeline carries no source bytes.
  let sha;
  try {
    sha = sha12(readFileSync(file, "utf8"));
  } catch {
    return emitNoop(); // file gone / unreadable — nothing to record
  }

  const minCycles = posIntEnv("PRUNE_THRASH_MIN_CYCLES") ?? 2;

  const store = updateSessionStore(payload.transcript_path, (s) => {
    s.seq += 1;
    s.fileTimeline.push({ turn: s.seq, path: file, sha });
  });

  const report = detectThrash(store.fileTimeline, { minCycles });
  const finding = report.findings.find((f) => f.path === file) ?? null;

  await recordFeatureEventBestEffort({
    featureId: "thrash-detector",
    qualityProof: {
      schemaVersion: 1,
      featureId: "thrash-detector",
      verdict: report.verdict,
      cycles: finding ? finding.cycles : 0,
      wastedEdits: finding ? finding.wastedEdits : 0,
    },
    sessionId: deriveSessionId(payload),
    eventId: `thrash-${stableId(payload.transcript_path ?? "", file, sha)}`,
    latencyMs: Date.now() - start,
  });

  // Only advise when THIS file is the one oscillating (avoid stale nags).
  if (report.verdict !== "warn" || !finding) return emitNoop();

  return emitAdditionalContext(
    `🔁 Cost-guard (thrash): "${file}" has returned to a previous state ${finding.cycles} times ` +
      `(${finding.wastedEdits} edit${finding.wastedEdits === 1 ? "" : "s"} produced no net change). ` +
      `You appear to be in an edit loop — stop re-applying the same change. Re-read the failing ` +
      `signal once, form a different hypothesis, or ask for guidance before editing again.`,
    payload.hook_event_name ?? "PostToolUse",
    { verdict: report.verdict, cycles: finding.cycles, wasted_edits: finding.wastedEdits }
  );
});

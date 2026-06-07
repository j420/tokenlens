#!/usr/bin/env node
/**
 * Navigation-to-Edit Ratio — PostToolUse hook  (Cost-Security).
 *
 * After an agent has localized a fix, the common cheap failure is *over-
 * exploration*: turn after turn of read-class calls (Read/Grep/Glob/LS, or the
 * equivalent in other runtimes) over files it has ALREADY seen, with zero edits
 * in between. Every such turn re-transmits the growing context for no edit.
 *
 * This hook replays the session view, projects each turn's tool calls onto the
 * deterministic detector in @prune/cost-security, and — when the window shows no
 * mutations, enough navigation, and a re-visited path — advises the agent to act
 * on what it has already read rather than keep exploring. Advisory; never blocks.
 *
 * Runtime-neutral: tool classification uses the cross-runtime default vocabulary
 * (Claude Code / Cursor / Codex). Override per-runtime via
 *   PRUNE_NAV_TOOLS / PRUNE_MUT_TOOLS  (comma-separated tool names).
 * Other config:
 *   PRUNE_NAV_RATIO_DISABLED "1" → no-op.
 *   PRUNE_NAV_RATIO_WINDOW   override the turn window (default 4).
 *   PRUNE_NAV_RATIO_FLOOR    override the navigation-call floor (default 5).
 */

import { loadCachedSessionView } from "@prune/telemetry";
import { assessNavigationRatio } from "@prune/cost-security";

import { emitAdditionalContext, emitNoop, readHookPayload, safeRun } from "./_runtime.mjs";
import { deriveSessionId, recordFeatureEventBestEffort, stableId } from "./_telemetry.mjs";

function pickPath(input) {
  if (input && typeof input === "object") {
    if (typeof input.file_path === "string") return input.file_path;
    if (typeof input.path === "string") return input.path;
    if (typeof input.notebook_path === "string") return input.notebook_path;
  }
  return null;
}

function posIntEnv(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

function nameListEnv(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : undefined;
}

safeRun(async () => {
  if (process.env.PRUNE_NAV_RATIO_DISABLED === "1") return emitNoop();

  const start = Date.now();
  const payload = await readHookPayload();
  if (!payload.transcript_path) return emitNoop();

  const { turns } = await loadCachedSessionView(payload.transcript_path);
  if (turns.length < 2) return emitNoop();

  const navTurns = turns.map((t) => ({
    turn: t.turnNumber,
    tools: (t.toolUses ?? []).map((u) => ({ name: u.name, path: pickPath(u.input) })),
  }));

  const options = {};
  const window = posIntEnv("PRUNE_NAV_RATIO_WINDOW");
  if (window !== undefined) options.window = window;
  const navFloor = posIntEnv("PRUNE_NAV_RATIO_FLOOR");
  if (navFloor !== undefined) options.navFloor = navFloor;
  const navTools = nameListEnv("PRUNE_NAV_TOOLS");
  if (navTools !== undefined) options.navTools = navTools;
  const mutTools = nameListEnv("PRUNE_MUT_TOOLS");
  if (mutTools !== undefined) options.mutTools = mutTools;

  const report = assessNavigationRatio(navTurns, options);

  await recordFeatureEventBestEffort({
    featureId: "navigation-ratio",
    qualityProof: {
      schemaVersion: 1,
      featureId: "navigation-ratio",
      verdict: report.verdict,
      navCount: report.navCount,
      mutCount: report.mutCount,
      revisited: report.revisitedPaths.length,
    },
    sessionId: deriveSessionId(payload),
    eventId: `nav-ratio-${stableId(payload.transcript_path ?? "", String(turns.length))}`,
    latencyMs: Date.now() - start,
  });

  if (report.verdict !== "warn") return emitNoop();

  const paths = report.revisitedPaths.slice(0, 3).join(", ");
  return emitAdditionalContext(
    `🧭 Cost-guard (navigation): the last ${report.turnsConsidered} turns made ${report.navCount} ` +
      `read/search calls and zero edits, re-visiting ${report.revisitedPaths.length} file` +
      `${report.revisitedPaths.length === 1 ? "" : "s"} (${paths}). You appear to have already ` +
      `localized the work — act on what you've read (make the edit) instead of continuing to explore.`,
    payload.hook_event_name ?? "PostToolUse",
    {
      verdict: report.verdict,
      nav_count: report.navCount,
      revisited: report.revisitedPaths.length,
    }
  );
});

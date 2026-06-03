#!/usr/bin/env node
/**
 * Local→dashboard telemetry forwarder hook (Stop).
 *
 * Closes the observability loop (pending action 1.4): the recording hooks / MCP
 * server write feature telemetry to the developer's local
 * `~/.prune/events.sqlite`, but nothing forwarded it to a hosted dashboard, so a
 * deployed dashboard read zero real telemetry. This hook, on session Stop,
 * ships the unsent FORWARDABLE rows (feature-tagged events only — no file
 * bodies, aggregate-only quality_proof) to the dashboard ingest, resuming from
 * a persisted high-water-mark cursor so re-runs never re-send.
 *
 * OPT-IN: forwarding sends data off-machine, so the hook is a pure no-op unless
 * PRUNE_FORWARD_ENDPOINT is set. PRUNE_TELEMETRY_DISABLED=1 also forces it off.
 *
 * FAIL-SAFE: the whole run is best-effort. A missing DB, a held write-lock (a
 * recording hook is mid-write), or any network failure resolves quietly; the
 * hook always exits 0 and never blocks the agent.
 *
 * Config (env vars):
 *   PRUNE_FORWARD_ENDPOINT     Dashboard ingest URL, e.g.
 *                              https://your-dashboard/api/v1/events. REQUIRED to
 *                              do anything; unset ⇒ no-op.
 *   PRUNE_EVENTS_SQLITE        Local events DB (default ~/.prune/events.sqlite).
 *   PRUNE_FORWARD_CURSOR       Cursor file (default ~/.prune/forward-cursor.json).
 *   PRUNE_FORWARD_BATCH        Rows per DB page (default 100).
 *   PRUNE_FORWARD_MAX          Max rows shipped per run (default 500).
 *   PRUNE_FORWARD_TIMEOUT_MS   Per-request timeout (default 5000).
 *   PRUNE_TELEMETRY_DISABLED   Set "1" to disable all telemetry I/O.
 *
 * Never blocks, never throws, never calls a model.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { runForwardOnce } from "@prune/persistence";

import { emitNoop, readHookPayload, safeRun } from "./_runtime.mjs";

const DEFAULT_DB = join(homedir(), ".prune", "events.sqlite");
const DEFAULT_CURSOR = join(homedir(), ".prune", "forward-cursor.json");

/**
 * Refuse pseudo-filesystem paths up front: a mkdir/stat under /proc or /sys
 * blocks at the syscall level (a synchronous hang no JS timeout can rescue).
 * Mirrors _telemetry.mjs.
 */
function isUnsafePath(p) {
  let abs;
  try {
    abs = resolve(p);
  } catch {
    return true;
  }
  return (
    abs === "/proc" ||
    abs === "/sys" ||
    abs.startsWith("/proc/") ||
    abs.startsWith("/sys/")
  );
}

function positiveIntEnv(name) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : undefined;
}

safeRun(async () => {
  // Drain stdin so the hook protocol is satisfied even though Stop carries
  // nothing we need here.
  await readHookPayload();

  if (process.env.PRUNE_TELEMETRY_DISABLED === "1") return emitNoop();

  const endpoint = process.env.PRUNE_FORWARD_ENDPOINT;
  if (!endpoint) return emitNoop(); // opt-in: no endpoint ⇒ nothing to do

  const dbPath = process.env.PRUNE_EVENTS_SQLITE || DEFAULT_DB;
  const cursorPath = process.env.PRUNE_FORWARD_CURSOR || DEFAULT_CURSOR;
  if (isUnsafePath(dbPath) || isUnsafePath(cursorPath)) {
    process.stderr.write(
      `prune-forward: refusing pseudo-filesystem path; skipping.\n`
    );
    return emitNoop();
  }

  const res = await runForwardOnce({
    dbPath,
    endpoint,
    cursorPath,
    batchSize: positiveIntEnv("PRUNE_FORWARD_BATCH"),
    maxEvents: positiveIntEnv("PRUNE_FORWARD_MAX"),
    timeoutMs: positiveIntEnv("PRUNE_FORWARD_TIMEOUT_MS"),
  });

  // Diagnostics only (stderr); Stop does not consume additionalContext.
  if (res.attempted > 0) {
    process.stderr.write(
      `prune-forward: sent ${res.sent}/${res.attempted}` +
        (res.stoppedOnFailure ? " (stopped on a delivery failure)" : "") +
        ".\n"
    );
  }
  return emitNoop();
});

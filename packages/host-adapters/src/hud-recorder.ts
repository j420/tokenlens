/**
 * recordHudTransition — the f5 reference recorder a host injects into the HUD's
 * `onSeverityTransition` callback (apps/extension/src/hud.ts:activateHud).
 *
 * The HUD computes a PII-safe f5 `quality_proof` on a spend-severity zone
 * transition (green↔yellow↔red) via `buildHudQualityProof`, then hands it to an
 * injected recorder so the actual sink write rides OFF the render hot path.
 * This is that recorder: it records the proof as an EventRow via
 * @prune/persistence's `recordFeatureEvent` + `LocalSqliteSink`.
 *
 * It mirrors the _telemetry.mjs discipline EXACTLY, because a recorder failure
 * must never affect the status bar:
 *   - Fire-and-forget, best-effort: ANY error (lock contention, disk, bad
 *     params) is swallowed. Returns true on a landed row, false otherwise.
 *     NEVER throws.
 *   - Gated by PRUNE_TELEMETRY_DISABLED=1 ⇒ no-op, returns false.
 *   - Refuses pseudo-filesystem paths (/proc, /sys) up front: a mkdir lookup
 *     under /proc blocks at the syscall level — a synchronous hang no JS
 *     timeout can rescue — so we never even open the sink there.
 *   - Sink opened + closed per call; close() flushes and releases the lock.
 *
 * NO fabrication: the recorder copies only what the proof and the caller
 * actually carry. The featureId comes from the proof's own `featureId` field
 * (the HUD stamps it as "f5"); we never invent costs or token counts the proof
 * didn't include — those default to neutral zeros inside buildFeatureEventRow.
 */

import { resolve } from "node:path";

import { LocalSqliteSink, recordFeatureEvent } from "@prune/persistence";

export interface RecordHudTransitionParams {
  /**
   * The f5 quality_proof object from `buildHudQualityProof`. Recorded verbatim
   * as the EventRow's `quality_proof`. Must be a plain object.
   */
  qualityProof: Record<string, unknown>;
  /** Absolute path to the events sqlite sink. */
  sinkPath: string;
  /** Session this transition belongs to. Default "unknown-session". */
  sessionId?: string;
  /**
   * Deterministic idempotency key. Re-recording the same transition with the
   * same id upserts rather than duplicates. Default: derived from the proof's
   * from/to severities + sessionId (so identical transitions de-dupe). When the
   * caller wants per-occurrence rows it should pass a unique eventId.
   */
  eventId?: string;
  /** Model in context, when the host knows it. Default "unknown". */
  model?: string;
  /** ISO 8601 timestamp. Default: now (the recorder's own write time). */
  timestamp?: string;
}

/**
 * Pseudo-filesystems are never valid sqlite locations AND a mkdir lookup under
 * /proc blocks at the syscall level. Refuse them so a misconfigured sink path
 * can never freeze the host. Mirrors apps/extension/hooks/_telemetry.mjs.
 */
export function isUnsafeSinkPath(p: string): boolean {
  let abs: string;
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

/** Stable feature id read off the proof, defaulting to "f5". */
function featureIdOf(proof: Record<string, unknown>): string {
  const id = proof?.featureId;
  return typeof id === "string" && id ? id : "f5";
}

/** Stable, deterministic default event id from the transition's own fields. */
function defaultEventId(proof: Record<string, unknown>, sessionId: string): string {
  const from = typeof proof?.from === "string" ? proof.from : "?";
  const to = typeof proof?.to === "string" ? proof.to : "?";
  return `${featureIdOf(proof)}-transition-${sessionId}-${from}-${to}`;
}

/** Read a non-negative finite number off the proof, else undefined. */
function num(proof: Record<string, unknown>, key: string): number | undefined {
  const v = proof?.[key];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * Record one HUD severity transition, best-effort. Returns true on a landed
 * row, false if disabled / unsafe path / any swallowed failure. NEVER throws.
 */
export async function recordHudTransition(
  params: RecordHudTransitionParams
): Promise<boolean> {
  // Gate FIRST — a disabled recorder does no filesystem work at all.
  if (process.env.PRUNE_TELEMETRY_DISABLED === "1") return false;

  // Guard the inputs without throwing.
  const proof =
    params && params.qualityProof && typeof params.qualityProof === "object"
      ? params.qualityProof
      : null;
  if (!proof) return false;
  if (!params.sinkPath || typeof params.sinkPath !== "string") return false;
  if (isUnsafeSinkPath(params.sinkPath)) return false;

  const sessionId =
    typeof params.sessionId === "string" && params.sessionId
      ? params.sessionId
      : "unknown-session";

  let sink: LocalSqliteSink | null = null;
  try {
    sink = new LocalSqliteSink({ path: params.sinkPath });
    await sink.init();
    await recordFeatureEvent(sink, {
      featureId: featureIdOf(proof),
      qualityProof: proof,
      sessionId,
      eventId:
        typeof params.eventId === "string" && params.eventId
          ? params.eventId
          : defaultEventId(proof, sessionId),
      model: params.model,
      timestamp: params.timestamp,
      // Copy ONLY figures the proof actually carries; never fabricate. The
      // f5 proof uses `costUsd` for the triggering spend; tokens for the count.
      estimatedCostUsd: num(proof, "costUsd"),
      tokensIn: num(proof, "tokens"),
    });
    return true;
  } catch {
    // Best-effort: a busy lock or any other error must never surface.
    return false;
  } finally {
    if (sink) {
      try {
        await sink.close();
      } catch {
        /* ignore close errors */
      }
    }
  }
}

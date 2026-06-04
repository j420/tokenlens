/**
 * Caller-side feature-telemetry recording for the MCP server.
 *
 * The pure TCRP handlers in `tcrp-tools.ts` (tool_audit → f2, qpd_report → f4,
 * cache_habits → f9, mcp_proxy_trim → f10, replay_cost_plan → f11) RETURN a
 * `quality_proof` but
 * record nothing — they must stay pure so their unit tests stay pure. This
 * module is the *caller*
 * side: the `index.ts` CallTool dispatch hands it the (already-serialized)
 * handler result and we best-effort persist the proof as a feature EventRow
 * via `@prune/persistence`, AFTER the handler returns.
 *
 * It mirrors the discipline of `apps/extension/hooks/_telemetry.mjs`:
 *   - GATED behind PRUNE_MCP_TELEMETRY=1. Default OFF, so existing tests and
 *     the existing server behavior are completely unchanged.
 *   - PRUNE_TELEMETRY_DISABLED=1 also forces it off (shared kill-switch).
 *   - The events DB defaults to ~/.prune/events.sqlite (override with
 *     PRUNE_EVENTS_SQLITE).
 *   - Pseudo-filesystem paths (/proc, /sys) are REFUSED up front: a `mkdir`
 *     lookup under procfs blocks at the syscall level — a synchronous hang no
 *     JS timeout can rescue.
 *   - ANY failure (bad JSON, no proof, lock contention, disk) is swallowed.
 *     Recording NEVER throws out of the dispatch and never changes the
 *     response the caller already got.
 *   - The event_id is deterministic (hash of feature + canonical proof) so a
 *     re-fired identical tool call upserts rather than duplicates.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

import {
  LocalSqliteSink,
  recordFeatureEvent,
  type FeatureEventParams,
} from "@prune/persistence";

const DEFAULT_DB = join(homedir(), ".prune", "events.sqlite");

/** Tool name → TCRP feature id. Only these tools record. */
const TOOL_FEATURE_IDS: Record<string, string> = {
  tool_audit: "f2",
  qpd_report: "f4",
  cache_habits: "f9",
  cache_habits_from_transcript: "f9",
  mcp_proxy_trim: "f10",
  replay_cost_plan: "f11",
};

export function isFeatureTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PRUNE_TELEMETRY_DISABLED === "1") return false;
  return env.PRUNE_MCP_TELEMETRY === "1";
}

export function eventsDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRUNE_EVENTS_SQLITE || DEFAULT_DB;
}

/**
 * Refuse pseudo-filesystem paths. See _telemetry.mjs for the full rationale:
 * a mkdir under /proc or /sys hangs synchronously and cannot be timed out.
 */
export function isUnsafeTelemetryPath(p: string): boolean {
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

/** Stable short hash for deterministic, idempotent event ids. */
export function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join(" ")).digest("hex").slice(0, 32);
}

/**
 * Parse a handler's JSON result and extract the recordable feature proof.
 * Returns null when the tool is not a recording tool, the result isn't JSON,
 * it's an error response, or it carries no `quality_proof`/`featureId`.
 * Pure (no I/O, no env) so it's trivially testable.
 */
export function extractFeatureProof(
  toolName: string,
  resultJson: string
): { featureId: string; qualityProof: Record<string, unknown> } | null {
  const featureId = TOOL_FEATURE_IDS[toolName];
  if (!featureId) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  // A handler error response (e.g. bad input) carries `error` and no proof.
  if (typeof obj.error === "string") return null;

  const proof = obj.quality_proof;
  if (!proof || typeof proof !== "object") return null;

  // Trust the proof's own featureId when present (it is for f10/f11); fall back
  // to the tool→id map. Never fabricate a different id.
  const proofFeatureId =
    typeof (proof as Record<string, unknown>).featureId === "string"
      ? ((proof as Record<string, unknown>).featureId as string)
      : featureId;

  return { featureId: proofFeatureId, qualityProof: proof as Record<string, unknown> };
}

/**
 * Best-effort recording of a TCRP tool's quality_proof as a feature EventRow.
 * Returns true on a written row, false when disabled / not recordable / on any
 * swallowed failure. NEVER throws.
 *
 * @param toolName    The dispatched MCP tool name.
 * @param resultJson  The handler's serialized JSON result (already returned to the caller).
 * @param sessionId   Optional session id; defaults to "mcp-server".
 * @param env         Override for tests.
 */
export async function recordToolFeatureEventBestEffort(
  toolName: string,
  resultJson: string,
  sessionId = "mcp-server",
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  try {
    if (!isFeatureTelemetryEnabled(env)) return false;

    const extracted = extractFeatureProof(toolName, resultJson);
    if (!extracted) return false;

    const path = eventsDbPath(env);
    if (isUnsafeTelemetryPath(path)) {
      process.stderr.write(
        `prune-mcp-telemetry: refusing pseudo-filesystem path ${path}; skipping.\n`
      );
      return false;
    }

    // Deterministic, idempotent id: same feature + same proof bytes ⇒ same id,
    // so a re-fired identical tool call upserts (INSERT OR REPLACE) rather than
    // duplicating. Canonical JSON via JSON.stringify on the already-built proof.
    const eventId = `mcp-${extracted.featureId}-${stableId(
      extracted.featureId,
      JSON.stringify(extracted.qualityProof)
    )}`;

    const params: FeatureEventParams = {
      featureId: extracted.featureId,
      qualityProof: extracted.qualityProof,
      sessionId,
      eventId,
      tool: `prune-mcp-${toolName}`,
    };

    let sink: LocalSqliteSink | null = null;
    try {
      sink = new LocalSqliteSink({ path });
      await sink.init();
      await recordFeatureEvent(sink, params);
      return true;
    } finally {
      if (sink) {
        try {
          await sink.close();
        } catch {
          /* ignore close errors */
        }
      }
    }
  } catch (err) {
    // Best-effort: any failure must not surface to the dispatch / the caller.
    try {
      process.stderr.write(
        `prune-mcp-telemetry: skipped (${(err as Error)?.message ?? err})\n`
      );
    } catch {
      /* ignore */
    }
    return false;
  }
}

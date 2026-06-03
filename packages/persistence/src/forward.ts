/**
 * Local→dashboard feature-telemetry forwarder.
 *
 * The recording hooks / MCP server write feature telemetry to the developer's
 * local `~/.prune/events.sqlite`. Nothing forwarded that to the hosted ingest
 * API, so a deployed dashboard read zero real telemetry (pending action 1.4).
 * This module closes that loop: it reads the FORWARDABLE subset (feature-tagged
 * events only — they carry no file bodies and an aggregate-only quality_proof)
 * and POSTs each, in order, to the dashboard's `POST /api/v1/events` ingest.
 *
 * Discipline (load-bearing, not decoration):
 *   - OPT-IN. Forwarding sends data off-machine, so the hook only runs when the
 *     caller supplies an endpoint. No endpoint ⇒ no network I/O.
 *   - FAIL-SAFE. Every network/disk failure is contained; a failure stops the
 *     run (so the cursor never skips an undelivered event) but never throws to
 *     the hook. The agent's workflow can never break because forwarding failed.
 *   - IN-ORDER, NO GAPS. Events ship in (timestamp, event_id) order; the cursor
 *     advances only PAST a row that was accepted (HTTP ok). A mid-batch failure
 *     leaves the cursor at the last success, so the next run retries from there.
 *   - BOUNDED. At most `maxEvents` per run, read in `batchSize` pages, with a
 *     per-request `timeoutMs` (AbortController) so a hung endpoint can't wedge
 *     the hook.
 *   - AT-LEAST-ONCE. The cursor is persisted after EACH accepted event, so a
 *     crash between POST and cursor-save re-sends at most ONE event. The ingest
 *     receives a deterministic `id` (the event_id) so a server that dedups can;
 *     today's dashboard store does not, so a duplicate is possible exactly in
 *     that crash window — documented, bounded, never silently lost.
 *   - PII-SAFE. Only feature rows are forwarded; usage columns are 0 and the
 *     quality_proof is aggregate-only by construction (counts/hashes).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { EventRow, EventCursor } from "./sink.js";
import { LocalSqliteSink } from "./local-sqlite.js";

/** The slice of LocalSqliteSink the forwarder needs (keeps the core testable). */
export interface ForwardableSource {
  getForwardableEvents(
    cursor: EventCursor | null,
    limit?: number
  ): Promise<EventRow[]>;
}

/** Minimal fetch shape — injected so the core is testable without a network. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<{ ok: boolean; status: number }>;

export interface ForwardOptions {
  endpoint: string;
  fetchImpl: FetchLike;
  /** Resume point; null forwards from the beginning of the feature stream. */
  cursor?: EventCursor | null;
  /** Rows per DB page (default 100). */
  batchSize?: number;
  /** Hard cap on rows shipped in one run (default 500). */
  maxEvents?: number;
  /** Per-request timeout in ms (default 5000). */
  timeoutMs?: number;
  /**
   * Persist the advanced cursor after each accepted event. Best-effort: a
   * persistence failure is swallowed (the in-memory cursor still advances so the
   * rest of THIS run doesn't re-send), but the next run may re-ship from the
   * last durably-saved point. Optional.
   */
  onCursorAdvance?: (cursor: EventCursor) => void | Promise<void>;
}

export interface ForwardResult {
  /** Rows we attempted to POST. */
  attempted: number;
  /** Rows the endpoint accepted (HTTP ok). */
  sent: number;
  /** Rows that failed (network error or non-ok status). At most 1 — we stop. */
  failures: number;
  /** Cursor after the last accepted event (null if nothing was sent and none prior). */
  nextCursor: EventCursor | null;
  /** True when the run halted early on a delivery failure. */
  stoppedOnFailure: boolean;
}

/** Map an EventRow onto the dashboard ingest's accepted (snake_case) shape. */
export function eventToIngestPayload(row: EventRow): Record<string, unknown> {
  return {
    // Deterministic id so a dedup-capable server is idempotent.
    id: row.event_id,
    timestamp: row.timestamp,
    provider: row.provider,
    tool: row.tool,
    model: row.model,
    // snake_case usage fields (the ingest accepts either casing).
    tokens_in: row.tokens_in,
    tokens_out: row.tokens_out,
    estimated_cost_usd: row.estimated_cost_usd,
    latency_ms: row.latency_ms,
    // The feature tags the dashboard's f1–f13 aggregator reads.
    feature_id: row.feature_id ?? null,
    quality_proof: row.quality_proof ?? null,
  };
}

/** POST one event with a timeout. Returns ok/false; never throws. */
async function postOne(
  endpoint: string,
  fetchImpl: FetchLike,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return !!res && res.ok === true;
  } catch {
    // Network error, abort/timeout, or a misbehaving fetch impl — treat as a
    // delivery failure so the caller stops and retries this row next run.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Forward feature events from `source` to the ingest endpoint, in order,
 * stopping on the first delivery failure. Pure of any global state — the source,
 * fetch, and cursor persistence are all injected. Never throws.
 */
export async function forwardFeatureEvents(
  source: ForwardableSource,
  opts: ForwardOptions
): Promise<ForwardResult> {
  const batchSize = clampPositive(opts.batchSize, 100);
  const maxEvents = clampPositive(opts.maxEvents, 500);
  const timeoutMs = clampPositive(opts.timeoutMs, 5000);

  let cursor: EventCursor | null = opts.cursor ?? null;
  let attempted = 0;
  let sent = 0;
  let failures = 0;
  let stoppedOnFailure = false;

  while (sent + failures < maxEvents && !stoppedOnFailure) {
    const remaining = maxEvents - (sent + failures);
    const page = Math.min(batchSize, remaining);
    let rows: EventRow[];
    try {
      rows = await source.getForwardableEvents(cursor, page);
    } catch {
      // A read failure is non-fatal: nothing shipped this run, retry next time.
      break;
    }
    if (rows.length === 0) break; // caught up

    for (const row of rows) {
      attempted++;
      const ok = await postOne(
        opts.endpoint,
        opts.fetchImpl,
        eventToIngestPayload(row),
        timeoutMs
      );
      if (!ok) {
        failures++;
        stoppedOnFailure = true;
        break; // do NOT advance past an undelivered event
      }
      sent++;
      cursor = { timestamp: row.timestamp, eventId: row.event_id };
      if (opts.onCursorAdvance) {
        try {
          await opts.onCursorAdvance(cursor);
        } catch {
          // Persisting the cursor is best-effort; the in-memory cursor still
          // advances so the rest of this run won't re-send.
        }
      }
    }

    if (rows.length < page) break; // last partial page — nothing more to read
  }

  return { attempted, sent, failures, nextCursor: cursor, stoppedOnFailure };
}

function clampPositive(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.trunc(v)
    : fallback;
}

// ---------------------------------------------------------------------------
// Cursor persistence (small JSON file at the caller-supplied path).
// ---------------------------------------------------------------------------

/** Read the saved cursor, or null if absent/corrupt. Never throws. */
export function loadCursor(path: string): EventCursor | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const c = parsed as Record<string, unknown>;
    if (typeof c.timestamp === "string" && typeof c.eventId === "string") {
      return { timestamp: c.timestamp, eventId: c.eventId };
    }
    return null;
  } catch {
    return null;
  }
}

/** Atomically persist the cursor (tmp + rename). Throws only on a real FS error. */
export function saveCursor(path: string, cursor: EventCursor): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(cursor));
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* temp may not exist */
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Orchestration: open the local sink, forward one bounded run, persist cursor.
// ---------------------------------------------------------------------------

export interface RunForwardOptions {
  /** Path to the local events.sqlite. */
  dbPath: string;
  /** Dashboard ingest URL (e.g. https://host/api/v1/events). */
  endpoint: string;
  /** Where to persist the high-water-mark cursor. */
  cursorPath: string;
  /** Defaults to the global fetch. */
  fetchImpl?: FetchLike;
  batchSize?: number;
  maxEvents?: number;
  timeoutMs?: number;
}

/**
 * One bounded forward run: load cursor → open local sink → forward → close.
 * The cursor is saved after each accepted event. Fail-safe: a missing DB, a
 * held write-lock (a recording hook is mid-write), a read error, or any network
 * failure resolves to a ForwardResult rather than throwing. Callers (the hook)
 * still wrap this, but it is self-contained.
 */
export async function runForwardOnce(
  opts: RunForwardOptions
): Promise<ForwardResult> {
  const empty: ForwardResult = {
    attempted: 0,
    sent: 0,
    failures: 0,
    nextCursor: null,
    stoppedOnFailure: false,
  };

  // Nothing to forward if the DB doesn't exist yet.
  if (!existsSync(opts.dbPath)) return empty;

  const fetchImpl =
    opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (typeof fetchImpl !== "function") return empty; // no fetch available

  const cursor = loadCursor(opts.cursorPath);

  let sink: LocalSqliteSink | null = null;
  try {
    sink = new LocalSqliteSink({ path: opts.dbPath });
    await sink.init(); // acquires the single-writer lock; throws if held
  } catch {
    // DB locked by a concurrent writer, or open failed — best-effort skip.
    if (sink) {
      try {
        await sink.close();
      } catch {
        /* ignore */
      }
    }
    return { ...empty, nextCursor: cursor };
  }

  try {
    return await forwardFeatureEvents(sink, {
      endpoint: opts.endpoint,
      fetchImpl,
      cursor,
      batchSize: opts.batchSize,
      maxEvents: opts.maxEvents,
      timeoutMs: opts.timeoutMs,
      onCursorAdvance: (c) => saveCursor(opts.cursorPath, c),
    });
  } finally {
    try {
      await sink.close();
    } catch {
      /* ignore close errors */
    }
  }
}

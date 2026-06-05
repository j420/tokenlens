/**
 * Per-session state store (Cost-Security cross-turn accumulator).
 *
 * Several cost-security detectors need state that only exists ACROSS turns — a
 * file's content-hash timeline (thrash), an ingested-source/downstream-action
 * ledger (injection-cost). Hooks fire per-event with no shared memory, so this
 * provides a tiny, atomic, bounded JSON store keyed by the session transcript.
 *
 * DISCIPLINE:
 *   - Best-effort & total. Never throws; a corrupt/missing file yields a fresh
 *     default; a failed write is swallowed (the detector simply sees less data).
 *   - PII-safe. Callers store paths + content SHAs + token counts only — never
 *     file bodies or prompt text.
 *   - Bounded. Arrays are capped (ring-buffer trim) so a long session cannot
 *     grow the file without limit.
 *   - Atomic. tmp + rename, mirroring speculative-record.mjs.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const STORE_DIR = join(homedir(), ".prune", "session");

const MAX_TIMELINE = 200;
const MAX_SOURCES = 100;
const MAX_ACTIONS = 500;
const MAX_FANOUT = 50;

/** Default, well-formed empty store. */
export function emptyStore() {
  return {
    version: 1,
    seq: 0,
    fileTimeline: [], // [{ turn, path, sha }]
    sources: [], // [{ id, kind, tokens, trusted }]
    actions: [], // [{ sourceId, tokens }]
    lastUntrustedSourceId: null,
    downstreamCount: 0,
    fanoutTurns: [], // [{ turn, count }] — subagent spawns bucketed per turn
  };
}

export function sessionStorePath(transcriptPath) {
  const key = typeof transcriptPath === "string" && transcriptPath ? transcriptPath : "no-transcript";
  const h = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return join(STORE_DIR, `cost-security-${h}.json`);
}

export function readSessionStore(transcriptPath) {
  const path = sessionStorePath(transcriptPath);
  if (!existsSync(path)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return coerce(parsed);
  } catch {
    return emptyStore(); // corrupt file — start fresh, never throw
  }
}

function atomicWrite(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

/**
 * Read the store, apply `mutate(store)`, trim, and atomically persist. Returns
 * the (in-memory) store even if persistence fails. Best-effort, never throws.
 */
export function updateSessionStore(transcriptPath, mutate) {
  const store = readSessionStore(transcriptPath);
  try {
    mutate(store);
  } catch {
    // a buggy mutator must not break the hook
  }
  trim(store);
  try {
    atomicWrite(sessionStorePath(transcriptPath), JSON.stringify(store));
  } catch {
    // disk/permission error — detector just sees un-persisted state next turn
  }
  return store;
}

// ----------------------------------------------------------------------------

function coerce(parsed) {
  const base = emptyStore();
  if (!parsed || typeof parsed !== "object") return base;
  base.seq = intOr(parsed.seq, 0);
  base.fileTimeline = Array.isArray(parsed.fileTimeline) ? parsed.fileTimeline.slice(-MAX_TIMELINE) : [];
  base.sources = Array.isArray(parsed.sources) ? parsed.sources.slice(-MAX_SOURCES) : [];
  base.actions = Array.isArray(parsed.actions) ? parsed.actions.slice(-MAX_ACTIONS) : [];
  base.lastUntrustedSourceId =
    typeof parsed.lastUntrustedSourceId === "string" ? parsed.lastUntrustedSourceId : null;
  base.downstreamCount = intOr(parsed.downstreamCount, 0);
  base.fanoutTurns = Array.isArray(parsed.fanoutTurns) ? parsed.fanoutTurns.slice(-MAX_FANOUT) : [];
  return base;
}

function trim(store) {
  if (store.fileTimeline.length > MAX_TIMELINE) store.fileTimeline = store.fileTimeline.slice(-MAX_TIMELINE);
  if (store.sources.length > MAX_SOURCES) store.sources = store.sources.slice(-MAX_SOURCES);
  if (store.actions.length > MAX_ACTIONS) store.actions = store.actions.slice(-MAX_ACTIONS);
  if (store.fanoutTurns.length > MAX_FANOUT) store.fanoutTurns = store.fanoutTurns.slice(-MAX_FANOUT);
}

function intOr(v, dflt) {
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}

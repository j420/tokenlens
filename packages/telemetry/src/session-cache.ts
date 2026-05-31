/**
 * Per-transcript on-disk checkpoint for incremental hook/MCP processing.
 *
 * Hook scripts are short-lived processes spawned ~5×/turn by Claude Code;
 * each invocation used to re-read the entire transcript and re-classify
 * every turn from scratch, making hook latency O(N²) over the session.
 * This cache stores: the byte offset reached, the cumulative flat-message
 * list (small JSON), and the ROI walk over committed (finalized) turns.
 * On the next call we only read the appended bytes, group only the new
 * messages, and classify only the new finalized turns; the live turn is
 * re-classified (cheap — one turn) so the caller sees the current state.
 *
 * Atomic write semantics mirror @prune/persistence's flushSync — tmp file
 * then rename, so a crash mid-write never leaves a half-written cache.
 *
 * The cache is keyed by sha256(absolute transcript path) so two
 * transcripts in different dirs never collide; the path is also stored
 * inside the entry so manual inspection is possible.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { sha256Hex } from "@prune/shared/node";

import {
  appendToSession,
  createEmptySessionROI,
  deserializeWalk,
  serializeWalk,
  type SerializedSessionROIWalk,
  type SessionROIWalk,
  type TurnData,
} from "@prune/intelligence";

import { TranscriptReader } from "./transcript-reader.js";
import {
  groupIntoTurns,
  toTurnDataLike,
  type NormalizedTurn,
} from "./turn-mapper.js";
import type { FlatMessage } from "./schema.js";

const CACHE_VERSION = 1;

export interface SessionCacheOptions {
  /** Override the cache directory. Default `~/.prune/cache/sessions`. */
  cacheDir?: string;
}

export interface SessionCacheEntry {
  version: number;
  transcriptPath: string;
  lastByteOffset: number;
  lastLineNumber: number;
  /** Accumulated flat messages — re-grouping into turns is fast (O(N) walk). */
  flatMessages: FlatMessage[];
  /**
   * Number of turns whose ROI is committed to `walkCommitted`. The LAST
   * turn at any moment is treated as "live" (more tool_results or
   * assistant messages may still arrive) and is NOT included.
   */
  committedTurnCount: number;
  walkCommitted: SerializedSessionROIWalk | null;
}

function defaultCacheDir(): string {
  return join(homedir(), ".prune", "cache", "sessions");
}

export class SessionCache {
  private readonly path: string;
  private readonly transcriptPath: string;

  constructor(transcriptPath: string, options: SessionCacheOptions = {}) {
    this.transcriptPath = resolve(transcriptPath);
    const dir = options.cacheDir ?? defaultCacheDir();
    const key = sha256Hex(this.transcriptPath).slice(0, 16);
    this.path = join(dir, `${key}.json`);
  }

  filePath(): string {
    return this.path;
  }

  async load(): Promise<SessionCacheEntry | null> {
    if (!existsSync(this.path)) return null;
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as SessionCacheEntry;
      if (parsed.version !== CACHE_VERSION) return null;
      if (parsed.transcriptPath !== this.transcriptPath) return null;
      return parsed;
    } catch {
      // Corrupt cache (truncated mid-write, JSON broken, etc.) — start fresh.
      return null;
    }
  }

  async save(entry: SessionCacheEntry): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp.${process.pid}`;
    try {
      writeFileSync(tmp, JSON.stringify(entry));
      renameSync(tmp, this.path);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        // ignore — temp may not exist
      }
      throw err;
    }
  }

  async invalidate(): Promise<void> {
    if (existsSync(this.path)) {
      try {
        unlinkSync(this.path);
      } catch {
        // ignore — concurrent invalidate
      }
    }
  }
}

export interface CachedSessionView {
  /** All turns derived from the (cached + freshly appended) transcript. */
  turns: NormalizedTurn[];
  /**
   * Walk including the live (currently-growing) turn. Undefined when the
   * transcript has zero turns.
   */
  walk?: SessionROIWalk;
  /** True if the cache was invalidated this call (file shrank/missing). */
  reset: boolean;
}

/**
 * Single entry point for the six callers (3 hook scripts + 3 MCP
 * handlers) that need a current view of a transcript's turns + ROI walk
 * without re-reading from scratch every time.
 */
export async function loadCachedSessionView(
  transcriptPath: string,
  options: SessionCacheOptions = {}
): Promise<CachedSessionView> {
  const cache = new SessionCache(transcriptPath, options);
  const reader = new TranscriptReader(transcriptPath);
  if (!reader.exists()) {
    return { turns: [], reset: false };
  }

  let entry = await cache.load();

  // If transcript shrank or the cache predates a rotated file, throw the
  // cache away and read from offset 0.
  if (entry) {
    const size = statSync(transcriptPath).size;
    if (entry.lastByteOffset > size) entry = null;
  }

  const startOffset = entry?.lastByteOffset ?? 0;
  const startLineNumber = entry?.lastLineNumber ?? 0;
  const reset = entry === null && startOffset > 0;
  const appended = await reader.readAppended(startOffset, startLineNumber);

  // If readAppended itself reports stale (e.g. concurrent truncation), reset.
  if (appended.stale) {
    await cache.invalidate();
    return loadCachedSessionView(transcriptPath, options);
  }

  const flatMessages: FlatMessage[] = entry
    ? [...entry.flatMessages, ...appended.messages]
    : appended.messages;

  const turns = groupIntoTurns(flatMessages);
  if (turns.length === 0) {
    return { turns, reset };
  }

  // TurnDataLike is structurally identical to TurnData.
  const allTurnData: TurnData[] = turns.map((t) => toTurnDataLike(t));

  // The last turn is treated as "live" — more messages may yet be appended
  // to it within the same hook invocation cycle, so don't commit its ROI.
  const liveCount = Math.max(0, turns.length - 1);
  const committedTurnCount = entry?.committedTurnCount ?? 0;

  let walkCommitted: SessionROIWalk = entry?.walkCommitted
    ? deserializeWalk(entry.walkCommitted)
    : { sessionROI: createEmptySessionROI(), perTurn: [] };

  if (committedTurnCount < liveCount) {
    const newCommitted = allTurnData.slice(committedTurnCount, liveCount);
    const priorHistory = allTurnData.slice(0, committedTurnCount);
    walkCommitted = appendToSession(walkCommitted, newCommitted, priorHistory);
  }

  await cache.save({
    version: CACHE_VERSION,
    transcriptPath: resolve(transcriptPath),
    lastByteOffset: appended.newOffset,
    lastLineNumber: appended.newLineNumber,
    flatMessages,
    committedTurnCount: liveCount,
    walkCommitted: serializeWalk(walkCommitted),
  });

  // Build the live walk: include the in-progress final turn so callers see
  // the freshest classification, but don't persist this — next call will
  // re-classify it (still cheap: one turn).
  const liveTurnData = allTurnData[turns.length - 1];
  const walk =
    turns.length > liveCount
      ? appendToSession(walkCommitted, [liveTurnData], allTurnData.slice(0, liveCount))
      : walkCommitted;

  return { turns, walk, reset };
}

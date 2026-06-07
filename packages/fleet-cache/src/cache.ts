/**
 * Fleet Resolved-Context Cache  (F7)
 * ==================================
 * A developer asks "how does our auth flow work?" and the agent spends real
 * tokens resolving it from the repo. The next dev on the team asks the same
 * thing and pays again. This caches the RESOLVED answer so one resolution
 * serves the team — but only while it is still TRUE. Correctness is gated by
 * dependency content-SHA freshness: the answer records the SHAs of the files it
 * was derived from, and a hit is served only when every one of those SHAs is
 * unchanged. Any drift ⇒ stale ⇒ evict and re-derive.
 *
 * DISCIPLINE: deterministic SHA equality (no model, no regex). Team-scoped — the
 * cache is the caller's team boundary; nothing crosses an org. The answer itself
 * is referenced by an opaque id; this package stores SHAs + the ref, not content.
 * Total: never throws.
 */

// ============================================================================
// Types
// ============================================================================

export interface ResolvedEntry {
  /** Opaque reference to the stored answer (the host holds the body). */
  answerRef: string;
  /** depId → content SHA at resolution time (the freshness key). */
  depShas: Record<string, string>;
  /** Who resolved it (team attribution). */
  resolver: string;
  resolvedAtIso: string;
}

export interface FleetCache {
  version: 1;
  entries: Record<string, ResolvedEntry>;
}

export type GetReason = "fresh" | "stale-deps" | "miss";

export interface GetResult {
  hit: boolean;
  reason: GetReason;
  entry: ResolvedEntry | null;
  /** Dep ids whose SHA changed or went missing (on a stale result). */
  staleDeps: string[];
  /** Cache with a stale entry evicted; unchanged on fresh/miss. */
  cache: FleetCache;
}

// ============================================================================
// Construction + put
// ============================================================================

export function emptyFleetCache(): FleetCache {
  return { version: 1, entries: {} };
}

export function putResolved(cache: unknown, key: string, entry: unknown): FleetCache {
  const next = coerce(cache);
  if (typeof key !== "string" || key.length === 0) return next;
  if (!isEntry(entry)) return next;
  next.entries[key] = {
    answerRef: entry.answerRef,
    depShas: { ...entry.depShas },
    resolver: entry.resolver,
    resolvedAtIso: entry.resolvedAtIso,
  };
  return next;
}

// ============================================================================
// getResolved — freshness-gated lookup (evicts on stale)
// ============================================================================

export function getResolved(cache: unknown, key: string, currentDepShas: unknown): GetResult {
  const c = coerce(cache);
  const entry = typeof key === "string" ? c.entries[key] : undefined;
  if (!entry) {
    return { hit: false, reason: "miss", entry: null, staleDeps: [], cache: c };
  }

  const current = isShaMap(currentDepShas) ? (currentDepShas as Record<string, string>) : {};
  const staleDeps: string[] = [];
  for (const [dep, sha] of Object.entries(entry.depShas)) {
    if (current[dep] !== sha) staleDeps.push(dep);
  }
  staleDeps.sort();

  if (staleDeps.length > 0) {
    // Evict the stale entry so the team re-derives a correct answer.
    const evicted = coerce(c);
    delete evicted.entries[key];
    return { hit: false, reason: "stale-deps", entry: null, staleDeps, cache: evicted };
  }

  return { hit: true, reason: "fresh", entry, staleDeps: [], cache: c };
}

// ============================================================================
// Helpers
// ============================================================================

function coerce(cache: unknown): FleetCache {
  const out: FleetCache = { version: 1, entries: {} };
  if (!cache || typeof cache !== "object") return out;
  const c = cache as Partial<FleetCache>;
  if (!c.entries || typeof c.entries !== "object") return out;
  for (const [k, raw] of Object.entries(c.entries)) {
    if (isEntry(raw)) {
      out.entries[k] = {
        answerRef: raw.answerRef,
        depShas: { ...raw.depShas },
        resolver: raw.resolver,
        resolvedAtIso: raw.resolvedAtIso,
      };
    }
  }
  return out;
}

function isEntry(v: unknown): v is ResolvedEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.answerRef === "string" &&
    e.answerRef.length > 0 &&
    isShaMap(e.depShas) &&
    typeof e.resolver === "string" &&
    typeof e.resolvedAtIso === "string"
  );
}

function isShaMap(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val !== "string") return false;
  }
  return true;
}

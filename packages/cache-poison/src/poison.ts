/**
 * Cache-Poisoning Economics  (F21)
 * ================================
 * f7 semantic-cache defends a single entry: a content-SHA mismatch rejects a
 * poisoned read. But an adversary (or a buggy writer) can attack the cache
 * ECONOMICALLY — flooding it with entries that fail the equivalence gate (forcing
 * misses + recompute) or crafting near-key collisions (wrong-then-retry). The
 * harm is diffuse across many entries; the signal is the WRITER. This attributes
 * the economic harm to a writer identity and recommends quarantine — which here
 * means REVALIDATE that writer's entries, never delete them (fail-open: a
 * cost-defense must not destroy legitimate work).
 *
 * `assessWriters(events, options?)` is a PURE rate accounting over caller-fed
 * per-write outcomes (the equivalence-rejection and near-collision booleans come
 * from f7 / the cache layer). Deterministic thresholds, no regex, no model.
 */

// ============================================================================
// Types
// ============================================================================

export interface WriteEvent {
  /** Writer identity (dev / agent / MCP source). */
  writerId: string;
  /** Did this write fail the equivalence gate (a poisoned entry)? caller-fed. */
  equivalenceRejected: boolean;
  /** Was this write a near-key collision (forces a miss/wrong-then-retry)? caller-fed. */
  nearKeyCollision?: boolean;
}

export interface PoisonOptions {
  /** Min writes from a writer before it can be quarantined. Default 5. */
  minWrites?: number;
  /** Equivalence-rejection rate at/above which to quarantine. Default 0.3. */
  rejectionThreshold?: number;
  /** Near-key-collision rate at/above which to quarantine. Default 0.3. */
  collisionThreshold?: number;
}

export interface WriterStat {
  writerId: string;
  writes: number;
  rejections: number;
  collisions: number;
  rejectionRate: number;
  collisionRate: number;
  /** Recommend quarantine (revalidate, not delete) for this writer. */
  quarantine: boolean;
  reason: "ok" | "high-rejection-rate" | "high-collision-rate" | "below-min-writes";
}

export interface PoisonReport {
  /** Per-writer stats, worst (highest rejection rate) first. */
  writers: WriterStat[];
  /** Writer ids recommended for quarantine (revalidation). */
  quarantined: string[];
  skipped: number;
}

// ============================================================================
// assessWriters
// ============================================================================

export function assessWriters(events: unknown, options: PoisonOptions = {}): PoisonReport {
  const minWrites = intOr(options.minWrites, 5, 1);
  const rejThreshold = unit(options.rejectionThreshold, 0.3);
  const colThreshold = unit(options.collisionThreshold, 0.3);

  const list: WriteEvent[] = Array.isArray(events) ? (events.filter(isEvent) as WriteEvent[]) : [];
  const skipped = (Array.isArray(events) ? events.length : 0) - list.length;

  const byWriter = new Map<string, { writes: number; rejections: number; collisions: number }>();
  for (const e of list) {
    const w = byWriter.get(e.writerId) ?? { writes: 0, rejections: 0, collisions: 0 };
    w.writes += 1;
    if (e.equivalenceRejected) w.rejections += 1;
    if (e.nearKeyCollision) w.collisions += 1;
    byWriter.set(e.writerId, w);
  }

  const writers: WriterStat[] = [];
  for (const [writerId, w] of byWriter) {
    const rejectionRate = w.writes > 0 ? w.rejections / w.writes : 0;
    const collisionRate = w.writes > 0 ? w.collisions / w.writes : 0;
    let quarantine = false;
    let reason: WriterStat["reason"] = "ok";
    if (w.writes < minWrites) {
      reason = "below-min-writes";
    } else if (rejectionRate >= rejThreshold) {
      quarantine = true;
      reason = "high-rejection-rate";
    } else if (collisionRate >= colThreshold) {
      quarantine = true;
      reason = "high-collision-rate";
    }
    writers.push({
      writerId,
      writes: w.writes,
      rejections: w.rejections,
      collisions: w.collisions,
      rejectionRate: round(rejectionRate),
      collisionRate: round(collisionRate),
      quarantine,
      reason,
    });
  }

  // Worst first: by rejection rate desc, then collision rate desc, then id.
  writers.sort(
    (a, b) =>
      b.rejectionRate - a.rejectionRate ||
      b.collisionRate - a.collisionRate ||
      (a.writerId < b.writerId ? -1 : a.writerId > b.writerId ? 1 : 0)
  );

  return {
    writers,
    quarantined: writers.filter((w) => w.quarantine).map((w) => w.writerId).sort(),
    skipped,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function isEvent(v: unknown): v is WriteEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.writerId === "string" &&
    e.writerId.length > 0 &&
    typeof e.equivalenceRejected === "boolean" &&
    (e.nearKeyCollision === undefined || typeof e.nearKeyCollision === "boolean")
  );
}

function unit(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : dflt;
}

function intOr(v: unknown, dflt: number, min: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min ? Math.floor(v) : dflt;
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

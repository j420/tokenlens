/**
 * Feature-telemetry aggregation (read-side) for the f9–f13 shadow-mode stream.
 *
 * PURE module: no I/O, no env, no clock. Takes `EventRow[]` (as produced by
 * `@prune/persistence` `LocalSqliteSink.recordEvent` and read back via
 * `getRecentEvents`) and folds them into per-feature rollups for the dashboard.
 *
 * Discipline (these are load-bearing, not decoration):
 *   - DEFENSIVE decoding: `quality_proof` is an untrusted-shape blob. We never
 *     assume a field exists or has the right type. A malformed/missing proof
 *     contributes its row to the count/token sums but its feature-specific
 *     summary fields stay null/omitted.
 *   - NEVER fabricate a number. A figure we can't read defensibly is `null`,
 *     never a guess or a zero-that-pretends-to-be-data. (Sums start at 0 by
 *     definition — that is honest aggregation, not fabrication.)
 *   - NEVER throw. A single bad row must not take down the rollup.
 *   - DETERMINISTIC ordering: features are always emitted f9, f10, f11, f12,
 *     f13 regardless of input order or which ids are present.
 *
 * The shapes we decode mirror each package's `src/quality-proof.ts`:
 *   f9  cache-habits        → verdict + findings + totals.estimatedWasteUsd
 *   f10 mcp-proxy           → audit.savedTokens / fullCatalogTokens / shippedTokens
 *   f11 replay-cost         → cost.savedUsd / naiveCostUsd / replayCostUsd
 *   f12 skill-library       → event "capture"|"replay" + discoveryTokens
 *   f13 speculative-pipeline → stats.hitRate + outcome.latencySavedMs
 * We intentionally do NOT import those package types: the proof on disk is
 * untrusted and may predate or postdate any given schema version, so we decode
 * structurally rather than by nominal type.
 */

import type { EventRow } from "@prune/persistence";
import { TCRP_FEATURE_NAMES, type TcrpFeatureId } from "@prune/shared";

/** The feature ids this read-side surfaces, in deterministic emit order. */
export const TELEMETRY_FEATURE_IDS = ["f9", "f10", "f11", "f12", "f13"] as const;
export type TelemetryFeatureId = (typeof TELEMETRY_FEATURE_IDS)[number];

// ---------------------------------------------------------------------------
// Per-feature summary shapes. Every numeric field is `number | null`: null
// means "we could not read this defensibly from any row", NOT zero.
// ---------------------------------------------------------------------------

/** f9 cacheHabits: lint verdicts + estimated waste surfaced by the linter. */
export interface CacheHabitsSummary {
  /** Count of rows per verdict string, e.g. { ok: 3, warn: 1 }. */
  verdictCounts: Record<string, number>;
  /** Total findings across all decodable rows. null if no row carried totals. */
  totalFindings: number | null;
  /** Sum of estimated wasted USD the linter flagged. null if unreadable. */
  estimatedWasteUsd: number | null;
  /** Sum of estimated wasted tokens. null if unreadable. */
  estimatedWasteTokens: number | null;
}

/** f10 mcpProxy: tool-catalog reduction audit. */
export interface McpProxySummary {
  /** Sum of tokens saved by trimming tool catalogs. null if unreadable. */
  savedTokens: number | null;
  /** Sum of full-catalog tokens seen. null if unreadable. */
  fullCatalogTokens: number | null;
  /** Sum of tokens actually shipped. null if unreadable. */
  shippedTokens: number | null;
}

/** f11 replayCost: what-if replay economics. */
export interface ReplayCostSummary {
  /** Sum of USD saved by replaying a shared prefix. null if unreadable. */
  savedUsd: number | null;
  /** Sum of the naive (no-replay) cost. null if unreadable. */
  naiveCostUsd: number | null;
  /** Sum of the replay cost actually paid. null if unreadable. */
  replayCostUsd: number | null;
}

/** f12 skillLibrary: capture vs. replay events and discovery cost. */
export interface SkillLibrarySummary {
  /** Count of "capture" events (a skill was distilled). */
  captureCount: number;
  /** Count of "replay" events (a skill was matched + reused). */
  replayCount: number;
  /** Sum of discovery tokens across capture rows. null if unreadable. */
  discoveryTokens: number | null;
}

/** f13 speculativePipeline: speculation hit-rate + latency saved. */
export interface SpeculativePipelineSummary {
  /** Count of rows whose outcome.hit was true. */
  hits: number;
  /** Count of rows whose outcome.hit was false. */
  misses: number;
  /**
   * Latest readable rolling hit-rate (0..1) from stats.hitRate. We surface
   * the most-recent row's value rather than averaging per-row snapshots
   * (those are already cumulative). null if no row carried it.
   */
  latestHitRate: number | null;
  /** Sum of per-outcome latencySavedMs. null if unreadable. */
  latencySavedMs: number | null;
}

export type FeatureSummary =
  | { kind: "f9"; data: CacheHabitsSummary }
  | { kind: "f10"; data: McpProxySummary }
  | { kind: "f11"; data: ReplayCostSummary }
  | { kind: "f12"; data: SkillLibrarySummary }
  | { kind: "f13"; data: SpeculativePipelineSummary }
  | { kind: "unknown"; data: null };

/** One feature's rollup. Always present for f9–f13 even with zero events. */
export interface FeatureRollup {
  featureId: TelemetryFeatureId;
  /** Human name from TCRP_FEATURE_NAMES, e.g. "cacheHabits". */
  featureName: string;
  /** Number of telemetry rows tagged with this feature. */
  eventCount: number;
  /** Sum of tokens_in across this feature's rows. Honest 0 when no rows. */
  tokensIn: number;
  /** Sum of estimated_cost_usd across this feature's rows. */
  estimatedCostUsd: number;
  /** Count of rows whose quality_proof was missing or un-decodable. */
  malformedProofCount: number;
  /** Feature-specific decoded summary. */
  summary: FeatureSummary;
}

export interface FeatureTelemetryReport {
  /** Always length 5, ordered f9..f13. */
  features: FeatureRollup[];
  /** Total rows folded in (across ALL feature ids, including out-of-range). */
  totalEvents: number;
  /** Rows tagged with a feature id outside f9–f13 (e.g. "f1", or unknown). */
  outOfScopeEventCount: number;
}

// ---------------------------------------------------------------------------
// Defensive primitives. Each returns a usable value or null — never throws.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A finite number, or null. Rejects NaN/Infinity/strings/etc. */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A finite, non-negative number for summing tokens/cost columns. */
function nonNegNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Accumulator that holds a running sum but only "materializes" to a number
 * once at least one readable value has landed. Until then it reports null, so
 * a feature with no decodable figures shows "—" instead of a fabricated 0.
 */
class NullableSum {
  private total = 0;
  private seen = false;
  add(v: unknown): void {
    const n = num(v);
    if (n !== null) {
      this.total += n;
      this.seen = true;
    }
  }
  value(): number | null {
    return this.seen ? this.total : null;
  }
}

// ---------------------------------------------------------------------------
// Aggregation.
// ---------------------------------------------------------------------------

interface MutableRollup {
  eventCount: number;
  tokensIn: number;
  estimatedCostUsd: number;
  malformedProofCount: number;
}

function emptyMutable(): MutableRollup {
  return {
    eventCount: 0,
    tokensIn: 0,
    estimatedCostUsd: 0,
    malformedProofCount: 0,
  };
}

/**
 * Fold an array of EventRows into per-feature rollups. Pure & total: any input
 * (including an empty array, malformed proofs, or unknown feature ids) yields a
 * well-formed report. Output ordering is always f9..f13.
 */
export function aggregateFeatureTelemetry(
  events: readonly EventRow[]
): FeatureTelemetryReport {
  const base: Record<TelemetryFeatureId, MutableRollup> = {
    f9: emptyMutable(),
    f10: emptyMutable(),
    f11: emptyMutable(),
    f12: emptyMutable(),
    f13: emptyMutable(),
  };

  // f9
  const f9Verdicts: Record<string, number> = {};
  const f9Findings = new NullableSum();
  const f9WasteUsd = new NullableSum();
  const f9WasteTokens = new NullableSum();
  // f10
  const f10Saved = new NullableSum();
  const f10Full = new NullableSum();
  const f10Shipped = new NullableSum();
  // f11
  const f11Saved = new NullableSum();
  const f11Naive = new NullableSum();
  const f11Replay = new NullableSum();
  // f12
  let f12Capture = 0;
  let f12Replay = 0;
  const f12Discovery = new NullableSum();
  // f13
  let f13Hits = 0;
  let f13Misses = 0;
  let f13LatestHitRate: number | null = null;
  let f13SeenHitRate = false;
  const f13Latency = new NullableSum();

  let totalEvents = 0;
  let outOfScopeEventCount = 0;

  // Rows arrive newest-first from getRecentEvents (ORDER BY timestamp DESC).
  // For f13's "latest" hit-rate we want the most recent decodable value, so we
  // capture the FIRST readable one we encounter while scanning in input order.
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    totalEvents++;

    const fid = ev.feature_id;
    if (
      typeof fid !== "string" ||
      !(TELEMETRY_FEATURE_IDS as readonly string[]).includes(fid)
    ) {
      outOfScopeEventCount++;
      continue;
    }
    const id = fid as TelemetryFeatureId;
    const roll = base[id];
    roll.eventCount++;
    roll.tokensIn += nonNegNum(ev.tokens_in);
    roll.estimatedCostUsd += nonNegNum(ev.estimated_cost_usd);

    const proof = ev.quality_proof;
    if (!isRecord(proof)) {
      roll.malformedProofCount++;
      continue;
    }

    switch (id) {
      case "f9": {
        const verdict = proof.verdict;
        if (typeof verdict === "string") {
          f9Verdicts[verdict] = (f9Verdicts[verdict] ?? 0) + 1;
        }
        const totals = proof.totals;
        if (isRecord(totals)) {
          f9Findings.add(totals.findingCount);
          f9WasteUsd.add(totals.estimatedWasteUsd);
          f9WasteTokens.add(totals.estimatedWasteTokens);
        }
        break;
      }
      case "f10": {
        const audit = proof.audit;
        if (isRecord(audit)) {
          f10Saved.add(audit.savedTokens);
          f10Full.add(audit.fullCatalogTokens);
          f10Shipped.add(audit.shippedTokens);
        }
        break;
      }
      case "f11": {
        const cost = proof.cost;
        if (isRecord(cost)) {
          f11Saved.add(cost.savedUsd);
          f11Naive.add(cost.naiveCostUsd);
          f11Replay.add(cost.replayCostUsd);
        }
        break;
      }
      case "f12": {
        const event = proof.event;
        if (event === "capture") {
          f12Capture++;
          f12Discovery.add(proof.discoveryTokens);
        } else if (event === "replay") {
          f12Replay++;
        }
        break;
      }
      case "f13": {
        const outcome = proof.outcome;
        if (isRecord(outcome)) {
          if (outcome.hit === true) f13Hits++;
          else if (outcome.hit === false) f13Misses++;
          f13Latency.add(outcome.latencySavedMs);
        }
        const stats = proof.stats;
        if (isRecord(stats) && !f13SeenHitRate) {
          const hr = num(stats.hitRate);
          if (hr !== null) {
            f13LatestHitRate = hr;
            f13SeenHitRate = true;
          }
        }
        break;
      }
    }
  }

  const summaries: Record<TelemetryFeatureId, FeatureSummary> = {
    f9: {
      kind: "f9",
      data: {
        verdictCounts: f9Verdicts,
        totalFindings: f9Findings.value(),
        estimatedWasteUsd: f9WasteUsd.value(),
        estimatedWasteTokens: f9WasteTokens.value(),
      },
    },
    f10: {
      kind: "f10",
      data: {
        savedTokens: f10Saved.value(),
        fullCatalogTokens: f10Full.value(),
        shippedTokens: f10Shipped.value(),
      },
    },
    f11: {
      kind: "f11",
      data: {
        savedUsd: f11Saved.value(),
        naiveCostUsd: f11Naive.value(),
        replayCostUsd: f11Replay.value(),
      },
    },
    f12: {
      kind: "f12",
      data: {
        captureCount: f12Capture,
        replayCount: f12Replay,
        discoveryTokens: f12Discovery.value(),
      },
    },
    f13: {
      kind: "f13",
      data: {
        hits: f13Hits,
        misses: f13Misses,
        latestHitRate: f13LatestHitRate,
        latencySavedMs: f13Latency.value(),
      },
    },
  };

  const features: FeatureRollup[] = TELEMETRY_FEATURE_IDS.map((id) => ({
    featureId: id,
    featureName: TCRP_FEATURE_NAMES[id as TcrpFeatureId] ?? id,
    eventCount: base[id].eventCount,
    tokensIn: base[id].tokensIn,
    estimatedCostUsd: base[id].estimatedCostUsd,
    malformedProofCount: base[id].malformedProofCount,
    summary: summaries[id],
  }));

  return { features, totalEvents, outOfScopeEventCount };
}

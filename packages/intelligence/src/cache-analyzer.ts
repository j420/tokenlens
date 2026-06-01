/**
 * Prompt-cache intelligence.
 *
 * Computes hit rate, write amplification, and the $ delta between the
 * realized cache outcome and two baselines (perfect cache + no cache).
 * Also diagnoses common bust signals: prefix volatility, MCP tool drift,
 * timestamps in system prompts.
 *
 * Inputs come from @prune/telemetry. Pricing comes from @prune/shared so
 * every consumer sees the same numbers.
 */

import {
  detectProvider,
  getModelPricing,
  type ModelPricing,
} from "@prune/shared";

export interface CacheTurnInput {
  model?: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreate: number;
  };
}

export type CacheTTL = "5m" | "1h";

// Anthropic write multipliers vs the input price.
const WRITE_MULTIPLIER: Record<CacheTTL, number> = {
  "5m": 1.25,
  "1h": 2.0,
};

export interface CacheCost {
  actual: number;
  ifAllCached: number;
  ifNoCache: number;
  savedVsNoCache: number;
}

export interface CacheMetrics {
  windowTurns: number;
  totalInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  hitRate: number;
  writeAmplification: number;
  cost: CacheCost;
}

function pickPricing(model: string | undefined): ModelPricing {
  const pricing = !model
    ? getModelPricing("anthropic", "claude-sonnet-4-5-20250929")
    : getModelPricing(detectProvider(model), model);
  if (pricing.cached_input !== undefined) return pricing;
  // Unknown / new model IDs land on DEFAULT_PRICING (no cached_input),
  // which would silently collapse the cached-read rate to the full input
  // rate and flatten the cache-savings report to ~$0. Estimate at ~10% of
  // input — the standard Anthropic ephemeral-cache ratio.
  return { ...pricing, cached_input: pricing.input * 0.1 };
}

function turnCost(
  t: CacheTurnInput,
  ttl: CacheTTL
): { actual: number; ifAllCached: number; ifNoCache: number } {
  const p = pickPricing(t.model);
  const cachedRate = p.cached_input ?? p.input;
  const writeMult = WRITE_MULTIPLIER[ttl];

  const u = t.usage;
  const totalInput = u.input + u.cacheRead + u.cacheCreate;

  const actual =
    (u.input / 1_000_000) * p.input +
    (u.cacheRead / 1_000_000) * cachedRate +
    (u.cacheCreate / 1_000_000) * p.input * writeMult +
    (u.output / 1_000_000) * p.output;

  const ifAllCached =
    (totalInput / 1_000_000) * cachedRate +
    (u.output / 1_000_000) * p.output;

  const ifNoCache =
    (totalInput / 1_000_000) * p.input +
    (u.output / 1_000_000) * p.output;

  return { actual, ifAllCached, ifNoCache };
}

export function computeCacheMetrics(
  turns: CacheTurnInput[],
  ttl: CacheTTL = "5m"
): CacheMetrics {
  let totalInput = 0;
  let cacheRead = 0;
  let cacheCreate = 0;
  let uncached = 0;
  let output = 0;
  let actual = 0;
  let ifAllCached = 0;
  let ifNoCache = 0;

  for (const t of turns) {
    const u = t.usage;
    totalInput += u.input + u.cacheRead + u.cacheCreate;
    cacheRead += u.cacheRead;
    cacheCreate += u.cacheCreate;
    uncached += u.input;
    output += u.output;

    const c = turnCost(t, ttl);
    actual += c.actual;
    ifAllCached += c.ifAllCached;
    ifNoCache += c.ifNoCache;
  }

  const hitRate = totalInput > 0 ? cacheRead / totalInput : 0;
  const writeAmplification = cacheRead > 0 ? cacheCreate / cacheRead : 0;

  return {
    windowTurns: turns.length,
    totalInputTokens: totalInput,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreate,
    uncachedInputTokens: uncached,
    outputTokens: output,
    hitRate,
    writeAmplification,
    cost: {
      actual,
      ifAllCached,
      ifNoCache,
      savedVsNoCache: Math.max(0, ifNoCache - actual),
    },
  };
}

// ============================================================================
// Bust diagnosis
// ============================================================================

export type CacheBustSignal =
  | "volatile_prefix"
  | "timestamp_in_system"
  | "mcp_tool_drift"
  | "low_hit_rate"
  | "high_write_amplification";

export interface CacheBustDiagnosis {
  signal: CacheBustSignal;
  evidence: string;
  estimatedLostHitRate: number; // 0..1, approximate
  suggestion: string;
}

export interface DiagnoseInput {
  systemPrompt?: string;
  toolListsByTurn?: string[][]; // tool names per turn, in order
  turns: CacheTurnInput[];
}

const TIMESTAMP_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/, // ISO 8601
  /\b\d{4}-\d{2}-\d{2}\b/, // date
  // Bare HH:MM is too noisy (matches durations, port refs, "5:30 in the
  // afternoon" examples) — require an adjacent time keyword.
  /\b(?:current[ _-]?time|now|today|timestamp|at)\b[^\n]{0,20}?\b\d{1,2}:\d{2}(?::\d{2})?\b/i,
  /current[ _-]?time/i,
  /now\s*:/i,
];

function detectTimestamp(text: string): string | null {
  for (const re of TIMESTAMP_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

function detectToolDrift(toolLists: string[][]): {
  drifted: boolean;
  details: string;
} {
  if (toolLists.length < 2) return { drifted: false, details: "" };
  const reference = JSON.stringify([...toolLists[0]].sort());
  for (let i = 1; i < toolLists.length; i++) {
    const current = JSON.stringify([...toolLists[i]].sort());
    if (current !== reference) {
      const added = toolLists[i].filter((t) => !toolLists[0].includes(t));
      const removed = toolLists[0].filter((t) => !toolLists[i].includes(t));
      return {
        drifted: true,
        details: `turn ${i + 1}: +${JSON.stringify(added)} -${JSON.stringify(
          removed
        )}`,
      };
    }
  }
  return { drifted: false, details: "" };
}

export function diagnoseCacheBust(input: DiagnoseInput): CacheBustDiagnosis[] {
  const out: CacheBustDiagnosis[] = [];
  const metrics = computeCacheMetrics(input.turns);

  if (input.systemPrompt) {
    const ts = detectTimestamp(input.systemPrompt);
    if (ts) {
      out.push({
        signal: "timestamp_in_system",
        evidence: `system prompt contains "${ts}"`,
        estimatedLostHitRate: 0.9,
        suggestion:
          "Move the timestamp out of the cached prefix — either into the user message or omit it entirely.",
      });
    }
  }

  if (input.toolListsByTurn) {
    const drift = detectToolDrift(input.toolListsByTurn);
    if (drift.drifted) {
      out.push({
        signal: "mcp_tool_drift",
        evidence: drift.details,
        estimatedLostHitRate: 0.7,
        suggestion:
          "Pin MCP tool definitions across turns; reordering or adding tools busts the cached prefix.",
      });
    }
  }

  // After turn 2, a low hit rate on a meaningful window is a strong signal
  // the prefix isn't stable.
  if (input.turns.length >= 2 && metrics.totalInputTokens > 2000) {
    if (metrics.hitRate < 0.2) {
      out.push({
        signal: "low_hit_rate",
        evidence: `hit rate ${(metrics.hitRate * 100).toFixed(1)}% over ${
          input.turns.length
        } turns`,
        estimatedLostHitRate: Math.max(0, 0.7 - metrics.hitRate),
        suggestion:
          "Inspect the prompt prefix for volatility (timestamps, file-state blocks, tool ordering).",
      });
    }
    // Independent: paying to rebuild the cache more than reading from it.
    if (metrics.writeAmplification > 1.5) {
      out.push({
        signal: "high_write_amplification",
        evidence: `write amp ${metrics.writeAmplification.toFixed(2)}× — paying to rebuild the cache more than reading from it`,
        estimatedLostHitRate: 0,
        suggestion:
          "Stabilize the cached prefix; the cache is being rewritten faster than it's being used.",
      });
    }
  }

  return out;
}

// ============================================================================
// Cache Co-Pilot — silent-failure + TTL-penalty detectors
// ============================================================================
//
// Targets two specific 2026 failure modes that pure hit-rate metrics miss:
//
// 1. SILENT_FAILURE — caller set cache_control but the prefix didn't meet
//    Anthropic's min-prefix threshold (20 content blocks; varies). Request
//    succeeds, usage fields show zero cache activity, full input price is
//    charged. Documented in
//    https://platform.claude.com/docs/en/build-with-claude/prompt-caching
//    Detector: 3+ consecutive turns with large `input` and zero cache
//    activity. We can't see whether cache_control was sent, only that the
//    pattern reads as a missed-cache opportunity worth flagging.
//
// 2. TTL_PENALTY — caller used default 5m TTL but consecutive same-shape
//    cache_creation events landed >5min apart, so the previous write
//    expired and got rebuilt. The March 2026 silent regression of
//    Anthropic's default TTL from 1h to 5m (GitHub issue #46829) makes
//    this an active continuing tax for long sessions.
//    Detector: pairs of consecutive turns with similar `cacheCreate`
//    magnitudes and an inter-turn gap >5min. Estimate the 1h-vs-5m
//    delta directly.

export interface SilentCacheFailure {
  startTurnIndex: number; // inclusive
  endTurnIndex: number; // inclusive
  consecutiveTurns: number;
  uncachedInputTokens: number;
  estimatedExtraCostUsd: number;
  suggestion: string;
}

export interface TTLPenalty {
  fromTurnIndex: number;
  toTurnIndex: number;
  gapMinutes: number;
  cacheCreateTokens: number;
  estimatedExtraCostUsd: number;
  suggestion: string;
}

export interface CoPilotInput {
  /** Same turn shape used elsewhere in this module. */
  turns: CacheTurnInput[];
  /**
   * ISO 8601 timestamps for each turn (e.g. NormalizedTurn.endedAt).
   * Required for TTL-penalty detection; silent-failure detection still
   * works without them.
   */
  turnTimestamps?: string[];
  /** Min `input` tokens for a turn to be considered cacheable. Default 2048. */
  minCacheablePrefixTokens?: number;
  /** Min consecutive run length before flagging silent failure. Default 3. */
  minConsecutiveTurnsForSilentFailure?: number;
  /** Treat two cache_creates as same-shape if within ±this ratio. Default 0.3. */
  ttlPenaltySimilarityTolerance?: number;
}

export interface CacheCoPilotReport {
  silentFailures: SilentCacheFailure[];
  ttlPenalties: TTLPenalty[];
  /** Sum of estimatedExtraCostUsd across both lists. */
  totalLostUsd: number;
  recommendedActions: string[];
}

const FIVE_MIN_MS = 5 * 60 * 1000;

/**
 * Detect runs of consecutive turns whose `input` looks cacheable
 * (≥ minCacheablePrefixTokens) but show zero `cacheRead` and
 * zero `cacheCreate`. Either caching was never enabled or the
 * cached prefix was too short — both look like the documented
 * silent-failure mode to a downstream consumer.
 */
export function detectSilentCacheFailures(
  input: CoPilotInput
): SilentCacheFailure[] {
  const minPrefix = input.minCacheablePrefixTokens ?? 2048;
  const minRun = input.minConsecutiveTurnsForSilentFailure ?? 3;
  const out: SilentCacheFailure[] = [];

  let runStart = -1;
  let runUncached = 0;
  let runUsd = 0;

  const flush = (endIdx: number) => {
    if (runStart < 0) return;
    const run = endIdx - runStart + 1;
    if (run >= minRun) {
      out.push({
        startTurnIndex: runStart,
        endTurnIndex: endIdx,
        consecutiveTurns: run,
        uncachedInputTokens: runUncached,
        estimatedExtraCostUsd: runUsd,
        suggestion:
          "Verify cache_control is set on the system prompt + tool definitions, " +
          "and that the cached prefix exceeds Anthropic's minimum-prefix threshold " +
          "(silent failure when too short). " +
          "https://platform.claude.com/docs/en/build-with-claude/prompt-caching",
      });
    }
    runStart = -1;
    runUncached = 0;
    runUsd = 0;
  };

  for (let i = 0; i < input.turns.length; i++) {
    const t = input.turns[i];
    const u = t.usage;
    const looksCacheable =
      u.input >= minPrefix && u.cacheRead === 0 && u.cacheCreate === 0;
    if (looksCacheable) {
      if (runStart < 0) runStart = i;
      runUncached += u.input;
      // Extra cost ≈ uncached input charged at full input rate minus what
      // the same input would have cost as cache_read (~10% of input).
      const p = pickPricing(t.model);
      const cachedRate = p.cached_input ?? p.input * 0.1;
      const fullRate = p.input;
      runUsd += (u.input / 1_000_000) * (fullRate - cachedRate);
    } else {
      flush(i - 1);
    }
  }
  flush(input.turns.length - 1);

  return out;
}

/**
 * For each pair of consecutive turns where both have non-trivial
 * `cacheCreate` of similar magnitude and the inter-turn gap exceeds 5
 * minutes, estimate what would have been saved with `ttl=1h`. Surfaces
 * the post-March-2026 silent default-TTL regression directly.
 */
export function detectTTLPenalty(input: CoPilotInput): TTLPenalty[] {
  if (!input.turnTimestamps) return [];
  if (input.turnTimestamps.length !== input.turns.length) return [];

  const tolerance = input.ttlPenaltySimilarityTolerance ?? 0.3;
  const out: TTLPenalty[] = [];

  for (let i = 1; i < input.turns.length; i++) {
    const prev = input.turns[i - 1];
    const curr = input.turns[i];
    if (prev.usage.cacheCreate === 0 || curr.usage.cacheCreate === 0) continue;
    // Same-shape filter: don't fire for unrelated rebuilds.
    const ratio = Math.min(prev.usage.cacheCreate, curr.usage.cacheCreate) /
      Math.max(prev.usage.cacheCreate, curr.usage.cacheCreate);
    if (1 - ratio > tolerance) continue;

    const tPrev = Date.parse(input.turnTimestamps[i - 1]);
    const tCurr = Date.parse(input.turnTimestamps[i]);
    if (!Number.isFinite(tPrev) || !Number.isFinite(tCurr)) continue;
    const gapMs = tCurr - tPrev;
    if (gapMs <= FIVE_MIN_MS) continue;

    // Cost of the second cache_create at 5m vs 1h (which would have read).
    const p = pickPricing(curr.model);
    const inputRate = p.input;
    const cachedRate = p.cached_input ?? inputRate * 0.1;
    const cost5m = (curr.usage.cacheCreate / 1_000_000) * inputRate * 1.25;
    const cost1h = (curr.usage.cacheCreate / 1_000_000) * cachedRate; // would have been read
    out.push({
      fromTurnIndex: i - 1,
      toTurnIndex: i,
      gapMinutes: gapMs / 60_000,
      cacheCreateTokens: curr.usage.cacheCreate,
      estimatedExtraCostUsd: cost5m - cost1h,
      suggestion:
        "Pass `cache_control: { type: 'ephemeral', ttl: '1h' }` on the " +
        "system / tools breakpoint. After Anthropic's March 2026 default-TTL " +
        "regression, long sessions silently re-pay the 1.25× write multiplier. " +
        "https://github.com/anthropics/claude-code/issues/46829",
    });
  }
  return out;
}

export function analyzeCacheCoPilot(
  input: CoPilotInput
): CacheCoPilotReport {
  const silentFailures = detectSilentCacheFailures(input);
  const ttlPenalties = detectTTLPenalty(input);
  const totalLostUsd =
    silentFailures.reduce((acc, s) => acc + s.estimatedExtraCostUsd, 0) +
    ttlPenalties.reduce((acc, t) => acc + t.estimatedExtraCostUsd, 0);
  const actions: string[] = [];
  if (silentFailures.length > 0) {
    actions.push(
      `Investigate ${silentFailures.length} silent-cache-failure run(s); ` +
        "verify cache_control is set and prefix exceeds min length."
    );
  }
  if (ttlPenalties.length > 0) {
    actions.push(
      `Switch to ttl='1h' on the cached breakpoint to recover ` +
        `~$${ttlPenalties.reduce((a, t) => a + t.estimatedExtraCostUsd, 0).toFixed(4)} ` +
        `across ${ttlPenalties.length} affected turn pair(s).`
    );
  }
  return { silentFailures, ttlPenalties, totalLostUsd, recommendedActions: actions };
}

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

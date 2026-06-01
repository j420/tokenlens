/**
 * Cache-breakpoint planner — the dollar-saving heart of the SDK adapter.
 *
 * Anthropic's prompt-cache reads input at ~10% of the input price, but only
 * for a byte-identical prefix terminating at a `cache_control` breakpoint.
 * The provider enforces:
 *   - up to 4 breakpoints per request,
 *   - the cached prefix must clear a minimum length (model-dependent),
 *   - a single character of drift in ANY block before the breakpoint
 *     invalidates the cache.
 *
 * SOUNDNESS RULES (the credibility backbone):
 *   1. A breakpoint NEVER sits on or after a `volatile` block. The planner
 *      treats `stable → volatile` as a hard boundary.
 *   2. Volatility is DECLARED by the caller (no sniffing, no regex). If the
 *      caller marks a block stable that's actually volatile, that's a caller
 *      bug visible in telemetry (the `cache_read_input_tokens` will drop) —
 *      not a silent failure of the planner.
 *   3. A candidate breakpoint that would land below the minimum cacheable
 *      prefix is recorded in `rejected` (not silently dropped).
 *   4. Output is deterministic: same input ⇒ same plan ⇒ same hash. Required
 *      for cache hits across processes.
 *
 * The planner DOES NOT mutate the request. It returns a `BreakpointPlan`;
 * `applyBreakpoints` materializes the provider-shaped request.
 */

import type {
  BreakpointPlan,
  CacheBreakpoint,
  ContentBlock,
  Message,
  MessageRequest,
  ToolSchema,
} from "./types.js";
import {
  defaultEstimate,
  estimateContentBlockTokens,
  estimateMessageTokens,
  estimateToolSchemaTokens,
  type EstimateFn,
} from "./tokens.js";

/** Minimum cacheable prefix in tokens, by model family. Conservative. */
export const DEFAULT_MIN_CACHEABLE_TOKENS: Record<string, number> = {
  // Sonnet families: documented ≥1024.
  sonnet: 1024,
  // Opus / Haiku families: documented ≥4096.
  opus: 4096,
  haiku: 4096,
  // Conservative fallback for unknowns.
  default: 4096,
};

export interface PlanOptions {
  /** Hard upper bound on breakpoints (Anthropic = 4). Default 4. */
  maxBreakpoints?: number;
  /** Min cacheable prefix in tokens. Default looks up by model family. */
  minCacheableTokens?: number;
  /** Default TTL. "5m" is the cheap-writes tier and the right default. */
  defaultTtl?: "5m" | "1h";
  /** Caller-supplied estimator (e.g. exact tokenizer). */
  estimate?: EstimateFn;
}

/** Look up the min-cacheable threshold for a model by family substring. */
export function minCacheableForModel(model: string): number {
  const m = model.toLowerCase();
  if (m.includes("sonnet")) return DEFAULT_MIN_CACHEABLE_TOKENS.sonnet;
  if (m.includes("opus")) return DEFAULT_MIN_CACHEABLE_TOKENS.opus;
  if (m.includes("haiku")) return DEFAULT_MIN_CACHEABLE_TOKENS.haiku;
  return DEFAULT_MIN_CACHEABLE_TOKENS.default;
}

interface FlatBlock {
  segment: CacheBreakpoint["segment"];
  blockIndex: number;
  tokens: number;
  volatility: "stable" | "volatile";
}

/**
 * Plan cache breakpoints for a request. Returns a frozen plan; never mutates.
 */
export function planBreakpoints(
  request: MessageRequest,
  options: PlanOptions = {}
): BreakpointPlan {
  const estimate = options.estimate ?? defaultEstimate;
  // The provider hard-caps breakpoints at 4. A caller passing Infinity, NaN,
  // or a number outside [0, 4] would either get a provider-side rejection
  // (Infinity) or a degenerate plan (negative/NaN). Clamp explicitly here so
  // the upstream contract is enforced at OUR boundary, not at the wire.
  const rawMax = options.maxBreakpoints ?? 4;
  const maxBreakpoints =
    Number.isFinite(rawMax) && Number.isInteger(rawMax)
      ? Math.max(0, Math.min(4, rawMax))
      : 4;
  const minPrefix =
    options.minCacheableTokens ?? minCacheableForModel(request.model);
  const ttl = options.defaultTtl ?? "5m";

  // Flatten into one ordered stream of blocks with declared volatility. Order
  // is fixed by the provider's contract: system → tools → messages.
  const flat: FlatBlock[] = [];

  request.system.forEach((b, i) => {
    flat.push({
      segment: "system",
      blockIndex: i,
      tokens: estimateContentBlockTokens(b, estimate),
      volatility: b.volatility,
    });
  });
  request.tools.forEach((t, i) => {
    flat.push({
      segment: "tools",
      blockIndex: i,
      tokens: estimateToolSchemaTokens(t, estimate),
      volatility: t.volatility,
    });
  });
  request.messages.forEach((m, mi) => {
    // For message blocks we expose the WHOLE message as one breakpoint
    // candidate. The provider doesn't allow finer-than-message granularity in
    // practice (mid-message breakpoints split a content array which is rarely
    // safe under the cache rules). Volatility is the worst across blocks in
    // the message — one volatile block taints the message.
    flat.push({
      segment: "messages",
      blockIndex: mi,
      tokens: estimateMessageTokens(m, estimate),
      volatility: messageVolatility(m),
    });
  });

  // Walk the prefix. Record CANDIDATE breakpoints at the END of every maximal
  // run of stable blocks. Then pick the top-N candidates by cumulative token
  // span (largest first) under the maxBreakpoints ceiling.
  const candidates: Array<{
    afterIndex: number; // index into `flat`
    cumulativeTokens: number;
    segment: CacheBreakpoint["segment"];
    blockIndex: number;
  }> = [];
  const rejected: BreakpointPlan["rejected"] = [];

  let running = 0;
  for (let i = 0; i < flat.length; i++) {
    const b = flat[i];
    if (b.volatility === "stable") {
      running += b.tokens;
      // The stable run ENDS when (a) we hit a volatile boundary on the next
      // step, (b) we cross into a different segment on the next step, or (c)
      // we're at the last block in the stream. Segment boundaries are
      // breakpoint-eligible because the provider serializes system → tools →
      // messages in that exact order, so a stable system prefix is a valid
      // cached segment even when followed by stable tools.
      const next = flat[i + 1];
      const isRunEnd =
        !next || next.volatility === "volatile" || next.segment !== b.segment;
      if (isRunEnd) {
        if (running >= minPrefix) {
          candidates.push({
            afterIndex: i,
            cumulativeTokens: running,
            segment: b.segment,
            blockIndex: b.blockIndex,
          });
        } else {
          rejected.push({
            segment: b.segment,
            blockIndex: b.blockIndex,
            reason: `cumulative prefix ${running} tokens < min cacheable ${minPrefix}`,
          });
        }
        // NOTE: do NOT reset `running` here — a stable system run that
        // crosses into stable tools should accumulate. The running counter
        // is the cumulative cacheable PREFIX, not the current segment.
      }
    } else {
      // Volatile — the prefix is poisoned from here. Reset.
      running = 0;
      rejected.push({
        segment: b.segment,
        blockIndex: b.blockIndex,
        reason: "block declared volatile — never a breakpoint",
      });
    }
  }

  // Pick the top-N candidates. Primary sort: cumulativeTokens descending
  // (largest cacheable span first). Tie-break: later afterIndex first — when
  // multiple isolated runs are equal in size we prefer the LATER ones because
  // they cache more of the realistic prefix the next turn will rebuild.
  const chosen = [...candidates]
    .sort(
      (a, b) =>
        b.cumulativeTokens - a.cumulativeTokens || b.afterIndex - a.afterIndex
    )
    .slice(0, maxBreakpoints);

  // For deterministic output, re-sort chosen by ascending cumulativeTokens
  // (which is == prefix-walk order WITHIN a single run, but across multiple
  // runs we order by ascending afterIndex to keep the plan stable).
  const chosenSorted = [...chosen].sort((a, b) => a.afterIndex - b.afterIndex);
  const droppedByCeiling = candidates.filter((c) => !chosen.includes(c));

  const breakpoints: CacheBreakpoint[] = chosenSorted.map((c) => ({
    segment: c.segment,
    blockIndex: c.blockIndex,
    cumulativeTokens: c.cumulativeTokens,
    ttl,
  }));

  // The cacheable prefix size is the LARGEST cumulativeTokens we anchored;
  // earlier breakpoints in the same run are subsets of that prefix.
  const cacheablePrefixTokens =
    breakpoints.length > 0
      ? Math.max(...breakpoints.map((b) => b.cumulativeTokens))
      : 0;

  for (const c of droppedByCeiling) {
    rejected.push({
      segment: c.segment,
      blockIndex: c.blockIndex,
      reason: `dropped: maxBreakpoints=${maxBreakpoints} ceiling, smaller-span candidate`,
    });
  }

  return { breakpoints, rejected, cacheablePrefixTokens };
}

/** A message inherits the WORST volatility across its content blocks. */
function messageVolatility(m: Message): "stable" | "volatile" {
  for (const b of m.content) {
    if (b.type === "tool_result" || b.type === "tool_use") {
      // Tool I/O is volatile by default unless the caller explicitly tags it.
      if (b.volatility === "volatile") return "volatile";
    }
    if (b.type === "text" && b.volatility === "volatile") return "volatile";
  }
  // Are all blocks stable?
  return m.content.every((b) => b.volatility === "stable") ? "stable" : "volatile";
}

/**
 * A stable fingerprint of the cacheable prefix for telemetry. Helpful for
 * proving "the same prefix was sent" across requests.
 */
export function prefixFingerprint(
  request: MessageRequest,
  plan: BreakpointPlan
): string {
  if (plan.breakpoints.length === 0) return "no-cache";
  // SHA-free hash; we only need stability across calls within one process.
  // The hook layer uses sha256 when persisting; the adapter doesn't need to
  // import node:crypto to stay environment-agnostic.
  let h = 0xcbf29ce4 >>> 0; // FNV-1a 32-bit
  const pump = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  pump(request.model);
  for (const b of request.system) pump(JSON.stringify(b));
  for (const t of request.tools) pump(`${t.name}|${t.description}`);
  const last = plan.breakpoints[plan.breakpoints.length - 1];
  pump(`bp:${last.segment}:${last.blockIndex}:${last.cumulativeTokens}`);
  return `fnv:${h.toString(16)}`;
}

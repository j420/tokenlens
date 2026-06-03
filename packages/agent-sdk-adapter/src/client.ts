/**
 * PruneAgentClient — orchestrates the adapter's policies around a single
 * model call.
 *
 *   1. Decide model via RoutingPolicy.
 *   2. Plan cache breakpoints over the declared volatility.
 *   3. Materialize ProviderRequest via applyBreakpoints.
 *   4. Invoke the caller-supplied ModelInvoker.
 *   5. Observe usage; report cache-hit ratio + savings.
 *   6. If the turn looks like a completed agent turn (text content), feed the
 *      LoopPolicy to update streaks and potentially halt.
 *
 * No SDK import. No network. The ModelInvoker is the only thing that touches
 * a wire — the Anthropic client, an Agent SDK `query()` closure, an
 * OpenAI-shaped adapter, or the F4 fixture runner all plug in here.
 *
 * Everything is deterministic and inspectable: callers can introspect the
 * last plan, the last decision, and the rolling usage summary at any time.
 */

import { calculateCost, getModelPricing, type Provider } from "@prune/shared";
import type { TurnData } from "@prune/intelligence";
import { applyBreakpoints } from "./apply.js";
import { planBreakpoints, type PlanOptions } from "./cache-planner.js";
import { LoopPolicy } from "./loop.js";
import {
  StaticRoutingPolicy,
  type RoutingDecision,
  type RoutingPolicy,
} from "./routing.js";
import type {
  BreakpointPlan,
  MessageRequest,
  MessageResponse,
  ModelInvoker,
  ProviderRequest,
  UsageReport,
} from "./types.js";
import {
  assertValidRequest,
  normalizeUsage,
  validateResponse,
  type ValidationIssue,
} from "./validate.js";

export interface PruneAgentClientOptions {
  /** REQUIRED. Calls the model. No default — purity by injection. */
  invoke: ModelInvoker;
  /** Defaults to StaticRoutingPolicy if omitted. */
  routing?: RoutingPolicy;
  /** Loop policy. Created with defaults (enforce=true, threshold=3) if omitted. */
  loop?: LoopPolicy;
  /** Caching options forwarded to planBreakpoints. */
  cache?: PlanOptions;
  /**
   * Convert a successful MessageResponse to a TurnData so the LoopPolicy can
   * observe it. Defaults to a best-effort projection (text-only); pass a
   * richer mapper if you have file/test/error signal.
   */
  toTurnData?: (turn: number, req: MessageRequest, res: MessageResponse) => TurnData;
}

export interface AdapterUsageSummary {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Sum of estimated cost across all observed turns, in USD. */
  costUsd: number;
  /** Estimated cost if the same turns had been run with no cache at all. */
  costNoCacheUsd: number;
  /** costNoCacheUsd − costUsd. */
  savedVsNoCacheUsd: number;
}

export interface AdapterTurn {
  index: number;
  request: MessageRequest;
  provider: ProviderRequest;
  routing: RoutingDecision;
  plan: BreakpointPlan;
  response: MessageResponse;
  /** Always present — normalized to explicit zeros if the vendor omitted it. */
  usage: UsageReport;
  /** Non-fatal vendor-response warnings (e.g. missing usage, missing id). */
  responseWarnings: ValidationIssue[];
  /**
   * The model the cost math actually used. Equals response.model when set
   * (catches vendor downgrades / A-B routing); falls back to request.model.
   */
  billedModel: string;
}

export class PruneAgentClient {
  private readonly invoke: ModelInvoker;
  private readonly routing: RoutingPolicy;
  private readonly loop: LoopPolicy;
  private readonly cacheOptions?: PlanOptions;
  private readonly toTurnData: NonNullable<
    PruneAgentClientOptions["toTurnData"]
  >;
  private turnCount = 0;
  private readonly history: AdapterTurn[] = [];

  constructor(options: PruneAgentClientOptions) {
    if (typeof options.invoke !== "function") {
      throw new Error("PruneAgentClient requires an `invoke` function.");
    }
    this.invoke = options.invoke;
    this.routing = options.routing ?? new StaticRoutingPolicy();
    this.loop = options.loop ?? new LoopPolicy();
    this.cacheOptions = options.cache;
    this.toTurnData = options.toTurnData ?? defaultTurnDataProjection;
  }

  /**
   * Run one turn end-to-end. Throws LoopHaltError if the loop policy decides
   * to halt AFTER this turn's response is observed.
   */
  async query(
    request: MessageRequest,
    signal?: AbortSignal
  ): Promise<AdapterTurn> {
    // FAIL FAST at the boundary — every invalid field gets named with its
    // path. No silent NaN propagation, no provider-side cryptic errors.
    assertValidRequest(request);

    const routing = this.routing.decide({
      baselineModel: request.model,
      sessionROI: this.loop.state,
    });
    const effective: MessageRequest = { ...request, model: routing.model };
    const plan = planBreakpoints(effective, this.cacheOptions);
    const providerReq = applyBreakpoints(effective, plan);

    const response = await this.invoke(providerReq, signal);
    const turnIndex = ++this.turnCount;

    // Normalize the response — vendor may have returned partial usage. We
    // record any warnings on the turn for telemetry but never crash.
    const responseWarnings = validateResponse(response);
    const usage: UsageReport = normalizeUsage(response);
    // Vendor downgrade visibility: if the provider returned a DIFFERENT model
    // than requested (silent A/B, fallback, deprecation), record it and use
    // it for cost math. Request.model would over-estimate.
    const billedModel =
      typeof response?.model === "string" && response.model.length > 0
        ? response.model
        : effective.model;

    const turn: AdapterTurn = {
      index: turnIndex,
      request: effective,
      provider: providerReq,
      routing,
      plan,
      response,
      usage,
      responseWarnings,
      billedModel,
    };
    this.history.push(turn);

    // Feed the loop policy. The throw — if any — happens HERE, after the
    // request has already been recorded, so callers can still inspect history.
    // Pass the NORMALIZED usage to the projection so it never sees undefined.
    const td = this.toTurnData(turnIndex, effective, {
      ...response,
      usage,
    });
    this.loop.observe(td);

    return turn;
  }

  /**
   * Rolling summary across all observed turns.
   *
   * Cost math honesty: Anthropic's prompt cache prices cache_read at ~10% of
   * input but cache_creation at ~1.25× input (5m TTL) or ~2× (1h TTL). The
   * shared `calculateCost` helper only knows the cache_READ rate, so a turn
   * that ONLY writes the cache would be priced as if it were regular input
   * — hiding the 25% write premium. We compute that premium HERE, per turn,
   * using the per-turn TTL when known, defaulting to 1.25× (5m).
   */
  summary(): AdapterUsageSummary {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let costUsd = 0;
    let costNoCacheUsd = 0;
    for (const t of this.history) {
      const u = t.usage;
      const cr = u.cache_read_input_tokens ?? 0;
      const cc = u.cache_creation_input_tokens ?? 0;
      const fresh = u.input_tokens;
      inputTokens += fresh + cr + cc;
      outputTokens += u.output_tokens;
      cacheReadTokens += cr;
      cacheCreationTokens += cc;

      // Per-turn write premium. Pick the LARGEST ttl in this turn's plan
      // (most expensive write); default 5m (1.25×).
      const writeMultiplier = t.plan.breakpoints.some((b) => b.ttl === "1h")
        ? 2.0
        : 1.25;
      const pricing = getModelPricing(t.request.provider, t.billedModel);
      const cacheWritePremium =
        (cc / 1_000_000) * pricing.input * (writeMultiplier - 1);

      // Realized cost: regular input cost (fresh) + cache_read cost (cr at
      // 10%) + the write content as input (cc) + the 25% write premium.
      const baseRealized = calculateCost(
        t.request.provider,
        t.billedModel,
        fresh + cc,
        u.output_tokens,
        cr
      );
      costUsd += baseRealized + cacheWritePremium;

      // No-cache counterfactual: everything is full-price input. Output is
      // unchanged. cache_read becomes regular input; cache_creation also
      // becomes regular input (the underlying CONTENT was sent either way).
      costNoCacheUsd += calculateCost(
        t.request.provider,
        t.billedModel,
        fresh + cr + cc,
        u.output_tokens,
        0
      );
    }
    return {
      turns: this.history.length,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      costUsd,
      costNoCacheUsd,
      savedVsNoCacheUsd: costNoCacheUsd - costUsd,
    };
  }

  /** Read-only access to the turn history (for tests + audit). */
  get turns(): readonly AdapterTurn[] {
    return this.history;
  }

  /** Read-only access to the loop policy state. */
  get loopState() {
    return this.loop.state;
  }
}

/**
 * Best-effort projection: the assistant's joined text becomes responseContent;
 * no files/tests/errors signal. Callers with richer signals pass their own.
 */
function defaultTurnDataProjection(
  turnNumber: number,
  req: MessageRequest,
  res: MessageResponse
): TurnData {
  const text = res.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return {
    turnNumber,
    responseContent: text,
    filesWritten: [],
    filesRead: [],
    testsPassed: null,
    errorsPresent: [],
    tokensIn:
      res.usage.input_tokens +
      (res.usage.cache_read_input_tokens ?? 0) +
      (res.usage.cache_creation_input_tokens ?? 0),
    tokensOut: res.usage.output_tokens,
    timestamp: new Date(),
  };
}

// Re-export `getModelPricing` for callers that want to display pricing
// alongside the adapter's usage summary, without taking a new @prune/shared dep.
export { getModelPricing, type Provider };

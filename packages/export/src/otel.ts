/**
 * OpenTelemetry GenAI semantic conventions exporter.
 *
 * Emits OTLP-compatible JSON payloads — a thin map from TokenLens
 * BudgetCharge rows into the GenAI semconv span shape any OTel
 * Collector can ingest. We deliberately avoid pulling in
 * @opentelemetry/sdk-trace or the OTLP gRPC client at this layer so
 * the package stays small and embeddable; the consumer can pipe the
 * JSON to an existing collector or use otelhttp-json POST directly.
 *
 * Spec sources (verified May 2026):
 *   - https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *   - https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
 *   - https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/
 *
 * Spec status as of May 2026: client spans exited experimental in early
 * 2026; agent + framework spans remain in Development but have been
 * stable in practice. Building on the spec today is reasonable —
 * OTEL_SEMCONV_STABILITY_OPT_IN lets consumers manage transitions.
 */

import type { BudgetChargeRow } from "@prune/persistence";

/**
 * Standardized values for `gen_ai.system` per the spec's
 * "Well-known values" guidance. Anything outside this set goes through
 * verbatim — collectors typically accept and bucket as "other".
 */
export const KNOWN_GEN_AI_SYSTEMS = new Set([
  "anthropic",
  "openai",
  "vertex_ai",
  "az.ai.openai",
  "az.ai.inference",
  "aws.bedrock",
  "cohere",
  "deepseek",
  "groq",
  "ibm.watsonx.ai",
  "mistral_ai",
  "perplexity",
  "xai",
]);

export interface OtelSpan {
  /** Hex string per OTLP. */
  traceId: string;
  /** Hex string per OTLP. */
  spanId: string;
  /** OTel span name — `gen_ai.<operation>`. */
  name: string;
  /** ISO 8601 start. */
  startTimeUnixNano: string;
  /** ISO 8601 end (we use startTimeUnixNano for charges). */
  endTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
  kind: "SPAN_KIND_CLIENT";
}

export interface OtelMetric {
  /** Stable metric name per GenAI semconv. */
  name: string;
  /** Unit per UCUM. */
  unit: string;
  description: string;
  dataPoints: Array<{
    timeUnixNano: string;
    asInt: number;
    attributes: Record<string, string | number | boolean>;
  }>;
}

export interface OtelExportPayload {
  spans: OtelSpan[];
  metrics: OtelMetric[];
}

function isoToUnixNano(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "0";
  // nanoseconds as bigint string — OTLP expects ns.
  return (BigInt(ms) * 1_000_000n).toString();
}

function randomHex(bytes: number): string {
  // Deterministic per call but unique — we're not using these for actual
  // trace propagation; collectors mostly use them for indexing.
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function systemFor(provider: string): string {
  const v = provider.toLowerCase();
  if (KNOWN_GEN_AI_SYSTEMS.has(v)) return v;
  return v;
}

export interface OtelMapOptions {
  /** Service name to set as resource attribute. Default "tokenlens". */
  serviceName?: string;
  /** Optional resource attributes (deployment.environment, etc.). */
  resourceAttributes?: Record<string, string>;
  /** Override the operation name (default "chat"). */
  operationName?: string;
}

/**
 * Map a list of BudgetCharge rows into an OTel GenAI semconv payload.
 * Each charge becomes one span (gen_ai.chat) plus two metric data
 * points (input + output token usage).
 */
export function mapChargesToOtel(
  charges: BudgetChargeRow[],
  opts: OtelMapOptions = {}
): OtelExportPayload {
  const op = opts.operationName ?? "chat";
  const spans: OtelSpan[] = [];
  const tokenDataPoints: OtelMetric["dataPoints"] = [];
  const durationDataPoints: OtelMetric["dataPoints"] = [];

  for (const c of charges) {
    const startNs = isoToUnixNano(c.timestamp);
    const traceId = randomHex(16);
    const spanId = randomHex(8);
    const baseAttrs: Record<string, string | number | boolean> = {
      "gen_ai.operation.name": op,
      "gen_ai.system": systemFor(c.provider),
      "gen_ai.request.model": c.model,
      "gen_ai.response.model": c.model,
      "gen_ai.usage.input_tokens": c.tokens_in,
      "gen_ai.usage.output_tokens": c.tokens_out,
      // Non-standardized but commonly accepted attributes downstream:
      "gen_ai.usage.cache_read_input_tokens": c.tokens_cached,
      "gen_ai.usage.cache_creation_input_tokens": c.tokens_cache_creation,
      "tokenlens.cost_usd": c.cost_usd,
      "tokenlens.envelope_id": c.envelope_id,
      "tokenlens.charge_id": c.charge_id,
      "tokenlens.source": c.source,
    };
    if (c.agent_id) baseAttrs["gen_ai.conversation.id"] = c.agent_id;

    spans.push({
      traceId,
      spanId,
      name: `gen_ai.${op}`,
      startTimeUnixNano: startNs,
      endTimeUnixNano: startNs,
      attributes: baseAttrs,
      kind: "SPAN_KIND_CLIENT",
    });

    // Token usage metric — emit one data point per token type per spec.
    tokenDataPoints.push({
      timeUnixNano: startNs,
      asInt: c.tokens_in,
      attributes: {
        "gen_ai.system": systemFor(c.provider),
        "gen_ai.token.type": "input",
        "gen_ai.request.model": c.model,
      },
    });
    tokenDataPoints.push({
      timeUnixNano: startNs,
      asInt: c.tokens_out,
      attributes: {
        "gen_ai.system": systemFor(c.provider),
        "gen_ai.token.type": "output",
        "gen_ai.request.model": c.model,
      },
    });
    // Duration is unknown for a charge row; emit 0 so the metric still
    // wires up. Consumers depending on duration should derive from
    // event_log instead.
    durationDataPoints.push({
      timeUnixNano: startNs,
      asInt: 0,
      attributes: {
        "gen_ai.system": systemFor(c.provider),
        "gen_ai.request.model": c.model,
      },
    });
  }

  const metrics: OtelMetric[] = [
    {
      name: "gen_ai.client.token.usage",
      unit: "{token}",
      description: "Number of input and output tokens used.",
      dataPoints: tokenDataPoints,
    },
    {
      name: "gen_ai.client.operation.duration",
      unit: "s",
      description: "Duration of GenAI client operations.",
      dataPoints: durationDataPoints,
    },
  ];

  void opts.serviceName;
  void opts.resourceAttributes;
  return { spans, metrics };
}

/**
 * Canonical event store for the dashboard's own ingest path.
 *
 * CANONICAL STORED SHAPE (`StoredEvent`)
 * --------------------------------------
 * The dashboard's overview/sessions code consumes camelCase usage fields
 * (`tokensIn`/`tokensOut`/`costUsd`), while the f9–f13 feature-telemetry
 * aggregator (`@/lib/feature-telemetry`) reads snake_case `EventRow` fields
 * (`tokens_in`/`estimated_cost_usd`/`feature_id`/`quality_proof`). Historically
 * these two read-sides disagreed on the wire shape, so feature-tagged events
 * never reached the aggregator and every f9–f13 card rendered zero.
 *
 * We resolve this by storing ONE canonical superset object that carries BOTH
 * casings of the load-bearing fields plus the optional feature-telemetry tags.
 * Ingest normalizes whatever a client sends (camelCase, snake_case, with or
 * without `feature_id`/`quality_proof`) into this superset at the boundary —
 * nothing is silently dropped. Both read-sides then find the fields they need
 * on the same object.
 *
 * This lives in `lib/` (not a route file) so it can be shared in-process by the
 * `/api/v1/events` and `/api/v1/features` routes — Next.js forbids non-handler
 * exports from `route.ts`.
 */

/** The canonical event we persist and return. */
export interface StoredEvent {
  // --- identity / context ---
  id: string;
  timestamp: string;
  provider: "openai" | "anthropic";
  tool: "cursor" | "claude-code" | "codex" | "unknown";
  model: string;

  // --- camelCase usage fields (overview/sessions read-side) ---
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;

  // --- snake_case mirror (feature-telemetry aggregator read-side) ---
  /** Mirror of tokensIn so the aggregator's EventRow shape is satisfied. */
  tokens_in: number;
  /** Mirror of costUsd. */
  estimated_cost_usd: number;

  // --- f9–f13 feature telemetry tags (optional) ---
  /** TCRP feature tag ('f9'..'f13'), if this event is feature telemetry. */
  feature_id?: string | null;
  /** Untrusted-shape quality-proof blob the feature recorded. */
  quality_proof?: Record<string, unknown> | null;
}

/**
 * The raw payload a client may POST. We accept either casing for the usage
 * fields and the optional feature tags. Everything is validated/normalized
 * defensively in `normalizeEvent`.
 */
export interface RawEventInput {
  id?: unknown;
  timestamp?: unknown;
  provider?: unknown;
  tool?: unknown;
  model?: unknown;
  tokensIn?: unknown;
  tokensOut?: unknown;
  costUsd?: unknown;
  latencyMs?: unknown;
  // snake_case aliases (accepted for parity with EventRow / the local sink)
  tokens_in?: unknown;
  tokens_out?: unknown;
  estimated_cost_usd?: unknown;
  latency_ms?: unknown;
  // feature telemetry tags
  feature_id?: unknown;
  quality_proof?: unknown;
}

// In-memory fallback storage of canonical events (module-singleton).
const memoryStore: StoredEvent[] = [];

const PROVIDERS = new Set(["openai", "anthropic"]);
const TOOLS = new Set(["cursor", "claude-code", "codex", "unknown"]);

/** First finite number among the candidates, else fallback (default 0). */
function firstNum(fallback: number, ...candidates: unknown[]): number {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return fallback;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/**
 * Normalize an untrusted payload into the canonical `StoredEvent`. Never
 * throws on field-level issues — missing/malformed fields fall back to neutral
 * defaults. (A non-object body is rejected upstream by the caller.)
 */
export function normalizeEvent(raw: RawEventInput): StoredEvent {
  const tokensIn = firstNum(0, raw.tokensIn, raw.tokens_in);
  const tokensOut = firstNum(0, raw.tokensOut, raw.tokens_out);
  const costUsd = firstNum(0, raw.costUsd, raw.estimated_cost_usd);
  const latencyMs = firstNum(0, raw.latencyMs, raw.latency_ms);

  const provider = PROVIDERS.has(raw.provider as string)
    ? (raw.provider as StoredEvent["provider"])
    : "anthropic";
  const tool = TOOLS.has(raw.tool as string)
    ? (raw.tool as StoredEvent["tool"])
    : "unknown";

  const featureId =
    typeof raw.feature_id === "string" && raw.feature_id.length > 0
      ? raw.feature_id
      : null;
  // Only retain a plain-object proof; arrays/primitives are dropped to null so
  // the aggregator's `isRecord` guard stays the single source of truth.
  const qualityProof =
    raw.quality_proof !== null &&
    typeof raw.quality_proof === "object" &&
    !Array.isArray(raw.quality_proof)
      ? (raw.quality_proof as Record<string, unknown>)
      : null;

  return {
    id: asString(
      raw.id,
      `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    ),
    timestamp: asString(raw.timestamp, new Date().toISOString()),
    provider,
    tool,
    model: asString(raw.model, "unknown"),
    tokensIn,
    tokensOut,
    costUsd,
    latencyMs,
    tokens_in: tokensIn,
    estimated_cost_usd: costUsd,
    feature_id: featureId,
    quality_proof: qualityProof,
  };
}

async function getKV() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import("@vercel/kv");
      return kv;
    } catch {
      return null;
    }
  }
  return null;
}

/** Persist a canonical event. Updates daily stats when KV is configured. */
export async function storeEvent(
  event: StoredEvent
): Promise<{ storage: "kv" | "memory" }> {
  const kv = await getKV();
  if (kv) {
    await kv.lpush("prune:events", JSON.stringify(event));
    await kv.ltrim("prune:events", 0, 999);

    const today = new Date().toISOString().split("T")[0];
    const statsKey = `prune:stats:${today}`;
    const currentStats = (await kv.get<{
      totalCost: number;
      totalTokens: number;
      eventCount: number;
    }>(statsKey)) || { totalCost: 0, totalTokens: 0, eventCount: 0 };

    await kv.set(
      statsKey,
      {
        totalCost: currentStats.totalCost + event.costUsd,
        totalTokens:
          currentStats.totalTokens + event.tokensIn + event.tokensOut,
        eventCount: currentStats.eventCount + 1,
      },
      { ex: 86400 * 30 }
    );
    return { storage: "kv" };
  }

  memoryStore.unshift(event);
  if (memoryStore.length > 500) {
    memoryStore.splice(500);
  }
  return { storage: "memory" };
}

/**
 * Read canonical events from the dashboard's own store. Shared with sibling
 * routes (e.g. the f9–f13 features rollup) so they read exactly what ingest
 * wrote, in-process — no HTTP self-fetch, no base-URL guessing.
 */
export async function readStoredEvents(
  limit: number
): Promise<{ events: StoredEvent[]; storage: "kv" | "memory" }> {
  const kv = await getKV();
  if (kv) {
    const rawEvents = await kv.lrange<string>("prune:events", 0, limit - 1);
    const events = rawEvents.map((e) =>
      typeof e === "string" ? (JSON.parse(e) as StoredEvent) : (e as StoredEvent)
    );
    return { events, storage: "kv" };
  }
  return { events: memoryStore.slice(0, limit), storage: "memory" };
}

/** Fallback reader for the GET error path: never touches KV, never throws. */
export function readMemoryStore(limit: number): StoredEvent[] {
  return memoryStore.slice(0, limit);
}

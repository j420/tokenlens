import { describe, it, expect } from "vitest";

import type { BudgetChargeRow } from "@prune/persistence";

import { mapChargesToOtel, KNOWN_GEN_AI_SYSTEMS } from "./otel.js";
import { mapChargesToFocus } from "./focus.js";
import { rowsToCsv } from "./csv.js";
import { FOCUS_COLUMNS } from "./index.js";

function charge(over: Partial<BudgetChargeRow> = {}): BudgetChargeRow {
  return {
    charge_id: "c1",
    envelope_id: "e1",
    timestamp: "2026-05-15T10:00:00.000Z",
    agent_id: "alice",
    model: "claude-sonnet-4",
    provider: "anthropic",
    tokens_in: 1000,
    tokens_out: 200,
    tokens_cached: 0,
    tokens_cache_creation: 0,
    cost_usd: 0.0035,
    source: "recorded",
    metadata: {},
    ...over,
  };
}

// ============================================================================
// OTel exporter
// ============================================================================

describe("mapChargesToOtel — GenAI semconv", () => {
  it("emits one span per charge with the spec attributes", () => {
    const out = mapChargesToOtel([charge()]);
    expect(out.spans).toHaveLength(1);
    const s = out.spans[0];
    expect(s.name).toBe("gen_ai.chat");
    expect(s.attributes["gen_ai.system"]).toBe("anthropic");
    expect(s.attributes["gen_ai.request.model"]).toBe("claude-sonnet-4");
    expect(s.attributes["gen_ai.usage.input_tokens"]).toBe(1000);
    expect(s.attributes["gen_ai.usage.output_tokens"]).toBe(200);
    expect(s.attributes["tokenlens.cost_usd"]).toBe(0.0035);
    expect(s.kind).toBe("SPAN_KIND_CLIENT");
  });

  it("sets gen_ai.conversation.id from agent_id when present", () => {
    const out = mapChargesToOtel([charge({ agent_id: "session-x" })]);
    expect(out.spans[0].attributes["gen_ai.conversation.id"]).toBe("session-x");
  });

  it("emits two token-usage metric data points per charge (input + output)", () => {
    const out = mapChargesToOtel([charge()]);
    const tokenMetric = out.metrics.find((m) => m.name === "gen_ai.client.token.usage");
    expect(tokenMetric).toBeDefined();
    expect(tokenMetric!.dataPoints).toHaveLength(2);
    const types = tokenMetric!.dataPoints.map((d) => d.attributes["gen_ai.token.type"]).sort();
    expect(types).toEqual(["input", "output"]);
  });

  it("emits duration metric (zero for charges; consumer derives elsewhere)", () => {
    const out = mapChargesToOtel([charge()]);
    const durMetric = out.metrics.find((m) => m.name === "gen_ai.client.operation.duration");
    expect(durMetric).toBeDefined();
    expect(durMetric!.unit).toBe("s");
  });

  it("preserves cache-token fields as non-standard attributes (collectors accept)", () => {
    const out = mapChargesToOtel([
      charge({ tokens_cached: 5000, tokens_cache_creation: 2000 }),
    ]);
    expect(out.spans[0].attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(5000);
    expect(out.spans[0].attributes["gen_ai.usage.cache_creation_input_tokens"]).toBe(2000);
  });

  it("known systems list includes the major providers", () => {
    expect(KNOWN_GEN_AI_SYSTEMS.has("anthropic")).toBe(true);
    expect(KNOWN_GEN_AI_SYSTEMS.has("openai")).toBe(true);
    expect(KNOWN_GEN_AI_SYSTEMS.has("aws.bedrock")).toBe(true);
    expect(KNOWN_GEN_AI_SYSTEMS.has("vertex_ai")).toBe(true);
  });
});

// ============================================================================
// FOCUS exporter
// ============================================================================

describe("mapChargesToFocus — v1.3", () => {
  it("emits a row per charge with all required columns populated", () => {
    const rows = mapChargesToFocus([charge()]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.BilledCost).toBe(0.0035);
    expect(r.ChargeCategory).toBe("Usage");
    expect(r.ConsumedUnit).toBe("tokens");
    expect(r.PricingUnit).toBe("1M_tokens");
    expect(r.ServiceCategory).toBe("AI and Machine Learning");
    expect(r.ServiceSubcategory).toBe("Generative AI");
    expect(r.ProviderName).toBe("Anthropic");
    expect(r.PublisherName).toBe("Anthropic");
    expect(r.ServiceName).toBe("Claude");
    expect(r.ResourceType).toBe("AIModel");
    expect(r.ResourceName).toBe("claude-sonnet-4");
    expect(r.SkuId).toBe("claude-sonnet-4");
  });

  it("unit price = cost / (tokens / 1M)", () => {
    // 1200 tokens at $0.0036 → unit price $0.0036 / (1200/1e6) = $3.00 per 1M
    const rows = mapChargesToFocus([
      charge({ tokens_in: 1000, tokens_out: 200, cost_usd: 0.0036 }),
    ]);
    expect(rows[0].ListUnitPrice).toBeCloseTo(3.0, 4);
    expect(rows[0].ContractedUnitPrice).toBeCloseTo(3.0, 4);
  });

  it("subAccountId / extraTags propagate from options", () => {
    const rows = mapChargesToFocus([charge()], {
      subAccountId: "team-platform",
      subAccountName: "Platform Team",
      extraTags: { project: "auth-rewrite" },
    });
    expect(rows[0].SubAccountId).toBe("team-platform");
    expect(rows[0].SubAccountName).toBe("Platform Team");
    expect(rows[0].Tags.project).toBe("auth-rewrite");
    expect(rows[0].Tags.envelope_id).toBe("e1");
  });

  it("maps OpenAI provider to GPT service name", () => {
    const rows = mapChargesToFocus([
      charge({ provider: "openai", model: "gpt-5-codex" }),
    ]);
    expect(rows[0].ServiceName).toBe("GPT");
    expect(rows[0].PublisherName).toBe("OpenAI");
  });

  it("maps Google Vertex provider to Gemini service name", () => {
    const rows = mapChargesToFocus([
      charge({ provider: "google", model: "gemini-2.5-pro" }),
    ]);
    expect(rows[0].ServiceName).toBe("Gemini");
    expect(rows[0].PublisherName).toBe("Google");
  });
});

// ============================================================================
// CSV writer
// ============================================================================

describe("rowsToCsv — RFC 4180", () => {
  it("CRLF-terminates lines", () => {
    const csv = rowsToCsv([{ a: 1, b: 2 }], ["a", "b"]);
    expect(csv).toBe("a,b\r\n1,2\r\n");
  });

  it("quotes fields with commas or quotes", () => {
    const csv = rowsToCsv(
      [{ a: 'one,two', b: 'he said "hi"' }],
      ["a", "b"]
    );
    expect(csv).toContain('"one,two"');
    expect(csv).toContain('"he said ""hi"""');
  });

  it("handles newlines inside fields by quoting", () => {
    const csv = rowsToCsv([{ a: "line1\nline2", b: "x" }], ["a", "b"]);
    expect(csv).toMatch(/"line1\nline2",x/);
  });

  it("renders objects as JSON", () => {
    const csv = rowsToCsv([{ tags: { k: "v" } }], ["tags"]);
    expect(csv).toContain('"{""k"":""v""}"');
  });

  it("treats null/undefined as empty fields", () => {
    const csv = rowsToCsv(
      [{ a: null as unknown as string, b: undefined as unknown as string, c: 1 }],
      ["a", "b", "c"]
    );
    expect(csv).toBe("a,b,c\r\n,,1\r\n");
  });

  it("FOCUS_COLUMNS produces a valid header row", () => {
    const rows = mapChargesToFocus([charge()]);
    const csv = rowsToCsv(rows, FOCUS_COLUMNS as unknown as ReadonlyArray<keyof typeof rows[0] & string>);
    expect(csv.split("\r\n")[0]).toBe(FOCUS_COLUMNS.join(","));
  });
});

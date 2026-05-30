import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  anthropicCountTokens,
  LruTokenCountCache,
} from "./anthropic.js";

const originalKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
  vi.restoreAllMocks();
});

const sampleInput = {
  model: "claude-sonnet-4-5-20250929",
  messages: [{ role: "user" as const, content: "Hello, count my tokens." }],
};

describe("anthropicCountTokens — fallback (no key)", () => {
  it("returns source 'estimated' and a non-zero count when no API key is set", async () => {
    const result = await anthropicCountTokens(sampleInput);
    expect(result.source).toBe("estimated");
    expect(result.input_tokens).toBeGreaterThan(0);
  });
});

describe("anthropicCountTokens — exact path", () => {
  it("hits the API and returns source 'exact' when key is provided", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ input_tokens: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await anthropicCountTokens(sampleInput, {
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      cache: new LruTokenCountCache(2),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/messages/count_tokens");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "test-key"
    );
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe(
      "2023-06-01"
    );

    expect(result.source).toBe("exact");
    expect(result.input_tokens).toBe(42);
  });

  it("caches by payload hash and avoids repeat calls", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ input_tokens: 17 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const cache = new LruTokenCountCache(4);

    const first = await anthropicCountTokens(sampleInput, {
      apiKey: "k",
      fetchImpl: fetchMock as unknown as typeof fetch,
      cache,
    });
    const second = await anthropicCountTokens(sampleInput, {
      apiKey: "k",
      fetchImpl: fetchMock as unknown as typeof fetch,
      cache,
    });

    expect(first.input_tokens).toBe(17);
    expect(second.input_tokens).toBe(17);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to estimated on non-2xx response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("rate limited", { status: 429 })
    );
    const result = await anthropicCountTokens(sampleInput, {
      apiKey: "k",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.source).toBe("estimated");
    expect(result.input_tokens).toBeGreaterThan(0);
  });

  it("falls back to estimated on fetch throw", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await anthropicCountTokens(sampleInput, {
      apiKey: "k",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.source).toBe("estimated");
    expect(result.input_tokens).toBeGreaterThan(0);
  });

  it("falls back when API returns malformed body", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ wat: "noooo" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await anthropicCountTokens(sampleInput, {
      apiKey: "k",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.source).toBe("estimated");
  });
});

describe("canonicalize cache key — regression for nested-key collision", () => {
  it("derives distinct cache keys for inputs that differ only in nested message content", async () => {
    // Before the fix, JSON.stringify(input, Object.keys(input).sort()) used
    // the array as a recursive *property filter*, stripping nested keys
    // like `role` and `content` and collapsing every payload that shared
    // top-level keys to the same hash — so the second call would return
    // the cached count from the first call.
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        messages: { content: string }[];
      };
      const tokens = body.messages[0].content.length;
      return new Response(JSON.stringify({ input_tokens: tokens }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const cache = new LruTokenCountCache(8);
    const small = await anthropicCountTokens(
      {
        model: "claude-sonnet-4-5-20250929",
        messages: [{ role: "user", content: "hi" }],
      },
      { apiKey: "k", fetchImpl: fetchMock as unknown as typeof fetch, cache }
    );
    const big = await anthropicCountTokens(
      {
        model: "claude-sonnet-4-5-20250929",
        messages: [{ role: "user", content: "a much longer prompt body" }],
      },
      { apiKey: "k", fetchImpl: fetchMock as unknown as typeof fetch, cache }
    );
    expect(small.input_tokens).toBe(2);
    expect(big.input_tokens).toBe("a much longer prompt body".length);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("LruTokenCountCache", () => {
  it("evicts the least-recently-used entry past capacity", () => {
    const cache = new LruTokenCountCache(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("refreshes recency on get", () => {
    const cache = new LruTokenCountCache(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // a is now most-recent
    cache.set("c", 3); // should evict b, not a
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });
});

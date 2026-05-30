/**
 * Anthropic exact tokenizer.
 *
 * Wraps POST /v1/messages/count_tokens. Returns `source: "exact"` on success,
 * `"estimated"` (gpt-tokenizer fallback) on missing API key / network error.
 * Caches by SHA-256 of the canonicalized request payload to avoid repeat calls.
 *
 * Never silently presents fallback as exact — callers always see `.source`.
 */

import { encode } from "gpt-tokenizer";
import { createHash } from "node:crypto";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_CACHE_SIZE = 256;

export interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolDef {
  name: string;
  description?: string;
  input_schema: unknown;
}

export interface CountTokensInput {
  model: string;
  system?: string | ContentBlock[];
  messages: Message[];
  tools?: ToolDef[];
}

export interface CountTokensResult {
  input_tokens: number;
  source: "exact" | "estimated";
}

export interface AnthropicTokenizerOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  cache?: TokenCountCache;
  timeoutMs?: number;
}

export interface TokenCountCache {
  get(key: string): number | undefined;
  set(key: string, value: number): void;
}

export class LruTokenCountCache implements TokenCountCache {
  private readonly capacity: number;
  private readonly map = new Map<string, number>();

  constructor(capacity: number = DEFAULT_CACHE_SIZE) {
    this.capacity = capacity;
  }

  get(key: string): number | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // refresh recency
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: number): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const first = this.map.keys().next().value;
      if (first === undefined) break;
      this.map.delete(first);
    }
  }
}

const defaultCache = new LruTokenCountCache();

function canonicalize(input: CountTokensInput): string {
  // Recursively sort object keys so semantically equivalent inputs hash to
  // the same key. Passing an array as JSON.stringify's second argument is a
  // recursive property *filter*, not a sort order — using it strips nested
  // keys that aren't in the top-level set and collapses different payloads
  // to the same string. Use a replacer function that returns a new object
  // with sorted keys at every nesting level instead.
  return JSON.stringify(input, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as object).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
}

function cacheKey(input: CountTokensInput): string {
  return createHash("sha256").update(canonicalize(input)).digest("hex");
}

function estimateLocally(input: CountTokensInput): number {
  const chunks: string[] = [];
  if (typeof input.system === "string") chunks.push(input.system);
  else if (Array.isArray(input.system)) {
    for (const b of input.system) if (b.text) chunks.push(b.text);
  }
  for (const m of input.messages) {
    if (typeof m.content === "string") chunks.push(m.content);
    else for (const b of m.content) if (b.text) chunks.push(b.text);
  }
  if (input.tools) {
    for (const t of input.tools) {
      chunks.push(t.name);
      if (t.description) chunks.push(t.description);
      chunks.push(JSON.stringify(t.input_schema));
    }
  }
  return encode(chunks.join("\n")).length;
}

export async function anthropicCountTokens(
  input: CountTokensInput,
  opts: AnthropicTokenizerOptions = {}
): Promise<CountTokensResult> {
  const cache = opts.cache ?? defaultCache;
  const key = cacheKey(input);
  const cached = cache.get(key);
  if (cached !== undefined) {
    return { input_tokens: cached, source: "exact" };
  }

  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { input_tokens: estimateLocally(input), source: "estimated" };
  }

  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 15_000
  );

  try {
    const res = await fetchImpl(`${baseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { input_tokens: estimateLocally(input), source: "estimated" };
    }
    const body = (await res.json()) as { input_tokens?: number };
    if (typeof body.input_tokens !== "number") {
      return { input_tokens: estimateLocally(input), source: "estimated" };
    }
    cache.set(key, body.input_tokens);
    return { input_tokens: body.input_tokens, source: "exact" };
  } catch {
    return { input_tokens: estimateLocally(input), source: "estimated" };
  } finally {
    clearTimeout(timeout);
  }
}

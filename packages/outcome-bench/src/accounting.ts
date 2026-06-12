/**
 * Trial accounting: provider-reported usage only.
 *
 * Reads a Claude Code session transcript (JSONL) and totals the four billing
 * categories the provider itself reported. Nothing here estimates tokens with
 * a tokenizer, and USD is null-honest: an unpriced model, or cache reads
 * without a known cached-input rate, yield `billedUsd: null` rather than a
 * fabricated number.
 *
 * Known disclosed limitation: cache-WRITE tokens are billed at the plain
 * input rate (the pricing table carries no cache-write multiplier), which
 * slightly UNDERSTATES true spend. This follows the @prune/task-ledger
 * convention and is disclosed in the report; it biases both arms equally.
 */

import {
  TranscriptReader,
  groupIntoTurns,
  type FlatMessage,
} from "@prune/telemetry";
import { getModelPricingStrictByName } from "@prune/shared";
import type { UsageBreakdown } from "./types.js";

export interface TrialUsage {
  usage: UsageBreakdown;
  totalTokens: number;
  /** Strict USD; null when any component would need an unknown rate. */
  billedUsd: number | null;
  costComplete: boolean;
  turns: number;
  /** Most frequent model id in the transcript; null when none reported. */
  model: string | null;
  /** Transcript lines that failed to parse (reported, not hidden). */
  parseErrors: number;
  messages: FlatMessage[];
}

export function priceUsage(
  usage: UsageBreakdown,
  model: string | null
): { billedUsd: number | null; costComplete: boolean } {
  if (!model) return { billedUsd: null, costComplete: false };
  const pricing = getModelPricingStrictByName(model);
  if (!pricing) return { billedUsd: null, costComplete: false };
  if (usage.cacheRead > 0 && pricing.cached_input === undefined) {
    // A cached-read rate we don't know — refusing to guess.
    return { billedUsd: null, costComplete: false };
  }
  const usd =
    ((usage.input + usage.cacheCreate) * pricing.input +
      usage.cacheRead * (pricing.cached_input ?? 0) +
      usage.output * pricing.output) /
    1_000_000;
  return { billedUsd: usd, costComplete: true };
}

export function summarizeMessages(messages: FlatMessage[]): {
  usage: UsageBreakdown;
  turns: number;
  model: string | null;
} {
  const turns = groupIntoTurns(messages);
  const usage: UsageBreakdown = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreate: 0,
  };
  const modelCounts = new Map<string, number>();
  for (const t of turns) {
    usage.input += t.usage.input;
    usage.output += t.usage.output;
    usage.cacheRead += t.usage.cacheRead;
    usage.cacheCreate += t.usage.cacheCreate;
    if (t.model) modelCounts.set(t.model, (modelCounts.get(t.model) ?? 0) + 1);
  }
  let model: string | null = null;
  let best = 0;
  for (const [m, n] of modelCounts) {
    if (n > best) {
      best = n;
      model = m;
    }
  }
  return { usage, turns: turns.length, model };
}

export function totalOf(usage: UsageBreakdown): number {
  return usage.input + usage.output + usage.cacheRead + usage.cacheCreate;
}

/** Read a transcript file and produce the trial's accounting record. */
export async function readTrialUsage(
  transcriptPath: string
): Promise<TrialUsage> {
  const reader = new TranscriptReader(transcriptPath);
  const { messages, errors } = await reader.readAll();
  const { usage, turns, model } = summarizeMessages(messages);
  const { billedUsd, costComplete } = priceUsage(usage, model);
  return {
    usage,
    totalTokens: totalOf(usage),
    billedUsd,
    costComplete,
    turns,
    model,
    parseErrors: errors.length,
    messages,
  };
}

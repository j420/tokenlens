/**
 * buildCacheHabitsInputs — derive the FULL typed inputs the `cache_habits`
 * MCP tool consumes from REAL session data, so all 12 CH rules can fire.
 *
 * Reference: apps/extension/hooks/cache-habits-advisor.mjs derives only the
 * idle-gap-derivable subset (CH-004) from a transcript at UserPromptSubmit,
 * because a hook payload carries no proposed-action diff. This module
 * generalizes that into a pure function: it takes the typed transcript view
 * (NormalizedTurn[]) PLUS the host's declared next action, and produces the
 * `{ snapshot, action }` pair the linter needs — with the `action.changes`
 * diff computed by COMPARING the proposal to the transcript-derived snapshot.
 * That change-detection is the real, testable logic that unlocks
 * CH-001/005/006/007/008/009/010 (the mutation rules), not just the idle rule.
 *
 * Discipline:
 *   - NO regex. Structure comes from the typed turn view and explicit field
 *     comparisons only.
 *   - NEVER fabricate a token count / cost / timestamp. A value absent from
 *     the source is null (or [] for set fields), and the dependent change
 *     field is null — never guessed.
 *   - Pure & deterministic. Never throws on malformed input.
 */

import type { NormalizedTurn } from "@prune/telemetry";
import {
  modelFamilyOf,
  type CacheTtl,
  type ModelFamily,
  type ProposedAction,
  type SessionSnapshot,
} from "@prune/cache-habits";

/**
 * The transcript view this adapter reads. `loadCachedSessionView` returns an
 * object whose `.turns` is `NormalizedTurn[]`; we accept that shape directly
 * (or any already-loaded `{ turns }`) so the caller can pass either the full
 * CachedSessionView or a slimmer projection. `readonly` so we never mutate it.
 */
export interface TranscriptViewLike {
  turns: readonly NormalizedTurn[];
}

/** A reasoning-effort dial value, as the linter types it. */
export type ReasoningEffort = "standard" | "high" | "xhigh" | "max";

/**
 * The host's declared next action. Everything except `model` is optional; the
 * host supplies only what it actually knows. Values the host does NOT know are
 * simply omitted — the adapter then leaves the corresponding snapshot field /
 * change null rather than inventing one.
 *
 * Volatility / change is DECLARED here (e.g. `pastedBlocks`), never sniffed —
 * mirroring the linter's own discipline (rules.ts header).
 */
export interface ProposedActionInput {
  /** Full model id the next turn will use, e.g. "claude-opus-4-5". Required. */
  model: string;
  /** TTL the next turn will use. Default "none" (caller didn't declare one). */
  ttl?: CacheTtl;
  /** The user's prompt text for the next turn. Default "". */
  promptText?: string;
  /**
   * Caller-declared paste annotations (one per paste event). The adapter
   * passes these straight through; it never tries to detect pastes from the
   * prompt body. Default [].
   */
  pastedBlocks?: ProposedAction["prompt"]["pastedBlocks"];
  /**
   * Token count of the system prompt the next turn will send (computed by the
   * host via @prune/tokenizer). null/absent ⇒ unknown ⇒ no CH-002/006 signal.
   */
  systemPromptTokens?: number | null;
  /**
   * Stable hash of the tool-list ORDER the next turn will send. null/absent ⇒
   * unknown ⇒ no CH-005 reorder signal.
   */
  toolListOrderHash?: string | null;
  /** Reasoning-effort dial the next turn will use, if the host exposes one. */
  reasoningEffort?: ReasoningEffort;
  /** Sampling temperature the next turn will use, if the host exposes one. */
  temperature?: number;
  /** MCP server ids attached for the next turn. Default [] (none declared). */
  mcpServers?: readonly string[];
  /**
   * Wall-clock time the action will fire (ISO 8601). Used by CH-004 for the
   * idle-gap computation. Default: the snapshot's lastTurnAt (⇒ zero idle gap,
   * so CH-004 never fires spuriously when the host omits a clock).
   */
  now?: string;
}

/** Carrier for the host's prior-state knowledge the transcript can't supply. */
export interface SnapshotContextInput {
  /**
   * TTL the active session is configured with. The transcript does not record
   * the configured TTL, so the host declares it. Default "none".
   */
  currentTtl?: CacheTtl;
  /**
   * Token count of the CURRENTLY-active system prompt (host-computed). null ⇒
   * unknown. Never derived from the transcript (turn usage mixes system +
   * tools + history and cannot be attributed to the system prompt alone).
   */
  systemPromptTokens?: number | null;
  /** Stable hash of the currently-active tool-list ORDER. null ⇒ unknown. */
  toolListOrderHash?: string | null;
  /** Reasoning-effort dial currently active, if the host exposes one. */
  reasoningEffort?: ReasoningEffort;
  /** Currently-active sampling temperature, if the host exposes one. */
  temperature?: number;
  /** MCP server ids attached to the active session. Default []. */
  mcpServers?: readonly string[];
}

export interface CacheHabitsInputs {
  snapshot: SessionSnapshot;
  action: ProposedAction;
}

/**
 * `modelFamilyOf` returns a widened `string`. The linter's `ProposedAction`
 * wants the `ModelFamily` union. The classifier only ever emits members of
 * that union, so we narrow against the canonical set rather than blind-casting.
 */
const MODEL_FAMILIES: ReadonlySet<ModelFamily> = new Set<ModelFamily>([
  "sonnet",
  "opus",
  "haiku",
  "gpt-4o",
  "gpt-4o-mini",
  "other",
]);

function familyOf(model: string): ModelFamily {
  const fam = modelFamilyOf(model);
  return MODEL_FAMILIES.has(fam as ModelFamily) ? (fam as ModelFamily) : "other";
}

/** Read a non-negative finite usage field, tolerating malformed runtime values. */
function safeUsageField(turn: NormalizedTurn, key: "cacheRead" | "cacheCreate"): number {
  const usage = turn.usage;
  if (!usage || typeof usage !== "object") return 0;
  // `usage` is typed UsageTotals, but at runtime a malformed transcript can put
  // a NaN / negative / non-number here. Guard before summing; never go negative.
  const v: unknown = usage[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Last turn that carries any field, scanning from the end. Tolerates gaps. */
function lastTurn(turns: readonly NormalizedTurn[]): NormalizedTurn | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t && typeof t === "object") return t;
  }
  return null;
}

/** Set difference `a \ b`, preserving `a`'s order, de-duplicated. */
function difference(a: readonly string[], b: readonly string[]): string[] {
  const exclude = new Set(b);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of a) {
    if (typeof x !== "string") continue;
    if (exclude.has(x) || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/** Normalize a possibly-undefined readonly string list to a clean string[]. */
function cleanList(xs: readonly string[] | undefined): string[] {
  if (!Array.isArray(xs)) return [];
  return xs.filter((x): x is string => typeof x === "string");
}

/**
 * Build the FULL `{ snapshot, action }` the cache_habits linter consumes.
 *
 * SNAPSHOT (derived from the transcript, host context for what the transcript
 * cannot supply):
 *   - currentModel: the last turn's model (the active model right now).
 *   - currentTtl: host-declared (transcript has no TTL). Default "none".
 *   - lastTurnAt: last turn's endedAt ?? startedAt ?? null. Never invented.
 *   - turnsSoFar: number of turns in the view.
 *   - cacheReadTokensSoFar / cacheCreationTokensSoFar: summed from turn usage.
 *   - systemPromptTokens / toolListOrderHash: host-supplied or null.
 *   - mcpServers: host-supplied or [].
 *
 * ACTION (the proposal + a change-set computed by comparing proposal to
 * snapshot). Each `changes` field is non-null ONLY when it genuinely differs:
 *   - systemPromptTokens: non-null iff host declared a next value AND it
 *     differs from the snapshot's (and the snapshot's is known).
 *   - toolListOrderHash: non-null iff host declared a next hash AND it differs
 *     from the snapshot's (and the snapshot's is known).
 *   - reasoningEffort: non-null iff host declared a next dial AND it differs
 *     from the active dial (active defaults to "standard" only for comparison,
 *     matching CH-009's own default).
 *   - temperature: non-null iff host declared a next temp AND it differs from
 *     the active temp (and the active temp is known — CH-010 requires both).
 *   - mcpServersAdded / mcpServersRemoved: set differences proposal vs snapshot.
 *
 * Model switch (CH-001), TTL tier switch (CH-008), and idle gap (CH-004) are
 * detected by the rules from the top-level action fields (model/ttl/now), so we
 * don't pre-diff those into `changes` — we just pass the real values through.
 */
export function buildCacheHabitsInputs(
  view: TranscriptViewLike,
  proposed: ProposedActionInput,
  context: SnapshotContextInput = {}
): CacheHabitsInputs {
  const turns = Array.isArray(view?.turns) ? view.turns : [];

  const last = lastTurn(turns);
  // currentModel: the last turn's declared model. When the transcript carries
  // none, fall back to the PROPOSED model — this means "no model switch known"
  // rather than fabricating a different model that would spuriously fire CH-001.
  const currentModel =
    last && typeof last.model === "string" && last.model ? last.model : proposed.model;

  let cacheRead = 0;
  let cacheCreate = 0;
  for (const t of turns) {
    if (!t || typeof t !== "object") continue;
    cacheRead += safeUsageField(t, "cacheRead");
    cacheCreate += safeUsageField(t, "cacheCreate");
  }

  const lastTurnAt =
    last && (typeof last.endedAt === "string" || typeof last.startedAt === "string")
      ? (last.endedAt ?? last.startedAt ?? null)
      : null;

  const snapshotMcp = cleanList(context.mcpServers);

  const snapshot: SessionSnapshot = {
    currentModel,
    currentTtl: context.currentTtl ?? "none",
    lastTurnAt,
    turnsSoFar: turns.length,
    cacheReadTokensSoFar: cacheRead,
    cacheCreationTokensSoFar: cacheCreate,
    systemPromptTokens:
      context.systemPromptTokens === undefined ? null : context.systemPromptTokens,
    toolListOrderHash:
      context.toolListOrderHash === undefined ? null : context.toolListOrderHash,
    mcpServers: snapshotMcp,
    // Optional dials: include only when the host actually knows the active
    // value. Leaving them undefined makes CH-009 default the prev to "standard"
    // and CH-010 short-circuit (it requires a known prior temperature).
    ...(context.reasoningEffort !== undefined
      ? { reasoningEffort: context.reasoningEffort }
      : {}),
    ...(context.temperature !== undefined ? { temperature: context.temperature } : {}),
  };

  const proposedMcp = cleanList(proposed.mcpServers);

  // --- change-detection: each field non-null ONLY when it actually differs ---

  // System-prompt token change: requires BOTH a declared next value and a known
  // prior value, and they must differ. (CH-002 reads the value to flag
  // too-small prompts; CH-006 reads it to flag a mutation — both need it set
  // when changing, null when not.)
  let changeSystemPromptTokens: number | null = null;
  if (
    proposed.systemPromptTokens !== undefined &&
    proposed.systemPromptTokens !== null &&
    snapshot.systemPromptTokens !== null &&
    proposed.systemPromptTokens !== snapshot.systemPromptTokens
  ) {
    changeSystemPromptTokens = proposed.systemPromptTokens;
  }

  // Tool-list reorder: declared next hash differs from a known prior hash.
  let changeToolListOrderHash: string | null = null;
  if (
    proposed.toolListOrderHash !== undefined &&
    proposed.toolListOrderHash !== null &&
    snapshot.toolListOrderHash !== null &&
    proposed.toolListOrderHash !== snapshot.toolListOrderHash
  ) {
    changeToolListOrderHash = proposed.toolListOrderHash;
  }

  // Reasoning-effort raise/change: declared next dial differs from the active
  // dial. Active defaults to "standard" for the comparison, matching CH-009's
  // own `prev = snapshot.reasoningEffort ?? "standard"`.
  let changeReasoningEffort: ReasoningEffort | null = null;
  if (proposed.reasoningEffort !== undefined) {
    const activeEffort = snapshot.reasoningEffort ?? "standard";
    if (proposed.reasoningEffort !== activeEffort) {
      changeReasoningEffort = proposed.reasoningEffort;
    }
  }

  // Temperature change: declared next temp differs from a KNOWN active temp.
  // (CH-010 short-circuits when the prior temp is unknown, so emitting a change
  // without a known prior would be inert anyway — keep it honest and null it.)
  let changeTemperature: number | null = null;
  if (
    proposed.temperature !== undefined &&
    snapshot.temperature !== undefined &&
    proposed.temperature !== snapshot.temperature
  ) {
    changeTemperature = proposed.temperature;
  }

  // MCP add/remove: pure set differences of declared proposal vs snapshot.
  const mcpServersAdded = difference(proposedMcp, snapshotMcp);
  const mcpServersRemoved = difference(snapshotMcp, proposedMcp);

  const pastedBlocks: ProposedAction["prompt"]["pastedBlocks"] = Array.isArray(
    proposed.pastedBlocks
  )
    ? proposed.pastedBlocks
    : [];

  const action: ProposedAction = {
    modelFamily: familyOf(proposed.model),
    model: proposed.model,
    ttl: proposed.ttl ?? "none",
    prompt: {
      text: typeof proposed.promptText === "string" ? proposed.promptText : "",
      pastedBlocks,
    },
    changes: {
      systemPromptTokens: changeSystemPromptTokens,
      toolListOrderHash: changeToolListOrderHash,
      reasoningEffort: changeReasoningEffort,
      temperature: changeTemperature,
      mcpServersAdded,
      mcpServersRemoved,
    },
    // now: host-declared firing time, or the last turn's time (⇒ zero idle gap,
    // so CH-004 never fires from a fabricated clock). Never invent "new Date()"
    // here — that would be a non-deterministic fabricated timestamp.
    now:
      typeof proposed.now === "string" && proposed.now
        ? proposed.now
        : (lastTurnAt ?? new Date(0).toISOString()),
  };

  return { snapshot, action };
}

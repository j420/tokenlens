/**
 * Cache-Habits Linter — typed surface.
 *
 * The linter is pre-action: it inspects a `ProposedAction` (the typed shape of
 * what the user is about to send to the model) and emits `LintFinding`s for
 * any rule that fires. No I/O here; the runtime caller supplies the action
 * payload and the session context and decides what to do with the verdict
 * (warn in stdout, refuse the send, exit 2 from a hook, etc).
 *
 * Hard rules enforced by the type shape:
 *   - No regex. Inputs are STRUCTURALLY TYPED (string lengths, declared TTL
 *     enums, typed message arrays). Rules walk fields, never patterns.
 *   - No model call. Every field is a deterministic input the caller supplies.
 *   - Volatility is DECLARED by the caller, never sniffed (mirrors the
 *     agent-sdk-adapter cache-planner discipline).
 */

/**
 * The model family the proposed action targets. Used by rules that key off
 * minimum cacheable prefix (Sonnet = 1024 tokens; Opus / Haiku = 4096). Pulled
 * from `@prune/agent-sdk-adapter`'s DEFAULT_MIN_CACHEABLE_TOKENS table.
 */
export type ModelFamily = "sonnet" | "opus" | "haiku" | "gpt-4o" | "gpt-4o-mini" | "other";

/** Cache TTL bucket the upstream caller is using. */
export type CacheTtl = "5m" | "1h" | "none";

/**
 * Transport tier the session is using, caller-DECLARED (never sniffed).
 *
 *   - "stateful"   — a server-side / WebSocket transport that retains
 *                    conversation history server-side, so history is NOT
 *                    re-transmitted (and re-billed) each turn.
 *   - "stateless"  — a plain HTTP transport that re-sends the growing stable
 *                    prefix every turn (the "communication tax").
 *   - "unknown"    — the host does not (or cannot) report the transport tier.
 *                    The transport rules treat this as "do not fire" — they are
 *                    dormant until a host supplies a concrete tier, so they can
 *                    never act on a guess.
 */
export type TransportTier = "stateful" | "stateless" | "unknown";

/**
 * Snapshot of the session's *prior* state as the user composes the next
 * action. All counts are caller-supplied; the linter does not introspect a
 * transcript here — that's `cache-stabilize.mjs`'s job. The linter's role
 * is to compare the PROPOSED action against this snapshot deterministically.
 */
export interface SessionSnapshot {
  /** Active model right before the proposed action. */
  currentModel: string;
  /** Cache TTL the active session is configured with. */
  currentTtl: CacheTtl;
  /** Wall-clock timestamp of the last model round-trip, ISO 8601. */
  lastTurnAt: string | null;
  /** Number of turns completed in the session so far. */
  turnsSoFar: number;
  /**
   * Cache-read tokens accumulated in the session. Used to estimate the
   * dollar value of cache about to be invalidated.
   */
  cacheReadTokensSoFar: number;
  /** Cache-creation tokens accumulated. */
  cacheCreationTokensSoFar: number;
  /**
   * Token count of the active system prompt (caller-supplied; computed via
   * `@prune/tokenizer`, NEVER guessed). null when unknown.
   */
  systemPromptTokens: number | null;
  /**
   * Stable hash of the active tool-list ORDER. The linter compares this to
   * the proposed action's tool-list-order hash to detect reorders without
   * looking inside the schemas.
   */
  toolListOrderHash: string | null;
  /** Active reasoning effort dial, if the provider exposes one. */
  reasoningEffort?: "standard" | "high" | "xhigh" | "max";
  /** Active sampling temperature (provider default if absent). */
  temperature?: number;
  /**
   * Set of MCP server identifiers attached to the session. Used by
   * CH-010 to detect mid-session server adds/removes.
   */
  mcpServers: readonly string[];
  /**
   * Transport tier the session is currently on. Caller-declared; absent /
   * "unknown" means the transport rules (CH-013, CH-014) stay dormant.
   */
  transport?: TransportTier;
  /**
   * Tokens of conversation history a STATELESS transport re-transmits each
   * turn (the stable prefix that would be retained server-side on a stateful
   * transport). Caller-supplied via the tokenizer; null when unknown. Used by
   * CH-013 (re-billed on a stateful→stateless fallback) and CH-014 (the
   * per-turn communication tax on a long stateless session). Never guessed.
   */
  historyTokens?: number | null;
}

/**
 * What the user is about to send. The linter inspects this typed payload —
 * never the raw network bytes — and decides whether any cache-killer rule
 * applies. Optional fields are absent when the user did not change them.
 */
export interface ProposedAction {
  /** Model family the proposed action targets. */
  modelFamily: ModelFamily;
  /** Full model id, e.g. "claude-sonnet-4-5-20250929". */
  model: string;
  /** TTL the action will use. */
  ttl: CacheTtl;
  /**
   * The user's prompt content. The linter reads `.length` and looks at the
   * caller-supplied `pastedBlocks` annotation; it never regex-scans the
   * content.
   */
  prompt: {
    text: string;
    /**
     * Caller-declared paste annotations. The host (extension, hook) tracks
     * paste events by clipboard interaction; the linter never tries to
     * "sniff" whether content looks pasted. One entry per paste event.
     */
    pastedBlocks: ReadonlyArray<{
      tokens: number;
      /** Caller-declared source — file path, "clipboard", or "url". */
      source: "clipboard" | "url" | "file" | "unknown";
    }>;
  };
  /**
   * Caller-declared change set vs the session snapshot. Each field is null
   * when unchanged. The linter never diffs raw values to guess; the host
   * (which already has both versions) supplies the typed diff.
   */
  changes: {
    /** New system prompt token count, if the user is about to change it. */
    systemPromptTokens: number | null;
    /** New tool-list-order hash, if the catalog was reordered. */
    toolListOrderHash: string | null;
    /** New reasoning effort, if the dial is being changed. */
    reasoningEffort: "standard" | "high" | "xhigh" | "max" | null;
    /** New temperature, if it's being changed. */
    temperature: number | null;
    /** MCP servers being added in this turn. */
    mcpServersAdded: readonly string[];
    /** MCP servers being removed in this turn. */
    mcpServersRemoved: readonly string[];
    /**
     * New transport tier, if it is changing this turn (e.g. a silent
     * stateful→stateless fallback after a reconnect). null when unchanged.
     * Caller-declared; CH-013 fires on a stateful→stateless transition.
     */
    transport: TransportTier | null;
  };
  /**
   * Caller-supplied wall-clock timestamp when the action will fire. The
   * linter uses (now − lastTurnAt) to compute idle gap. ISO 8601.
   */
  now: string;
}

/** Severity buckets for findings; the hook decides how each maps to a verdict. */
export type FindingSeverity = "info" | "warn" | "block";

/**
 * A single finding from one rule. Every finding carries a stable rule id so
 * dashboards can roll up and so users can suppress a rule by id without
 * regex-matching the message.
 */
export interface LintFinding {
  /** Stable rule id, e.g. "CH-001". Never changes once shipped. */
  ruleId: string;
  /** Short human-readable rule name. */
  ruleName: string;
  severity: FindingSeverity;
  /**
   * The reason the rule fired — deterministic templated string, never
   * includes the user's prompt content verbatim (PII hygiene). Same inputs
   * always produce the same message (test-pinned).
   */
  message: string;
  /**
   * Caller-actionable suggestion. Templated. May be empty if the rule has
   * no canonical remediation.
   */
  suggestion: string;
  /**
   * Estimated wasted cost in USD if the user proceeds. Computed from
   * `@prune/shared/pricing` cached_input rates; null when the model isn't
   * priced (linter never fabricates a number).
   */
  estimatedWasteUsd: number | null;
  /**
   * Estimated wasted tokens if the user proceeds. Caller can use this for
   * the HUD ribbon when cost is unavailable.
   */
  estimatedWasteTokens: number | null;
  /**
   * Structured signal payload — the typed values that drove the decision.
   * Goes into `quality_proof` on the persistence sink so a post-hoc audit
   * can verify the rule fired correctly. Never includes user content.
   */
  signal: Record<string, unknown>;
}

/** Aggregate verdict the runner returns after running all enabled rules. */
export interface LintReport {
  /**
   * Highest severity across all findings. If none → "info"; mixed → "block"
   * if any block fired, else "warn" if any warn fired, else "info".
   */
  verdict: FindingSeverity;
  findings: LintFinding[];
  /** Sum of `estimatedWasteUsd` over all findings with a non-null value. */
  totalEstimatedWasteUsd: number;
  /** Sum of `estimatedWasteTokens` over all findings with a non-null value. */
  totalEstimatedWasteTokens: number;
  /** Rule ids that were skipped (suppressed or short-circuited). */
  skipped: string[];
}

/** Caller-controlled options. Stable; tests pin the defaults. */
export interface LintOptions {
  /**
   * Rule ids to suppress entirely. Useful when a user knows a rule fires
   * spuriously in their environment.
   */
  suppress?: readonly string[];
  /**
   * Override of the per-rule default severity. Used by adapters that want
   * to demote `block` to `warn` in shadow mode.
   */
  severityOverrides?: Readonly<Record<string, FindingSeverity>>;
}

/**
 * Pure rule contract: read the proposed action + snapshot, return zero or
 * one finding. Rules MUST be deterministic and side-effect-free. Returning
 * an array is reserved for a future rule that can produce multiple
 * findings; v0.1 caps at one per rule for stable id-finding mapping.
 */
export type RuleFn = (
  action: ProposedAction,
  snapshot: SessionSnapshot
) => LintFinding | null;

export interface Rule {
  id: string;
  name: string;
  /** One-line description, shown in `prune cache-habits explain <id>`. */
  description: string;
  /** Default severity this rule emits at. Caller can override per-call. */
  defaultSeverity: FindingSeverity;
  /** Citation the rule traces back to (Anthropic blog, forum, paper, etc). */
  citation: string;
  /** The deterministic predicate. */
  run: RuleFn;
}

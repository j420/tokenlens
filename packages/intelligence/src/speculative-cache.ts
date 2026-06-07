/**
 * F3 — Speculative Action Pruner.
 *
 * An agent re-reads the same file, re-lists the same directory, re-greps the
 * same pattern many times in a session. Each redundant read-only call costs a
 * round-trip and re-injects its result into the context window. This cache
 * substitutes a cached result for a redundant read-only call WHEN a freshness
 * token proves the underlying source is unchanged.
 *
 * QUALITY INVARIANT (three independent guarantees, any one sufficient):
 *   1. ELIGIBILITY. Only read-only tools are ever substitutable. Write / Edit /
 *      destructive tools are structurally excluded — `isEligibleTool` returns
 *      false and there is no code path that substitutes them.
 *   2. FRESHNESS. A substitution fires only when the caller-supplied freshness
 *      token (file content SHA, dir mtime+count, working-tree SHA) is byte-
 *      identical to the token stored with the cached result. Identical token ⇒
 *      identical bytes ⇒ the agent receives exactly what a fresh call returns.
 *   3. VERIFICATION. Every substitution is shadow-verified: the caller runs the
 *      real tool out of band and reports whether cached ≡ fresh. If the
 *      observed miss-rate for a scope exceeds the threshold (default 2%) over a
 *      rolling window, that scope auto-disables for the session + a cooldown.
 *
 * This module is pure state + logic. It never touches the filesystem or runs a
 * tool — the caller (a PreToolUse hook) probes freshness and executes the
 * shadow verification.
 */

import { sha256Hex } from "@prune/shared/node";

export type SubstitutionScope = "Read" | "Glob" | "LS" | "Grep" | "BashReadOnly";

export const ELIGIBLE_TOOLS: readonly string[] = [
  "Read",
  "Glob",
  "LS",
  "Grep",
];

/**
 * Pure-read bash command forms. A command is eligible only when it matches one
 * of these AND contains no shell metacharacters that could chain a write
 * (`|`, `;`, `&`, `>`, `<`, backtick, `$(`).
 */
const PURE_READ_BASH = [
  /^git\s+log\b/,
  /^git\s+diff\b/,
  /^git\s+show\b/,
  /^git\s+status\b/,
  /^git\s+ls-files\b/,
  /^cat\s/,
  /^head\s/,
  /^tail\s/,
  /^ls\s/,
  /^find\b[^|;&]*-type\s+f\b/,
  /^wc\s/,
  /^grep\s/,
  /^rg\s/,
];

// Shell metacharacters that can chain, redirect, or substitute another
// command. Includes newline/carriage-return: a cacheable read is a single
// command, and a newline could smuggle `cat a\nrm b`.
const SHELL_WRITE_METACHARS = /[|;&><`\n\r]|\$\(/;

// `find` is a read primary ONLY without an action that executes or mutates.
// These primaries run commands or modify the filesystem and must disqualify.
const FIND_DANGEROUS_PRIMARY =
  /\s-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)\b/;

/**
 * An opaque freshness token. Equal tokens ⇒ the underlying source is unchanged.
 *
 * SOUNDNESS HIERARCHY (strongest → weakest):
 *   - "content-sha"    hash of the exact bytes. SOUND for Read: identical token
 *                      guarantees byte-identical content, zero false matches.
 *   - "filelist-stat"  hash of per-file (path, mtime, size) over the scanned
 *                      set. Catches in-place edits (mtime/size change) that a
 *                      bare directory stat misses. Recommended for Grep/Glob.
 *   - "dir-stat"       directory mtime + entry count only. Detects add/remove/
 *                      rename but NOT in-place content edits — a WEAK signal.
 *                      Use only for LS-style listings, and rely on shadow
 *                      verification + auto-disable to catch its failures.
 */
export interface FreshnessToken {
  kind: "content-sha" | "filelist-stat" | "dir-stat" | "worktree-sha";
  value: string;
}

export interface CacheEntry {
  scope: SubstitutionScope;
  canonicalInput: string;
  result: string;
  freshness: FreshnessToken;
  storedAtTurn: number;
  storedAt: number; // epoch ms
}

export interface SubstitutionDecision {
  substitute: boolean;
  scope?: SubstitutionScope;
  /** The cached result to inject, when substitute is true. */
  result?: string;
  /** Estimated tokens saved (chars/4 heuristic unless caller overrides). */
  estimatedTokensSaved?: number;
  reason: string;
}

export interface SpeculativeCacheOptions {
  /** Miss-rate (0..1) over the rolling window that triggers auto-disable. */
  missRateThreshold?: number;
  /** Rolling-window size for miss-rate computation. Default 100. */
  windowSize?: number;
  /** Cooldown (ms) a scope stays disabled after tripping. Default 24h. */
  cooldownMs?: number;
  /** Scopes enabled for substitution. Default ["Read"] (safest first). */
  enabledScopes?: SubstitutionScope[];
}

interface ScopeHealth {
  /** Ring buffer of recent verification outcomes (true = equivalent). */
  outcomes: boolean[];
  disabledUntil: number; // epoch ms; 0 = enabled
}

export interface VerificationStats {
  scope: SubstitutionScope;
  substitutions: number;
  misses: number;
  missRate: number;
  disabled: boolean;
}

/** On-disk shape of the cache, shared between hook processes. */
export interface SpeculativeCacheState {
  version: 1;
  entries: Array<{ key: string; entry: CacheEntry }>;
  health: Array<{
    scope: SubstitutionScope;
    outcomes: boolean[];
    disabledUntil: number;
  }>;
}

/** Tool eligibility — the structural guarantee that writes are never cached. */
export function isEligibleTool(name: string): boolean {
  return ELIGIBLE_TOOLS.includes(name);
}

/** Is a bash command a pure read we can safely cache? */
export function isPureReadBash(command: string): boolean {
  const trimmed = command.trim();
  if (SHELL_WRITE_METACHARS.test(trimmed)) return false;
  // `find` with an executing/mutating action primary is NOT a read, even
  // though it matches the `-type f` read pattern (e.g. `find . -type f -delete`).
  if (/^find\b/.test(trimmed) && FIND_DANGEROUS_PRIMARY.test(trimmed)) {
    return false;
  }
  return PURE_READ_BASH.some((re) => re.test(trimmed));
}

/**
 * Map a tool_use to a substitution scope, or null if ineligible. Bash is
 * eligible only for pure-read command forms.
 */
export function scopeForToolUse(
  name: string,
  input: Record<string, unknown>
): SubstitutionScope | null {
  switch (name) {
    case "Read":
      return "Read";
    case "Glob":
      return "Glob";
    case "LS":
      return "LS";
    case "Grep":
      return "Grep";
    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : "";
      return isPureReadBash(cmd) ? "BashReadOnly" : null;
    }
    default:
      return null;
  }
}

/** Canonicalize a tool input into a stable cache key component. */
export function canonicalizeInput(
  scope: SubstitutionScope,
  input: Record<string, unknown>
): string {
  switch (scope) {
    case "Read":
      return JSON.stringify({ path: normPath(input.file_path ?? input.path) });
    case "LS":
      return JSON.stringify({ path: normPath(input.path) });
    case "Glob":
      return JSON.stringify({
        pattern: String(input.pattern ?? ""),
        path: normPath(input.path),
      });
    case "Grep":
      return JSON.stringify({
        pattern: String(input.pattern ?? ""),
        path: normPath(input.path),
        glob: String(input.glob ?? ""),
        flags: String(input["-i"] ?? "") + String(input.output_mode ?? ""),
      });
    case "BashReadOnly":
      return JSON.stringify({
        command: String(input.command ?? "").trim(),
      });
  }
}

export class SpeculativeCache {
  private entries = new Map<string, CacheEntry>();
  private health = new Map<SubstitutionScope, ScopeHealth>();
  private readonly missRateThreshold: number;
  private readonly windowSize: number;
  private readonly cooldownMs: number;
  private readonly enabledScopes: Set<SubstitutionScope>;

  constructor(options: SpeculativeCacheOptions = {}) {
    this.missRateThreshold = options.missRateThreshold ?? 0.02;
    this.windowSize = options.windowSize ?? 100;
    this.cooldownMs = options.cooldownMs ?? 24 * 60 * 60 * 1000;
    this.enabledScopes = new Set(options.enabledScopes ?? ["Read"]);
  }

  /**
   * Store a fresh tool result with the freshness token observed at fetch time.
   */
  store(
    name: string,
    input: Record<string, unknown>,
    result: string,
    freshness: FreshnessToken,
    turn: number,
    now: number = Date.now()
  ): void {
    const scope = scopeForToolUse(name, input);
    if (!scope) return;
    const key = this.key(scope, input);
    this.entries.set(key, {
      scope,
      canonicalInput: canonicalizeInput(scope, input),
      result,
      freshness,
      storedAtTurn: turn,
      storedAt: now,
    });
  }

  /**
   * Decide whether to substitute a cached result for this tool_use. Requires:
   * the tool eligible, the scope enabled and not auto-disabled, a cache entry
   * present, and the caller's current freshness token byte-equal to the stored
   * one.
   */
  decide(
    name: string,
    input: Record<string, unknown>,
    currentFreshness: FreshnessToken | null,
    now: number = Date.now()
  ): SubstitutionDecision {
    const scope = scopeForToolUse(name, input);
    if (!scope) {
      return { substitute: false, reason: "tool not eligible (read-only only)" };
    }
    if (!this.enabledScopes.has(scope)) {
      return { substitute: false, scope, reason: `scope ${scope} not enabled` };
    }
    if (this.isScopeDisabled(scope, now)) {
      return {
        substitute: false,
        scope,
        reason: `scope ${scope} auto-disabled (miss-rate exceeded)`,
      };
    }
    const entry = this.entries.get(this.key(scope, input));
    if (!entry) {
      return { substitute: false, scope, reason: "cache miss (no prior result)" };
    }
    if (!currentFreshness) {
      return {
        substitute: false,
        scope,
        reason: "no freshness probe supplied; refusing to substitute",
      };
    }
    if (!freshnessEqual(entry.freshness, currentFreshness)) {
      return {
        substitute: false,
        scope,
        reason: "source changed since cache (freshness token differs)",
      };
    }
    return {
      substitute: true,
      scope,
      result: entry.result,
      estimatedTokensSaved: Math.ceil(entry.result.length / 4),
      reason: "fresh cached result available; substituting",
    };
  }

  /**
   * Record the outcome of a shadow verification (cached ≡ fresh?). Updates the
   * scope's rolling health and auto-disables on threshold breach.
   */
  recordVerification(
    scope: SubstitutionScope,
    equivalent: boolean,
    now: number = Date.now()
  ): void {
    const h = this.healthFor(scope);
    h.outcomes.push(equivalent);
    if (h.outcomes.length > this.windowSize) h.outcomes.shift();
    if (!equivalent) {
      const missRate = this.missRate(h);
      // Only trip once we have a meaningful sample to avoid a single early
      // miss disabling the scope on n=1.
      if (h.outcomes.length >= 10 && missRate > this.missRateThreshold) {
        h.disabledUntil = now + this.cooldownMs;
      }
    }
  }

  stats(scope: SubstitutionScope, now: number = Date.now()): VerificationStats {
    const h = this.healthFor(scope);
    const misses = h.outcomes.filter((o) => !o).length;
    return {
      scope,
      substitutions: h.outcomes.length,
      misses,
      missRate: this.missRate(h),
      disabled: this.isScopeDisabled(scope, now),
    };
  }

  isScopeDisabled(scope: SubstitutionScope, now: number = Date.now()): boolean {
    const h = this.health.get(scope);
    return !!h && h.disabledUntil > now;
  }

  /** Drop a single cached entry (e.g. on a known file-change event). */
  invalidate(name: string, input: Record<string, unknown>): void {
    const scope = scopeForToolUse(name, input);
    if (!scope) return;
    this.entries.delete(this.key(scope, input));
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  /**
   * Serialize cache + health to a plain JSON object. Hook scripts are separate
   * processes, so the cache must survive on disk between PreToolUse and
   * PostToolUse invocations. Config (thresholds/scopes) is NOT serialized —
   * the loading process supplies it, so policy changes take effect immediately.
   */
  toJSON(): SpeculativeCacheState {
    return {
      version: 1,
      // Serialize the map KEY directly to avoid any re-canonicalization on
      // restore (Grep/Glob keys are not round-trip-stable through parse).
      entries: [...this.entries.entries()].map(([key, entry]) => ({
        key,
        entry,
      })),
      health: [...this.health.entries()].map(([scope, h]) => ({
        scope,
        outcomes: h.outcomes,
        disabledUntil: h.disabledUntil,
      })),
    };
  }

  /** Restore previously-serialized entries + health (config unchanged). */
  loadState(state: SpeculativeCacheState | null | undefined): void {
    if (!state || state.version !== 1) return;
    this.entries.clear();
    this.health.clear();
    for (const { key, entry } of state.entries ?? []) {
      this.entries.set(key, entry);
    }
    for (const h of state.health ?? []) {
      this.health.set(h.scope, {
        outcomes: h.outcomes,
        disabledUntil: h.disabledUntil,
      });
    }
  }

  // ---- internals -------------------------------------------------------

  private key(scope: SubstitutionScope, input: Record<string, unknown>): string {
    return `${scope}::${canonicalizeInput(scope, input)}`;
  }

  private healthFor(scope: SubstitutionScope): ScopeHealth {
    let h = this.health.get(scope);
    if (!h) {
      h = { outcomes: [], disabledUntil: 0 };
      this.health.set(scope, h);
    }
    return h;
  }

  private missRate(h: ScopeHealth): number {
    if (h.outcomes.length === 0) return 0;
    const misses = h.outcomes.filter((o) => !o).length;
    return misses / h.outcomes.length;
  }
}

// ---- freshness-token builders (caller computes the underlying bytes) -----

/** Build a content-SHA token from a file's bytes. */
export function contentToken(content: string): FreshnessToken {
  return { kind: "content-sha", value: sha256Hex(content) };
}

/** Build a directory-stat token from mtime + entry count (WEAK — see hierarchy). */
export function dirStatToken(mtimeMs: number, entryCount: number): FreshnessToken {
  return { kind: "dir-stat", value: `${Math.trunc(mtimeMs)}:${entryCount}` };
}

/**
 * Build a strong file-list token from per-file (path, mtime, size). Catches
 * in-place content edits that a bare directory stat misses. Recommended for
 * Grep/Glob substitution. Entries are sorted so ordering can't change the
 * token.
 */
export function fileListStatToken(
  entries: Array<{ path: string; mtimeMs: number; size: number }>
): FreshnessToken {
  const canonical = entries
    .map((e) => `${e.path}\u0000${Math.trunc(e.mtimeMs)}\u0000${e.size}`)
    .sort()
    .join("");
  return { kind: "filelist-stat", value: sha256Hex(canonical) };
}

/** Build a worktree token from `git ls-files -s` output (or any state hash). */
export function worktreeToken(lsFilesOutput: string): FreshnessToken {
  return { kind: "worktree-sha", value: sha256Hex(lsFilesOutput) };
}

function freshnessEqual(a: FreshnessToken, b: FreshnessToken): boolean {
  return a.kind === b.kind && a.value === b.value;
}

function normPath(p: unknown): string {
  if (typeof p !== "string") return "";
  // Normalize trailing slashes and redundant ./ — conservative, no resolution
  // of symlinks (that would require fs access this pure module must not do).
  return p.replace(/\/+$/, "").replace(/\/\.\//g, "/");
}

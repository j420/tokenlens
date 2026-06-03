/**
 * Verb-token classifier. Tokenizes an MCP tool name on the common
 * separators `_`, `-`, `.`, and `/`, then maps recognized verb tokens
 * to one or more `IntentKind` labels.
 *
 * Hard rule (Phase 7 #1): NO REGEX. We split on a fixed set of
 * separator code points via `String.prototype.indexOf` walks and a
 * single-pass character-code scan. The verb tables are exact-match
 * lookup, not pattern match.
 *
 * Why this layer exists:
 *   The MCP-proxy must not call a model to classify tools, and must not
 *   make the user hand-tag every tool. Verb-based inference is a
 *   conservative middle ground: it handles the 80% of tool names that
 *   carry a clear action verb, and falls back to "all intents" for
 *   ambiguous names (fail-safe-to-INCLUDE).
 *
 * The verb tables below are the single source of truth. They are
 * deliberately conservative — adding a verb is a one-line change and
 * the matching test suite catches regressions.
 */

import type { IntentKind } from "@prune/router";

/**
 * Verb token → intent labels. A token can map to multiple intents (e.g.
 * "delete" is destructive → refactor, but a curious user might also call
 * it under debug). When a tool's name contains MULTIPLE verb tokens,
 * the union of their intents is used.
 */
const VERB_TO_INTENTS: ReadonlyMap<string, readonly IntentKind[]> = new Map([
  // Retrieval verbs.
  ["list", ["retrieve"]],
  ["get", ["retrieve"]],
  ["read", ["retrieve"]],
  ["fetch", ["retrieve"]],
  ["search", ["retrieve"]],
  ["find", ["retrieve"]],
  ["show", ["retrieve"]],
  ["describe", ["retrieve", "explain"]],
  ["query", ["retrieve"]],
  ["browse", ["retrieve"]],
  ["lookup", ["retrieve"]],
  ["enumerate", ["retrieve"]],
  // Generation verbs.
  ["create", ["generate"]],
  ["add", ["generate"]],
  ["insert", ["generate"]],
  ["generate", ["generate"]],
  ["build", ["generate"]],
  ["make", ["generate"]],
  ["scaffold", ["generate"]],
  ["new", ["generate"]],
  ["init", ["generate"]],
  ["spawn", ["generate"]],
  // Refactor / modify verbs.
  ["update", ["refactor"]],
  ["edit", ["refactor"]],
  ["modify", ["refactor"]],
  ["refactor", ["refactor"]],
  ["rename", ["refactor"]],
  ["replace", ["refactor"]],
  ["patch", ["refactor"]],
  ["set", ["refactor"]],
  // Destructive verbs — refactor intent (so the agent can clean up).
  ["delete", ["refactor"]],
  ["remove", ["refactor"]],
  ["drop", ["refactor"]],
  ["clear", ["refactor"]],
  ["purge", ["refactor"]],
  // Debug verbs.
  ["debug", ["debug"]],
  ["diagnose", ["debug"]],
  ["inspect", ["debug", "retrieve"]],
  ["trace", ["debug"]],
  ["log", ["debug", "retrieve"]],
  // Explanation verbs.
  ["explain", ["explain"]],
  ["summarize", ["explain"]],
  ["analyze", ["explain", "debug"]],
  // Test / execution verbs.
  ["run", ["test", "generate"]],
  ["exec", ["test", "generate"]],
  ["execute", ["test", "generate"]],
  ["test", ["test"]],
  ["check", ["test", "debug"]],
  ["validate", ["test", "format"]],
  // Format verbs.
  ["format", ["format"]],
  ["lint", ["format", "debug"]],
  ["normalize", ["format"]],
  ["sanitize", ["format"]],
  // Classifier verbs.
  ["classify", ["classify"]],
  ["match", ["classify", "retrieve"]],
  ["filter", ["classify", "retrieve"]],
]);

const SEPARATOR_CODES = new Set<number>([
  0x5f, // _
  0x2d, // -
  0x2e, // .
  0x2f, // /
  0x3a, // :
]);

const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const LOWER_A = 0x61;
const LOWER_Z = 0x7a;
const DIGIT_0 = 0x30;
const DIGIT_9 = 0x39;

function isAlnumCode(code: number): boolean {
  return (
    (code >= LOWER_A && code <= LOWER_Z) ||
    (code >= UPPER_A && code <= UPPER_Z) ||
    (code >= DIGIT_0 && code <= DIGIT_9)
  );
}

function isUpperCode(code: number): boolean {
  return code >= UPPER_A && code <= UPPER_Z;
}

function toLowerCode(code: number): number {
  return isUpperCode(code) ? code + 0x20 : code;
}

/**
 * Tokenize a tool name into lowercased word tokens. Splits on
 * underscore / hyphen / dot / slash / colon AND on camelCase boundaries
 * (lowercase→uppercase transitions). Single-pass, no regex.
 *
 * Examples:
 *   "list_pull_requests"   → ["list", "pull", "requests"]
 *   "createIssue"          → ["create", "issue"]
 *   "postgres__sql_execute"→ ["postgres", "sql", "execute"]
 *   "linear/create-issue"  → ["linear", "create", "issue"]
 */
export function tokenizeToolName(name: string): readonly string[] {
  if (name.length === 0) return [];
  const out: string[] = [];
  let buf = "";
  // Track the INPUT case of the previous char (before lowercasing into buf).
  // The buf accumulates already-lowercased chars, so we cannot use buf alone
  // to detect a camelCase boundary — we must remember the unmodified case.
  let prevWasLower = false;

  const flush = () => {
    if (buf.length > 0) {
      out.push(buf);
      buf = "";
    }
  };

  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (SEPARATOR_CODES.has(code) || !isAlnumCode(code)) {
      flush();
      prevWasLower = false;
      continue;
    }
    // CamelCase boundary: prior INPUT char was lowercase letter and current
    // is uppercase. Splits "createIssue" → ["create", "issue"] but leaves
    // "XMLParse" as one token (no lower→upper transition mid-buffer).
    if (prevWasLower && isUpperCode(code)) flush();
    buf += String.fromCharCode(toLowerCode(code));
    prevWasLower = code >= LOWER_A && code <= LOWER_Z;
  }
  flush();
  return out;
}

/**
 * Classify a tool name into intent labels using the verb table. Returns
 * the union of intents for every recognized verb token in the name.
 * Returns an empty array when no verb tokens are recognized; the caller
 * must apply the fail-safe-to-include policy.
 */
export function classifyToolNameByVerbs(name: string): {
  intents: readonly IntentKind[];
  verbTokens: readonly string[];
} {
  const tokens = tokenizeToolName(name);
  const intents = new Set<IntentKind>();
  const verbTokens: string[] = [];
  for (const tok of tokens) {
    const mapped = VERB_TO_INTENTS.get(tok);
    if (mapped) {
      verbTokens.push(tok);
      for (const intent of mapped) intents.add(intent);
    }
  }
  return {
    intents: [...intents] as IntentKind[],
    verbTokens,
  };
}

/** Inspect the verb table (read-only) for documentation / debugging. */
export function getVerbTable(): ReadonlyMap<string, readonly IntentKind[]> {
  return VERB_TO_INTENTS;
}

/**
 * Deterministic intent + difficulty classifier.
 *
 * Hard rule (CLAUDE.md): no opaque ML — every decision must be
 * explainable to a skeptical platform engineer. The v0.1 classifier is
 * a transparent rule layer that surfaces the exact signals that fired.
 * Once a local triage model (Qwen3-Coder-Next or DeepSeek-V4-Pro) lands
 * in v0.2, it composes alongside this — the rules still execute and the
 * router can blend confidences. The model never replaces the rule
 * audit trail.
 *
 * Sources informing the classifier shape:
 *   - FrugalGPT cascade (Stanford 2023): cheap-tier first, escalate
 *     on low confidence.
 *   - RouteLLM (arXiv 2406.18665, LMSYS): query-difficulty estimator
 *     → routes between strong and weak models; 2.49–3.66× cost
 *     reduction on MT-Bench.
 *   - Skywork.ai production: 3-tier (nano/mini/standard) for
 *     classification → generation → complex reasoning produced a
 *     measured 66% saving ($3.2k → $1.1k monthly).
 *
 * For coding agents specifically, the dimensions that empirically map
 * to model-tier are:
 *   - intent: what work the user is asking for
 *   - difficulty: how much the model has to reason about
 *   - context_size: how much input the request will carry
 */

export type IntentKind =
  | "classify"
  | "retrieve"
  | "generate"
  | "refactor"
  | "debug"
  | "explain"
  | "test"
  | "format";

export type DifficultyTier = "trivial" | "standard" | "hard";

export interface ClassificationInput {
  /** The user's prompt text. */
  prompt: string;
  /** Estimated input tokens including system + tools + context (count, don't guess). */
  estimatedTokensIn: number;
  /**
   * Optional hint: number of files in the current edit context. Empty/missing
   * → 0. Used as a "context breadth" signal for difficulty escalation.
   */
  filesInContext?: number;
  /**
   * Optional hint: whether the most recent turn had an error (test failure,
   * type error, runtime error). Pushes intent toward "debug".
   */
  recentError?: boolean;
}

export interface ClassificationSignal {
  kind: string;
  weight: number;
  rationale: string;
}

export interface Classification {
  intent: IntentKind;
  difficulty: DifficultyTier;
  /** All signals that contributed to the choice, in priority order. */
  signals: ClassificationSignal[];
}

const INTENT_KEYWORDS: Array<{ intent: IntentKind; tokens: string[] }> = [
  { intent: "debug", tokens: ["debug", "fix the bug", "stack trace", "error message", "exception", "fails with", "broken"] },
  { intent: "test", tokens: ["write a test", "add tests", "test case", "unit test", "integration test"] },
  { intent: "refactor", tokens: ["refactor", "rename", "extract", "inline", "split", "consolidate", "move"] },
  { intent: "generate", tokens: ["create", "implement", "add a", "write a", "build a", "scaffold"] },
  { intent: "explain", tokens: ["explain", "what does", "how does", "walk me through", "summarize"] },
  { intent: "retrieve", tokens: ["find", "locate", "where is", "list all", "show me"] },
  { intent: "format", tokens: ["format", "prettify", "reformat", "indent"] },
  { intent: "classify", tokens: ["which", "is this", "does this", "true or false"] },
];

const TRIVIAL_VERBS = new Set([
  "rename", "format", "prettify", "indent", "spell-check", "lowercase",
  "uppercase", "sort", "remove duplicates",
]);

const HARD_TOKENS = [
  "across the codebase", "throughout the project", "every file",
  "performance bottleneck", "race condition", "concurrency", "deadlock",
  "memory leak", "data corruption", "schema migration",
  "refactor the entire", "rewrite", "redesign",
];

const TRIVIAL_TOKEN_CEILING = 600;
const STANDARD_TOKEN_CEILING = 20_000;
const HARD_FILES_FLOOR = 6;

function lower(s: string): string {
  return s.toLowerCase();
}

export function classifyRequest(input: ClassificationInput): Classification {
  const promptLc = lower(input.prompt);
  const signals: ClassificationSignal[] = [];

  // Intent — first matching keyword wins. recentError forces debug.
  let intent: IntentKind = "generate"; // default
  if (input.recentError) {
    intent = "debug";
    signals.push({
      kind: "intent:recent_error",
      weight: 1,
      rationale: "Recent turn surfaced an error — promote to debug intent.",
    });
  } else {
    for (const { intent: i, tokens } of INTENT_KEYWORDS) {
      const hit = tokens.find((t) => promptLc.includes(t));
      if (hit) {
        intent = i;
        signals.push({
          kind: `intent:${i}`,
          weight: 1,
          rationale: `Prompt contains "${hit}".`,
        });
        break;
      }
    }
    if (signals.length === 0) {
      signals.push({
        kind: "intent:default_generate",
        weight: 0.5,
        rationale: "No intent keyword matched; defaulting to generate.",
      });
    }
  }

  // Difficulty.
  let difficulty: DifficultyTier = "standard";
  const looksTrivial =
    input.estimatedTokensIn <= TRIVIAL_TOKEN_CEILING &&
    Array.from(TRIVIAL_VERBS).some((v) => promptLc.includes(v));
  const filesInContext = input.filesInContext ?? 0;
  const hardSignal = HARD_TOKENS.find((t) => promptLc.includes(t));
  if (looksTrivial) {
    difficulty = "trivial";
    signals.push({
      kind: "difficulty:trivial_verb_and_small_context",
      weight: 1,
      rationale: `Prompt under ${TRIVIAL_TOKEN_CEILING} tokens and matches a trivial-verb pattern.`,
    });
  } else if (
    hardSignal ||
    input.estimatedTokensIn > STANDARD_TOKEN_CEILING ||
    filesInContext >= HARD_FILES_FLOOR ||
    intent === "debug"
  ) {
    difficulty = "hard";
    signals.push({
      kind: "difficulty:hard",
      weight: 1,
      rationale:
        hardSignal
          ? `Prompt contains hard-signal token "${hardSignal}".`
          : intent === "debug"
            ? "Debug intent escalates difficulty."
            : input.estimatedTokensIn > STANDARD_TOKEN_CEILING
              ? `Input ${input.estimatedTokensIn} tokens exceeds ${STANDARD_TOKEN_CEILING}-token standard ceiling.`
              : `${filesInContext} files in context exceeds ${HARD_FILES_FLOOR}-file standard ceiling.`,
    });
  } else {
    signals.push({
      kind: "difficulty:standard_default",
      weight: 0.5,
      rationale: "No hard or trivial signal — defaulting to standard difficulty.",
    });
  }

  return { intent, difficulty, signals };
}

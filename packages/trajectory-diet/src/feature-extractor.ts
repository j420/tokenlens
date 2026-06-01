/**
 * F1 — Trajectory Diet: per-step feature extraction.
 *
 * A "step" is a single tool_use within an agent trajectory. For each step we
 * compute the features the influence model scores. All features are pure
 * functions of the already-collected transcript (NormalizedTurn[]) — no model
 * call, no filesystem, no network.
 *
 * Features (mirroring the plan §F1 Phase 1):
 *   - toolName                    categorical
 *   - inputSimilarityToPrior      max similarity of this input to prior inputs
 *   - targetFileNovelty           1.0 first touch, decays on re-touch
 *   - positionInTrajectory        normalized step index in [0,1]
 *   - priorOutputUtilization      fraction of this step's result reused later
 *   - stepTokenCost               tokens this step's result contributes
 *   - intentClassMatch            alignment with the (optional) session intent
 */

import type { NormalizedTurn } from "@prune/telemetry";

export interface StepFeatures {
  /** Stable index of this step across the whole session. */
  stepIndex: number;
  turnNumber: number;
  toolName: string;
  /** The file/path/command this step targeted, if any. */
  target: string | null;
  inputSimilarityToPrior: number; // [0,1]
  targetFileNovelty: number; // [0,1]
  positionInTrajectory: number; // [0,1]
  priorOutputUtilization: number; // [0,1]
  stepTokenCost: number; // estimated tokens
  intentClassMatch: number; // [0,1]
}

export interface ExtractOptions {
  /**
   * Optional classified session intent (e.g. "debug", "refactor"). When
   * absent, intentClassMatch is neutral (0.5) so the feature contributes no
   * signal rather than a fabricated one.
   */
  intent?: string;
}

interface RawStep {
  stepIndex: number;
  turnNumber: number;
  name: string;
  input: unknown;
  resultText: string;
  /** Assistant text produced AFTER this step, for utilization scoring. */
  downstreamText: string;
}

/**
 * Extract per-step features for an entire session.
 */
export function extractStepFeatures(
  turns: NormalizedTurn[],
  options: ExtractOptions = {}
): StepFeatures[] {
  const steps = flattenSteps(turns);
  const features: StepFeatures[] = [];
  const priorInputTokens: Set<string>[] = [];
  const fileTouchCount = new Map<string, number>();
  const total = steps.length;

  for (const step of steps) {
    const target = extractTarget(step.name, step.input);
    const inputTokens = tokenize(stringifyInput(step.input));

    // input similarity: max Jaccard against any prior step's input tokens.
    let maxSim = 0;
    for (const prior of priorInputTokens) {
      const sim = jaccard(inputTokens, prior);
      if (sim > maxSim) maxSim = sim;
    }

    // file novelty: 1/(1+timesSeenBefore).
    let novelty = 1;
    if (target) {
      const seen = fileTouchCount.get(target) ?? 0;
      novelty = 1 / (1 + seen);
      fileTouchCount.set(target, seen + 1);
    }

    const utilization = computeUtilization(step.resultText, step.downstreamText);
    const stepTokenCost = estimateTokens(step.resultText);
    const position = total > 1 ? step.stepIndex / (total - 1) : 0;
    const intentMatch = options.intent
      ? scoreIntentMatch(options.intent, step.name, target)
      : 0.5;

    features.push({
      stepIndex: step.stepIndex,
      turnNumber: step.turnNumber,
      toolName: step.name,
      target,
      inputSimilarityToPrior: round(maxSim),
      targetFileNovelty: round(novelty),
      positionInTrajectory: round(position),
      priorOutputUtilization: round(utilization),
      stepTokenCost,
      intentClassMatch: round(intentMatch),
    });

    priorInputTokens.push(inputTokens);
  }

  return features;
}

/** Flatten turns into an ordered step list with downstream text attached. */
function flattenSteps(turns: NormalizedTurn[]): RawStep[] {
  const steps: RawStep[] = [];
  // Precompute the assistant text per turn for downstream utilization.
  const turnText = turns.map((t) => t.textContent ?? "");

  let stepIndex = 0;
  for (let ti = 0; ti < turns.length; ti++) {
    const turn = turns[ti];
    const resultById = new Map<string, string>();
    for (const r of turn.toolResults) {
      if (r.tool_use_id) resultById.set(r.tool_use_id, contentToText(r.content));
    }
    // Downstream text = all assistant text strictly after this turn.
    const downstream = turnText.slice(ti + 1).join("\n");

    for (const tu of turn.toolUses) {
      const resultText = tu.id ? (resultById.get(tu.id) ?? "") : "";
      steps.push({
        stepIndex: stepIndex++,
        turnNumber: turn.turnNumber,
        name: tu.name,
        input: tu.input,
        resultText,
        downstreamText: downstream,
      });
    }
  }
  return steps;
}

/**
 * Utilization: fraction of the step's distinctive result tokens that reappear
 * in downstream assistant reasoning. A result the model never referenced again
 * is, by this measure, low-utilization.
 */
function computeUtilization(resultText: string, downstreamText: string): number {
  const resultTokens = tokenize(resultText);
  if (resultTokens.size === 0) return 0;
  const downstream = tokenize(downstreamText);
  if (downstream.size === 0) return 0;
  let hit = 0;
  for (const t of resultTokens) {
    if (downstream.has(t)) hit++;
  }
  return hit / resultTokens.size;
}

function extractTarget(name: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (typeof o.file_path === "string") return o.file_path;
  if (typeof o.path === "string") return o.path;
  if (typeof o.command === "string") return o.command.slice(0, 80);
  if (typeof o.pattern === "string") return `grep:${o.pattern}`;
  return null;
}

function scoreIntentMatch(
  intent: string,
  toolName: string,
  target: string | null
): number {
  const i = intent.toLowerCase();
  const t = toolName.toLowerCase();
  // Transparent, documented heuristic. Editing tools align with edit/refactor
  // intents; read/search tools align with debug/explain; tests align with test.
  const editing = t.includes("edit") || t.includes("write");
  const searching = t.includes("grep") || t.includes("glob") || t.includes("read");
  const testish = (target ?? "").toLowerCase().includes("test");
  if ((i.includes("refactor") || i.includes("edit") || i.includes("generate")) && editing) {
    return 1;
  }
  if ((i.includes("debug") || i.includes("explain") || i.includes("review")) && searching) {
    return 0.8;
  }
  if (i.includes("test") && testish) return 1;
  return 0.4;
}

// ---- text utilities ------------------------------------------------------

function stringifyInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c
          ? String((c as { text: unknown }).text)
          : typeof c === "string"
            ? c
            : ""
      )
      .join("\n");
  }
  if (content && typeof content === "object") {
    try {
      return JSON.stringify(content);
    } catch {
      return "";
    }
  }
  return content == null ? "" : String(content);
}

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const re = /[A-Za-z0-9_$]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length >= 3) out.add(m[0].toLowerCase());
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function estimateTokens(text: string): number {
  // chars/4 heuristic — consistent with the cost displays elsewhere.
  return Math.ceil(text.length / 4);
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

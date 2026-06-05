/**
 * Drives the REAL extension core modules headlessly. These live in
 * apps/extension/src and are pure (no runtime `vscode` use — token-saver's
 * `vscode` import is unused and elided/aliased). Loaded only by vitest/tsx
 * (on-the-fly transpile), exactly as the shipped run-comprehensive-tests.ts
 * harness already loads them — never by the tsc build (it's excluded there).
 */

import { countTokens } from "@prune/tokenizer";
import { squeeze } from "@prune/squeezer";
import type { SqueezeTier } from "@prune/shared";

// Namespace imports + a `.default` fallback: under vitest these modules load as
// proper ESM (named members present); under tsx (the demo) the extension's .ts
// are treated as CJS — Node's cjs-module-lexer can miss class exports and expose
// only `default` (= module.exports). `pick` resolves a member from either shape,
// so the SAME driver works under both runners.
import * as tokenSaver from "../../../../apps/extension/src/token-saver";
import * as hudCompute from "../../../../apps/extension/src/hud-compute";
import * as contextAnalyzer from "../../../../apps/extension/src/context-analyzer";
import * as pruneIntel from "../../../../apps/extension/src/prune-intelligence";
import type { HudThresholds } from "../../../../apps/extension/src/hud-compute";

/* eslint-disable @typescript-eslint/no-explicit-any */
function pick<T = any>(ns: any, name: string): T {
  const v = ns?.[name] ?? ns?.default?.[name];
  if (v == null) throw new Error(`extension module missing export: ${name}`);
  return v as T;
}

const generateSmartCopy = pick<(files: FileInput[]) => any>(tokenSaver, "generateSmartCopy");
const analyzePreFlight = pick(tokenSaver, "analyzePreFlight");
const recordFileRead = pick(tokenSaver, "recordFileRead");
const getSessionStats = pick(tokenSaver, "getSessionStats");
const resetSessionMemory = pick(tokenSaver, "resetSessionMemory");
const incrementTurn = pick(tokenSaver, "incrementTurn");
const trackDecision = pick(tokenSaver, "trackDecision");
const getDecisionsAtRisk = pick(tokenSaver, "getDecisionsAtRisk");
const generateCompactionReminder = pick(tokenSaver, "generateCompactionReminder");
const computeHud = pick(hudCompute, "computeHud");
const analyzeContext = pick(contextAnalyzer, "analyzeContext");
const IntentClassifier = pick<any>(pruneIntel, "IntentClassifier");

export interface FileInput {
  path: string;
  content: string;
}

export const extension = {
  smartCopy(files: FileInput[]) {
    return generateSmartCopy(files);
  },

  preflight(prompt: string, files: FileInput[], activeFilePath?: string) {
    const withTokens = files.map((f) => ({
      path: f.path,
      content: f.content,
      tokens: countTokens(f.content).tokens,
    }));
    return analyzePreFlight(prompt, withTokens, 3, activeFilePath);
  },

  /** Session-memory dedup: read the same file twice; second read is a hit. */
  sessionMemoryDedup(file: FileInput) {
    resetSessionMemory();
    incrementTurn();
    const first = recordFileRead(file.path, file.content);
    for (let i = 0; i < 4; i++) incrementTurn();
    const second = recordFileRead(file.path, file.content);
    return { first, second, stats: getSessionStats() };
  },

  compaction(decisions: Array<{ text: string; category: string; priority: string }>) {
    for (const d of decisions) {
      // trackDecision(decision, category, priority)
      trackDecision(d.text, d.category as never, d.priority as never);
    }
    // Age the decisions past the at-risk threshold (turnNumber < currentTurn - 2)
    // so getDecisionsAtRisk surfaces them and the reminder lists them — exactly
    // what happens after several turns elapse before a compaction.
    for (let i = 0; i < 4; i++) incrementTurn();
    return {
      atRisk: getDecisionsAtRisk(),
      reminder: generateCompactionReminder(),
    };
  },

  hud(prompt: string, model: string, thresholds: HudThresholds = { greenUsd: 0.05, redUsd: 0.25 }) {
    return computeHud(prompt, model, thresholds);
  },

  context(activeFile: FileInput, prompt: string, workspaceFiles: FileInput[]) {
    return analyzeContext({
      activeFilePath: activeFile.path,
      activeFileContent: activeFile.content,
      prompt,
      workspaceFiles,
    });
  },

  intent(prompt: string) {
    return new IntentClassifier().classify(prompt);
  },

  squeeze(code: string, tier: SqueezeTier) {
    return squeeze(code, "typescript", { tier });
  },
};

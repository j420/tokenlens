/**
 * F5 — Spend-as-You-Type HUD: pure compute path (no VS Code dependency).
 *
 * Everything in this module is deterministic and side-effect-free so the
 * CI regression suite (plan §F5 verification) can exercise it without an
 * editor host. The VS Code integration lives in ./hud.ts.
 */

import {
  formatCost,
  formatTokens,
  getModelPricingByName,
} from "@prune/shared";
import { countTokens } from "@prune/tokenizer";

export interface HudThresholds {
  greenUsd: number;
  redUsd: number;
}

export interface HudComputation {
  tokens: number;
  cost: number;
  source: "exact" | "estimated";
  severity: "green" | "yellow" | "red";
  displayText: string;
  tooltipText: string;
}

/**
 * Given a prompt and a model, decide what the HUD should display.
 *
 * Quality invariant: this function reads its inputs, computes a display,
 * and returns. It never mutates the prompt and never invokes any model.
 */
export function computeHud(
  prompt: string,
  model: string,
  thresholds: HudThresholds
): HudComputation {
  const text = prompt ?? "";
  if (text.length === 0) {
    return {
      tokens: 0,
      cost: 0,
      source: "exact",
      severity: "green",
      displayText: "",
      tooltipText: "Prune HUD: type to see projected cost.",
    };
  }
  const counted = countTokens(text, model);
  const pricing = getModelPricingByName(model);
  const inputCost = (counted.tokens / 1_000_000) * pricing.input;
  const severity = classifySeverity(inputCost, thresholds);
  const sourceMark = counted.source === "estimated" ? "~" : "";
  const displayText = `$(symbol-misc) ${sourceMark}${formatTokens(counted.tokens)} · ${formatCost(inputCost)}`;
  const tooltipText = [
    "Prune HUD (F5)",
    `Model: ${model}`,
    `Tokens (input): ${formatTokens(counted.tokens)} (${counted.source})`,
    `Projected input cost: ${formatCost(inputCost)}`,
    `Pricing source: $${pricing.input.toFixed(2)} / 1M input tokens`,
    "",
    "Display-only — never modifies the prompt or routes the request.",
  ].join("\n");
  return {
    tokens: counted.tokens,
    cost: inputCost,
    source: counted.source,
    severity,
    displayText,
    tooltipText,
  };
}

export function classifySeverity(
  cost: number,
  thresholds: HudThresholds
): HudComputation["severity"] {
  if (cost >= thresholds.redUsd) return "red";
  if (cost >= thresholds.greenUsd) return "yellow";
  return "green";
}

/**
 * Pure heuristic for whether a document URI scheme + language id signals a
 * chat-input surface. Kept in sync with the editor-host watchers in
 * ./hud-watchers/. False positives cost us status-bar noise; false
 * negatives cost us a missed display. We err on the side of false negatives.
 */
export function isChatInputSurface(
  uriScheme: string,
  languageId: string
): boolean {
  if (uriScheme === "vscode-chat-input") return true;
  if (uriScheme === "cursor-chat") return true;
  if (uriScheme === "claude-code-chat") return true;
  if (languageId.startsWith("chat")) return true;
  return false;
}

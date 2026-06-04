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

// ===========================================================================
// F5 telemetry — the discrete signal of an always-on display.
//
// The HUD updates on every keystroke; recording per render would be spam (it
// violates the "only on a meaningful signal" discipline) and writing to the
// events sink on the UI render path would violate this codebase's architecture
// (every telemetry writer is a hook / MCP tool, never the editor render loop).
//
// DECISION (pending action 1.3): f5 emits ONLY on a spend-SEVERITY TRANSITION
// (green→yellow→red and back) — a genuine, infrequent cost-escalation event,
// not a per-render heartbeat. The detector and proof builder below are the pure,
// tested contract; the HUD invokes an injected callback on a transition so the
// actual sink write (if wanted) rides an injected recorder rather than the
// render hot path. The dashboard already rolls f5 up generically.
// ===========================================================================

export const F5_FEATURE_ID = "f5" as const;

export type HudSeverity = HudComputation["severity"];

export interface SeverityTransition {
  from: HudSeverity;
  to: HudSeverity;
  /** True when spend moved to a HIGHER zone (green<yellow<red). */
  escalated: boolean;
}

const SEVERITY_RANK: Record<HudSeverity, number> = { green: 0, yellow: 1, red: 2 };

/**
 * Detect a spend-zone transition. Returns null when there is no prior severity
 * (first render — not a transition) or the zone is unchanged. Pure.
 */
export function detectSeverityTransition(
  prev: HudSeverity | null,
  next: HudSeverity
): SeverityTransition | null {
  if (prev === null || prev === next) return null;
  return { from: prev, to: next, escalated: SEVERITY_RANK[next] > SEVERITY_RANK[prev] };
}

/**
 * Build the PII-safe f5 quality_proof for a transition. Carries only the
 * severities, the triggering cost/token figures, and the active thresholds —
 * never the prompt text. Shape mirrors the other features' proofs so the
 * dashboard's generic f5 rollup (and any future rich decoder) can read it.
 */
export function buildHudQualityProof(
  transition: SeverityTransition,
  computation: Pick<HudComputation, "tokens" | "cost" | "source">,
  thresholds: HudThresholds
): Record<string, unknown> {
  return {
    featureId: F5_FEATURE_ID,
    event: "severity_transition",
    from: transition.from,
    to: transition.to,
    escalated: transition.escalated,
    tokens: computation.tokens,
    costUsd: computation.cost,
    costSource: computation.source,
    thresholds: { greenUsd: thresholds.greenUsd, redUsd: thresholds.redUsd },
  };
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

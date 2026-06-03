/**
 * Advisory text generation for F6.
 *
 * Pure function: (state, observation) → ContextHealthAdvisory | null.
 *
 * Determinism rules:
 *   - Same inputs ⇒ byte-identical output. No timestamps, no random
 *     IDs, no Math.random.
 *   - Never includes user content. Only structural data (turn numbers,
 *     ECF percentage rounded to one decimal, tool name, suggested
 *     action). The structural-only rule is enforced by the
 *     `edge-cases.test.ts` PII fuzz.
 *
 * Emission rules:
 *   - regime === "healthy" | "insufficient_data" ⇒ null.
 *   - regime === "warning" ⇒ advisory.suggestedAction defaults to
 *     "trim_context"; if scopeDrift is strong, escalates to "compact".
 *   - regime === "critical" ⇒ advisory.suggestedAction is "compact"
 *     unless the primary cause is `large_tool_result`, in which case
 *     "trim_context" (don't compact away the latest evidence).
 *
 * The hook respects the feature-flag gate (it never invokes the advisor
 * in `shadow` mode), but the advisor itself is gate-agnostic so callers
 * can use it in tests, the MCP report, and any future surface uniformly.
 */

import type {
  ContextHealthAdvisory,
  DetectorObservation,
  PrimaryCause,
  Regime,
  SecondarySignals,
} from "./types.js";

/**
 * Threshold used by the advisor to decide if `scopeDriftSlope` counts
 * as a "scope drift" cause. A slope of 1.0 means the agent gained one
 * new distinct file per turn on average across the rolling window —
 * a strong signal of widening focus.
 */
export const SCOPE_DRIFT_THRESHOLD = 0.75;

/**
 * Threshold for cacheHitTrend negativity to count as "volatile prefix".
 * A slope of -0.1 means hit rate fell by 10 percentage points per turn
 * across the window — strong enough to register as the primary cause.
 */
export const VOLATILE_PREFIX_THRESHOLD = -0.1;

/**
 * Build the advisory from a single observation. Returns null when
 * regime is healthy / insufficient_data.
 */
export function buildAdvisory(
  observation: DetectorObservation
): ContextHealthAdvisory | null {
  const regime = observation.cusum.regime;
  if (regime !== "warning" && regime !== "critical") return null;

  const primaryCause = inferPrimaryCause(observation);
  const action = chooseAction(regime, primaryCause);
  const ecfPct = formatPct(observation.ecfSample.ecf);
  const turn = observation.turnNumber;

  // The text MUST be entirely structural — no user content, no tool
  // input values beyond the tool name itself (an enum-shaped field).
  const text = renderText(regime, primaryCause, ecfPct, turn, observation.signals, action);

  return {
    regime,
    text,
    primaryCause,
    suggestedAction: action,
  };
}

/**
 * Determine the primary inflection cause from CUSUM regime + signals.
 *
 * Priority order (matches the report rendering in mcp-server):
 *   1. large_tool_result    (a single tool result dominated)
 *   2. volatile_prefix      (cache-hit trend is sharply negative)
 *   3. scope_drift          (paths-per-turn slope is sharply positive)
 *   4. rising_ecf           (default — pure cumulative growth)
 */
export function inferPrimaryCause(
  observation: DetectorObservation
): PrimaryCause {
  const { signals } = observation;
  if (signals.largeToolResultCause !== null) return "large_tool_result";
  if (signals.cacheHitTrend < VOLATILE_PREFIX_THRESHOLD) return "volatile_prefix";
  if (signals.scopeDriftSlope > SCOPE_DRIFT_THRESHOLD) return "scope_drift";
  return "rising_ecf";
}

function chooseAction(
  regime: Extract<Regime, "warning" | "critical">,
  cause: PrimaryCause
): ContextHealthAdvisory["suggestedAction"] {
  if (regime === "critical") {
    return cause === "large_tool_result" ? "trim_context" : "compact";
  }
  // warning
  if (cause === "scope_drift") return "compact";
  return "trim_context";
}

function renderText(
  regime: Extract<Regime, "warning" | "critical">,
  cause: PrimaryCause,
  ecfPct: string,
  turn: number,
  signals: SecondarySignals,
  action: ContextHealthAdvisory["suggestedAction"]
): string {
  const tier =
    regime === "critical"
      ? "🛑 Context health: CRITICAL"
      : "⚠️  Context health: WARNING";
  const causeLine = formatCauseLine(cause, signals);
  const actionLine = formatActionLine(action);
  const evidence =
    "Evidence: Chroma research (2026) shows every model degrades past ~50% effective context fullness; ~75% is the coherence cliff.";
  return [
    tier,
    `Turn ${turn} — effective context fullness ${ecfPct}.`,
    causeLine,
    actionLine,
    evidence,
  ].join(" ");
}

function formatCauseLine(cause: PrimaryCause, signals: SecondarySignals): string {
  switch (cause) {
    case "large_tool_result": {
      const c = signals.largeToolResultCause;
      // c is guaranteed non-null by inferPrimaryCause; defensive fallback.
      if (!c) return "Cause: large tool result dominated this turn.";
      // Tool name is enum-shaped (e.g. "Read", "Bash"). No PII risk.
      const safeName = sanitizeToolName(c.toolName);
      return `Cause: a single ${safeName} result (~${formatTokensCompact(c.toolResultTokenEstimate)} tokens) dominated this turn.`;
    }
    case "volatile_prefix":
      return "Cause: cache hit rate is falling — your prefix is being busted turn-over-turn.";
    case "scope_drift":
      return "Cause: distinct files touched per turn is climbing — the agent's scope is widening.";
    case "rising_ecf":
    default:
      return "Cause: cumulative context budget has crossed the inflection threshold.";
  }
}

function formatActionLine(
  action: ContextHealthAdvisory["suggestedAction"]
): string {
  switch (action) {
    case "compact":
      return "Suggested: run `/compact` to summarize history, or end and start a fresh session.";
    case "fresh_session":
      return "Suggested: end this session and start fresh. /compact will lose decisions; a clean slate is better here.";
    case "trim_context":
      return "Suggested: trim large attachments or recent file reads from the next prompt before continuing.";
  }
}

/**
 * Defensive tool-name sanitizer. Strips anything that isn't a printable
 * ASCII letter or digit — keeps the output PII-clean even if a
 * malformed tool name leaks through. No regex (per Phase 7 hard rule):
 * we iterate char codes.
 */
function sanitizeToolName(name: string): string {
  if (typeof name !== "string" || name.length === 0) return "tool";
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    const isUnderscore = code === 95;
    if (isUpper || isLower || isDigit || isUnderscore) out += name[i];
    if (out.length >= 32) break;
  }
  return out.length > 0 ? out : "tool";
}

function formatPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return "n/a";
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return `${pct.toFixed(1)}%`;
}

function formatTokensCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.trunc(n).toString();
}

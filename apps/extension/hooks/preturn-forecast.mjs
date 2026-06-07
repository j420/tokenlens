#!/usr/bin/env node
/**
 * Pre-Turn Forecast — UserPromptSubmit hook  (Cost-Security / value-per-token).
 *
 * The costliest event is a fully-paid turn that yields nothing usable. This
 * hook scores that risk BEFORE the turn is spent, from deterministic signals
 * available at prompt time — prompt specificity, vague-retry phrasing, and a
 * context-fullness proxy — and, only when the risk is HIGH, advises a cheap
 * reframe instead of burning a whole turn.
 *
 * The score is a TRANSPARENT HEURISTIC INDEX (forecastTurnRisk), never a
 * fabricated probability; every point is attributed to a named factor. Advisory
 * only; surfaces solely on band "high" to avoid nagging. Fail-open.
 *
 * Config: PRUNE_PRETURN_DISABLED "1" → no-op.
 */

import { forecastTurnRisk } from "@prune/cost-security";
import { getContextWindow } from "@prune/shared";
import { loadCachedSessionView } from "@prune/telemetry";

import { emitAdditionalContext, emitNoop, readHookPayload, safeRun } from "./_runtime.mjs";
import { deriveSessionId, recordFeatureEventBestEffort, stableId } from "./_telemetry.mjs";

const CODE_EXTS = [
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php",
  ".json", ".md", ".css", ".html", ".c", ".cpp", ".h", ".sql", ".sh", ".yml", ".yaml",
];

const VAGUE_PHRASES = [
  "fix it", "still broken", "doesn't work", "does not work", "not working",
  "same error", "try again", "still failing", "didn't work", "did not work",
  "still not", "doesnt work", "broken again",
];

function hasPathLike(s) {
  for (const tok of s.split(/\s+/)) {
    if (tok.includes("/") && tok.includes(".")) return true;
    const lower = tok.toLowerCase();
    for (const ext of CODE_EXTS) if (lower.endsWith(ext) && tok.length > ext.length) return true;
  }
  return false;
}

function hasCodeIdentifier(s) {
  for (const tok of s.split(/\s+/)) {
    // call form: name(
    const paren = tok.indexOf("(");
    if (paren > 1) return true;
    // snake_case: alnum _ alnum
    for (let i = 1; i < tok.length - 1; i++) {
      if (tok[i] === "_" && isAlnum(tok[i - 1]) && isAlnum(tok[i + 1])) return true;
    }
    // camelCase: lower immediately followed by upper
    for (let i = 0; i < tok.length - 1; i++) {
      if (isLower(tok[i]) && isUpper(tok[i + 1])) return true;
    }
  }
  return false;
}

function isAlnum(c) {
  return c !== undefined && /[a-z0-9]/i.test(c);
}
function isLower(c) {
  return c !== undefined && c >= "a" && c <= "z";
}
function isUpper(c) {
  return c !== undefined && c >= "A" && c <= "Z";
}

function namesConcreteTarget(prompt) {
  return prompt.includes("`") || hasPathLike(prompt) || hasCodeIdentifier(prompt);
}

function isVagueDemand(prompt) {
  const lower = prompt.toLowerCase();
  return VAGUE_PHRASES.some((p) => lower.includes(p));
}

/** Effective context-fullness proxy: last turn's context tokens / window. */
function contextFullnessPct(turns) {
  if (!Array.isArray(turns) || turns.length === 0) return null;
  const last = turns[turns.length - 1];
  const model = last?.model;
  if (typeof model !== "string") return null;
  const window = getContextWindow(model);
  if (!window || window <= 0) return null;
  const u = last.usage ?? {};
  const ctx = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheCreate ?? 0) + (u.output ?? 0);
  if (!Number.isFinite(ctx) || ctx <= 0) return null;
  return Math.min(100, (ctx / window) * 100);
}

safeRun(async () => {
  if (process.env.PRUNE_PRETURN_DISABLED === "1") return emitNoop();

  const start = Date.now();
  const payload = await readHookPayload();
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (!prompt) return emitNoop();

  let turns = [];
  if (payload.transcript_path) {
    try {
      ({ turns } = await loadCachedSessionView(payload.transcript_path));
    } catch {
      turns = [];
    }
  }

  const report = forecastTurnRisk({
    promptChars: prompt.length,
    namesConcreteTarget: namesConcreteTarget(prompt),
    vagueDemand: isVagueDemand(prompt),
    priorLowRoiStreak: 0, // session-walk ROI streak not wired here; prompt signal carries retries
    contextFullnessPct: contextFullnessPct(turns),
    unresolvedErrorRepeats: 0,
  });

  await recordFeatureEventBestEffort({
    featureId: "preturn-forecast",
    qualityProof: {
      schemaVersion: 1,
      featureId: "preturn-forecast",
      band: report.band,
      risk: report.risk,
      factors: report.factors.map((f) => f.name),
    },
    sessionId: deriveSessionId(payload),
    eventId: `preturn-${stableId(payload.transcript_path ?? "", String(prompt.length), report.band)}`,
    latencyMs: Date.now() - start,
  });

  // Surface only on HIGH risk — keep the false-positive / nag rate low.
  if (report.band !== "high" || !report.recommend) return emitNoop();

  const why = report.factors
    .slice(0, 3)
    .map((f) => f.detail)
    .join("; ");

  return emitAdditionalContext(
    `🎯 Cost-guard (pre-turn): this request looks likely to need a retry (${why}). ` +
      `${report.recommend} A few hundred tokens of specificity now usually saves a whole wasted turn.`,
    payload.hook_event_name ?? "UserPromptSubmit",
    { band: report.band, risk: report.risk, factors: report.factors.map((f) => f.name) }
  );
});

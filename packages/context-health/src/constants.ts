/**
 * Default constants for @prune/context-health (F6).
 *
 * Every value here is pinned to either (a) Chroma's June 2026 context-rot
 * research, (b) the CUSUM tuning corpus in `test/fixtures/`, or (c) a
 * conservative defensive default. Changing any of these requires
 * re-pinning the golden fixtures and re-running the NI gate.
 */

import type { ContextHealthConfig } from "./types.js";

/**
 * Cache-fidelity factor α. The fraction of a cached-prefix token's
 * attention budget that counts toward context fullness. Chroma's
 * cache-fidelity measurement on long prefixes ⇒ ≈0.5. Configurable via
 * env `PRUNE_CONTEXT_HEALTH_ALPHA` so studies can vary it without a
 * recompile.
 */
export const DEFAULT_ALPHA = 0.5;

/** Warning-zone ECF (Chroma retrieval-precision inflection). */
export const DEFAULT_K_WARN = 0.5;

/** Critical-zone ECF (Chroma coherence inflection). */
export const DEFAULT_K_CRIT = 0.75;

/** CUSUM cumulative-excess trigger for the warning detector. */
export const DEFAULT_H_WARN = 0.05;

/** CUSUM cumulative-excess trigger for the critical detector. */
export const DEFAULT_H_CRIT = 0.1;

/** Rolling-window length for cache-hit trend & scope-drift slope. */
export const DEFAULT_ROLLING_WINDOW = 5;

/** Threshold for "this one tool result dominated the turn". */
export const DEFAULT_LARGE_TOOL_RESULT_FRACTION = 0.15;

export const DEFAULT_CONFIG: ContextHealthConfig = {
  alpha: DEFAULT_ALPHA,
  kWarn: DEFAULT_K_WARN,
  kCrit: DEFAULT_K_CRIT,
  hWarn: DEFAULT_H_WARN,
  hCrit: DEFAULT_H_CRIT,
  rollingWindow: DEFAULT_ROLLING_WINDOW,
  largeToolResultFraction: DEFAULT_LARGE_TOOL_RESULT_FRACTION,
};

/**
 * Resolve config from defaults + environment overrides. Pure — never
 * reads process.env directly in hot paths; takes the env snapshot as
 * an argument so tests can inject.
 */
export function resolveConfig(
  env: Record<string, string | undefined> = {},
  overrides: Partial<ContextHealthConfig> = {}
): ContextHealthConfig {
  const fromEnv = parseEnvFloat(env.PRUNE_CONTEXT_HEALTH_ALPHA);
  const alpha =
    overrides.alpha !== undefined
      ? overrides.alpha
      : fromEnv !== null
        ? fromEnv
        : DEFAULT_ALPHA;
  const cfg: ContextHealthConfig = {
    alpha,
    kWarn: overrides.kWarn ?? DEFAULT_K_WARN,
    kCrit: overrides.kCrit ?? DEFAULT_K_CRIT,
    hWarn: overrides.hWarn ?? DEFAULT_H_WARN,
    hCrit: overrides.hCrit ?? DEFAULT_H_CRIT,
    rollingWindow: overrides.rollingWindow ?? DEFAULT_ROLLING_WINDOW,
    largeToolResultFraction:
      overrides.largeToolResultFraction ?? DEFAULT_LARGE_TOOL_RESULT_FRACTION,
  };
  return clampConfig(cfg);
}

function parseEnvFloat(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Reject any non-numeric content structurally — no regex.
  // Number() returns NaN for empty/non-numeric strings; finite check
  // catches Infinity.
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Defensive clamp. If a config arrives with nonsensical values (NaN,
 * negative thresholds, alpha outside [0, 1]) we substitute the default
 * silently. This is the only place defaults are substituted — the rest
 * of the package trusts ContextHealthConfig as well-formed.
 */
function clampConfig(c: ContextHealthConfig): ContextHealthConfig {
  return {
    alpha: clamp01OrDefault(c.alpha, DEFAULT_ALPHA),
    kWarn: clamp01OrDefault(c.kWarn, DEFAULT_K_WARN),
    kCrit: clamp01OrDefault(c.kCrit, DEFAULT_K_CRIT),
    hWarn: positiveOrDefault(c.hWarn, DEFAULT_H_WARN),
    hCrit: positiveOrDefault(c.hCrit, DEFAULT_H_CRIT),
    rollingWindow: positiveIntOrDefault(c.rollingWindow, DEFAULT_ROLLING_WINDOW),
    largeToolResultFraction: clamp01OrDefault(
      c.largeToolResultFraction,
      DEFAULT_LARGE_TOOL_RESULT_FRACTION
    ),
  };
}

function clamp01OrDefault(v: number, d: number): number {
  if (!Number.isFinite(v) || v < 0 || v > 1) return d;
  return v;
}

function positiveOrDefault(v: number, d: number): number {
  if (!Number.isFinite(v) || v <= 0) return d;
  return v;
}

function positiveIntOrDefault(v: number, d: number): number {
  if (!Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) return d;
  return v;
}

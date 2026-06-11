/**
 * TCRP (Token-Cost Reduction Program) feature flags.
 *
 * Shared schema for the TCRP features. Every feature entry-point must read its
 * flag as its first non-import statement (enforced by lint).
 *
 * The flag file lives at ~/.prune/feature-flags.json. The reader and watcher
 * are Node-only and live with their consumer (extension/MCP). This module
 * only contains the schema, pure helpers, and defaults.
 *
 * f1–f13 are the original program. f14–f19 are the ROUND-16 "exponential set":
 * deterministic actuators (reward-integrity, observation-mask, read-gate,
 * program-slice, wastebench) coordinated by the clearing-price controller.
 * Cross-session reuse (#6) reuses f12 (skillLibrary) rather than adding an id.
 */

export type TcrpFeatureId =
  | "f1"
  | "f2"
  | "f3"
  | "f4"
  | "f5"
  | "f6"
  | "f7"
  | "f8"
  | "f9"
  | "f10"
  | "f11"
  | "f12"
  | "f13"
  | "f14"
  | "f15"
  | "f16"
  | "f17"
  | "f18"
  | "f19"
  | "f20";

export type TcrpFeatureMode =
  | "shadow" // runs in parallel, never affects user
  | "canary" // active for opt-in subset
  | "general" // active by default
  | "disabled"; // off, regardless of mode-default

export type TcrpPolicySource =
  | "default"
  | "local"
  | "team-postgres"
  | "auto-rollback";

export interface TcrpFeatureState {
  enabled: boolean;
  mode: TcrpFeatureMode;
  reason?: string;
  disabledAt?: string;
}

export interface TcrpFeatureFlags {
  version: 1;
  features: Record<TcrpFeatureId, TcrpFeatureState>;
  policySource: TcrpPolicySource;
}

export const TCRP_FEATURE_IDS: readonly TcrpFeatureId[] = [
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
  "f13",
  "f14",
  "f15",
  "f16",
  "f17",
  "f18",
  "f19",
  "f20",
] as const;

export const TCRP_FEATURE_NAMES: Record<TcrpFeatureId, string> = {
  f1: "trajectoryDiet",
  f2: "toolDefAuditor",
  f3: "speculativeCache",
  f4: "qpdBench",
  f5: "hud",
  f6: "contextHealth",
  // Phase 7 features (built; flags wired here for completeness).
  f7: "semanticCache",
  f8: "codeModeMcp",
  // Phase 9.7 Tier-1.5 / Tier-A features.
  f9: "cacheHabits",
  f10: "mcpProxy",
  f11: "replayCost",
  f12: "skillLibrary",
  f13: "speculativePipeline",
  // ROUND-16 exponential set. f18 (clearingPrice) is the coordinator the
  // actuators bid against; the rest are deterministic actuators / measurement.
  f14: "rewardIntegrity",
  f15: "observationMask",
  f16: "readGate",
  f17: "programSlice",
  f18: "clearingPrice",
  f19: "wasteBench",
  // f20: evidence-gated, repo-local proof + flag promotion (prune-proof CLI).
  f20: "repoProof",
} as const;

export const TCRP_FEATURE_BY_NAME: Record<string, TcrpFeatureId> = Object.entries(
  TCRP_FEATURE_NAMES
).reduce(
  (acc, [id, name]) => {
    acc[name] = id as TcrpFeatureId;
    return acc;
  },
  {} as Record<string, TcrpFeatureId>
);

/**
 * Ship-time default flag state. F5 (HUD) ships first per the Gantt, so it's
 * "general" by default. Others start "shadow" — code paths are loaded but
 * the user sees nothing until they're promoted.
 */
export const DEFAULT_TCRP_FLAGS: TcrpFeatureFlags = {
  version: 1,
  features: {
    f1: { enabled: false, mode: "shadow" },
    f2: { enabled: false, mode: "shadow" },
    f3: { enabled: false, mode: "shadow" },
    f4: { enabled: false, mode: "shadow" },
    f5: { enabled: true, mode: "general" },
    f6: { enabled: false, mode: "shadow" },
    f7: { enabled: false, mode: "shadow" },
    f8: { enabled: false, mode: "shadow" },
    f9: { enabled: false, mode: "shadow" },
    f10: { enabled: false, mode: "shadow" },
    f11: { enabled: false, mode: "shadow" },
    f12: { enabled: false, mode: "shadow" },
    f13: { enabled: false, mode: "shadow" },
    f14: { enabled: false, mode: "shadow" },
    f15: { enabled: false, mode: "shadow" },
    f16: { enabled: false, mode: "shadow" },
    f17: { enabled: false, mode: "shadow" },
    f18: { enabled: false, mode: "shadow" },
    f19: { enabled: false, mode: "shadow" },
    f20: { enabled: false, mode: "shadow" },
  },
  policySource: "default",
};

/** Resolve a feature identifier from either an id ("f5") or name ("hud"). */
export function resolveFeatureId(
  idOrName: string
): TcrpFeatureId | undefined {
  if ((TCRP_FEATURE_IDS as readonly string[]).includes(idOrName)) {
    return idOrName as TcrpFeatureId;
  }
  return TCRP_FEATURE_BY_NAME[idOrName];
}

/**
 * Pure predicate: is this feature live (visible to the user) right now?
 *
 * Returns true only when `enabled === true` AND `mode === "general" | "canary"`.
 * Shadow mode never returns true here — shadow telemetry collection happens
 * via a separate API (`isFeatureInShadow`) so the two paths don't interleave.
 */
export function isFeatureEnabled(
  flags: TcrpFeatureFlags,
  id: TcrpFeatureId
): boolean {
  const state = flags.features[id];
  if (!state || !state.enabled) return false;
  return state.mode === "general" || state.mode === "canary";
}

/** Pure predicate: should this feature collect shadow-mode telemetry? */
export function isFeatureInShadow(
  flags: TcrpFeatureFlags,
  id: TcrpFeatureId
): boolean {
  return flags.features[id]?.mode === "shadow";
}

/** Validate a parsed flag blob, returning the defaults if shape is wrong. */
export function validateFlags(input: unknown): TcrpFeatureFlags {
  if (!input || typeof input !== "object") return DEFAULT_TCRP_FLAGS;
  const candidate = input as Partial<TcrpFeatureFlags>;
  if (candidate.version !== 1) return DEFAULT_TCRP_FLAGS;
  if (!candidate.features || typeof candidate.features !== "object") {
    return DEFAULT_TCRP_FLAGS;
  }
  const features: Record<TcrpFeatureId, TcrpFeatureState> = {
    ...DEFAULT_TCRP_FLAGS.features,
  };
  for (const id of TCRP_FEATURE_IDS) {
    const incoming = (candidate.features as Record<string, unknown>)[id];
    if (incoming && typeof incoming === "object") {
      const s = incoming as Partial<TcrpFeatureState>;
      features[id] = {
        enabled: typeof s.enabled === "boolean" ? s.enabled : features[id].enabled,
        mode:
          s.mode === "shadow" ||
          s.mode === "canary" ||
          s.mode === "general" ||
          s.mode === "disabled"
            ? s.mode
            : features[id].mode,
        reason: typeof s.reason === "string" ? s.reason : undefined,
        disabledAt: typeof s.disabledAt === "string" ? s.disabledAt : undefined,
      };
    }
  }
  const policySource: TcrpPolicySource =
    candidate.policySource === "local" ||
    candidate.policySource === "team-postgres" ||
    candidate.policySource === "auto-rollback" ||
    candidate.policySource === "default"
      ? candidate.policySource
      : "default";
  return { version: 1, features, policySource };
}

/**
 * Produce a new flag blob with one feature mutated. Pure — does not write to
 * disk. The caller persists the result via the Node-side writer.
 */
export function withFeatureMutation(
  flags: TcrpFeatureFlags,
  id: TcrpFeatureId,
  mutation: Partial<TcrpFeatureState>,
  policySource: TcrpPolicySource = "local"
): TcrpFeatureFlags {
  return {
    ...flags,
    features: {
      ...flags.features,
      [id]: { ...flags.features[id], ...mutation },
    },
    policySource,
  };
}

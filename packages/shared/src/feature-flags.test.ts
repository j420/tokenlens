import { describe, expect, it } from "vitest";
import {
  DEFAULT_TCRP_FLAGS,
  isFeatureEnabled,
  isFeatureInShadow,
  resolveFeatureId,
  validateFlags,
  withFeatureMutation,
  type TcrpFeatureFlags,
} from "./feature-flags.js";

describe("TCRP feature flags", () => {
  describe("DEFAULT_TCRP_FLAGS", () => {
    it("ships F5 (HUD) as general-enabled", () => {
      expect(isFeatureEnabled(DEFAULT_TCRP_FLAGS, "f5")).toBe(true);
    });

    it("keeps F1-F4, F6, and the F7-F19 features in shadow (not user-visible)", () => {
      for (const id of [
        "f1", "f2", "f3", "f4", "f6",
        "f7", "f8", "f9", "f10", "f11", "f12", "f13",
        "f14", "f15", "f16", "f17", "f18", "f19",
      ] as const) {
        expect(isFeatureEnabled(DEFAULT_TCRP_FLAGS, id)).toBe(false);
        expect(isFeatureInShadow(DEFAULT_TCRP_FLAGS, id)).toBe(true);
      }
    });

    it("defines a state + name for every id in TCRP_FEATURE_IDS (no gaps)", () => {
      for (const id of [
        "f1", "f2", "f3", "f4", "f5", "f6", "f7",
        "f8", "f9", "f10", "f11", "f12", "f13",
        "f14", "f15", "f16", "f17", "f18", "f19",
      ] as const) {
        expect(DEFAULT_TCRP_FLAGS.features[id]).toBeDefined();
      }
    });
  });

  describe("resolveFeatureId", () => {
    it("accepts canonical ids", () => {
      expect(resolveFeatureId("f5")).toBe("f5");
      expect(resolveFeatureId("f1")).toBe("f1");
      expect(resolveFeatureId("f6")).toBe("f6");
    });

    it("accepts human-friendly names", () => {
      expect(resolveFeatureId("hud")).toBe("f5");
      expect(resolveFeatureId("trajectoryDiet")).toBe("f1");
      expect(resolveFeatureId("toolDefAuditor")).toBe("f2");
      expect(resolveFeatureId("speculativeCache")).toBe("f3");
      expect(resolveFeatureId("qpdBench")).toBe("f4");
      expect(resolveFeatureId("contextHealth")).toBe("f6");
      expect(resolveFeatureId("semanticCache")).toBe("f7");
      expect(resolveFeatureId("codeModeMcp")).toBe("f8");
      expect(resolveFeatureId("cacheHabits")).toBe("f9");
      expect(resolveFeatureId("mcpProxy")).toBe("f10");
      expect(resolveFeatureId("replayCost")).toBe("f11");
      expect(resolveFeatureId("skillLibrary")).toBe("f12");
      expect(resolveFeatureId("speculativePipeline")).toBe("f13");
      expect(resolveFeatureId("rewardIntegrity")).toBe("f14");
      expect(resolveFeatureId("observationMask")).toBe("f15");
      expect(resolveFeatureId("readGate")).toBe("f16");
      expect(resolveFeatureId("programSlice")).toBe("f17");
      expect(resolveFeatureId("clearingPrice")).toBe("f18");
      expect(resolveFeatureId("wasteBench")).toBe("f19");
    });

    it("returns undefined for unknown ids", () => {
      expect(resolveFeatureId("f99")).toBeUndefined();
      expect(resolveFeatureId("notAFeature")).toBeUndefined();
    });
  });

  describe("isFeatureEnabled", () => {
    it("requires both enabled=true and mode general|canary", () => {
      const flags: TcrpFeatureFlags = {
        version: 1,
        features: {
          f1: { enabled: true, mode: "shadow" },
          f2: { enabled: true, mode: "canary" },
          f3: { enabled: true, mode: "general" },
          f4: { enabled: false, mode: "general" },
          f5: { enabled: true, mode: "disabled" },
          f6: { enabled: true, mode: "canary" },
        },
        policySource: "local",
      };
      expect(isFeatureEnabled(flags, "f1")).toBe(false); // shadow
      expect(isFeatureEnabled(flags, "f2")).toBe(true); // canary
      expect(isFeatureEnabled(flags, "f3")).toBe(true); // general
      expect(isFeatureEnabled(flags, "f4")).toBe(false); // not enabled
      expect(isFeatureEnabled(flags, "f5")).toBe(false); // disabled mode
      expect(isFeatureEnabled(flags, "f6")).toBe(true); // canary
    });
  });

  describe("validateFlags", () => {
    it("returns defaults for non-object input", () => {
      expect(validateFlags(null)).toEqual(DEFAULT_TCRP_FLAGS);
      expect(validateFlags(undefined)).toEqual(DEFAULT_TCRP_FLAGS);
      expect(validateFlags("string")).toEqual(DEFAULT_TCRP_FLAGS);
      expect(validateFlags(42)).toEqual(DEFAULT_TCRP_FLAGS);
    });

    it("returns defaults when version is wrong", () => {
      expect(validateFlags({ version: 2, features: {} })).toEqual(
        DEFAULT_TCRP_FLAGS
      );
    });

    it("merges partial blobs with defaults", () => {
      const result = validateFlags({
        version: 1,
        features: { f5: { enabled: false, mode: "disabled" } },
        policySource: "local",
      });
      expect(result.features.f5).toEqual({
        enabled: false,
        mode: "disabled",
        reason: undefined,
        disabledAt: undefined,
      });
      // Other features fall back to defaults
      expect(result.features.f1).toEqual(DEFAULT_TCRP_FLAGS.features.f1);
      expect(result.policySource).toBe("local");
    });

    it("rejects invalid mode values, keeping defaults", () => {
      const result = validateFlags({
        version: 1,
        features: { f5: { enabled: true, mode: "bogus" } },
      });
      expect(result.features.f5.mode).toBe(DEFAULT_TCRP_FLAGS.features.f5.mode);
    });

    it("preserves reason and disabledAt when present", () => {
      const result = validateFlags({
        version: 1,
        features: {
          f1: {
            enabled: false,
            mode: "disabled",
            reason: "AR breach",
            disabledAt: "2026-06-01T00:00:00Z",
          },
        },
      });
      expect(result.features.f1.reason).toBe("AR breach");
      expect(result.features.f1.disabledAt).toBe("2026-06-01T00:00:00Z");
    });
  });

  describe("withFeatureMutation", () => {
    it("flips enabled without touching siblings", () => {
      const mutated = withFeatureMutation(DEFAULT_TCRP_FLAGS, "f5", {
        enabled: false,
      });
      expect(mutated.features.f5.enabled).toBe(false);
      expect(mutated.features.f5.mode).toBe("general"); // mode preserved
      expect(mutated.features.f1).toEqual(DEFAULT_TCRP_FLAGS.features.f1);
    });

    it("defaults policySource to local on mutation", () => {
      const mutated = withFeatureMutation(DEFAULT_TCRP_FLAGS, "f5", {
        enabled: false,
      });
      expect(mutated.policySource).toBe("local");
    });

    it("does not mutate the input flags", () => {
      const before = JSON.stringify(DEFAULT_TCRP_FLAGS);
      withFeatureMutation(DEFAULT_TCRP_FLAGS, "f5", { enabled: false });
      expect(JSON.stringify(DEFAULT_TCRP_FLAGS)).toBe(before);
    });
  });
});

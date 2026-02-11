import { describe, it, expect } from "vitest";
import {
  providerEnum,
  toolTypeEnum,
  classificationEnum,
  taskTypeEnum,
  wastePatternEnum,
  alertSeverityEnum,
  teamRoleEnum,
  budgetTypeEnum,
  budgetActionEnum,
} from "./schema.js";

// ============================================================================
// ENUM VALIDATION EDGE CASES
// ============================================================================

describe("Enum Validation Edge Cases", () => {
  describe("providerEnum", () => {
    it("should have exactly 3 providers", () => {
      expect(providerEnum.enumValues).toHaveLength(3);
    });

    it("should not have empty strings", () => {
      for (const value of providerEnum.enumValues) {
        expect(value).not.toBe("");
        expect(value.trim()).toBe(value);
      }
    });

    it("should be lowercase", () => {
      for (const value of providerEnum.enumValues) {
        expect(value).toBe(value.toLowerCase());
      }
    });
  });

  describe("toolTypeEnum", () => {
    it("should have exactly 5 tool types", () => {
      expect(toolTypeEnum.enumValues).toHaveLength(5);
    });

    it("should include unknown as fallback", () => {
      expect(toolTypeEnum.enumValues).toContain("unknown");
    });

    it("should have valid kebab-case values", () => {
      for (const value of toolTypeEnum.enumValues) {
        expect(value).toMatch(/^[a-z-]+$/);
      }
    });
  });

  describe("classificationEnum", () => {
    it("should have mutually exclusive classifications", () => {
      const values = classificationEnum.enumValues;
      expect(new Set(values).size).toBe(values.length);
    });

    it("should include unknown for unclassified items", () => {
      expect(classificationEnum.enumValues).toContain("unknown");
    });
  });

  describe("taskTypeEnum", () => {
    it("should cover main development tasks", () => {
      const values = taskTypeEnum.enumValues;
      expect(values).toContain("refactor");
      expect(values).toContain("debug");
      expect(values).toContain("test");
      expect(values).toContain("feature");
    });
  });

  describe("wastePatternEnum", () => {
    it("should have all documented waste patterns", () => {
      const expectedPatterns = [
        "circular_loop",
        "redundant_reads",
        "compaction_storm",
        "zero_acceptance",
        "mcp_bloat",
        "cost_anomaly",
        "low_roi",
        "budget_warning",
      ];
      for (const pattern of expectedPatterns) {
        expect(wastePatternEnum.enumValues).toContain(pattern);
      }
    });

    it("should use snake_case consistently", () => {
      for (const value of wastePatternEnum.enumValues) {
        expect(value).toMatch(/^[a-z_]+$/);
      }
    });
  });

  describe("alertSeverityEnum", () => {
    it("should have exactly 2 severity levels", () => {
      expect(alertSeverityEnum.enumValues).toHaveLength(2);
    });

    it("should have warning and info", () => {
      expect(alertSeverityEnum.enumValues).toContain("warning");
      expect(alertSeverityEnum.enumValues).toContain("info");
    });
  });

  describe("teamRoleEnum", () => {
    it("should have hierarchy of roles", () => {
      const values = teamRoleEnum.enumValues;
      expect(values).toContain("admin");
      expect(values).toContain("member");
      expect(values).toContain("viewer");
    });
  });

  describe("budgetTypeEnum", () => {
    it("should cover different budget scopes", () => {
      const values = budgetTypeEnum.enumValues;
      expect(values).toContain("daily_developer");
      expect(values).toContain("monthly_project");
      expect(values).toContain("monthly_team");
    });
  });

  describe("budgetActionEnum", () => {
    it("should have escalating actions", () => {
      const values = budgetActionEnum.enumValues;
      expect(values).toContain("block");
      expect(values).toContain("warn");
      expect(values).toContain("downgrade");
    });
  });
});

// ============================================================================
// TYPE SAFETY TESTS
// ============================================================================

describe("Type Safety", () => {
  it("should have consistent enum naming conventions", () => {
    // All enums should have enumName and enumValues
    const enums = [
      providerEnum,
      toolTypeEnum,
      classificationEnum,
      taskTypeEnum,
      wastePatternEnum,
      alertSeverityEnum,
      teamRoleEnum,
      budgetTypeEnum,
      budgetActionEnum,
    ];

    for (const enumDef of enums) {
      expect(enumDef.enumName).toBeDefined();
      expect(enumDef.enumValues).toBeDefined();
      expect(Array.isArray(enumDef.enumValues)).toBe(true);
      expect(enumDef.enumValues.length).toBeGreaterThan(0);
    }
  });

  it("should have unique values within each enum", () => {
    const enums = [
      providerEnum.enumValues,
      toolTypeEnum.enumValues,
      classificationEnum.enumValues,
      taskTypeEnum.enumValues,
      wastePatternEnum.enumValues,
      alertSeverityEnum.enumValues,
    ];

    for (const values of enums) {
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    }
  });
});

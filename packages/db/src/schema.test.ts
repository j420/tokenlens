import { describe, it, expect } from "vitest";
import {
  // Enums
  providerEnum,
  teamRoleEnum,
  budgetTypeEnum,
  budgetActionEnum,
  toolTypeEnum,
  classificationEnum,
  taskTypeEnum,
  wastePatternEnum,
  alertSeverityEnum,
  // Tables
  teams,
  teamMembers,
  teamInvites,
  teamApiKeys,
  budgetRules,
  budgetUsage,
  projects,
  users,
  apiKeys,
  sessions,
  events,
  alerts,
  compactionEvents,
  autoTrimRules,
  predictionModels,
  predictions,
  // Types
  type Team,
  type NewTeam,
  type User,
  type NewUser,
  type ApiKey,
  type NewApiKey,
  type Session,
  type NewSession,
  type Event,
  type NewEvent,
  type Alert,
  type NewAlert,
} from "./schema.js";

// ============================================================================
// ENUM TESTS
// ============================================================================

describe("Database Enums", () => {
  describe("providerEnum", () => {
    it("should have correct enum values", () => {
      expect(providerEnum.enumValues).toContain("anthropic");
      expect(providerEnum.enumValues).toContain("openai");
      expect(providerEnum.enumValues).toContain("google");
      expect(providerEnum.enumValues).toHaveLength(3);
    });

    it("should have correct enum name", () => {
      expect(providerEnum.enumName).toBe("provider");
    });
  });

  describe("teamRoleEnum", () => {
    it("should have correct role values", () => {
      expect(teamRoleEnum.enumValues).toContain("admin");
      expect(teamRoleEnum.enumValues).toContain("member");
      expect(teamRoleEnum.enumValues).toContain("viewer");
      expect(teamRoleEnum.enumValues).toHaveLength(3);
    });
  });

  describe("budgetTypeEnum", () => {
    it("should have correct budget type values", () => {
      expect(budgetTypeEnum.enumValues).toContain("daily_developer");
      expect(budgetTypeEnum.enumValues).toContain("monthly_project");
      expect(budgetTypeEnum.enumValues).toContain("monthly_team");
      expect(budgetTypeEnum.enumValues).toHaveLength(3);
    });
  });

  describe("budgetActionEnum", () => {
    it("should have correct action values", () => {
      expect(budgetActionEnum.enumValues).toContain("block");
      expect(budgetActionEnum.enumValues).toContain("warn");
      expect(budgetActionEnum.enumValues).toContain("downgrade");
      expect(budgetActionEnum.enumValues).toHaveLength(3);
    });
  });

  describe("toolTypeEnum", () => {
    it("should have correct tool type values", () => {
      expect(toolTypeEnum.enumValues).toContain("claude-code");
      expect(toolTypeEnum.enumValues).toContain("cursor");
      expect(toolTypeEnum.enumValues).toContain("codex");
      expect(toolTypeEnum.enumValues).toContain("direct-api");
      expect(toolTypeEnum.enumValues).toContain("unknown");
      expect(toolTypeEnum.enumValues).toHaveLength(5);
    });
  });

  describe("classificationEnum", () => {
    it("should have correct classification values", () => {
      expect(classificationEnum.enumValues).toContain("productive");
      expect(classificationEnum.enumValues).toContain("recursive");
      expect(classificationEnum.enumValues).toContain("unknown");
      expect(classificationEnum.enumValues).toHaveLength(3);
    });
  });

  describe("taskTypeEnum", () => {
    it("should have correct task type values", () => {
      expect(taskTypeEnum.enumValues).toContain("refactor");
      expect(taskTypeEnum.enumValues).toContain("debug");
      expect(taskTypeEnum.enumValues).toContain("test");
      expect(taskTypeEnum.enumValues).toContain("feature");
      expect(taskTypeEnum.enumValues).toContain("unknown");
      expect(taskTypeEnum.enumValues).toHaveLength(5);
    });
  });

  describe("wastePatternEnum", () => {
    it("should have all waste pattern types", () => {
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
      expect(wastePatternEnum.enumValues).toHaveLength(8);
    });
  });

  describe("alertSeverityEnum", () => {
    it("should have correct severity values", () => {
      expect(alertSeverityEnum.enumValues).toContain("warning");
      expect(alertSeverityEnum.enumValues).toContain("info");
      expect(alertSeverityEnum.enumValues).toHaveLength(2);
    });
  });
});

// ============================================================================
// TABLE STRUCTURE TESTS
// ============================================================================

describe("Table Structures", () => {
  describe("teams table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(teams);
      expect(columns).toContain("id");
      expect(columns).toContain("name");
      expect(columns).toContain("slack_webhook_url");
      expect(columns).toContain("created_at");
      expect(columns).toContain("updated_at");
    });
  });

  describe("users table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(users);
      expect(columns).toContain("id");
      expect(columns).toContain("email");
      expect(columns).toContain("name");
      expect(columns).toContain("team_id");
      expect(columns).toContain("created_at");
      expect(columns).toContain("updated_at");
    });
  });

  describe("apiKeys table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(apiKeys);
      expect(columns).toContain("id");
      expect(columns).toContain("user_id");
      expect(columns).toContain("key_hash");
      expect(columns).toContain("key_prefix");
      expect(columns).toContain("name");
      expect(columns).toContain("last_used_at");
      expect(columns).toContain("created_at");
      expect(columns).toContain("revoked_at");
    });
  });

  describe("sessions table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(sessions);
      expect(columns).toContain("id");
      expect(columns).toContain("user_id");
      expect(columns).toContain("team_id");
      expect(columns).toContain("provider");
      expect(columns).toContain("tool");
      expect(columns).toContain("model");
      expect(columns).toContain("started_at");
      expect(columns).toContain("ended_at");
      expect(columns).toContain("total_tokens_in");
      expect(columns).toContain("total_tokens_out");
      expect(columns).toContain("total_cost_usd");
      expect(columns).toContain("event_count");
      expect(columns).toContain("description");
    });

    it("should have ROI tracking columns", () => {
      const columns = Object.keys(sessions);
      expect(columns).toContain("cumulative_roi_score");
      expect(columns).toContain("total_productive_tokens");
      expect(columns).toContain("total_recursive_tokens");
      expect(columns).toContain("consecutive_low_roi_turns");
    });
  });

  describe("events table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(events);
      expect(columns).toContain("id");
      expect(columns).toContain("session_id");
      expect(columns).toContain("user_id");
      expect(columns).toContain("team_id");
      expect(columns).toContain("timestamp");
      expect(columns).toContain("provider");
      expect(columns).toContain("tool");
      expect(columns).toContain("model");
      expect(columns).toContain("tokens_in");
      expect(columns).toContain("tokens_out");
      expect(columns).toContain("tokens_cached");
      expect(columns).toContain("latency_ms");
      expect(columns).toContain("estimated_cost_usd");
      expect(columns).toContain("cumulative_session_cost_usd");
    });

    it("should have context tracking columns", () => {
      const columns = Object.keys(events);
      expect(columns).toContain("tool_calls");
      expect(columns).toContain("files_referenced");
      expect(columns).toContain("compaction_triggered");
      expect(columns).toContain("context_size_before");
      expect(columns).toContain("context_size_after");
    });

    it("should have classification columns", () => {
      const columns = Object.keys(events);
      expect(columns).toContain("waste_flags");
      expect(columns).toContain("classification");
      expect(columns).toContain("roi_score");
      expect(columns).toContain("task_metadata");
    });
  });

  describe("alerts table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(alerts);
      expect(columns).toContain("id");
      expect(columns).toContain("session_id");
      expect(columns).toContain("user_id");
      expect(columns).toContain("team_id");
      expect(columns).toContain("event_id");
      expect(columns).toContain("pattern");
      expect(columns).toContain("severity");
      expect(columns).toContain("tokens_wasted");
      expect(columns).toContain("cost_wasted_usd");
      expect(columns).toContain("message_title");
      expect(columns).toContain("message_body");
      expect(columns).toContain("suggestions");
    });
  });

  describe("compactionEvents table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(compactionEvents);
      expect(columns).toContain("id");
      expect(columns).toContain("session_id");
      expect(columns).toContain("user_id");
      expect(columns).toContain("event_id");
      expect(columns).toContain("turn_number");
      expect(columns).toContain("tokens_before");
      expect(columns).toContain("tokens_after");
      expect(columns).toContain("tokens_removed");
      expect(columns).toContain("overhead_cost_usd");
      expect(columns).toContain("lost_references");
      expect(columns).toContain("summary");
    });
  });

  describe("budgetRules table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(budgetRules);
      expect(columns).toContain("id");
      expect(columns).toContain("team_id");
      expect(columns).toContain("name");
      expect(columns).toContain("budget_type");
      expect(columns).toContain("limit_usd");
      expect(columns).toContain("action");
      expect(columns).toContain("user_id");
      expect(columns).toContain("project_name");
      expect(columns).toContain("downgrade_model");
      expect(columns).toContain("downgrade_threshold_percent");
      expect(columns).toContain("warn_at_percent");
      expect(columns).toContain("enabled");
    });
  });

  describe("autoTrimRules table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(autoTrimRules);
      expect(columns).toContain("id");
      expect(columns).toContain("user_id");
      expect(columns).toContain("repo_identifier");
      expect(columns).toContain("question_pattern");
      expect(columns).toContain("included_paths");
      expect(columns).toContain("excluded_paths");
      expect(columns).toContain("max_context_tokens");
      expect(columns).toContain("enabled");
    });
  });

  describe("predictions table", () => {
    it("should have input columns", () => {
      const columns = Object.keys(predictions);
      expect(columns).toContain("task_type");
      expect(columns).toContain("model");
      expect(columns).toContain("estimated_context_tokens");
      expect(columns).toContain("repo_identifier");
      expect(columns).toContain("session_depth");
      expect(columns).toContain("hour_of_day");
    });

    it("should have output columns", () => {
      const columns = Object.keys(predictions);
      expect(columns).toContain("predicted_cost_usd");
      expect(columns).toContain("confidence_interval_low");
      expect(columns).toContain("confidence_interval_high");
      expect(columns).toContain("confidence");
    });

    it("should have actual result columns", () => {
      const columns = Object.keys(predictions);
      expect(columns).toContain("actual_cost_usd");
      expect(columns).toContain("prediction_error");
    });
  });
});

// ============================================================================
// TEAM MANAGEMENT TABLE TESTS
// ============================================================================

describe("Team Management Tables", () => {
  describe("teamMembers table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(teamMembers);
      expect(columns).toContain("id");
      expect(columns).toContain("team_id");
      expect(columns).toContain("user_id");
      expect(columns).toContain("role");
      expect(columns).toContain("joined_at");
    });
  });

  describe("teamInvites table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(teamInvites);
      expect(columns).toContain("id");
      expect(columns).toContain("team_id");
      expect(columns).toContain("email");
      expect(columns).toContain("role");
      expect(columns).toContain("invited_by");
      expect(columns).toContain("token");
      expect(columns).toContain("expires_at");
      expect(columns).toContain("accepted_at");
    });
  });

  describe("teamApiKeys table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(teamApiKeys);
      expect(columns).toContain("id");
      expect(columns).toContain("team_id");
      expect(columns).toContain("key_hash");
      expect(columns).toContain("key_prefix");
      expect(columns).toContain("name");
      expect(columns).toContain("created_by");
      expect(columns).toContain("last_used_at");
      expect(columns).toContain("revoked_at");
    });
  });

  describe("projects table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(projects);
      expect(columns).toContain("id");
      expect(columns).toContain("team_id");
      expect(columns).toContain("name");
      expect(columns).toContain("created_at");
    });
  });

  describe("budgetUsage table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(budgetUsage);
      expect(columns).toContain("id");
      expect(columns).toContain("rule_id");
      expect(columns).toContain("user_id");
      expect(columns).toContain("period_start");
      expect(columns).toContain("period_end");
      expect(columns).toContain("spent_usd");
      expect(columns).toContain("token_count");
      expect(columns).toContain("request_count");
      expect(columns).toContain("blocked_count");
      expect(columns).toContain("downgraded_count");
    });
  });
});

// ============================================================================
// ML/PREDICTION TABLE TESTS
// ============================================================================

describe("ML/Prediction Tables", () => {
  describe("predictionModels table", () => {
    it("should have required columns", () => {
      const columns = Object.keys(predictionModels);
      expect(columns).toContain("id");
      expect(columns).toContain("team_id");
      expect(columns).toContain("weights");
      expect(columns).toContain("event_count");
      expect(columns).toContain("mean_absolute_error");
      expect(columns).toContain("r2_score");
      expect(columns).toContain("trained_at");
      expect(columns).toContain("is_active");
    });
  });
});

// ============================================================================
// TYPE INFERENCE TESTS
// ============================================================================

describe("Type Inference", () => {
  it("should have Team type with expected properties", () => {
    const team: Team = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Test Team",
      slack_webhook_url: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    expect(team.id).toBeDefined();
    expect(team.name).toBe("Test Team");
  });

  it("should have NewTeam type for inserts", () => {
    const newTeam: NewTeam = {
      name: "New Team",
    };
    expect(newTeam.name).toBe("New Team");
  });

  it("should have User type with expected properties", () => {
    const user: User = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      email: "test@example.com",
      name: "Test User",
      team_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    expect(user.email).toBe("test@example.com");
  });

  it("should have NewUser type for inserts", () => {
    const newUser: NewUser = {
      email: "new@example.com",
    };
    expect(newUser.email).toBe("new@example.com");
  });

  it("should have Session type with ROI tracking", () => {
    const session: Session = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      user_id: "123e4567-e89b-12d3-a456-426614174001",
      team_id: null,
      provider: "anthropic",
      tool: "claude-code",
      model: "claude-sonnet-4",
      started_at: new Date(),
      ended_at: null,
      total_tokens_in: 1000,
      total_tokens_out: 500,
      total_cost_usd: 0.05,
      event_count: 5,
      description: null,
      cumulative_roi_score: 0.85,
      total_productive_tokens: 1200,
      total_recursive_tokens: 300,
      consecutive_low_roi_turns: 0,
    };
    expect(session.cumulative_roi_score).toBe(0.85);
  });

  it("should have Event type with all fields", () => {
    const event: Event = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      session_id: "123e4567-e89b-12d3-a456-426614174001",
      user_id: "123e4567-e89b-12d3-a456-426614174002",
      team_id: null,
      timestamp: new Date(),
      provider: "openai",
      tool: "cursor",
      model: "gpt-4o",
      tokens_in: 500,
      tokens_out: 200,
      tokens_cached: 100,
      latency_ms: 1500,
      estimated_cost_usd: 0.02,
      cumulative_session_cost_usd: 0.10,
      tool_calls: ["read", "write"],
      files_referenced: ["file.ts"],
      compaction_triggered: false,
      context_size_before: 2000,
      context_size_after: 2000,
      waste_flags: [],
      classification: "productive",
      roi_score: 0.9,
      task_metadata: { type: "debug", repo: null, branch: null },
    };
    expect(event.tokens_in).toBe(500);
    expect(event.classification).toBe("productive");
  });

  it("should have Alert type with suggestions", () => {
    const alert: Alert = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      session_id: "123e4567-e89b-12d3-a456-426614174001",
      user_id: "123e4567-e89b-12d3-a456-426614174002",
      team_id: null,
      event_id: null,
      pattern: "circular_loop",
      severity: "warning",
      tokens_wasted: 5000,
      cost_wasted_usd: 0.50,
      file_involved: "auth.ts",
      occurrences: 3,
      message_title: "Circular Loop Detected",
      message_body: "The same file is being read repeatedly",
      suggestions: [
        { label: "Skip", action: "skip_file", detail: "Skip this file in future reads" }
      ],
      cooldown_seconds: 300,
      dismissed_at: null,
      created_at: new Date(),
    };
    expect(alert.pattern).toBe("circular_loop");
    expect(alert.suggestions).toHaveLength(1);
  });
});

// ============================================================================
// RELATIONSHIP TESTS
// ============================================================================

describe("Table Relationships", () => {
  it("should define proper foreign key relationships", () => {
    // These tests verify the structure exists - actual FK enforcement happens at DB level
    expect(teamMembers).toBeDefined();
    expect(teamInvites).toBeDefined();
    expect(teamApiKeys).toBeDefined();
    expect(budgetRules).toBeDefined();
    expect(budgetUsage).toBeDefined();
    expect(events).toBeDefined();
    expect(alerts).toBeDefined();
    expect(compactionEvents).toBeDefined();
    expect(predictions).toBeDefined();
  });
});

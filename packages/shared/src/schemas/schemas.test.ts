import { describe, it, expect } from "vitest";
import {
  ProviderSchema,
  ToolTypeSchema,
  ClassificationSchema,
  TaskTypeSchema,
  WasteFlagSchema,
  TaskMetadataSchema,
  CanonicalEventSchema,
  CreateEventInputSchema,
} from "./event.js";
import { UserSchema, CreateUserInputSchema } from "./user.js";
import { ApiKeySchema, CreateApiKeyInputSchema, API_KEY_PREFIX } from "./api-key.js";
import { SessionSchema, CreateSessionInputSchema } from "./session.js";

// ============================================================================
// PROVIDER SCHEMA TESTS
// ============================================================================

describe("ProviderSchema", () => {
  it("should accept valid providers", () => {
    expect(ProviderSchema.parse("anthropic")).toBe("anthropic");
    expect(ProviderSchema.parse("openai")).toBe("openai");
    expect(ProviderSchema.parse("google")).toBe("google");
  });

  it("should reject invalid providers", () => {
    expect(() => ProviderSchema.parse("invalid")).toThrow();
    expect(() => ProviderSchema.parse("")).toThrow();
    expect(() => ProviderSchema.parse(123)).toThrow();
    expect(() => ProviderSchema.parse(null)).toThrow();
    expect(() => ProviderSchema.parse(undefined)).toThrow();
  });

  it("should be case-sensitive", () => {
    expect(() => ProviderSchema.parse("Anthropic")).toThrow();
    expect(() => ProviderSchema.parse("OPENAI")).toThrow();
  });
});

// ============================================================================
// TOOL TYPE SCHEMA TESTS
// ============================================================================

describe("ToolTypeSchema", () => {
  it("should accept all valid tool types", () => {
    expect(ToolTypeSchema.parse("claude-code")).toBe("claude-code");
    expect(ToolTypeSchema.parse("cursor")).toBe("cursor");
    expect(ToolTypeSchema.parse("codex")).toBe("codex");
    expect(ToolTypeSchema.parse("direct-api")).toBe("direct-api");
    expect(ToolTypeSchema.parse("unknown")).toBe("unknown");
  });

  it("should reject invalid tool types", () => {
    expect(() => ToolTypeSchema.parse("vscode")).toThrow();
    expect(() => ToolTypeSchema.parse("copilot")).toThrow();
    expect(() => ToolTypeSchema.parse("")).toThrow();
  });
});

// ============================================================================
// CLASSIFICATION SCHEMA TESTS
// ============================================================================

describe("ClassificationSchema", () => {
  it("should accept valid classifications", () => {
    expect(ClassificationSchema.parse("productive")).toBe("productive");
    expect(ClassificationSchema.parse("recursive")).toBe("recursive");
    expect(ClassificationSchema.parse("unknown")).toBe("unknown");
  });

  it("should reject invalid classifications", () => {
    expect(() => ClassificationSchema.parse("good")).toThrow();
    expect(() => ClassificationSchema.parse("bad")).toThrow();
    expect(() => ClassificationSchema.parse("")).toThrow();
  });
});

// ============================================================================
// TASK TYPE SCHEMA TESTS
// ============================================================================

describe("TaskTypeSchema", () => {
  it("should accept all valid task types", () => {
    expect(TaskTypeSchema.parse("refactor")).toBe("refactor");
    expect(TaskTypeSchema.parse("debug")).toBe("debug");
    expect(TaskTypeSchema.parse("test")).toBe("test");
    expect(TaskTypeSchema.parse("feature")).toBe("feature");
    expect(TaskTypeSchema.parse("unknown")).toBe("unknown");
  });

  it("should reject invalid task types", () => {
    expect(() => TaskTypeSchema.parse("build")).toThrow();
    expect(() => TaskTypeSchema.parse("deploy")).toThrow();
  });
});

// ============================================================================
// WASTE FLAG SCHEMA TESTS
// ============================================================================

describe("WasteFlagSchema", () => {
  it("should accept all valid waste flags", () => {
    expect(WasteFlagSchema.parse("circular_loop")).toBe("circular_loop");
    expect(WasteFlagSchema.parse("redundant_reads")).toBe("redundant_reads");
    expect(WasteFlagSchema.parse("compaction_storm")).toBe("compaction_storm");
    expect(WasteFlagSchema.parse("zero_acceptance")).toBe("zero_acceptance");
    expect(WasteFlagSchema.parse("mcp_bloat")).toBe("mcp_bloat");
    expect(WasteFlagSchema.parse("cost_anomaly")).toBe("cost_anomaly");
  });

  it("should reject invalid waste flags", () => {
    expect(() => WasteFlagSchema.parse("memory_leak")).toThrow();
    expect(() => WasteFlagSchema.parse("slow_response")).toThrow();
  });
});

// ============================================================================
// TASK METADATA SCHEMA TESTS
// ============================================================================

describe("TaskMetadataSchema", () => {
  it("should accept valid task metadata", () => {
    const result = TaskMetadataSchema.parse({
      type: "debug",
      repo: "my-repo",
      branch: "main",
    });
    expect(result.type).toBe("debug");
    expect(result.repo).toBe("my-repo");
    expect(result.branch).toBe("main");
  });

  it("should accept null repo and branch", () => {
    const result = TaskMetadataSchema.parse({
      type: "feature",
      repo: null,
      branch: null,
    });
    expect(result.repo).toBeNull();
    expect(result.branch).toBeNull();
  });

  it("should reject missing required fields", () => {
    expect(() => TaskMetadataSchema.parse({})).toThrow();
    expect(() => TaskMetadataSchema.parse({ type: "debug" })).toThrow();
  });

  it("should reject invalid task types in metadata", () => {
    expect(() =>
      TaskMetadataSchema.parse({
        type: "invalid",
        repo: null,
        branch: null,
      })
    ).toThrow();
  });
});

// ============================================================================
// CANONICAL EVENT SCHEMA TESTS
// ============================================================================

describe("CanonicalEventSchema", () => {
  const validEvent = {
    event_id: "123e4567-e89b-12d3-a456-426614174000",
    session_id: "123e4567-e89b-12d3-a456-426614174001",
    user_id: "123e4567-e89b-12d3-a456-426614174002",
    team_id: null,
    timestamp: "2024-01-01T00:00:00.000Z",
    provider: "anthropic",
    tool: "claude-code",
    model: "claude-sonnet-4",
    tokens_in: 1000,
    tokens_out: 500,
    tokens_cached: 200,
    latency_ms: 1500,
    estimated_cost_usd: 0.05,
    cumulative_session_cost_usd: 0.10,
    tool_calls: ["read_file", "write_file"],
    files_referenced: ["src/main.ts", "package.json"],
    compaction_triggered: false,
    context_size_before: 5000,
    context_size_after: 5000,
    waste_flags: [],
    classification: "productive",
    roi_score: 0.85,
    task_metadata: {
      type: "debug",
      repo: "my-project",
      branch: "main",
    },
  };

  it("should accept a valid canonical event", () => {
    const result = CanonicalEventSchema.parse(validEvent);
    expect(result.event_id).toBe(validEvent.event_id);
    expect(result.tokens_in).toBe(1000);
  });

  it("should accept event with waste flags", () => {
    const eventWithWaste = {
      ...validEvent,
      waste_flags: ["circular_loop", "redundant_reads"],
    };
    const result = CanonicalEventSchema.parse(eventWithWaste);
    expect(result.waste_flags).toHaveLength(2);
  });

  it("should reject invalid UUIDs", () => {
    expect(() =>
      CanonicalEventSchema.parse({
        ...validEvent,
        event_id: "not-a-uuid",
      })
    ).toThrow();
  });

  it("should reject negative token counts", () => {
    expect(() =>
      CanonicalEventSchema.parse({
        ...validEvent,
        tokens_in: -100,
      })
    ).toThrow();
  });

  it("should reject invalid timestamps", () => {
    expect(() =>
      CanonicalEventSchema.parse({
        ...validEvent,
        timestamp: "not-a-date",
      })
    ).toThrow();
  });

  it("should reject roi_score outside 0-1 range", () => {
    expect(() =>
      CanonicalEventSchema.parse({
        ...validEvent,
        roi_score: 1.5,
      })
    ).toThrow();
    expect(() =>
      CanonicalEventSchema.parse({
        ...validEvent,
        roi_score: -0.5,
      })
    ).toThrow();
  });

  it("should accept edge case roi_score values", () => {
    expect(CanonicalEventSchema.parse({ ...validEvent, roi_score: 0 }).roi_score).toBe(0);
    expect(CanonicalEventSchema.parse({ ...validEvent, roi_score: 1 }).roi_score).toBe(1);
  });
});

// ============================================================================
// CREATE EVENT INPUT SCHEMA TESTS
// ============================================================================

describe("CreateEventInputSchema", () => {
  const validInput = {
    session_id: "123e4567-e89b-12d3-a456-426614174001",
    user_id: "123e4567-e89b-12d3-a456-426614174002",
    team_id: null,
    provider: "openai",
    tool: "cursor",
    model: "gpt-4o",
    tokens_in: 500,
    tokens_out: 200,
    latency_ms: 800,
  };

  it("should accept valid input with defaults", () => {
    const result = CreateEventInputSchema.parse(validInput);
    expect(result.tokens_cached).toBe(0);
    expect(result.tool_calls).toEqual([]);
    expect(result.files_referenced).toEqual([]);
    expect(result.context_size_before).toBe(0);
    expect(result.context_size_after).toBe(0);
  });

  it("should accept input with optional fields", () => {
    const result = CreateEventInputSchema.parse({
      ...validInput,
      tokens_cached: 100,
      tool_calls: ["bash"],
      files_referenced: ["file.ts"],
      context_size_before: 1000,
      context_size_after: 1200,
      task_metadata: { type: "feature", repo: "test", branch: "dev" },
    });
    expect(result.tokens_cached).toBe(100);
    expect(result.tool_calls).toEqual(["bash"]);
  });

  it("should reject missing required fields", () => {
    expect(() => CreateEventInputSchema.parse({})).toThrow();
    expect(() =>
      CreateEventInputSchema.parse({
        session_id: "123e4567-e89b-12d3-a456-426614174001",
      })
    ).toThrow();
  });
});

// ============================================================================
// USER SCHEMA TESTS
// ============================================================================

describe("UserSchema", () => {
  const validUser = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    email: "test@example.com",
    name: "Test User",
    team_id: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
  };

  it("should accept a valid user", () => {
    const result = UserSchema.parse(validUser);
    expect(result.email).toBe("test@example.com");
  });

  it("should accept user with null name", () => {
    const result = UserSchema.parse({ ...validUser, name: null });
    expect(result.name).toBeNull();
  });

  it("should accept user with team_id", () => {
    const result = UserSchema.parse({
      ...validUser,
      team_id: "123e4567-e89b-12d3-a456-426614174001",
    });
    expect(result.team_id).toBe("123e4567-e89b-12d3-a456-426614174001");
  });

  it("should reject invalid email", () => {
    expect(() => UserSchema.parse({ ...validUser, email: "not-an-email" })).toThrow();
    expect(() => UserSchema.parse({ ...validUser, email: "" })).toThrow();
  });

  it("should reject invalid UUID for id", () => {
    expect(() => UserSchema.parse({ ...validUser, id: "not-a-uuid" })).toThrow();
  });
});

// ============================================================================
// CREATE USER INPUT SCHEMA TESTS
// ============================================================================

describe("CreateUserInputSchema", () => {
  it("should accept valid input with email only", () => {
    const result = CreateUserInputSchema.parse({ email: "user@test.com" });
    expect(result.email).toBe("user@test.com");
    expect(result.name).toBeUndefined();
  });

  it("should accept input with all fields", () => {
    const result = CreateUserInputSchema.parse({
      email: "user@test.com",
      name: "Test User",
      team_id: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.name).toBe("Test User");
    expect(result.team_id).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("should accept null values for optional fields", () => {
    const result = CreateUserInputSchema.parse({
      email: "user@test.com",
      name: null,
      team_id: null,
    });
    expect(result.name).toBeNull();
    expect(result.team_id).toBeNull();
  });

  it("should reject missing email", () => {
    expect(() => CreateUserInputSchema.parse({})).toThrow();
    expect(() => CreateUserInputSchema.parse({ name: "Test" })).toThrow();
  });
});

// ============================================================================
// API KEY SCHEMA TESTS
// ============================================================================

describe("ApiKeySchema", () => {
  const validApiKey = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    user_id: "123e4567-e89b-12d3-a456-426614174001",
    key_hash: "sha256hashvalue",
    key_prefix: "prune_sk_abc12345",
    name: "Development Key",
    last_used_at: "2024-01-01T00:00:00.000Z",
    created_at: "2024-01-01T00:00:00.000Z",
    revoked_at: null,
  };

  it("should accept a valid API key", () => {
    const result = ApiKeySchema.parse(validApiKey);
    expect(result.name).toBe("Development Key");
  });

  it("should accept API key with null timestamps", () => {
    const result = ApiKeySchema.parse({
      ...validApiKey,
      last_used_at: null,
      revoked_at: null,
    });
    expect(result.last_used_at).toBeNull();
    expect(result.revoked_at).toBeNull();
  });

  it("should accept revoked API key", () => {
    const result = ApiKeySchema.parse({
      ...validApiKey,
      revoked_at: "2024-06-01T00:00:00.000Z",
    });
    expect(result.revoked_at).toBe("2024-06-01T00:00:00.000Z");
  });
});

// ============================================================================
// CREATE API KEY INPUT SCHEMA TESTS
// ============================================================================

describe("CreateApiKeyInputSchema", () => {
  it("should accept valid input with user_id only", () => {
    const result = CreateApiKeyInputSchema.parse({
      user_id: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.user_id).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(result.name).toBe("Default");
  });

  it("should accept custom name", () => {
    const result = CreateApiKeyInputSchema.parse({
      user_id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Production Key",
    });
    expect(result.name).toBe("Production Key");
  });

  it("should reject invalid user_id", () => {
    expect(() =>
      CreateApiKeyInputSchema.parse({
        user_id: "not-a-uuid",
      })
    ).toThrow();
  });
});

// ============================================================================
// API KEY PREFIX TESTS
// ============================================================================

describe("API_KEY_PREFIX", () => {
  it("should have correct prefix value", () => {
    expect(API_KEY_PREFIX).toBe("prune_sk_");
  });

  it("should be a valid key prefix format", () => {
    expect(API_KEY_PREFIX).toMatch(/^[a-z_]+$/);
  });
});

// ============================================================================
// SESSION SCHEMA TESTS
// ============================================================================

describe("SessionSchema", () => {
  const validSession = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    user_id: "123e4567-e89b-12d3-a456-426614174001",
    team_id: null,
    provider: "anthropic",
    tool: "claude-code",
    model: "claude-sonnet-4",
    started_at: "2024-01-01T00:00:00.000Z",
    ended_at: null,
    total_tokens_in: 10000,
    total_tokens_out: 5000,
    total_cost_usd: 0.50,
    event_count: 10,
    description: "Implementing feature X",
  };

  it("should accept a valid session", () => {
    const result = SessionSchema.parse(validSession);
    expect(result.model).toBe("claude-sonnet-4");
  });

  it("should accept session with ended_at", () => {
    const result = SessionSchema.parse({
      ...validSession,
      ended_at: "2024-01-01T01:00:00.000Z",
    });
    expect(result.ended_at).toBe("2024-01-01T01:00:00.000Z");
  });

  it("should accept session with null description", () => {
    const result = SessionSchema.parse({
      ...validSession,
      description: null,
    });
    expect(result.description).toBeNull();
  });

  it("should reject negative token counts", () => {
    expect(() =>
      SessionSchema.parse({
        ...validSession,
        total_tokens_in: -100,
      })
    ).toThrow();
  });

  it("should reject negative cost", () => {
    expect(() =>
      SessionSchema.parse({
        ...validSession,
        total_cost_usd: -0.50,
      })
    ).toThrow();
  });

  it("should reject negative event count", () => {
    expect(() =>
      SessionSchema.parse({
        ...validSession,
        event_count: -1,
      })
    ).toThrow();
  });
});

// ============================================================================
// CREATE SESSION INPUT SCHEMA TESTS
// ============================================================================

describe("CreateSessionInputSchema", () => {
  it("should accept valid input", () => {
    const result = CreateSessionInputSchema.parse({
      user_id: "123e4567-e89b-12d3-a456-426614174000",
      provider: "openai",
      tool: "cursor",
      model: "gpt-4o",
    });
    expect(result.user_id).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(result.team_id).toBeUndefined();
  });

  it("should accept input with team_id", () => {
    const result = CreateSessionInputSchema.parse({
      user_id: "123e4567-e89b-12d3-a456-426614174000",
      team_id: "123e4567-e89b-12d3-a456-426614174001",
      provider: "anthropic",
      tool: "claude-code",
      model: "claude-opus-4",
    });
    expect(result.team_id).toBe("123e4567-e89b-12d3-a456-426614174001");
  });

  it("should accept null team_id", () => {
    const result = CreateSessionInputSchema.parse({
      user_id: "123e4567-e89b-12d3-a456-426614174000",
      team_id: null,
      provider: "google",
      tool: "codex",
      model: "gemini-pro",
    });
    expect(result.team_id).toBeNull();
  });

  it("should reject missing required fields", () => {
    expect(() => CreateSessionInputSchema.parse({})).toThrow();
    expect(() =>
      CreateSessionInputSchema.parse({
        user_id: "123e4567-e89b-12d3-a456-426614174000",
      })
    ).toThrow();
  });
});

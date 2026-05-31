import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  real,
  boolean,
  jsonb,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

// Enums
export const providerEnum = pgEnum("provider", [
  "anthropic",
  "openai",
  "google",
]);

export const teamRoleEnum = pgEnum("team_role", [
  "admin",   // Set budgets, view all devs, manage team
  "member",  // View own data + team aggregates
  "viewer",  // Read-only team view
]);

export const budgetTypeEnum = pgEnum("budget_type", [
  "daily_developer",   // Per-developer daily cap
  "monthly_project",   // Per-project monthly budget
  "monthly_team",      // Team-wide monthly budget
]);

export const budgetActionEnum = pgEnum("budget_action", [
  "block",     // Block requests when budget exceeded
  "warn",      // Only warn, don't block
  "downgrade", // Downgrade model when threshold hit
]);

export const toolTypeEnum = pgEnum("tool_type", [
  "claude-code",
  "cursor",
  "codex",
  "direct-api",
  "unknown",
]);

export const classificationEnum = pgEnum("classification", [
  "productive",
  "recursive",
  "unknown",
]);

export const taskTypeEnum = pgEnum("task_type", [
  "refactor",
  "debug",
  "test",
  "feature",
  "unknown",
]);

// Teams table
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slack_webhook_url: text("slack_webhook_url"), // For budget alerts
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Team members table - links users to teams with roles
export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull().default("member"),
    joined_at: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("team_members_team_id_idx").on(table.team_id),
    index("team_members_user_id_idx").on(table.user_id),
  ]
);

// Team invites table
export const teamInvites = pgTable(
  "team_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: teamRoleEnum("role").notNull().default("member"),
    invited_by: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(), // Invite token
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("team_invites_team_id_idx").on(table.team_id),
    index("team_invites_email_idx").on(table.email),
    index("team_invites_token_idx").on(table.token),
  ]
);

// Team API keys - separate from user API keys
export const teamApiKeys = pgTable(
  "team_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    key_hash: text("key_hash").notNull(),
    key_prefix: text("key_prefix").notNull(), // "prune_tk_" for team keys
    name: text("name").notNull().default("Default Team Key"),
    created_by: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("team_api_keys_key_hash_idx").on(table.key_hash),
    index("team_api_keys_team_id_idx").on(table.team_id),
  ]
);

// Budget rules table
export const budgetRules = pgTable(
  "budget_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    budget_type: budgetTypeEnum("budget_type").notNull(),
    limit_usd: real("limit_usd").notNull(),
    action: budgetActionEnum("action").notNull().default("block"),
    // Optional: specific user/project this applies to
    user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    project_name: text("project_name"), // From task_metadata.repo
    // For downgrade action
    downgrade_model: text("downgrade_model"), // e.g., "claude-3-haiku"
    downgrade_threshold_percent: integer("downgrade_threshold_percent"), // e.g., 80
    // Alert settings
    warn_at_percent: integer("warn_at_percent").default(80),
    enabled: boolean("enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("budget_rules_team_id_idx").on(table.team_id),
    index("budget_rules_user_id_idx").on(table.user_id),
  ]
);

// Budget usage tracking (daily/monthly aggregates)
export const budgetUsage = pgTable(
  "budget_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rule_id: uuid("rule_id")
      .notNull()
      .references(() => budgetRules.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    period_start: timestamp("period_start", { withTimezone: true }).notNull(),
    period_end: timestamp("period_end", { withTimezone: true }).notNull(),
    spent_usd: real("spent_usd").notNull().default(0),
    token_count: integer("token_count").notNull().default(0),
    request_count: integer("request_count").notNull().default(0),
    blocked_count: integer("blocked_count").notNull().default(0),
    downgraded_count: integer("downgraded_count").notNull().default(0),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("budget_usage_rule_id_idx").on(table.rule_id),
    index("budget_usage_user_id_idx").on(table.user_id),
    index("budget_usage_period_idx").on(table.period_start, table.period_end),
  ]
);

// Projects table for project-level tracking
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // Matches task_metadata.repo
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("projects_team_id_idx").on(table.team_id),
    index("projects_name_idx").on(table.name),
  ]
);

// Users table
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name"),
    team_id: uuid("team_id").references(() => teams.id),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("users_email_idx").on(table.email)]
);

// API Keys table
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key_hash: text("key_hash").notNull(), // SHA-256 hash of the full key
    key_prefix: text("key_prefix").notNull(), // "prune_sk_" + first 8 chars for display
    name: text("name").notNull().default("Default"),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("api_keys_key_hash_idx").on(table.key_hash),
    index("api_keys_user_id_idx").on(table.user_id),
  ]
);

// Sessions table
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    team_id: uuid("team_id").references(() => teams.id),
    provider: providerEnum("provider").notNull(),
    tool: toolTypeEnum("tool").notNull(),
    model: text("model").notNull(),
    started_at: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ended_at: timestamp("ended_at", { withTimezone: true }),
    total_tokens_in: integer("total_tokens_in").notNull().default(0),
    total_tokens_out: integer("total_tokens_out").notNull().default(0),
    total_cost_usd: real("total_cost_usd").notNull().default(0),
    event_count: integer("event_count").notNull().default(0),
    description: text("description"), // Natural language task description
    // ROI tracking
    cumulative_roi_score: real("cumulative_roi_score").notNull().default(1),
    total_productive_tokens: integer("total_productive_tokens").notNull().default(0),
    total_recursive_tokens: integer("total_recursive_tokens").notNull().default(0),
    consecutive_low_roi_turns: integer("consecutive_low_roi_turns").notNull().default(0),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.user_id),
    index("sessions_team_id_idx").on(table.team_id),
    index("sessions_started_at_idx").on(table.started_at),
  ]
);

// Events table - canonical event storage
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    team_id: uuid("team_id").references(() => teams.id),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    provider: providerEnum("provider").notNull(),
    tool: toolTypeEnum("tool").notNull(),
    model: text("model").notNull(),
    tokens_in: integer("tokens_in").notNull(),
    tokens_out: integer("tokens_out").notNull(),
    tokens_cached: integer("tokens_cached").notNull().default(0),
    latency_ms: integer("latency_ms").notNull(),
    estimated_cost_usd: real("estimated_cost_usd").notNull(),
    cumulative_session_cost_usd: real("cumulative_session_cost_usd").notNull(),
    tool_calls: jsonb("tool_calls").$type<string[]>().notNull().default([]),
    files_referenced: jsonb("files_referenced")
      .$type<string[]>()
      .notNull()
      .default([]),
    compaction_triggered: boolean("compaction_triggered").notNull().default(false),
    context_size_before: integer("context_size_before").notNull().default(0),
    context_size_after: integer("context_size_after").notNull().default(0),
    waste_flags: jsonb("waste_flags").$type<string[]>().notNull().default([]),
    classification: classificationEnum("classification")
      .notNull()
      .default("unknown"),
    roi_score: real("roi_score").notNull().default(0),
    task_metadata: jsonb("task_metadata")
      .$type<{
        type: string;
        repo: string | null;
        branch: string | null;
      }>()
      .notNull()
      .default({ type: "unknown", repo: null, branch: null }),
  },
  (table) => [
    index("events_session_id_idx").on(table.session_id),
    index("events_user_id_idx").on(table.user_id),
    index("events_team_id_idx").on(table.team_id),
    index("events_timestamp_idx").on(table.timestamp),
  ]
);

// Waste pattern enum
export const wastePatternEnum = pgEnum("waste_pattern", [
  "circular_loop",
  "redundant_reads",
  "compaction_storm",
  "zero_acceptance",
  "mcp_bloat",
  "cost_anomaly",
  "low_roi",
  "budget_warning",
]);

// Alert severity enum
export const alertSeverityEnum = pgEnum("alert_severity", ["warning", "info"]);

// Alerts table - stores waste detection alerts
export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    team_id: uuid("team_id").references(() => teams.id),
    event_id: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    pattern: wastePatternEnum("pattern").notNull(),
    severity: alertSeverityEnum("severity").notNull(),
    tokens_wasted: integer("tokens_wasted").notNull(),
    cost_wasted_usd: real("cost_wasted_usd").notNull(),
    file_involved: text("file_involved"),
    occurrences: integer("occurrences").notNull().default(1),
    message_title: text("message_title").notNull(),
    message_body: text("message_body").notNull(),
    suggestions: jsonb("suggestions")
      .$type<Array<{ label: string; action: string; detail: string }>>()
      .notNull()
      .default([]),
    cooldown_seconds: integer("cooldown_seconds").notNull().default(300),
    dismissed_at: timestamp("dismissed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("alerts_session_id_idx").on(table.session_id),
    index("alerts_user_id_idx").on(table.user_id),
    index("alerts_pattern_idx").on(table.pattern),
    index("alerts_created_at_idx").on(table.created_at),
  ]
);

// Compaction events table - stores compaction analysis results
export const compactionEvents = pgTable(
  "compaction_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event_id: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    turn_number: integer("turn_number").notNull(),
    tokens_before: integer("tokens_before").notNull(),
    tokens_after: integer("tokens_after").notNull(),
    tokens_removed: integer("tokens_removed").notNull(),
    overhead_cost_usd: real("overhead_cost_usd").notNull(),
    lost_references: jsonb("lost_references")
      .$type<
        Array<{
          item: string;
          original_turn: number;
          category: string;
          rawValue: string;
        }>
      >()
      .notNull()
      .default([]),
    summary: text("summary").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("compaction_events_session_id_idx").on(table.session_id),
    index("compaction_events_user_id_idx").on(table.user_id),
    index("compaction_events_created_at_idx").on(table.created_at),
  ]
);

// Auto-trim rules table - per-repo context pruning rules
export const autoTrimRules = pgTable(
  "auto_trim_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repo_identifier: text("repo_identifier").notNull(), // e.g., "my-app" or "github.com/user/repo"
    question_pattern: text("question_pattern"), // e.g., "CSS questions", "test files"
    included_paths: jsonb("included_paths").$type<string[]>().notNull().default([]), // globs like "src/**/*.ts"
    excluded_paths: jsonb("excluded_paths").$type<string[]>().notNull().default([]), // globs like "**/*.test.ts"
    max_context_tokens: integer("max_context_tokens"), // optional cap on context size
    enabled: boolean("enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("auto_trim_rules_user_id_idx").on(table.user_id),
    index("auto_trim_rules_repo_idx").on(table.repo_identifier),
  ]
);

// Cost prediction model weights table
export const predictionModels = pgTable(
  "prediction_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    // Null team_id means global model
    weights: jsonb("weights").notNull(), // ModelWeights from cost-predictor
    event_count: integer("event_count").notNull(),
    mean_absolute_error: real("mean_absolute_error").notNull(),
    r2_score: real("r2_score").notNull(),
    trained_at: timestamp("trained_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    is_active: boolean("is_active").notNull().default(true),
  },
  (table) => [
    index("prediction_models_team_id_idx").on(table.team_id),
    index("prediction_models_is_active_idx").on(table.is_active),
  ]
);

// Individual predictions for tracking accuracy
export const predictions = pgTable(
  "predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    session_id: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    event_id: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    // Prediction inputs
    task_type: taskTypeEnum("task_type").notNull(),
    model: text("model").notNull(),
    estimated_context_tokens: integer("estimated_context_tokens").notNull(),
    repo_identifier: text("repo_identifier"),
    session_depth: integer("session_depth").notNull(),
    hour_of_day: integer("hour_of_day").notNull(),
    // Prediction outputs
    predicted_cost_usd: real("predicted_cost_usd").notNull(),
    confidence_interval_low: real("confidence_interval_low").notNull(),
    confidence_interval_high: real("confidence_interval_high").notNull(),
    confidence: real("confidence").notNull(),
    // Actual result (filled in after request completes)
    actual_cost_usd: real("actual_cost_usd"),
    prediction_error: real("prediction_error"), // actual - predicted
    // Metadata
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("predictions_user_id_idx").on(table.user_id),
    index("predictions_session_id_idx").on(table.session_id),
    index("predictions_created_at_idx").on(table.created_at),
  ]
);

// Type exports for use in application code
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;

export type AutoTrimRule = typeof autoTrimRules.$inferSelect;
export type NewAutoTrimRule = typeof autoTrimRules.$inferInsert;

export type CompactionEvent = typeof compactionEvents.$inferSelect;
export type NewCompactionEvent = typeof compactionEvents.$inferInsert;

export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;

export type TeamInvite = typeof teamInvites.$inferSelect;
export type NewTeamInvite = typeof teamInvites.$inferInsert;

export type TeamApiKey = typeof teamApiKeys.$inferSelect;
export type NewTeamApiKey = typeof teamApiKeys.$inferInsert;

export type BudgetRule = typeof budgetRules.$inferSelect;
export type NewBudgetRule = typeof budgetRules.$inferInsert;

export type BudgetUsage = typeof budgetUsage.$inferSelect;
export type NewBudgetUsage = typeof budgetUsage.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type PredictionModel = typeof predictionModels.$inferSelect;
export type NewPredictionModel = typeof predictionModels.$inferInsert;

export type Prediction = typeof predictions.$inferSelect;
export type NewPrediction = typeof predictions.$inferInsert;

// ============================================================================
// Phase 5+ — cost-intelligence platform tables.
// These mirror the schema added to @prune/persistence/local-sqlite.ts so a
// team can roll up local TokenLens data into Postgres without rewriting.
// Column types match the SQLite schema 1:1 (TEXT → text, REAL → real,
// INTEGER → integer, JSON → jsonb).
// ============================================================================

// budget_envelopes — named spend caps (BudgetGate). Parent-envelope linkage
// supports team → dev → agent rollups. Period bounds are stored as ISO
// strings (text) to match the SQLite shape exactly.
export const budgetEnvelopes = pgTable(
  "budget_envelopes",
  {
    envelope_id: uuid("envelope_id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    period_kind: text("period_kind").notNull(),
    period_start: timestamp("period_start", { withTimezone: true }).notNull(),
    period_end: timestamp("period_end", { withTimezone: true }).notNull(),
    limit_usd: real("limit_usd").notNull(),
    soft_cap_pct: real("soft_cap_pct").notNull().default(0.75),
    hard_cap_pct: real("hard_cap_pct").notNull().default(1.0),
    parent_envelope_id: uuid("parent_envelope_id"),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => ({
    parentIdx: index("idx_envelopes_parent").on(table.parent_envelope_id),
  })
);

// budget_charges — append-only ledger of per-call cost charges with
// attribution metadata stamped by @prune/budget-gate.
export const budgetCharges = pgTable(
  "budget_charges",
  {
    charge_id: uuid("charge_id").primaryKey().defaultRandom(),
    envelope_id: uuid("envelope_id").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    agent_id: text("agent_id"),
    model: text("model").notNull(),
    provider: providerEnum("provider").notNull(),
    tokens_in: integer("tokens_in").notNull(),
    tokens_out: integer("tokens_out").notNull(),
    tokens_cached: integer("tokens_cached").notNull().default(0),
    tokens_cache_creation: integer("tokens_cache_creation").notNull().default(0),
    cost_usd: real("cost_usd").notNull(),
    source: text("source").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => ({
    envelopeTimeIdx: index("idx_charges_envelope_time").on(
      table.envelope_id,
      table.timestamp
    ),
    agentTimeIdx: index("idx_charges_agent_time").on(table.agent_id, table.timestamp),
  })
);

// replay_log — hash-chained, ed25519-signed audit log per session
// (@prune/replay-vault). Sequence is per-session monotonic. payload_canonical
// is the RFC 8785 JCS canonical form over which record_hash is computed.
export const replayLog = pgTable(
  "replay_log",
  {
    record_id: uuid("record_id").primaryKey().defaultRandom(),
    session_id: text("session_id").notNull(),
    sequence: integer("sequence").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    kind: text("kind").notNull(),
    payload_canonical: text("payload_canonical").notNull(),
    record_hash: text("record_hash").notNull(),
    prev_record_hash: text("prev_record_hash"),
    signature: text("signature").notNull(),
    signer_fingerprint: text("signer_fingerprint").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => ({
    sessionSeqIdx: index("idx_replay_session_seq").on(table.session_id, table.sequence),
  })
);

// slo_definitions — SRE Error Budget rows (@prune/slo). SLI is computed at
// read time from budget_charges, so adjusting targets doesn't rewrite history.
export const sloDefinitions = pgTable(
  "slo_definitions",
  {
    slo_id: uuid("slo_id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    scope_envelope_id: uuid("scope_envelope_id").notNull(),
    target_usd_per_task: real("target_usd_per_task").notNull(),
    error_budget_usd: real("error_budget_usd").notNull(),
    window_days: integer("window_days").notNull(),
    warning_pct: real("warning_pct").notNull().default(0.5),
    task_dimension: text("task_dimension").notNull().default("agent_id"),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => ({
    scopeIdx: index("idx_slo_scope").on(table.scope_envelope_id),
  })
);

export type BudgetEnvelope = typeof budgetEnvelopes.$inferSelect;
export type NewBudgetEnvelope = typeof budgetEnvelopes.$inferInsert;

export type BudgetCharge = typeof budgetCharges.$inferSelect;
export type NewBudgetCharge = typeof budgetCharges.$inferInsert;

export type ReplayLogRow = typeof replayLog.$inferSelect;
export type NewReplayLogRow = typeof replayLog.$inferInsert;

export type SloDefinition = typeof sloDefinitions.$inferSelect;
export type NewSloDefinition = typeof sloDefinitions.$inferInsert;

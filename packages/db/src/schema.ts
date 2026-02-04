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
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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

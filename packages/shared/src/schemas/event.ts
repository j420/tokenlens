import { z } from "zod";

// Provider enum
export const ProviderSchema = z.enum(["anthropic", "openai", "google"]);
export type Provider = z.infer<typeof ProviderSchema>;

// Tool detection enum
export const ToolTypeSchema = z.enum([
  "claude-code",
  "cursor",
  "codex",
  "direct-api",
  "unknown",
]);
export type ToolType = z.infer<typeof ToolTypeSchema>;

// Classification enum
export const ClassificationSchema = z.enum([
  "productive",
  "recursive",
  "unknown",
]);
export type Classification = z.infer<typeof ClassificationSchema>;

// Task type enum
export const TaskTypeSchema = z.enum([
  "refactor",
  "debug",
  "test",
  "feature",
  "unknown",
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

// Waste flag enum
export const WasteFlagSchema = z.enum([
  "circular_loop",
  "redundant_reads",
  "compaction_storm",
  "zero_acceptance",
  "mcp_bloat",
  "cost_anomaly",
]);
export type WasteFlag = z.infer<typeof WasteFlagSchema>;

// Task metadata schema
export const TaskMetadataSchema = z.object({
  type: TaskTypeSchema,
  repo: z.string().nullable(),
  branch: z.string().nullable(),
});
export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

// Canonical event schema - matches CLAUDE.md specification
export const CanonicalEventSchema = z.object({
  event_id: z.string().uuid(),
  session_id: z.string().uuid(),
  user_id: z.string().uuid(),
  team_id: z.string().uuid().nullable(),
  timestamp: z.string().datetime(),
  provider: ProviderSchema,
  tool: ToolTypeSchema,
  model: z.string(),
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  tokens_cached: z.number().int().nonnegative(),
  latency_ms: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative(),
  cumulative_session_cost_usd: z.number().nonnegative(),
  tool_calls: z.array(z.string()),
  files_referenced: z.array(z.string()),
  compaction_triggered: z.boolean(),
  context_size_before: z.number().int().nonnegative(),
  context_size_after: z.number().int().nonnegative(),
  waste_flags: z.array(WasteFlagSchema),
  classification: ClassificationSchema,
  roi_score: z.number().min(0).max(1),
  task_metadata: TaskMetadataSchema,
});
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

// Event creation input (fields we generate vs fields from the request)
export const CreateEventInputSchema = z.object({
  session_id: z.string().uuid(),
  user_id: z.string().uuid(),
  team_id: z.string().uuid().nullable(),
  provider: ProviderSchema,
  tool: ToolTypeSchema,
  model: z.string(),
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  tokens_cached: z.number().int().nonnegative().default(0),
  latency_ms: z.number().int().nonnegative(),
  tool_calls: z.array(z.string()).default([]),
  files_referenced: z.array(z.string()).default([]),
  context_size_before: z.number().int().nonnegative().default(0),
  context_size_after: z.number().int().nonnegative().default(0),
  task_metadata: TaskMetadataSchema.optional(),
});
export type CreateEventInput = z.infer<typeof CreateEventInputSchema>;

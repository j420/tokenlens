import { z } from "zod";
import { ProviderSchema, ToolTypeSchema } from "./event.js";

export const SessionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  team_id: z.string().uuid().nullable(),
  provider: ProviderSchema,
  tool: ToolTypeSchema,
  model: z.string(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable(),
  total_tokens_in: z.number().int().nonnegative(),
  total_tokens_out: z.number().int().nonnegative(),
  total_cost_usd: z.number().nonnegative(),
  event_count: z.number().int().nonnegative(),
  description: z.string().nullable(), // Natural language task description
});
export type Session = z.infer<typeof SessionSchema>;

export const CreateSessionInputSchema = z.object({
  user_id: z.string().uuid(),
  team_id: z.string().uuid().nullable().optional(),
  provider: ProviderSchema,
  tool: ToolTypeSchema,
  model: z.string(),
});
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

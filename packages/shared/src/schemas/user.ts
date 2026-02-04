import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  team_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserInputSchema = z.object({
  email: z.string().email(),
  name: z.string().nullable().optional(),
  team_id: z.string().uuid().nullable().optional(),
});
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

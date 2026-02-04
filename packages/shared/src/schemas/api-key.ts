import { z } from "zod";

export const ApiKeySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  key_hash: z.string(), // We store hashed keys
  key_prefix: z.string(), // First 8 chars for identification (prune_sk_)
  name: z.string(),
  last_used_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  revoked_at: z.string().datetime().nullable(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const CreateApiKeyInputSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string().default("Default"),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

// The key format: prune_sk_<random>
export const API_KEY_PREFIX = "prune_sk_";

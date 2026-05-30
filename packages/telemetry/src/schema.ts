/**
 * Zod schemas for Claude Code session transcripts.
 *
 * Source of truth: the Anthropic Messages API `usage` shape plus what the
 * Claude Code transcript JSONL records per line. Until the exact JSONL layout
 * is calibrated against a real captured session, all unknown fields are
 * passed through and most structural fields are optional. The reader fails
 * loudly only on hard contradictions (wrong primitive types).
 */

import { z } from "zod";

export const UsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().default(0),
    output_tokens: z.number().int().nonnegative().default(0),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    service_tier: z.string().optional(),
  })
  .passthrough();
export type Usage = z.infer<typeof UsageSchema>;

export const TextBlockSchema = z
  .object({ type: z.literal("text"), text: z.string() })
  .passthrough();
export const ToolUseBlockSchema = z
  .object({
    type: z.literal("tool_use"),
    id: z.string().optional(),
    name: z.string(),
    input: z.unknown(),
  })
  .passthrough();
export const ToolResultBlockSchema = z
  .object({
    type: z.literal("tool_result"),
    tool_use_id: z.string().optional(),
    content: z.unknown(),
    is_error: z.boolean().optional(),
  })
  .passthrough();
export const ThinkingBlockSchema = z
  .object({ type: z.literal("thinking"), thinking: z.string().optional() })
  .passthrough();

export const ContentBlockSchema = z.union([
  TextBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
  ThinkingBlockSchema,
  z.object({ type: z.string() }).passthrough(),
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const RoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type Role = z.infer<typeof RoleSchema>;

export const TranscriptMessageSchema = z
  .object({
    role: RoleSchema.optional(),
    // Claude Code wraps Anthropic messages; field names vary, so accept
    // multiple shapes: either a flat `role+content` or a nested
    // `message: { role, content, usage, model, stop_reason }`.
    message: z
      .object({
        role: RoleSchema.optional(),
        content: z
          .union([z.string(), z.array(ContentBlockSchema)])
          .optional(),
        usage: UsageSchema.optional(),
        model: z.string().optional(),
        stop_reason: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    content: z
      .union([z.string(), z.array(ContentBlockSchema)])
      .optional(),
    usage: UsageSchema.optional(),
    model: z.string().optional(),
    stop_reason: z.string().nullable().optional(),
    type: z.string().optional(),
    timestamp: z.string().optional(),
    uuid: z.string().optional(),
    parentUuid: z.string().nullable().optional(),
    sessionId: z.string().optional(),
  })
  .passthrough();
export type TranscriptMessage = z.infer<typeof TranscriptMessageSchema>;

/**
 * Flatten a Claude Code transcript message into a normalized inner shape,
 * regardless of whether the API fields live at the top level or under
 * `message.*`.
 */
export interface FlatMessage {
  role: Role;
  content: string | ContentBlock[];
  usage?: Usage;
  model?: string;
  stop_reason?: string | null;
  timestamp?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
}

export function flattenMessage(m: TranscriptMessage): FlatMessage | null {
  const inner = m.message ?? {};
  const role = (inner.role ?? m.role) as Role | undefined;
  const content = inner.content ?? m.content;
  if (!role || content === undefined) return null;
  return {
    role,
    content,
    usage: inner.usage ?? m.usage,
    model: inner.model ?? m.model,
    stop_reason: inner.stop_reason ?? m.stop_reason ?? null,
    timestamp: m.timestamp,
    uuid: m.uuid,
    parentUuid: m.parentUuid ?? null,
    sessionId: m.sessionId,
  };
}

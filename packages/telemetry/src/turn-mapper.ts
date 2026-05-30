/**
 * Group transcript messages into turns and project them onto the analysis
 * shapes used by intelligence (TurnData) and compaction-auditor
 * (MessageSummary-shaped).
 */

import type { FlatMessage, ContentBlock, Usage } from "./schema.js";

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface NormalizedTurn {
  turnNumber: number;
  sessionId?: string;
  userMessage?: FlatMessage;
  assistantMessages: FlatMessage[];
  toolUses: Array<{ name: string; input: unknown; id?: string }>;
  toolResults: Array<{
    tool_use_id?: string;
    content: unknown;
    is_error?: boolean;
  }>;
  usage: UsageTotals;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  textContent: string;
}

function blocksOf(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content;
}

function extractTextFromBlocks(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "thinking" && typeof b.thinking === "string")
      parts.push(b.thinking);
  }
  return parts.join("\n");
}

function addUsage(acc: UsageTotals, u?: Usage): void {
  if (!u) return;
  acc.input += u.input_tokens ?? 0;
  acc.output += u.output_tokens ?? 0;
  acc.cacheRead += u.cache_read_input_tokens ?? 0;
  acc.cacheCreate += u.cache_creation_input_tokens ?? 0;
}

/**
 * Group a flat stream of messages into turns. A turn starts at each user
 * message and includes the assistant messages (and tool uses/results) that
 * follow, up to (but not including) the next user message.
 */
export function groupIntoTurns(messages: FlatMessage[]): NormalizedTurn[] {
  const turns: NormalizedTurn[] = [];
  let current: NormalizedTurn | null = null;
  let turnNumber = 0;

  const startTurn = (m?: FlatMessage): NormalizedTurn => ({
    turnNumber: ++turnNumber,
    sessionId: m?.sessionId,
    userMessage: m,
    assistantMessages: [],
    toolUses: [],
    toolResults: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    model: m?.model,
    startedAt: m?.timestamp,
    endedAt: m?.timestamp,
    textContent: "",
  });

  for (const m of messages) {
    if (m.role === "user") {
      if (current) turns.push(current);
      current = startTurn(m);
      const blocks = blocksOf(m.content);
      // user message often carries tool_result blocks from a prior assistant
      // tool call — capture them so we can attribute tool outcomes.
      for (const b of blocks) {
        if (b.type === "tool_result") {
          current.toolResults.push({
            tool_use_id:
              typeof (b as { tool_use_id?: unknown }).tool_use_id === "string"
                ? ((b as { tool_use_id?: string }).tool_use_id ?? undefined)
                : undefined,
            content: (b as { content?: unknown }).content,
            is_error: (b as { is_error?: boolean }).is_error,
          });
        }
      }
      addUsage(current.usage, m.usage);
      current.textContent += extractTextFromBlocks(blocks);
    } else if (m.role === "assistant") {
      if (!current) current = startTurn(undefined);
      current.assistantMessages.push(m);
      if (m.model) current.model = m.model;
      addUsage(current.usage, m.usage);
      const blocks = blocksOf(m.content);
      current.textContent += extractTextFromBlocks(blocks);
      for (const b of blocks) {
        if (b.type === "tool_use") {
          current.toolUses.push({
            name: (b as { name?: string }).name ?? "unknown",
            input: (b as { input?: unknown }).input,
            id: (b as { id?: string }).id,
          });
        }
      }
      if (m.timestamp) current.endedAt = m.timestamp;
    }
  }
  if (current) turns.push(current);
  return turns;
}

/**
 * Project a normalized turn onto the TurnData shape consumed by
 * intelligence/roi-classifier. The caller supplies filesWritten,
 * testsPassed, etc. when these are derived from external signals
 * (extension events, hook context); we infer best-effort defaults from
 * tool uses when no overrides are provided.
 */
export interface TurnDataLike {
  turnNumber: number;
  responseContent: string;
  filesWritten: string[];
  filesRead: string[];
  testsPassed: boolean | null;
  errorsPresent: string[];
  tokensIn: number;
  tokensOut: number;
  timestamp: Date;
}

const WRITE_TOOL_NAMES = new Set([
  "Edit",
  "Write",
  "NotebookEdit",
  "MultiEdit",
]);
const READ_TOOL_NAMES = new Set(["Read", "NotebookRead"]);

function pickPath(input: unknown): string | null {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (typeof o.file_path === "string") return o.file_path;
    if (typeof o.path === "string") return o.path;
    if (typeof o.notebook_path === "string") return o.notebook_path;
  }
  return null;
}

export function toTurnDataLike(
  turn: NormalizedTurn,
  overrides: Partial<
    Pick<TurnDataLike, "filesWritten" | "filesRead" | "testsPassed">
  > = {}
): TurnDataLike {
  const filesWritten = new Set<string>(overrides.filesWritten ?? []);
  const filesRead = new Set<string>(overrides.filesRead ?? []);
  for (const t of turn.toolUses) {
    if (WRITE_TOOL_NAMES.has(t.name)) {
      const p = pickPath(t.input);
      if (p) filesWritten.add(p);
    } else if (READ_TOOL_NAMES.has(t.name)) {
      const p = pickPath(t.input);
      if (p) filesRead.add(p);
    }
  }
  const tokensIn =
    turn.usage.input + turn.usage.cacheRead + turn.usage.cacheCreate;
  const tokensOut = turn.usage.output;
  const ts = turn.endedAt ?? turn.startedAt;
  return {
    turnNumber: turn.turnNumber,
    responseContent: turn.textContent,
    filesWritten: [...filesWritten],
    filesRead: [...filesRead],
    testsPassed: overrides.testsPassed ?? null,
    errorsPresent: [],
    tokensIn,
    tokensOut,
    timestamp: ts ? new Date(ts) : new Date(),
  };
}

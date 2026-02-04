/**
 * Compaction Quality Auditor
 *
 * Tracks context across a session and when compaction is detected:
 * - Compares entities before vs after compaction
 * - Identifies lost references (file names, function names, config values, etc.)
 * - Translates into plain English for developer notifications
 */

import { estimateTokenCount } from "./tokenizer.js";

// Categories of entities we track
export type EntityCategory =
  | "file_name"
  | "function_name"
  | "variable_name"
  | "api_endpoint"
  | "configuration"
  | "architectural_decision"
  | "test_requirement"
  | "type_definition"
  | "constant";

export interface TrackedEntity {
  value: string;
  category: EntityCategory;
  turnNumber: number;
  context: string; // Surrounding context for human-readable description
  timestamp: Date;
}

export interface MessageSummary {
  turnNumber: number;
  role: "user" | "assistant" | "system";
  content: string;
  entities: TrackedEntity[];
  tokenCount: number;
  timestamp: Date;
}

export interface LostReference {
  item: string; // Human-readable description
  original_turn: number;
  category: EntityCategory;
  rawValue: string;
}

export interface CompactionDiff {
  turnNumber: number;
  tokensBefore: number;
  tokensAfter: number;
  tokensRemoved: number;
  overheadCostUsd: number;
  lostReferences: LostReference[];
  summary: string;
  timestamp: Date;
}

/**
 * In-memory message buffer for a session
 * In production, this would be persisted to Redis for horizontal scaling
 */
export class MessageBuffer {
  private messages: MessageSummary[] = [];
  private maxMessages: number;

  constructor(maxMessages = 100) {
    this.maxMessages = maxMessages;
  }

  /**
   * Add a message to the buffer
   */
  addMessage(summary: MessageSummary): void {
    this.messages.push(summary);

    // Keep only the most recent messages
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }
  }

  /**
   * Get all messages in the buffer
   */
  getMessages(): MessageSummary[] {
    return [...this.messages];
  }

  /**
   * Get all entities across all messages
   */
  getAllEntities(): TrackedEntity[] {
    return this.messages.flatMap((m) => m.entities);
  }

  /**
   * Get total token count
   */
  getTotalTokens(): number {
    return this.messages.reduce((sum, m) => sum + m.tokenCount, 0);
  }

  /**
   * Clear the buffer (after compaction)
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Get the latest turn number
   */
  getLatestTurnNumber(): number {
    return this.messages.length > 0
      ? Math.max(...this.messages.map((m) => m.turnNumber))
      : 0;
  }
}

// Regex patterns for entity extraction
const ENTITY_PATTERNS: Array<{
  category: EntityCategory;
  patterns: RegExp[];
}> = [
  {
    category: "file_name",
    patterns: [
      /(?:file|path|in|from|to)\s+[`"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,6})[`"]?/gi,
      /([a-zA-Z0-9_\-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|css|scss|html|json|yaml|yml|toml|md))/g,
      /src\/[a-zA-Z0-9_\-./]+/g,
      /packages\/[a-zA-Z0-9_\-./]+/g,
    ],
  },
  {
    category: "function_name",
    patterns: [
      /function\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      /(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:async\s*)?\(/g,
      /(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*(?:=>|{)/g,
      /def\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      /fn\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    ],
  },
  {
    category: "api_endpoint",
    patterns: [
      /(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+([/a-zA-Z0-9_\-:{}]+)/gi,
      /["'`](\/api\/[a-zA-Z0-9_\-/{}:]+)["'`]/g,
      /["'`](\/v[0-9]+\/[a-zA-Z0-9_\-/{}:]+)["'`]/g,
      /endpoint[:\s]+["'`]?([/a-zA-Z0-9_\-:{}]+)["'`]?/gi,
    ],
  },
  {
    category: "configuration",
    patterns: [
      /(?:set|config|setting|option|parameter|value)[:\s]+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|:)\s*["'`]?([^"'`\n]+)["'`]?/gi,
      /timeout[:\s]*([0-9]+\s*(?:ms|s|min|minute|hour)?)/gi,
      /expir(?:y|es?|ation)[:\s]*([0-9]+\s*(?:ms|s|min|minute|hour)?)/gi,
      /port[:\s]*([0-9]+)/gi,
      /limit[:\s]*([0-9]+)/gi,
    ],
  },
  {
    category: "architectural_decision",
    patterns: [
      /(?:must|should|need to|have to|required to)\s+([^.!?\n]{10,100})/gi,
      /(?:pattern|approach|strategy|architecture)[:\s]+([^.!?\n]{10,100})/gi,
      /(?:before|after|chain|order)[:\s]+([^.!?\n]{10,100})/gi,
      /implement(?:s|ed|ation)?[:\s]+([^.!?\n]{10,100})/gi,
    ],
  },
  {
    category: "variable_name",
    patterns: [
      /(?:const|let|var|val)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      /(?:type|interface|class|struct|enum)\s+([A-Z][a-zA-Z0-9_]*)/g,
    ],
  },
  {
    category: "type_definition",
    patterns: [
      /(?:type|interface)\s+([A-Z][a-zA-Z0-9_]*)/g,
      /class\s+([A-Z][a-zA-Z0-9_]*)/g,
      /struct\s+([A-Z][a-zA-Z0-9_]*)/g,
    ],
  },
  {
    category: "test_requirement",
    patterns: [
      /test[:\s]+["'`]?([^"'`\n]{10,100})["'`]?/gi,
      /(?:should|must)\s+(?:test|verify|check|ensure)\s+([^.!?\n]{10,100})/gi,
      /assertion[:\s]+([^.!?\n]{10,100})/gi,
    ],
  },
];

/**
 * Extract entities from text content
 */
export function extractEntities(
  content: string,
  turnNumber: number,
  timestamp: Date
): TrackedEntity[] {
  const entities: TrackedEntity[] = [];
  const seen = new Set<string>();

  for (const { category, patterns } of ENTITY_PATTERNS) {
    for (const pattern of patterns) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        const value = match[1] || match[0];
        const cleanValue = value.trim();

        // Skip if we've seen this exact value
        const key = `${category}:${cleanValue.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Skip common keywords and short values
        if (isCommonKeyword(cleanValue) || cleanValue.length < 3) continue;

        // Get surrounding context (50 chars before and after)
        const start = Math.max(0, match.index - 50);
        const end = Math.min(content.length, match.index + match[0].length + 50);
        const context = content.slice(start, end).replace(/\n/g, " ").trim();

        entities.push({
          value: cleanValue,
          category,
          turnNumber,
          context,
          timestamp,
        });
      }
    }
  }

  return entities;
}

const COMMON_KEYWORDS = new Set([
  "function",
  "const",
  "let",
  "var",
  "return",
  "if",
  "else",
  "for",
  "while",
  "class",
  "interface",
  "type",
  "export",
  "import",
  "from",
  "async",
  "await",
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "new",
  "try",
  "catch",
  "throw",
  "public",
  "private",
  "protected",
  "static",
  "readonly",
]);

function isCommonKeyword(value: string): boolean {
  return COMMON_KEYWORDS.has(value.toLowerCase());
}

/**
 * Create a message summary from content
 */
export function createMessageSummary(
  content: string,
  turnNumber: number,
  role: "user" | "assistant" | "system",
  timestamp = new Date()
): MessageSummary {
  const entities = extractEntities(content, turnNumber, timestamp);
  const tokenCount = estimateTokenCount(content, role === "assistant");

  return {
    turnNumber,
    role,
    content,
    entities,
    tokenCount,
    timestamp,
  };
}

/**
 * Generate human-readable description for a lost entity
 */
function describeEntity(entity: TrackedEntity): string {
  switch (entity.category) {
    case "file_name":
      return `File reference: ${entity.value}`;
    case "function_name":
      return `Function: ${entity.value}()`;
    case "api_endpoint":
      return `API endpoint: ${entity.value}`;
    case "configuration":
      return `Configuration: ${entity.value}`;
    case "architectural_decision":
      return entity.value.charAt(0).toUpperCase() + entity.value.slice(1);
    case "variable_name":
      return `Variable: ${entity.value}`;
    case "type_definition":
      return `Type: ${entity.value}`;
    case "test_requirement":
      return `Test requirement: ${entity.value}`;
    case "constant":
      return `Constant: ${entity.value}`;
    default:
      return entity.value;
  }
}

/**
 * Detect compaction and analyze what was lost
 */
export function analyzeCompaction(
  preCompactionBuffer: MessageBuffer,
  postCompactionContent: string,
  turnNumber: number,
  costPerMillion = 3 // $3 per 1M input tokens
): CompactionDiff {
  const preEntities = preCompactionBuffer.getAllEntities();
  const tokensBefore = preCompactionBuffer.getTotalTokens();
  const tokensAfter = estimateTokenCount(postCompactionContent, false);
  const tokensRemoved = Math.max(0, tokensBefore - tokensAfter);

  // Extract entities from post-compaction content
  const postEntities = extractEntities(postCompactionContent, turnNumber, new Date());
  const postEntityValues = new Set(
    postEntities.map((e) => `${e.category}:${e.value.toLowerCase()}`)
  );

  // Find entities that were present before but not after
  const lostReferences: LostReference[] = [];
  const seenLost = new Set<string>();

  for (const entity of preEntities) {
    const key = `${entity.category}:${entity.value.toLowerCase()}`;

    // Skip if already tracked as lost or still present
    if (seenLost.has(key) || postEntityValues.has(key)) continue;
    seenLost.add(key);

    lostReferences.push({
      item: describeEntity(entity),
      original_turn: entity.turnNumber,
      category: entity.category,
      rawValue: entity.value,
    });
  }

  // Sort by turn number and limit to most important
  lostReferences.sort((a, b) => b.original_turn - a.original_turn);
  const topLostReferences = lostReferences.slice(0, 10); // Top 10 most recent

  // Calculate overhead cost
  const overheadCostUsd = (tokensRemoved / 1_000_000) * costPerMillion;

  // Generate summary
  const categoryCounts = new Map<EntityCategory, number>();
  for (const ref of topLostReferences) {
    categoryCounts.set(ref.category, (categoryCounts.get(ref.category) || 0) + 1);
  }

  const summaryParts: string[] = [];
  if (categoryCounts.size > 0) {
    const parts: string[] = [];
    if (categoryCounts.get("architectural_decision"))
      parts.push(
        `${categoryCounts.get("architectural_decision")} architectural decisions`
      );
    if (categoryCounts.get("configuration"))
      parts.push(`${categoryCounts.get("configuration")} configuration values`);
    if (categoryCounts.get("api_endpoint"))
      parts.push(`${categoryCounts.get("api_endpoint")} API signatures`);
    if (categoryCounts.get("file_name"))
      parts.push(`${categoryCounts.get("file_name")} file references`);
    if (categoryCounts.get("function_name"))
      parts.push(`${categoryCounts.get("function_name")} function references`);
    if (categoryCounts.get("test_requirement"))
      parts.push(`${categoryCounts.get("test_requirement")} test requirements`);

    summaryParts.push(`${topLostReferences.length} references lost`);
    if (parts.length > 0) {
      summaryParts.push(parts.join(", "));
    }
  } else {
    summaryParts.push("No significant references lost");
  }

  return {
    turnNumber,
    tokensBefore,
    tokensAfter,
    tokensRemoved,
    overheadCostUsd,
    lostReferences: topLostReferences,
    summary: summaryParts.join(": "),
    timestamp: new Date(),
  };
}

/**
 * Check if compaction occurred (significant context reduction)
 */
export function detectCompaction(
  contextSizeBefore: number,
  contextSizeAfter: number,
  threshold = 0.5 // 50% reduction threshold
): boolean {
  if (contextSizeBefore <= 0) return false;

  const reduction = (contextSizeBefore - contextSizeAfter) / contextSizeBefore;
  return reduction >= threshold;
}

/**
 * Session message buffer manager (singleton per session)
 */
const sessionBuffers = new Map<string, MessageBuffer>();

export function getSessionBuffer(sessionId: string): MessageBuffer {
  let buffer = sessionBuffers.get(sessionId);
  if (!buffer) {
    buffer = new MessageBuffer();
    sessionBuffers.set(sessionId, buffer);
  }
  return buffer;
}

export function clearSessionBuffer(sessionId: string): void {
  sessionBuffers.delete(sessionId);
}

export function getSessionBufferSize(): number {
  return sessionBuffers.size;
}

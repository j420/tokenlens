import { EventEmitter } from "events";
import { logger } from "../lib/logger.js";

// Event types matching CLAUDE.md spec
export interface TokenUpdateEvent {
  type: "token_update";
  event_id: string;
  session_id: string;
  timestamp: string;
  cumulative_session_cost_usd: number;
  cumulative_session_tokens: number;
  turn_cost: number;
  turn_tokens: number;
  roi_score: number | null;
  model: string;
  provider: string;
}

export interface BurnAlertEvent {
  type: "burn_alert";
  alert_id: string;
  session_id: string;
  pattern: string;
  severity: "warning" | "info";
  tokens_wasted: number;
  cost_wasted_usd: number;
  file_involved: string | null;
  occurrences: number;
  message_title: string;
  message_body: string;
  suggestions: Array<{ label: string; action: string; detail: string }>;
  cooldown_seconds: number;
}

export interface CompactionEvent {
  type: "compaction_event";
  session_id: string;
  turn_number: number;
  tokens_before: number;
  tokens_after: number;
  tokens_removed: number;
  overhead_cost_usd: number;
  lost_references: Array<{
    item: string;
    original_turn: number;
    category: string;
  }>;
  lost_reference_count: number;
  summary: string;
}

export interface PruneSuggestionEvent {
  type: "prune_suggestion";
  request_id: string;
  total_tokens: number;
  relevant_tokens: number;
  relevant_ranges: Array<{ file: string; start_line: number; end_line: number }>;
  irrelevant_summary: string;
  estimated_savings_usd: number;
  confidence: number;
  auto_dismiss_seconds: number;
}

export type StreamEvent =
  | TokenUpdateEvent
  | BurnAlertEvent
  | CompactionEvent
  | PruneSuggestionEvent;

// In-memory pub/sub for WebSocket connections
// In production, this would use Redis pub/sub for horizontal scaling
class StreamPublisher extends EventEmitter {
  private static instance: StreamPublisher;

  private constructor() {
    super();
    this.setMaxListeners(1000); // Allow many WebSocket connections
  }

  static getInstance(): StreamPublisher {
    if (!StreamPublisher.instance) {
      StreamPublisher.instance = new StreamPublisher();
    }
    return StreamPublisher.instance;
  }

  /**
   * Publish an event to all subscribers of a session
   */
  publish(sessionId: string, event: StreamEvent): void {
    try {
      this.emit(`session:${sessionId}`, event);
      logger.debug({ sessionId, eventType: event.type }, "Published stream event");
    } catch (err) {
      logger.error({ err, sessionId, event }, "Failed to publish stream event");
    }
  }

  /**
   * Subscribe to events for a session
   */
  subscribe(sessionId: string, callback: (event: StreamEvent) => void): () => void {
    const channel = `session:${sessionId}`;
    this.on(channel, callback);
    logger.debug({ sessionId }, "Client subscribed to stream");

    // Return unsubscribe function
    return () => {
      this.off(channel, callback);
      logger.debug({ sessionId }, "Client unsubscribed from stream");
    };
  }

  /**
   * Get the number of subscribers for a session
   */
  getSubscriberCount(sessionId: string): number {
    return this.listenerCount(`session:${sessionId}`);
  }
}

export const streamPublisher = StreamPublisher.getInstance();

/**
 * Publish a token update event when a new event is captured
 */
export function publishTokenUpdate(params: {
  eventId: string;
  sessionId: string;
  cumulativeSessionCostUsd: number;
  cumulativeSessionTokens: number;
  turnCost: number;
  turnTokens: number;
  roiScore: number | null;
  model: string;
  provider: string;
}): void {
  const event: TokenUpdateEvent = {
    type: "token_update",
    event_id: params.eventId,
    session_id: params.sessionId,
    timestamp: new Date().toISOString(),
    cumulative_session_cost_usd: params.cumulativeSessionCostUsd,
    cumulative_session_tokens: params.cumulativeSessionTokens,
    turn_cost: params.turnCost,
    turn_tokens: params.turnTokens,
    roi_score: params.roiScore,
    model: params.model,
    provider: params.provider,
  };

  streamPublisher.publish(params.sessionId, event);
}

/**
 * Publish a burn alert event when waste is detected
 */
export function publishBurnAlert(params: {
  alertId: string;
  sessionId: string;
  pattern: string;
  severity: "warning" | "info";
  tokensWasted: number;
  costWastedUsd: number;
  fileInvolved: string | null;
  occurrences: number;
  messageTitle: string;
  messageBody: string;
  suggestions: Array<{ label: string; action: string; detail: string }>;
  cooldownSeconds: number;
}): void {
  const event: BurnAlertEvent = {
    type: "burn_alert",
    alert_id: params.alertId,
    session_id: params.sessionId,
    pattern: params.pattern,
    severity: params.severity,
    tokens_wasted: params.tokensWasted,
    cost_wasted_usd: params.costWastedUsd,
    file_involved: params.fileInvolved,
    occurrences: params.occurrences,
    message_title: params.messageTitle,
    message_body: params.messageBody,
    suggestions: params.suggestions,
    cooldown_seconds: params.cooldownSeconds,
  };

  streamPublisher.publish(params.sessionId, event);
}

/**
 * Publish a compaction event when context is compacted
 */
export function publishCompactionEvent(params: {
  sessionId: string;
  turnNumber: number;
  tokensBefore: number;
  tokensAfter: number;
  tokensRemoved: number;
  overheadCostUsd: number;
  lostReferences: Array<{ item: string; original_turn: number; category: string }>;
  summary: string;
}): void {
  const event: CompactionEvent = {
    type: "compaction_event",
    session_id: params.sessionId,
    turn_number: params.turnNumber,
    tokens_before: params.tokensBefore,
    tokens_after: params.tokensAfter,
    tokens_removed: params.tokensRemoved,
    overhead_cost_usd: params.overheadCostUsd,
    lost_references: params.lostReferences,
    lost_reference_count: params.lostReferences.length,
    summary: params.summary,
  };

  streamPublisher.publish(params.sessionId, event);
}

/**
 * Publish a prune suggestion event when context could be optimized
 */
export function publishPruneSuggestion(sessionId: string, suggestion: PruneSuggestionEvent): void {
  streamPublisher.publish(sessionId, suggestion);
}

import { describe, it, expect, beforeEach } from "vitest";
import { streamPublisher, publishTokenUpdate } from "../src/stream/publisher.js";

describe("Stream Publisher", () => {
  it("should publish token updates to subscribers", () => {
    const receivedEvents: any[] = [];
    const unsubscribe = streamPublisher.subscribe("test-session-pub", (event) => {
      receivedEvents.push(event);
    });

    publishTokenUpdate({
      eventId: "event-1",
      sessionId: "test-session-pub",
      cumulativeSessionCostUsd: 1.5,
      cumulativeSessionTokens: 15000,
      turnCost: 0.5,
      turnTokens: 5000,
      roiScore: null,
      model: "claude-3-sonnet",
      provider: "anthropic",
    });

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].type).toBe("token_update");
    expect(receivedEvents[0].cumulative_session_cost_usd).toBe(1.5);

    unsubscribe();
  });

  it("should not receive events after unsubscribe", () => {
    const receivedEvents: any[] = [];
    const unsubscribe = streamPublisher.subscribe("test-session-unsub", (event) => {
      receivedEvents.push(event);
    });

    // Unsubscribe immediately
    unsubscribe();

    publishTokenUpdate({
      eventId: "event-2",
      sessionId: "test-session-unsub",
      cumulativeSessionCostUsd: 1.5,
      cumulativeSessionTokens: 15000,
      turnCost: 0.5,
      turnTokens: 5000,
      roiScore: null,
      model: "claude-3-sonnet",
      provider: "anthropic",
    });

    expect(receivedEvents.length).toBe(0);
  });

  it("should support multiple subscribers to the same session", () => {
    const received1: any[] = [];
    const received2: any[] = [];

    const unsub1 = streamPublisher.subscribe("test-session-multi", (event) => {
      received1.push(event);
    });
    const unsub2 = streamPublisher.subscribe("test-session-multi", (event) => {
      received2.push(event);
    });

    publishTokenUpdate({
      eventId: "event-3",
      sessionId: "test-session-multi",
      cumulativeSessionCostUsd: 2.0,
      cumulativeSessionTokens: 20000,
      turnCost: 0.5,
      turnTokens: 5000,
      roiScore: null,
      model: "claude-3-sonnet",
      provider: "anthropic",
    });

    expect(received1.length).toBe(1);
    expect(received2.length).toBe(1);

    unsub1();
    unsub2();
  });
});

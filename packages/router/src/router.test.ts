import { describe, it, expect } from "vitest";

import { classifyRequest } from "./classifier.js";
import { route, DEFAULT_TIER_MAP } from "./policy.js";
import { RoutingLedger } from "./ledger.js";

// ============================================================================
// Classifier
// ============================================================================

describe("classifyRequest — intent", () => {
  it("explicit debug keyword → debug intent", () => {
    const c = classifyRequest({
      prompt: "Fix the bug where login fails",
      estimatedTokensIn: 1000,
    });
    expect(c.intent).toBe("debug");
    expect(c.signals.some((s) => s.kind === "intent:debug")).toBe(true);
  });

  it("recentError flag forces debug intent even without keywords", () => {
    const c = classifyRequest({
      prompt: "see what's wrong here",
      estimatedTokensIn: 1000,
      recentError: true,
    });
    expect(c.intent).toBe("debug");
    expect(c.signals[0].kind).toBe("intent:recent_error");
  });

  it("test keyword → test intent", () => {
    const c = classifyRequest({
      prompt: "Add unit tests for AuthService",
      estimatedTokensIn: 1000,
    });
    expect(c.intent).toBe("test");
  });

  it("explain keyword → explain intent", () => {
    const c = classifyRequest({
      prompt: "explain how the rate limiter works",
      estimatedTokensIn: 1000,
    });
    expect(c.intent).toBe("explain");
  });

  it("no keyword → defaults to generate", () => {
    const c = classifyRequest({
      prompt: "make it do the thing",
      estimatedTokensIn: 500,
    });
    expect(c.intent).toBe("generate");
    expect(c.signals[0].kind).toBe("intent:default_generate");
  });
});

describe("classifyRequest — difficulty", () => {
  it("small prompt with trivial verb → trivial", () => {
    const c = classifyRequest({
      prompt: "rename variable foo to bar",
      estimatedTokensIn: 200,
    });
    expect(c.difficulty).toBe("trivial");
  });

  it("hard-signal token → hard", () => {
    const c = classifyRequest({
      prompt: "find the race condition in scheduler.ts",
      estimatedTokensIn: 5000,
    });
    expect(c.difficulty).toBe("hard");
    expect(c.signals.find((s) => s.kind === "difficulty:hard")).toBeDefined();
  });

  it("debug intent escalates difficulty to hard", () => {
    const c = classifyRequest({
      prompt: "Fix the bug",
      estimatedTokensIn: 800,
    });
    expect(c.difficulty).toBe("hard");
  });

  it("many files in context → hard", () => {
    const c = classifyRequest({
      prompt: "do something",
      estimatedTokensIn: 5000,
      filesInContext: 10,
    });
    expect(c.difficulty).toBe("hard");
  });

  it("very large input → hard", () => {
    const c = classifyRequest({
      prompt: "do something",
      estimatedTokensIn: 30_000,
    });
    expect(c.difficulty).toBe("hard");
  });

  it("none of the above → standard", () => {
    const c = classifyRequest({
      prompt: "implement a helper for date formatting",
      estimatedTokensIn: 2000,
    });
    expect(c.difficulty).toBe("standard");
  });
});

// ============================================================================
// Policy
// ============================================================================

describe("route — three-tier policy", () => {
  it("rule 1: trivial → FAST (Haiku)", () => {
    const c = classifyRequest({
      prompt: "rename foo to bar",
      estimatedTokensIn: 200,
    });
    const d = route(c);
    expect(d.tier).toBe("FAST");
    expect(d.model).toBe(DEFAULT_TIER_MAP.FAST);
    expect(d.rule).toBe("rule:1_trivial_or_triage");
  });

  it("rule 1: retrieve intent → FAST regardless of size", () => {
    const c = classifyRequest({
      prompt: "find all references to AuthService",
      estimatedTokensIn: 10_000,
    });
    const d = route(c);
    expect(d.tier).toBe("FAST");
  });

  it("rule 2: debug intent → STRONG (Opus)", () => {
    const c = classifyRequest({
      prompt: "Debug why login fails — stack trace in the logs",
      estimatedTokensIn: 1500,
    });
    expect(c.intent).toBe("debug");
    const d = route(c);
    expect(d.tier).toBe("STRONG");
    expect(d.rule).toBe("rule:2_debug_escalates");
  });

  it("rule 3: hard difficulty → STRONG", () => {
    const c = classifyRequest({
      prompt: "refactor the entire module to use streams",
      estimatedTokensIn: 8000,
    });
    const d = route(c);
    expect(d.tier).toBe("STRONG");
    expect(d.rule).toBe("rule:3_hard_difficulty");
  });

  it("rule 4: standard intent + standard difficulty → STD (Sonnet)", () => {
    const c = classifyRequest({
      prompt: "implement a debounce utility",
      estimatedTokensIn: 2000,
    });
    const d = route(c);
    expect(d.tier).toBe("STD");
    expect(d.rule).toBe("rule:4_workhorse_default");
  });

  it("floor option enforces a minimum tier", () => {
    const c = classifyRequest({
      prompt: "rename foo to bar",
      estimatedTokensIn: 200,
    });
    const d = route(c, { floor: "STD" });
    expect(d.tier).toBe("STD"); // FAST would be picked, but floor lifts it
  });

  it("tierMap override changes model ids without changing rules", () => {
    const c = classifyRequest({
      prompt: "implement a helper",
      estimatedTokensIn: 2000,
    });
    const d = route(c, { tierMap: { STD: "custom-std" } });
    expect(d.tier).toBe("STD");
    expect(d.model).toBe("custom-std");
  });
});

// ============================================================================
// Ledger — Skywork-style reproducibility ledger
// ============================================================================

describe("RoutingLedger — actual-vs-baseline savings", () => {
  it("Haiku call vs Opus baseline shows positive savings", () => {
    const ledger = new RoutingLedger("claude-opus-4");
    ledger.record({
      model: "claude-haiku-4-5",
      tokensIn: 1_000_000,
      tokensOut: 100_000,
    });
    const s = ledger.summary();
    expect(s.totalActualUsd).toBeGreaterThan(0);
    expect(s.totalBaselineUsd).toBeGreaterThan(s.totalActualUsd);
    expect(s.totalSavedUsd).toBeGreaterThan(0);
    expect(s.averageSavedFraction).toBeGreaterThan(0.5);
  });

  it("Opus call vs Opus baseline shows zero savings", () => {
    const ledger = new RoutingLedger("claude-opus-4");
    ledger.record({
      model: "claude-opus-4",
      tokensIn: 100_000,
      tokensOut: 10_000,
    });
    const s = ledger.summary();
    expect(s.totalSavedUsd).toBe(0);
    expect(s.averageSavedFraction).toBe(0);
  });

  it("aggregates across multiple calls", () => {
    const ledger = new RoutingLedger("claude-opus-4");
    ledger.record({ model: "claude-haiku-4-5", tokensIn: 50_000, tokensOut: 5_000 });
    ledger.record({ model: "claude-sonnet-4-5", tokensIn: 50_000, tokensOut: 5_000 });
    ledger.record({ model: "claude-opus-4", tokensIn: 10_000, tokensOut: 1_000 });
    const s = ledger.summary();
    expect(s.callCount).toBe(3);
    expect(s.totalSavedUsd).toBeGreaterThan(0);
  });

  it("history preserves insertion order", () => {
    const ledger = new RoutingLedger("claude-opus-4");
    ledger.record({ model: "claude-haiku-4-5", tokensIn: 100, tokensOut: 50 });
    ledger.record({ model: "claude-sonnet-4-5", tokensIn: 100, tokensOut: 50 });
    const hist = ledger.history();
    expect(hist[0].call.model).toBe("claude-haiku-4-5");
    expect(hist[1].call.model).toBe("claude-sonnet-4-5");
  });
});

// ============================================================================
// Reproducibility — the Skywork-style scenario
// ============================================================================

describe("Skywork-replicable workload", () => {
  it("70/20/10 mix of classify/generate/debug yields a substantial saving", () => {
    // Mirrors Skywork's reported distribution: most calls are
    // classification/triage (FAST tier), some are generation (STD), a
    // few are complex (STRONG). Their measured saving was ~66%; the
    // exact figure depends on the per-call token mix.
    const ledger = new RoutingLedger("claude-opus-4");
    for (let i = 0; i < 70; i++) {
      ledger.record({ model: "claude-haiku-4-5", tokensIn: 2000, tokensOut: 200 });
    }
    for (let i = 0; i < 20; i++) {
      ledger.record({ model: "claude-sonnet-4-5", tokensIn: 8000, tokensOut: 1000 });
    }
    for (let i = 0; i < 10; i++) {
      ledger.record({ model: "claude-opus-4", tokensIn: 8000, tokensOut: 1000 });
    }
    const s = ledger.summary();
    // Under the Jun 2026 pricing in @prune/shared, this distribution
    // saves ~60% vs always-Opus. (Lower than Skywork's reported 66%
    // because Skywork's GPT-5.1 nano:mini ratio is more aggressive than
    // our Haiku:Opus ratio.) Either way, > 50% is the threshold the
    // demo needs to meet to publish a "Skywork-replicable" claim with
    // a straight face.
    expect(s.averageSavedFraction).toBeGreaterThan(0.5);
    expect(s.totalSavedUsd).toBeGreaterThan(0);
  });
});

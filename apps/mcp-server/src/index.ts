#!/usr/bin/env node
/**
 * Prune MCP Server
 * 
 * Provides tools for AI self-regulation:
 * - analyze_context: Check token count before operations
 * - squeeze_files: Compress files to reduce tokens
 * - check_budget: Check remaining requests/budget
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";

import { sha256Hex } from "@prune/shared/node";
import { countTokens, countTokensBatch, estimateCost, formatTokens, formatCost } from "@prune/tokenizer";
import { squeezeFile, type SqueezeTier } from "@prune/squeezer";
import { detectCompaction, analyzeCompaction } from "@prune/intelligence";
import { fetchCursorUsage } from "@prune/state-scraper";
import {
  TranscriptReader,
  loadCachedSessionView,
  projectTurnsToBuffer,
} from "@prune/telemetry";
import {
  computeCacheMetrics,
  diagnoseCacheBust,
  evaluateLoopBlock,
  formatLoopBlockMessage,
  getModelRoutingSuggestion,
  type CacheTurnInput,
  type ToolDefinitionInfo,
  type ToolUsageWindow,
} from "@prune/intelligence";
import type { ModelAggregate } from "@prune/qpd-bench";
import {
  handleToolAudit,
  handleQpdReport,
  handleContextHealthReport,
  handleTrajectoryReplay,
  handleSemanticCacheProbe,
  handleCodeModeGenerateApi,
  handleCodeModeHarness,
  handleReplayCostPlan,
  handleMcpProxyTrim,
  handleCacheHabits,
  handleCacheHabitsFromTranscript,
  handleSubagentCostPredict,
  handleReasoningEffortRoute,
  handleResultPrune,
  handleMaxTokensCalibrate,
  handleDiffVsRewrite,
  handleOpenTabAudit,
  handleRewardIntegrityCheck,
  handleObservationMaskPlan,
  handleReadGateCheck,
  handleProgramSlice,
  handlePriceQuote,
  handlePrefixWarmPlan,
  handleWastebenchAttest,
} from "./tcrp-tools.js";
import { recordToolFeatureEventBestEffort } from "./feature-telemetry.js";

// ============================================================================
// Server Setup
// ============================================================================

const server = new Server(
  {
    name: "prune-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS = [
  {
    name: "analyze_context",
    description:
      "Analyze files to check token count and cost before proceeding with large operations. " +
      "Call this BEFORE attaching large amounts of code to understand the token impact.",
    inputSchema: {
      type: "object" as const,
      properties: {
        files: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Array of file paths to analyze",
        },
        model: {
          type: "string" as const,
          description: "Model to estimate tokens for (default: gpt-4o)",
          default: "gpt-4o",
        },
      },
      required: ["files"],
    },
  },
  {
    name: "squeeze_files",
    description:
      "Compress code files to reduce token count while preserving functionality. " +
      "Use this when analyze_context recommends squeezing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        files: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Array of file paths to squeeze",
        },
        tier: {
          type: "string" as const,
          enum: ["lossless", "structural", "telegraphic"],
          description:
            "Compression tier: lossless (~15% savings), structural (~40%), telegraphic (~70%)",
          default: "structural",
        },
      },
      required: ["files"],
    },
  },
  {
    name: "check_budget",
    description:
      "Check remaining Cursor requests and spending. " +
      "Call this to understand budget constraints before expensive operations.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "cache_report",
    description:
      "Analyze a Claude Code session transcript (JSONL) and report prompt-cache " +
      "performance: hit rate, write amplification, $ saved vs. no-cache, and any " +
      "bust signals (volatile prefix, MCP tool drift, timestamps in system).",
    inputSchema: {
      type: "object" as const,
      properties: {
        transcript_path: {
          type: "string" as const,
          description:
            "Absolute path to a Claude Code session transcript JSONL file.",
        },
        window_turns: {
          type: "number" as const,
          description:
            "Limit analysis to the most recent N turns (default: all turns).",
        },
        ttl: {
          type: "string" as const,
          enum: ["5m", "1h"],
          description:
            "Cache TTL used for cost math (default: 5m, the cheaper write tier).",
          default: "5m",
        },
        system_prompt: {
          type: "string" as const,
          description:
            "Optional system-prompt text to scan for volatility (timestamps, etc.).",
        },
      },
      required: ["transcript_path"],
    },
  },
  {
    name: "loop_status",
    description:
      "Replay a Claude Code session transcript and report the current ROI " +
      "state: per-turn classification, consecutive-low-ROI streak, recursive " +
      "signals, and (if a streak triggers) a model-routing suggestion. Useful " +
      "before continuing a long agentic loop.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transcript_path: {
          type: "string" as const,
          description:
            "Absolute path to a Claude Code session transcript JSONL file.",
        },
        current_model: {
          type: "string" as const,
          description:
            "The model the session is currently using; required for the routing suggestion.",
        },
        consecutive_low_roi_threshold: {
          type: "number" as const,
          description:
            "Streak length that triggers a block decision (default 3).",
          default: 3,
        },
      },
      required: ["transcript_path"],
    },
  },
  {
    name: "routing_suggestion",
    description:
      "Suggest a cheaper model when a session has been in a recursive streak. " +
      "Independent of any transcript — pass the current model and observed streak length.",
    inputSchema: {
      type: "object" as const,
      properties: {
        current_model: {
          type: "string" as const,
          description: "Currently-used model id (e.g. claude-sonnet-4-5-20250929).",
        },
        consecutive_low_roi_turns: {
          type: "number" as const,
          description: "Length of the current low-ROI streak.",
        },
      },
      required: ["current_model", "consecutive_low_roi_turns"],
    },
  },
  {
    name: "diff_context",
    description:
      "Decide the cheapest faithful way to send a file to the model on a " +
      "subsequent turn. Given the current content (or path) and an optional " +
      "previously-seen SHA-256 + previously-seen content, returns one of: " +
      "unchanged (zero new tokens), diff (only changed lines), signatures " +
      "(structural compression via AST), or full. Reports the token budget " +
      "for each option so callers can pick.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string" as const, description: "Absolute path." },
        content: {
          type: "string" as const,
          description:
            "Optional: file content. If omitted, read from file_path.",
        },
        previously_seen_sha256: {
          type: "string" as const,
          description:
            "SHA-256 hex digest of the version already in the model's context.",
        },
        previously_seen_content: {
          type: "string" as const,
          description:
            "Optional previous content; enables diff computation.",
        },
        model: {
          type: "string" as const,
          description: "Model for token counting (default gpt-4o).",
          default: "gpt-4o",
        },
        large_file_threshold: {
          type: "number" as const,
          description:
            "Files above this token count fall back to AST signatures when no diff baseline exists (default 1500).",
          default: 1500,
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "slo_define",
    description:
      "Define a cost Service Level Objective (SLO) — the SRE Error " +
      "Budget pattern for AI cost. Each task (default: one agent_id = " +
      "one task) is expected to stay under target_usd_per_task. The team " +
      "can absorb up to error_budget_usd of total excess in window_days " +
      "before the slo_check breaker fires. " +
      "https://sre.google/workbook/implementing-slos/",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" as const, description: "Unique SLO name." },
        scope_envelope_name: {
          type: "string" as const,
          description: "Budget envelope this SLO measures over.",
        },
        target_usd_per_task: {
          type: "number" as const,
          description: "Per-task cost target ($).",
        },
        error_budget_usd: {
          type: "number" as const,
          description: "Total $ of excess the team can absorb before block.",
        },
        window_days: {
          type: "number" as const,
          description: "SLO window length in days.",
        },
        warning_pct: {
          type: "number" as const,
          description:
            "0..1. WARN when remaining budget ≤ this fraction. Default 0.5.",
        },
        task_dimension: {
          type: "string" as const,
          description:
            "Which field defines a task. Default 'agent_id'. Also 'model', " +
            "'provider', 'envelope_id', or 'metadata.<key>' for attribution-aware SLOs.",
        },
        sqlite_path: { type: "string" as const, description: "Override the local sink path." },
      },
      required: ["name", "scope_envelope_name", "target_usd_per_task", "error_budget_usd", "window_days"],
    },
  },
  {
    name: "slo_check",
    description:
      "Compute the SLI for a named SLO and run the breaker policy. " +
      "Returns allow / warn / block with rationale + remediations. " +
      "Use as a pre-call gate when the breaker hook isn't wired.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" as const, description: "SLO name to evaluate." },
        sqlite_path: { type: "string" as const, description: "Override the local sink path." },
      },
      required: ["name"],
    },
  },
  {
    name: "slo_status",
    description:
      "Read-only SLI report for a named SLO — full task list (sorted by " +
      "cost descending), compliance ratio, p50/p95/p99 task cost, error " +
      "budget burn percentage. Use for weekly SRE-style review.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" as const, description: "SLO name." },
        sqlite_path: { type: "string" as const, description: "Override the local sink path." },
      },
      required: ["name"],
    },
  },
  {
    name: "attribution_rollup",
    description:
      "Cross-vendor per-developer / per-PR / per-project / per-team cost " +
      "rollup over a budget envelope's charges. Local-first; works across " +
      "every coding agent (Claude Code, Cursor, Cline, Codex CLI, Aider). " +
      "Competes with Anthropic's Enterprise-plan-only Enterprise Analytics " +
      "API on every plan. groupBy accepts 'developer', 'project', 'branch', " +
      "'prNumber', 'commitSha', 'model', 'provider', or 'extra.<key>'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        envelope_name: {
          type: "string" as const,
          description: "Source envelope.",
        },
        group_by: {
          type: "array" as const,
          items: { type: "string" as const },
          description:
            "Dimensions to group by (composite key, in order). Defaults to ['developer'].",
        },
        since: {
          type: "string" as const,
          description: "ISO 8601 lower bound on charge timestamps.",
        },
        until: {
          type: "string" as const,
          description: "ISO 8601 upper bound on charge timestamps.",
        },
        sqlite_path: { type: "string" as const, description: "Override the local sink path." },
        limit: {
          type: "number" as const,
          description: "Max charges to scan (newest first). Default 5000.",
        },
      },
      required: ["envelope_name"],
    },
  },
  {
    name: "export_focus_csv",
    description:
      "Export a budget envelope's charges as FOCUS v1.3 CSV. Drops " +
      "directly into FinOps platforms (CloudHealth, Apptio, Vantage, " +
      "Finout, CloudZero). Spec ratified Dec 4 2025; 68% of $100M+ orgs " +
      "consume FOCUS-formatted data (Amnic FOCUS 2026 guide). " +
      "https://focus.finops.org/focus-specification/v1-2/",
    inputSchema: {
      type: "object" as const,
      properties: {
        envelope_name: { type: "string" as const, description: "Source envelope." },
        sqlite_path: { type: "string" as const, description: "Override the local sink path." },
        sub_account_id: {
          type: "string" as const,
          description: "Optional: stamp every row with this SubAccountId.",
        },
        sub_account_name: { type: "string" as const, description: "Optional sub-account label." },
        limit: {
          type: "number" as const,
          description: "Max charges to export (newest first). Default 1000.",
        },
      },
      required: ["envelope_name"],
    },
  },
  {
    name: "export_otel_genai",
    description:
      "Export a budget envelope's charges as an OpenTelemetry GenAI " +
      "semantic-conventions payload (OTLP-compatible JSON). Pipe to any " +
      "OTel Collector for ingestion into Langfuse, Phoenix, Honeycomb, " +
      "Datadog, New Relic. Spec: " +
      "https://opentelemetry.io/docs/specs/semconv/gen-ai/",
    inputSchema: {
      type: "object" as const,
      properties: {
        envelope_name: { type: "string" as const, description: "Source envelope." },
        sqlite_path: { type: "string" as const, description: "Override the local sink path." },
        limit: {
          type: "number" as const,
          description: "Max charges to export. Default 1000.",
        },
      },
      required: ["envelope_name"],
    },
  },
  {
    name: "sentinel_scan_prompt",
    description:
      "Pre-prompt scan: detect API keys, private keys, connection " +
      "URLs, and high-entropy tokens in a payload BEFORE sending it " +
      "to a cloud model. Pattern-based (gitleaks/TruffleHog-style). " +
      "Responds to GitGuardian's documented 3.2% Claude-Code-commit leak rate " +
      "vs 1.5% baseline (https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/). " +
      "Returns a verdict (allow/warn/block), the per-finding location, " +
      "and a length-preserving redacted payload.",
    inputSchema: {
      type: "object" as const,
      properties: {
        payload: { type: "string" as const, description: "Text to scan." },
        block_on_pattern_ids: {
          type: "array" as const,
          items: { type: "string" as const },
          description:
            "Optional explicit list of pattern ids that must block. Defaults " +
            "to all vendor keys + private keys + connection URLs.",
        },
        min_entropy: {
          type: "number" as const,
          description: "Override entropy threshold (default 4.5).",
        },
      },
      required: ["payload"],
    },
  },
  {
    name: "sentinel_scan_mcp",
    description:
      "Post-tool scan: inspect an MCP tool response (or any untrusted " +
      "external payload) for prompt-injection signatures. Categories: " +
      "SHADOWING, PATH_TRAVERSAL, ARGUMENT_INJECTION, HIDDEN_HTML, " +
      "INDIRECT_MARKUP. Pattern matches the documented Jan 20 2026 RCE " +
      "in Anthropic's Git MCP server (CVE-2025-68143/68144/68145; class " +
      "surveyed in arXiv 2601.17548). Default policy blocks the first three " +
      "categories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        payload: { type: "string" as const, description: "Text to scan." },
        block_on_categories: {
          type: "array" as const,
          items: {
            type: "string" as const,
            enum: ["SHADOWING", "PATH_TRAVERSAL", "ARGUMENT_INJECTION", "HIDDEN_HTML", "INDIRECT_MARKUP"],
          },
          description:
            "Optional override of categories that force a block. Defaults " +
            "to SHADOWING + PATH_TRAVERSAL + ARGUMENT_INJECTION.",
        },
      },
      required: ["payload"],
    },
  },
  {
    name: "routing_decide",
    description:
      "Classify a coding-agent request (intent + difficulty) and return a " +
      "three-tier routing decision (FAST/STD/STRONG → Haiku 4.5 / Sonnet 4.6 / " +
      "Opus 4.8 by default). Reproduces Skywork.ai's documented 66% cost " +
      "saving. Every decision carries a rule id, rationale, and the signals " +
      "that fired — fully auditable. Pair with routing_ledger to track " +
      "actual-vs-baseline savings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: { type: "string" as const, description: "The user's prompt text." },
        estimated_tokens_in: {
          type: "number" as const,
          description: "Estimated input tokens (system + tools + context + user).",
        },
        files_in_context: {
          type: "number" as const,
          description: "Optional. Number of files in the edit context.",
        },
        recent_error: {
          type: "boolean" as const,
          description: "Optional. True if the most recent turn surfaced an error.",
        },
        floor: {
          type: "string" as const,
          enum: ["FAST", "STD", "STRONG"],
          description:
            "Optional. Minimum tier; FAST is never picked if floor='STD'.",
        },
        fast_model: { type: "string" as const, description: "Override default FAST model id." },
        std_model: { type: "string" as const, description: "Override default STD model id." },
        strong_model: { type: "string" as const, description: "Override default STRONG model id." },
      },
      required: ["prompt", "estimated_tokens_in"],
    },
  },
  {
    name: "repo_map",
    description:
      "Symbol-level repository map. Walks the project (TS/JS via TS Compiler " +
      "API, no regex), builds a directed reference graph, runs PageRank, and " +
      "returns the top-K ranked symbols with signatures-only. Optionally biases " +
      "the ranking toward a task query (personalized PageRank). Productizes " +
      "Aider's repo-map discipline cross-agent — Aider's published benchmark " +
      "shows 4.2× fewer tokens than Claude Code on the same 47-file task " +
      "(morphllm.com/comparisons/morph-vs-aider-diff).",
    inputSchema: {
      type: "object" as const,
      properties: {
        root: {
          type: "string" as const,
          description: "Absolute path to the repository root.",
        },
        task_query: {
          type: "string" as const,
          description:
            "Optional free-text task; biases the ranking via personalized PageRank " +
            "toward symbols whose name or signature contains query tokens.",
        },
        top_k: {
          type: "number" as const,
          description: "Max ranked symbols to return. Default 50.",
        },
        damping: {
          type: "number" as const,
          description: "PageRank damping. Default 0.85.",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "replay_verify",
    description:
      "Verify the integrity of the replay vault for a session. Re-hashes " +
      "every canonical payload, re-checks the chain links, and re-verifies " +
      "the ed25519 signatures against trusted public keys. Returns an " +
      "end-to-end pass/fail plus the first breaking sequence and per-row " +
      "diagnostics. Use this to satisfy EU AI Act Art 12 / ISO 42001 A.6.1.6 " +
      "/ NIST AI RMF Measure 2.5 audit asks.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string" as const, description: "Session id to verify." },
        sqlite_path: {
          type: "string" as const,
          description:
            "Override the local sink path (default: $PRUNE_VAULT_SQLITE or ~/.prune/vault.sqlite).",
        },
        key_path: {
          type: "string" as const,
          description:
            "Override the signer keystore PEM path (default: $PRUNE_VAULT_KEY or ~/.prune/keys/replay.pem).",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "replay_list",
    description:
      "List vault records for a session in canonical (sequence-ascending) " +
      "order. Each row contains the canonical payload, record hash, signer " +
      "fingerprint, and chain prev-hash for offline verification.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string" as const, description: "Session id to list." },
        sqlite_path: {
          type: "string" as const,
          description: "Override the local sink path.",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "cache_copilot",
    description:
      "Detect prompt-cache silent failures and TTL-penalty patterns in a " +
      "Claude Code session. SILENT_FAILURE: 3+ consecutive turns with " +
      "large input but zero cache activity (caching not enabled, or prefix " +
      "below Anthropic's minimum). TTL_PENALTY: same-shape cache_creation " +
      "events >5 min apart, where ttl='1h' would have converted the second " +
      "write into a read (relevant after the March 2026 default-TTL " +
      "regression). Returns dollar-quantified findings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transcript_path: {
          type: "string" as const,
          description: "Absolute path to a Claude Code session transcript JSONL.",
        },
        min_cacheable_prefix_tokens: {
          type: "number" as const,
          description:
            "Min `input` tokens for a turn to be considered cacheable. " +
            "Default 2048 (matches Anthropic's typical minimum-prefix threshold).",
        },
        min_consecutive_turns_for_silent_failure: {
          type: "number" as const,
          description:
            "Min consecutive turns of zero cache activity before flagging silent failure. " +
            "Default 3.",
        },
      },
      required: ["transcript_path"],
    },
  },
  {
    name: "subagent_status",
    description:
      "Inspect current subagent activity (active fan-outs, bursts, longest-running " +
      "subagent, peak parallel in one turn) and apply the runaway-prevention policy. " +
      "Use BEFORE issuing a Task fan-out — the response says whether the proposed " +
      "spawn would be blocked by the subagent-warden hook. Patterns: " +
      "FAN_OUT_RUNAWAY, UNATTENDED_LOOP, CONCURRENT_CAP, PEAK_PARALLEL_IN_TURN.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transcript_path: {
          type: "string" as const,
          description: "Absolute path to a Claude Code session transcript JSONL.",
        },
        proposed_task_count: {
          type: "number" as const,
          description:
            "Number of additional Task spawns to model. Pass the count you're " +
            "about to issue to see if the policy would block. Default 0 " +
            "(read-only inspection).",
          default: 0,
        },
        max_concurrent: {
          type: "number" as const,
          description: "Override the concurrent-subagent cap (default 15).",
        },
        max_burst: {
          type: "number" as const,
          description: "Override the per-60s burst cap (default 10).",
        },
        max_parallel_in_turn: {
          type: "number" as const,
          description: "Override the per-turn parallel cap (default 12).",
        },
        max_subagent_minutes: {
          type: "number" as const,
          description: "Override the per-subagent lifetime ceiling (default 30).",
        },
      },
      required: ["transcript_path"],
    },
  },
  {
    name: "subagent_cost_predict",
    description:
      "N6 pre-spawn subagent cost predictor. Complements subagent_status (which " +
      "caps by COUNT) by projecting the DOLLAR cost of a proposed Task fan-out " +
      "before it runs, from the observed cost of subagents already completed " +
      "this session. The host supplies per-subagent usage samples (it alone can " +
      "attribute tokens to a subagent); the predictor returns per-subagent and " +
      "projected-total token/USD quantiles (p50/p90/mean). Strict pricing: an " +
      "unpriced model yields null USD (priced:false), never a default rate; an " +
      "empty history yields basis 'insufficient_data'. Caller-supplied numbers " +
      "only — nothing is fabricated.",
    inputSchema: {
      type: "object" as const,
      properties: {
        history: {
          type: "array" as const,
          description:
            "Observed costs of subagents completed this session. Each entry: " +
            "{ tokensIn, tokensOut, tokensCached?, costUsd? }. costUsd, when " +
            "present, is used verbatim (most faithful).",
          items: {
            type: "object" as const,
            properties: {
              tokensIn: { type: "number" as const },
              tokensOut: { type: "number" as const },
              tokensCached: { type: "number" as const },
              costUsd: { type: "number" as const },
            },
          },
        },
        proposed_count: {
          type: "number" as const,
          description: "How many subagents are about to be spawned. Default 1.",
          default: 1,
        },
        model: {
          type: "string" as const,
          description: "Model the proposed subagents will run on (for pricing the history).",
        },
        provider: {
          type: "string" as const,
          description: "Provider hint; inferred from the model name when omitted.",
        },
      },
      required: ["model"],
    },
  },
  {
    name: "budget_status",
    description:
      "Read current budget envelope state — spent, remaining, pct, burn-rate $/day, " +
      "and projected exhaustion date. Use before kicking off expensive subagent fans " +
      "or long-running automation. Designed for the post-June-15-2026 Agent SDK " +
      "metered-credit world. If `name` is omitted, no result is returned — first " +
      "call budget_configure to create an envelope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string" as const,
          description:
            "Envelope name to inspect. Must exist (create via budget_configure first).",
        },
        sqlite_path: {
          type: "string" as const,
          description:
            "Override the local sink path (default: $PRUNE_BUDGET_SQLITE or " +
            "~/.prune/budget.sqlite).",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "budget_configure",
    description:
      "Create or update a budget envelope. Supports day/week/month/custom periods, " +
      "soft + hard caps, and parent envelopes for team→dev rollups. Idempotent on " +
      "the (name) key — calling twice with the same name updates the existing row.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" as const, description: "Unique envelope name." },
        limit_usd: {
          type: "number" as const,
          description:
            "Hard $ limit for the period. e.g. 200 for the $200 Max-20x Agent SDK credit pool.",
        },
        period_kind: {
          type: "string" as const,
          enum: ["day", "week", "month", "custom"],
          description: "Period rollover rule.",
        },
        period_start: {
          type: "string" as const,
          description: "ISO 8601 start (required when period_kind='custom').",
        },
        period_end: {
          type: "string" as const,
          description: "ISO 8601 end (required when period_kind='custom').",
        },
        soft_cap_pct: {
          type: "number" as const,
          description: "0..1 (default 0.75). Warn threshold.",
        },
        hard_cap_pct: {
          type: "number" as const,
          description: "0..1 (default 1.0). Block threshold.",
        },
        parent_envelope_name: {
          type: "string" as const,
          description:
            "Optional parent for rollup (charges to this envelope also count against the parent).",
        },
        sqlite_path: {
          type: "string" as const,
          description:
            "Override the local sink path (default: $PRUNE_BUDGET_SQLITE or " +
            "~/.prune/budget.sqlite).",
        },
      },
      required: ["name", "limit_usd", "period_kind"],
    },
  },
  {
    name: "compaction_check",
    description:
      "Inspect a Claude Code transcript window for a compaction event and " +
      "report what tracked entities (decisions, file references, rules) are " +
      "at risk of being lost when context is summarized. Use after a " +
      "PreCompact / PostCompact hook fires.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transcript_path: {
          type: "string" as const,
          description:
            "Absolute path to a Claude Code session transcript JSONL.",
        },
        window_turns: {
          type: "number" as const,
          description:
            "Compare the first N turns (pre-compaction) against the rest (post-compaction). Default: half-split.",
        },
      },
      required: ["transcript_path"],
    },
  },
  {
    name: "tool_audit",
    description:
      "F2 Tool-Definition Auditor. Given the MCP/tool registry (with each " +
      "tool's definition token cost) and recent per-session tool usage, report " +
      "which tools are dead weight — carried on every request but rarely or " +
      "never invoked — and how many tokens/week disabling them would recover. " +
      "Never recommends removing a critical-allowlist tool. Mechanically zero " +
      "quality impact: it only flags tools the agent does not invoke; the human " +
      "confirms each removal. " +
      "Vendor scoping: pass `vendor: \"anthropic-claude-code\"` to short-circuit " +
      "with a notice pointing the user at Claude Code 2.1+'s built-in on-demand " +
      "tool search (≈85% MCP token reduction at the host level); other vendors " +
      "(cursor / openai-codex / openai-other / unknown / unset) run the full " +
      "auditor.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tools: {
          type: "array" as const,
          description:
            "Tool registry: each { name, server, definition_tokens, protected? }.",
          items: { type: "object" as const },
        },
        usage: {
          type: "object" as const,
          description:
            "Aggregated usage window: { windowDays, sessionsInWindow, " +
            "invocations{}, lastUsedAgeDays{}, sessionsLoadingTool{} }.",
        },
        critical_allowlist: {
          type: "array" as const,
          description: "Tool names that must never be recommended for removal.",
          items: { type: "string" as const },
        },
        vendor: {
          type: "string" as const,
          description:
            "Host scope: 'anthropic-claude-code' short-circuits the audit; " +
            "any other value (cursor | openai-codex | openai-other | unknown) " +
            "runs the existing logic.",
        },
      },
      required: ["tools", "usage"],
    },
  },
  {
    name: "qpd_report",
    description:
      "F4 Pareto Quality-per-Dollar report. Given per-model bench aggregates " +
      "(acceptance rate, test-pass rate, mean cost, sample size) for one " +
      "workload cluster, return the cost/quality Pareto frontier and which " +
      "cheaper models — if any — are statistically quality-equivalent to the " +
      "current one and therefore safe to recommend. Recommends only; the user " +
      "always picks. Surfaces bench data; it does not run models.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseline: {
          type: "object" as const,
          description: "ModelAggregate for the current/baseline model.",
        },
        candidates: {
          type: "array" as const,
          description: "ModelAggregate for each candidate model.",
          items: { type: "object" as const },
        },
        ar_margin: {
          type: "number" as const,
          description:
            "Acceptance-rate non-inferiority margin (default 0.05, the coarse " +
            "screening margin; the production gate uses 1pp continuously).",
        },
        cost_dominance_ratio: {
          type: "number" as const,
          description: "Candidate cost must be ≤ this × baseline (default 0.7).",
        },
      },
      required: ["baseline", "candidates"],
    },
  },
  {
    name: "code_mode_generate_api",
    description:
      "F8 Code-Mode API generator. Walks a set of MCP tool JSON " +
      "schemas and emits a typed TypeScript `Toolbox` interface so an " +
      "agent can write code calling tools by name with checked params. " +
      "Pure: no model call, no I/O, no regex (structural schema walk). " +
      "Method names are sanitized (char-code walk); collisions get " +
      "suffixed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tools: {
          type: "array" as const,
          description: "McpToolDef[] — { name, description?, inputSchema, outputSchema? }.",
          items: { type: "object" as const },
        },
        toolbox_name: {
          type: "string" as const,
          description: "Optional interface name; default 'Toolbox'.",
        },
      },
      required: ["tools"],
    },
  },
  {
    name: "code_mode_harness",
    description:
      "F8 Code-Mode Equivalence Harness. Aggregates per-task verdicts " +
      "from a caller-supplied corpus comparing direct-tool-call outputs " +
      "against code-mode-script outputs via @prune/equivalence, plus " +
      "byte-reduction totals and sandbox-escape attempt counts. The " +
      "caller is responsible for actually running both arms; this tool " +
      "verifies and reports.",
    inputSchema: {
      type: "object" as const,
      properties: {
        outcomes: {
          type: "array" as const,
          description: "CodeModeTaskOutcome[] from your runner.",
          items: { type: "object" as const },
        },
      },
      required: ["outcomes"],
    },
  },
  {
    name: "semantic_cache_probe",
    description:
      "F7 Semantic Cache Probe. Stateless: hydrates a serialized cache " +
      "state and reports hit/miss verdicts (with similarity, freshness " +
      "match, equivalence flag) for the supplied probes. The cache uses " +
      "an in-process char-n-gram + hashing-trick embedder (no external " +
      "API, no wrapper) and content-SHA freshness tokens; a serving " +
      "decision requires both similarity ≥ threshold AND a matching " +
      "freshness token. Caller-owned state.",
    inputSchema: {
      type: "object" as const,
      properties: {
        state: {
          type: "object" as const,
          description: "Optional SerializedSemanticCache from SemanticCache.toJSON().",
        },
        probes: {
          type: "array" as const,
          description:
            "Probes [{ query: string, freshness_parts: string[] }]. " +
            "freshness_parts are concatenated with NUL separators to " +
            "produce a content-SHA token.",
          items: { type: "object" as const },
        },
      },
      required: ["probes"],
    },
  },
  {
    name: "trajectory_replay_report",
    description:
      "F1 v2 — Trajectory Diet replay/calibration report. Given F1 shadow " +
      "events (predicted influence + realized influence, optionally paired " +
      "control/treatment outcomes), returns calibration metrics (Brier, " +
      "log-loss, ECE), advisory aggregate (true vs false low-influence " +
      "counts, tokens projected to save), and the @prune/quality NI-gate " +
      "verdict when ≥ min_pairs_for_gate paired sessions are available. " +
      "Pure math over caller-supplied events; never auto-promotes a " +
      "feature, never throws on malformed input.",
    inputSchema: {
      type: "object" as const,
      properties: {
        events: {
          type: "array" as const,
          description: "F1ShadowEvent[] — projected from EventRow.quality_proof.",
          items: { type: "object" as const },
        },
        num_bins: {
          type: "number" as const,
          description: "Number of bins for ECE (default 10).",
        },
        min_pairs_for_gate: {
          type: "number" as const,
          description: "Minimum paired sessions to evaluate the NI gate (default 30).",
        },
        margins: {
          type: "object" as const,
          description: "Quality margins {acceptanceRate, testPassRate, alpha}.",
        },
      },
      required: ["events"],
    },
  },
  {
    name: "context_health_report",
    description:
      "F6 Context Health. Computes Effective Context Fullness (ECF) per turn " +
      "from the live Claude Code transcript (no model call, no API key), runs " +
      "streaming CUSUM change-point detection over the ECF curve, and reports " +
      "the regime (healthy / warning at 50% / critical at 75% — thresholds " +
      "pinned to Chroma 2026 context-rot research) plus secondary signals " +
      "(cache-hit trend, scope-drift slope, dominant large-tool-result). " +
      "Pure math + AST-typed tool inputs; no regex, no fabricated tokens. " +
      "Never blocks the agent. Never sees user content beyond the structured " +
      "telemetry fields.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transcript_path: {
          type: "string" as const,
          description: "Absolute path to the Claude Code session transcript (JSONL).",
        },
        window_turns: {
          type: "number" as const,
          description:
            "Optional cap on how many recent turns to include in the report (default: all).",
        },
      },
      required: ["transcript_path"],
    },
  },
  {
    name: "replay_cost_plan",
    description:
      "F11 What-If Deterministic Replay. Given an ordered set of session " +
      "segments (system/user/assistant/tool, each with caller-counted input " +
      "and output tokens) and a single-segment mutation, computes the " +
      "byte-identical shared prefix, the divergence point, and the dollar " +
      "delta between a naive cold re-run and a cache-replayed run (shared " +
      "prefix re-served at the cache-read tier, only the diverged tail " +
      "recomputed). Pure, deterministic, no model call; token counts are " +
      "caller-supplied and never fabricated; unpriced models return null USD. " +
      "Returns the divergence, the cost breakdown, and an f11 quality_proof.",
    inputSchema: {
      type: "object" as const,
      properties: {
        model: {
          type: "string" as const,
          description: "Model id used for pricing, e.g. claude-sonnet-4-5-20250929.",
        },
        provider: {
          type: "string" as const,
          enum: ["anthropic", "openai", "google"],
          description: "Provider hint; defaults to anthropic.",
        },
        segments: {
          type: "array" as const,
          description:
            "Ordered session segments. Index is assigned from array position.",
          items: {
            type: "object" as const,
            properties: {
              role: {
                type: "string" as const,
                enum: ["system", "user", "assistant", "tool"],
              },
              payload: {
                description: "JSON-canonicalizable bytes-defining payload for the segment.",
              },
              tokens_in: { type: "number" as const },
              tokens_out: { type: "number" as const },
            },
            required: ["role", "payload", "tokens_in", "tokens_out"],
          },
        },
        mutation: {
          type: "object" as const,
          description: "The single-segment what-if mutation to evaluate.",
          properties: {
            at_index: { type: "number" as const },
            new_payload: { description: "Replacement payload for the segment." },
            new_tokens_in: {
              type: "number" as const,
              description: "New input-token count; omitted ⇒ reuse the original.",
            },
          },
          required: ["at_index", "new_payload"],
        },
      },
      required: ["model", "segments", "mutation"],
    },
  },
  {
    name: "mcp_proxy_trim",
    description:
      "F10 Cross-Vendor Lazy-Schema MCP Proxy. Given a merged MCP tool catalog " +
      "and the caller-classified intent for the upcoming turn, returns only the " +
      "tools matching that intent (full inputSchemas held back for lazy load), " +
      "plus a reduction audit (tokens saved, kept/hidden tool names) and an f10 " +
      "quality_proof. Verb classification is a deterministic rule table (no " +
      "regex, no model call); fail-safe-to-include means an unset or " +
      "all-matching intent returns the full catalog rather than risk hiding a " +
      "tool the agent needs. Pass intent=null to measure the lazy-schema saving " +
      "alone.",
    inputSchema: {
      type: "object" as const,
      properties: {
        intent: {
          type: ["string", "null"] as const,
          enum: [
            "classify", "retrieve", "generate", "refactor",
            "debug", "explain", "test", "format", null,
          ],
          description: "Caller-classified intent, or null for the full catalog.",
        },
        tools: {
          type: "array" as const,
          description: "The merged upstream MCP tool catalog.",
          items: {
            type: "object" as const,
            properties: {
              name: { type: "string" as const },
              description: { type: "string" as const },
              inputSchema: { type: "object" as const },
              origin: { type: "string" as const },
            },
            required: ["name", "inputSchema"],
          },
        },
        token_cost_by_name: {
          type: "object" as const,
          description:
            "Optional per-tool tokenized cost: name → { schemaTokens, descriptionTokens }.",
        },
        overrides: {
          type: "array" as const,
          description: "Optional intent overrides for tools whose names carry no verb signal.",
          items: {
            type: "object" as const,
            properties: {
              toolName: { type: "string" as const },
              intents: { type: "array" as const, items: { type: "string" as const } },
            },
            required: ["toolName", "intents"],
          },
        },
        include_fallback: {
          type: "boolean" as const,
          description: "Include verb-inconclusive (fail-safe) tools in the trim. Default true.",
        },
      },
      required: ["tools"],
    },
  },
  {
    name: "cache_habits",
    description:
      "F9 cache-habits linter (full rule set). Given the host's PROPOSED action " +
      "diff and the prior SESSION snapshot, runs all 12 deterministic " +
      "prompt-cache-killer rules (CH-001..CH-012: mid-session model switch, " +
      "tool-list reorder, system-prompt mutation, large paste before the cached " +
      "prefix, MCP server add/remove, TTL/reasoning-effort/temperature change, " +
      "idle-TTL expiry, etc.) and returns the findings, per-rule estimated " +
      "wasted USD/tokens, and an f9 quality_proof. This is the surface for the " +
      "11 rules a transcript hook cannot reach (they need the proposed-vs-active " +
      "diff only the editor/host has). No regex, no model call; verdict is " +
      "advisory — the host decides whether to warn or block.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "object" as const,
          description:
            "ProposedAction: { modelFamily, model, ttl, prompt:{text,pastedBlocks[]}, " +
            "changes:{systemPromptTokens,toolListOrderHash,reasoningEffort,temperature," +
            "mcpServersAdded[],mcpServersRemoved[]}, now }. All change fields null when unchanged.",
        },
        snapshot: {
          type: "object" as const,
          description:
            "SessionSnapshot: { currentModel, currentTtl, lastTurnAt, turnsSoFar, " +
            "cacheReadTokensSoFar, cacheCreationTokensSoFar, systemPromptTokens, " +
            "toolListOrderHash, reasoningEffort?, temperature?, mcpServers[] }.",
        },
        suppress: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Rule ids to suppress (e.g. one that fires spuriously here).",
        },
        severity_overrides: {
          type: "object" as const,
          description: "Per-rule severity override, e.g. demote a block to warn in shadow.",
        },
      },
      required: ["action", "snapshot"],
    },
  },
  {
    name: "cache_habits_from_transcript",
    description:
      "F9 cache-habits linter, driven from a REAL transcript. Same 12 rules as " +
      "`cache_habits`, but instead of requiring a hand-built SessionSnapshot it " +
      "DERIVES the snapshot from the live Claude Code transcript (active model, " +
      "idle gap since the last turn, cumulative cache-read/creation tokens, turn " +
      "count) via @prune/host-adapters, then lints the caller's PROPOSED next " +
      "action against it. The proposed action is still caller-supplied — no " +
      "transcript records an action before it is taken — so this narrows (not " +
      "closes) host wiring; the response's `derived` block states exactly what " +
      "came from the transcript vs the caller. Fail-safe: a missing/unreadable " +
      "transcript yields an empty snapshot (model falls back to the proposal, so " +
      "no spurious model-switch finding), never an error. No regex, no model " +
      "call, no fabricated token/cost/clock.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transcript_path: {
          type: "string" as const,
          description: "Absolute path to the Claude Code session transcript (JSONL).",
        },
        proposed_action: {
          type: "object" as const,
          description:
            "The host's DECLARED next action (a transcript cannot supply it). " +
            "Fields: { model (required), ttl?, promptText?, pastedBlocks?[], " +
            "systemPromptTokens?, toolListOrderHash?, reasoningEffort?, " +
            "temperature?, mcpServers?[], now? }. Omitted fields stay 'unknown' " +
            "and the dependent rule stays quiet; a value is never invented.",
          properties: {
            model: { type: "string" as const, description: "Full model id the next turn will use. Required." },
            ttl: { type: "string" as const, enum: ["5m", "1h", "none"] },
            promptText: { type: "string" as const },
            systemPromptTokens: { type: ["number", "null"] as const },
            toolListOrderHash: { type: ["string", "null"] as const },
            reasoningEffort: { type: "string" as const, enum: ["standard", "high", "xhigh", "max"] },
            temperature: { type: "number" as const },
            mcpServers: { type: "array" as const, items: { type: "string" as const } },
            now: { type: "string" as const, description: "ISO 8601 firing time; default = last turn's time (zero idle gap)." },
          },
          required: ["model"],
        },
        snapshot_context: {
          type: "object" as const,
          description:
            "Prior state the transcript can't record: { currentTtl?, " +
            "systemPromptTokens?, toolListOrderHash?, reasoningEffort?, " +
            "temperature?, mcpServers?[] }. Optional; omitted ⇒ that rule stays quiet.",
        },
        suppress: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Rule ids to suppress (e.g. one that fires spuriously here).",
        },
        severity_overrides: {
          type: "object" as const,
          description: "Per-rule severity override, e.g. demote a block to warn in shadow.",
        },
      },
      required: ["transcript_path", "proposed_action"],
    },
  },
  {
    name: "reasoning_effort_route",
    description:
      "Reasoning-Effort Auto-Router. Recommends the LOWEST reasoning effort " +
      "(standard<high<xhigh<max) that is statistically quality-non-inferior to " +
      "the current dial on the caller's own task class — so the dial is set " +
      "right up front and never needs a mid-session change (which would bust the " +
      "prompt cache; this actuates the CH-009 warning). Down-route only (never " +
      "spends more), respects a floor, and HOLDS on insufficient data or when no " +
      "lower effort clears the AR/TPR/cost/sample-size gates. Caller supplies the " +
      "per-effort acceptance/cost stats — nothing is fabricated. Reuses the " +
      "qpd-bench non-inferiority gates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        current_effort: {
          type: "string" as const,
          enum: ["standard", "high", "xhigh", "max"],
          description: "The effort dial currently in use.",
        },
        outcomes: {
          type: "array" as const,
          description:
            "Per-effort outcome stats on the user's task class. Each: " +
            "{ effort, n, acceptedCount, testPassRate?, testN?, testPassedCount?, meanCostUsd }. " +
            "meanCostUsd is caller-computed from real token usage × price.",
          items: {
            type: "object" as const,
            properties: {
              effort: { type: "string" as const, enum: ["standard", "high", "xhigh", "max"] },
              n: { type: "number" as const },
              acceptedCount: { type: "number" as const },
              testPassRate: { type: ["number", "null"] as const },
              testN: { type: "number" as const },
              testPassedCount: { type: "number" as const },
              meanCostUsd: { type: "number" as const },
            },
            required: ["effort", "n", "acceptedCount", "meanCostUsd"],
          },
        },
        task_class: { type: "string" as const, description: "Task class id (cluster). Default 'default'." },
        floor: {
          type: "string" as const,
          enum: ["standard", "high", "xhigh", "max"],
          description: "Never recommend below this effort. Default 'standard'.",
        },
        ar_margin: { type: "number" as const, description: "AR non-inferiority margin (default 0.05)." },
        tpr_margin: { type: "number" as const, description: "TPR non-inferiority margin (default 0.03)." },
        cost_dominance_ratio: { type: "number" as const, description: "Max candidate/baseline cost ratio (default 0.7)." },
        min_samples: { type: "number" as const, description: "Min samples per effort to trust (default 30)." },
      },
      required: ["current_effort", "outcomes"],
    },
  },
  {
    name: "result_prune",
    description:
      "Phase-8 Tool-Result Sub-Token Pruner. Shrinks the token cost of a large " +
      "tool RESULT (file dump, grep/log output, JSON blob) by layered, fully-" +
      "accounted reduction: identical-line-run collapse, blank-run collapse, " +
      "opaque-blob collapse (char-set scan → sha256, NOT regex), trailing-" +
      "whitespace strip, and head/tail middle elision. Returns the pruned text, " +
      "REAL before/after token counts (@prune/tokenizer), savings, a lossless " +
      "flag, and a manifest accounting for every byte removed. Deterministic, " +
      "idempotent, never throws.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string" as const, description: "The tool-result text to prune." },
        options: {
          type: "object" as const,
          description:
            "Optional PruneOptions: layer toggles + thresholds (blobMinChars, " +
            "middleElisionTriggerLines, headTailLines, …). The core sanitizes.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "max_tokens_calibrate",
    description:
      "Phase-8 max_tokens Calibrator. From observed OUTPUT-token-count samples " +
      "for a task class, recommends a max_tokens reservation = nearest-rank " +
      "quantile(p) × (1+safetyMargin) rounded up to a bucket, and reports the " +
      "estimated truncation rate at the recommendation and at the current cap " +
      "plus over-reservation vs the max observed. Returns insufficient_data " +
      "(null recommendation) below minSamples — never guesses. Deterministic.",
    inputSchema: {
      type: "object" as const,
      properties: {
        samples: {
          type: "array" as const,
          items: { type: "number" as const },
          description: "Observed output-token counts (NaN/negative/non-number are filtered).",
        },
        options: {
          type: "object" as const,
          description:
            "Optional CalibrateOptions: p (default 0.95), safetyMargin (0.15), " +
            "bucket (256), minSamples (20), currentMaxTokens.",
        },
      },
      required: ["samples"],
    },
  },
  {
    name: "diff_vs_rewrite",
    description:
      "Phase-8 Diff-vs-Rewrite Enforcer. Given an original file and a proposed " +
      "new version, decides whether a line-level unified DIFF or a FULL REWRITE " +
      "costs fewer REAL tokens (@prune/tokenizer). The diff is computed with a " +
      "hand-written LCS dynamic program over lines (bounded; no regex, no diff " +
      "library) and is ROUND-TRIP VERIFIED — the serialized diff is re-applied " +
      "to the original and must reconstruct the proposed exactly; an unsound " +
      "diff is never recommended (falls back to rewrite). Returns the " +
      "recommendation, the diff, both token counts, savings, changeRatio, and " +
      "diffVerified.",
    inputSchema: {
      type: "object" as const,
      properties: {
        original: { type: "string" as const, description: "The current file content." },
        proposed: { type: "string" as const, description: "The proposed new content." },
        options: {
          type: "object" as const,
          description:
            "Optional DiffEnforceOptions: model, context lines, changeRatio " +
            "rewrite threshold, minSavingFraction, maxCells bound.",
        },
      },
      required: ["original", "proposed"],
    },
  },
  {
    name: "open_tab_audit",
    description:
      "Phase-8 IDE Open-Tab Auditor. Editors auto-attach open tabs to the AI " +
      "context; many are irrelevant and waste tokens. Scores each tab's " +
      "relevance to the current task from STRUCTURAL signals (import-graph BFS " +
      "proximity or path distance, access recency, task-keyword token overlap, " +
      "and a size penalty — no regex) and recommends which to DROP from auto-" +
      "context with honest, null-aware token savings. ALWAYS keeps the active " +
      "file and any dirty (unsaved) tab. Deterministic.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tabs: {
          type: "array" as const,
          description: "Open tabs: { path, tokenCount?, lastAccessedAt?, isDirty? }.",
          items: {
            type: "object" as const,
            properties: {
              path: { type: "string" as const },
              tokenCount: { type: ["number", "null"] as const },
              lastAccessedAt: { type: ["string", "null"] as const },
              isDirty: { type: "boolean" as const },
            },
            required: ["path"],
          },
        },
        activeFile: { type: "string" as const, description: "Path of the active editor file (always kept)." },
        task_keywords: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Keywords describing the current task (for token-overlap relevance).",
        },
        import_edges: {
          type: "array" as const,
          description: "Optional import graph edges for proximity scoring.",
          items: {
            type: "object" as const,
            properties: { from: { type: "string" as const }, to: { type: "string" as const } },
            required: ["from", "to"],
          },
        },
        options: {
          type: "object" as const,
          description: "Optional AuditOptions: dropThreshold (default 0.35), weights.",
        },
      },
      required: ["tabs", "activeFile"],
    },
  },
  {
    name: "reward_integrity_check",
    description:
      "F14 Reward-Integrity Interlock. Given a proposed file write " +
      "(path + before/after content), returns a structural verdict on whether " +
      "the edit weakens the success signal the agent is judged against — " +
      "removing/tautologizing assertions, disabling or focusing tests, or " +
      "writing a designated grader/oracle. AST + content-hash only (no regex, " +
      "no model). Fail-safe: an unparseable or ambiguous edit returns " +
      "`inconclusive`, never a false `violation`. Verdict is advisory here; the " +
      "PreToolUse hook decides whether to block.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description: "Path the write targets.",
        },
        before: {
          type: ["string", "null"] as const,
          description: "On-disk content before the write (null on creation).",
        },
        after: {
          type: ["string", "null"] as const,
          description: "Proposed content after the write (null on deletion).",
        },
        grader_paths: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Grader/oracle path suffixes the agent must not write.",
        },
        extra_test_suffixes: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Extra repo-specific test-file suffixes.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "observation_mask_plan",
    description:
      "F15 Observation Masking + Belady eviction. Given a transcript's " +
      "observation buffer (tool results with measured token counts and turn " +
      "numbers) and a sliding window, returns which observations to replace " +
      "with short reversible placeholders — capping retained context at " +
      "O(window) instead of O(n^2). When a token_budget forces extra drops, " +
      "orders evictions by Belady's MIN (true optimal with foresight; LRU " +
      "otherwise). Masking is monotone (cache-stable). Deterministic; reclaim " +
      "is computed from caller-measured tokens, never fabricated.",
    inputSchema: {
      type: "object" as const,
      properties: {
        observations: {
          type: "array" as const,
          description:
            "Observation buffer: { id, turn, tokens, contentHash, pinned?, nextUseTurn? }.",
          items: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const },
              turn: { type: "number" as const },
              tokens: { type: "number" as const },
              contentHash: { type: "string" as const },
              pinned: { type: "boolean" as const },
              nextUseTurn: { type: ["number", "null"] as const },
            },
            required: ["id", "turn", "tokens", "contentHash"],
          },
        },
        current_turn: { type: "number" as const, description: "Latest turn number." },
        window_turns: { type: "number" as const, description: "Turns to keep unmasked." },
        placeholder_tokens: {
          type: "number" as const,
          description: "Token cost of the placeholder (default 16).",
        },
        token_budget: {
          type: ["number", "null"] as const,
          description: "Optional hard cap on retained observation tokens.",
        },
        previously_masked_ids: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Ids masked in a prior turn (kept masked, cache-stable).",
        },
      },
      required: ["observations", "current_turn", "window_turns"],
    },
  },
  {
    name: "read_gate_check",
    description:
      "F16 Dedup-VoI Read Gate. Given a proposed file read (path, content " +
      "hash, turn, tokens, epoch) and the prior resident set, returns the " +
      "verdict and updated resident set. A `deny` fires only when the identical " +
      "content is provably still in context (same content hash AND same " +
      "compaction epoch), so it is information-lossless by construction; every " +
      "uncertain case (changed content, advanced epoch, first read) allows. " +
      "Deterministic hash state machine; reclaim from caller-measured tokens.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "File path being read." },
        content_hash: { type: "string" as const, description: "SHA of current content." },
        turn: { type: "number" as const, description: "Current turn number." },
        tokens: { type: "number" as const, description: "Measured token cost of the read." },
        epoch: { type: "number" as const, description: "Current compaction epoch." },
        resident_set: {
          type: "object" as const,
          description: "Prior resident set { epoch, entries } (omit for fresh).",
        },
      },
      required: ["path", "content_hash", "turn", "tokens", "epoch"],
    },
  },
  {
    name: "program_slice",
    description:
      "F17 Program-Slice Context Selection. Given a symbol dependency graph " +
      "(nodes + directed edges where `from` depends on `to`, e.g. from the " +
      "repo_map tool) and seed symbols, returns the backward static slice — the " +
      "transitive dependency closure the seeds need. Sound reachability, not a " +
      "heuristic: with no token_budget the slice drops no dependency " +
      "(`sound:true`). Forward direction yields the change-impact set. " +
      "Budget cuts fall on the farthest symbols first and are reported. " +
      "Deterministic graph traversal.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nodes: {
          type: "array" as const,
          description: "Graph nodes: { id, tokens? }.",
          items: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const },
              tokens: { type: "number" as const },
            },
            required: ["id"],
          },
        },
        edges: {
          type: "array" as const,
          description: "Dependency edges: { from, to } (`from` depends on `to`).",
          items: {
            type: "object" as const,
            properties: {
              from: { type: "string" as const },
              to: { type: "string" as const },
            },
            required: ["from", "to"],
          },
        },
        seeds: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Seed symbol ids (the task's targets).",
        },
        direction: {
          type: "string" as const,
          enum: ["backward", "forward"] as const,
          description: "backward = dependencies (default); forward = impact.",
        },
        max_depth: { type: "number" as const, description: "Max hops from a seed." },
        token_budget: {
          type: ["number", "null"] as const,
          description: "Optional cap; farthest symbols cut first, reported.",
        },
      },
      required: ["nodes", "edges", "seeds"],
    },
  },
  {
    name: "price_quote",
    description:
      "F18 Token Clearing-Price Controller. Advances the PID price loop with a " +
      "budget reading (spent/budget) and returns the updated state and lambda — " +
      "the marginal value of a token in quality units that every actuator bids " +
      "against (act iff qualityGain >= lambda*tokenCost). lambda rises over " +
      "budget, falls under it. Supply an optional `bid` to get the " +
      "spend/skip/abstain decision; it abstains (never forces) when quality is " +
      "unknown. Functional — caller persists `state`. Deterministic control math.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spent: { type: "number" as const, description: "Tokens/cost spent in the window." },
        budget: { type: "number" as const, description: "Window budget (> 0)." },
        state: {
          type: "object" as const,
          description: "Prior controller state (omit to start at the neutral midpoint).",
        },
        config: {
          type: "object" as const,
          description: "Optional PID gains / lambda bounds / setpoint override.",
        },
        bid: {
          type: "object" as const,
          description: "Optional bid to evaluate: { quality_gain, token_cost }.",
          properties: {
            quality_gain: { type: ["number", "null"] as const },
            token_cost: { type: "number" as const },
          },
          required: ["token_cost"],
        },
      },
      required: ["spent", "budget"],
    },
  },
  {
    name: "prefix_warm_plan",
    description:
      "Cross-session reuse — TTL-aware prompt-cache prefix warming (companion " +
      "to the f12 skill library). Given a tracked prefix (hash, tokens, " +
      "lastUsedAt), the current time, the provider cache TTL, and whether reuse " +
      "is expected, returns the cache assessment (warm | expired | absent + " +
      "expiry), a keep-alive decision (warm a warm-but-soon-expiring prefix; " +
      "prime an expired/absent one only when reuse is expected), and the " +
      "read-discount savings of reusing it. Deterministic TTL arithmetic; all " +
      "magnitudes caller-supplied (never fabricated).",
    inputSchema: {
      type: "object" as const,
      properties: {
        entry: {
          type: ["object", "null"] as const,
          description: "Tracked prefix { prefixHash, tokens, lastUsedAt } (null if never seen).",
        },
        now: { type: "number" as const, description: "Current epoch ms." },
        ttl_ms: { type: "number" as const, description: "Provider cache TTL in ms." },
        refresh_threshold_ms: {
          type: "number" as const,
          description: "Keep-alive when a warm prefix expires within this window.",
        },
        reuse_expected: {
          type: "boolean" as const,
          description: "Whether the prefix is expected to be reused.",
        },
        cache_read_discount: {
          type: "number" as const,
          description: "Optional: fraction of full price a cache read costs ([0,1]).",
        },
        expected_hits: {
          type: "number" as const,
          description: "Optional: number of warm re-serves for the savings projection.",
        },
      },
      required: ["now", "ttl_ms", "refresh_threshold_ms", "reuse_expected"],
    },
  },
  {
    name: "wastebench_attest",
    description:
      "F19 WasteBench + Signed Attestations. Rolls up counterfactual net " +
      "savings from measured records (gross savings minus the observer's OWN " +
      "overhead — net can be negative and is reported honestly), evaluates the " +
      "reflexive overhead SLO (the tool must cost less than a bounded fraction " +
      "of what it saves), and signs the manifest with Ed25519 over a " +
      "deterministic canonical form (tamper-evident). Omit private_key_pem to " +
      "mint an ephemeral keypair; the returned attestation embeds the public " +
      "key for verification. Deterministic given issued_at + key.",
    inputSchema: {
      type: "object" as const,
      properties: {
        records: {
          type: "array" as const,
          description:
            "Savings records: { feature, baselineTokens, optimizedTokens, overheadTokens }.",
          items: {
            type: "object" as const,
            properties: {
              feature: { type: "string" as const },
              baselineTokens: { type: "number" as const },
              optimizedTokens: { type: "number" as const },
              overheadTokens: { type: "number" as const },
            },
            required: ["feature", "baselineTokens", "optimizedTokens", "overheadTokens"],
          },
        },
        max_overhead_ratio: {
          type: "number" as const,
          description: "Reflexive SLO budget (overhead/gross), default 0.1.",
        },
        issued_at: { type: "string" as const, description: "ISO timestamp (default now)." },
        window: {
          type: ["object", "null"] as const,
          description: "Optional { from, to } window covered.",
        },
        private_key_pem: {
          type: "string" as const,
          description: "Ed25519 signing key PEM; omit for an ephemeral keypair.",
        },
      },
      required: ["records"],
    },
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleAnalyzeContext(args: {
  files: string[];
  model?: string;
}): Promise<string> {
  const { files, model = "gpt-4o" } = args;

  // Read files
  const fileContents = files.map((filePath) => {
    try {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(process.cwd(), filePath);
      return {
        path: filePath,
        content: fs.readFileSync(absolutePath, "utf-8"),
      };
    } catch (error) {
      return {
        path: filePath,
        content: "",
        error: "File not found or unreadable",
      };
    }
  });

  // Count tokens
  const validFiles = fileContents.filter((f) => !("error" in f));
  const batch = countTokensBatch(
    validFiles.map((f) => ({ path: f.path, content: f.content })),
    model
  );

  // Generate recommendation
  let recommendation: "proceed" | "squeeze" | "abort";
  const threshold = 10000;
  if (batch.total.tokens < threshold) {
    recommendation = "proceed";
  } else if (batch.total.tokens < threshold * 5) {
    recommendation = "squeeze";
  } else {
    recommendation = "abort";
  }

  // Build response
  const response = {
    totalTokens: batch.total.tokens,
    totalCost: formatCost(batch.total.cost),
    model,
    recommendation,
    files: batch.files.map((f) => ({
      path: f.path,
      tokens: f.tokens,
      percentage: Math.round((f.tokens / batch.total.tokens) * 100),
    })),
    warnings:
      recommendation === "squeeze"
        ? ["Consider using squeeze_files to reduce token count"]
        : recommendation === "abort"
          ? ["Context too large. Break into smaller chunks."]
          : [],
  };

  return JSON.stringify(response, null, 2);
}

async function handleSqueezeFiles(args: {
  files: string[];
  tier?: SqueezeTier;
}): Promise<string> {
  const { files, tier = "structural" } = args;

  const results = files.map((filePath) => {
    try {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(process.cwd(), filePath);
      const content = fs.readFileSync(absolutePath, "utf-8");
      const result = squeezeFile(content, filePath, { tier });

      return {
        path: filePath,
        originalTokens: result.originalTokens,
        compressedTokens: result.compressedTokens,
        savings: result.savingsPercent + "%",
        isValid: result.isValid,
        compressedContent: result.compressedCode,
        diffSummary: result.diffSummary,
      };
    } catch (error) {
      return {
        path: filePath,
        error: "Failed to squeeze file",
      };
    }
  });

  const totalOriginal = results.reduce(
    (sum, r) => sum + (r.originalTokens || 0),
    0
  );
  const totalCompressed = results.reduce(
    (sum, r) => sum + (r.compressedTokens || 0),
    0
  );
  const totalSavings = totalOriginal - totalCompressed;
  const savingsPercent = Math.round((totalSavings / totalOriginal) * 100);

  const response = {
    tier,
    totalOriginalTokens: totalOriginal,
    totalCompressedTokens: totalCompressed,
    totalSavings: formatTokens(totalSavings) + " (" + savingsPercent + "%)",
    costSaved: formatCost(estimateCost(totalSavings, "gpt-4o")),
    files: results,
  };

  return JSON.stringify(response, null, 2);
}

async function handleCheckBudget(): Promise<string> {
  const usage = await fetchCursorUsage();

  if (!usage) {
    return JSON.stringify({
      error: "Could not fetch usage. Cursor may not be installed or logged in.",
      suggestion: "Check that Cursor is running and you are logged in.",
    });
  }

  let alertLevel: "green" | "yellow" | "red";
  if (usage.requestsRemaining > usage.requestsLimit * 0.5) {
    alertLevel = "green";
  } else if (usage.requestsRemaining > usage.requestsLimit * 0.2) {
    alertLevel = "yellow";
  } else {
    alertLevel = "red";
  }

  return JSON.stringify({
    plan: usage.plan,
    requestsRemaining: usage.requestsRemaining,
    requestsUsed: usage.requestsUsed,
    requestsLimit: usage.requestsLimit,
    resetDate: usage.resetDate.toISOString(),
    alertLevel,
    recommendation:
      alertLevel === "red"
        ? "Low on requests. Consider using squeeze_files to reduce token usage."
        : alertLevel === "yellow"
          ? "Moderate requests remaining. Be mindful of large context operations."
          : "Plenty of requests remaining.",
  });
}

async function handleCacheReport(args: {
  transcript_path: string;
  window_turns?: number;
  ttl?: "5m" | "1h";
  system_prompt?: string;
}): Promise<string> {
  const reader = new TranscriptReader(args.transcript_path);
  if (!reader.exists()) {
    return JSON.stringify({
      error: `transcript not found: ${args.transcript_path}`,
    });
  }
  const { turns: allTurns } = await loadCachedSessionView(args.transcript_path);
  const window =
    args.window_turns && args.window_turns > 0
      ? allTurns.slice(-args.window_turns)
      : allTurns;

  const cacheInputs: CacheTurnInput[] = window.map((t) => ({
    model: t.model,
    usage: t.usage,
  }));

  const metrics = computeCacheMetrics(cacheInputs, args.ttl ?? "5m");
  const diagnoses = diagnoseCacheBust({
    systemPrompt: args.system_prompt,
    turns: cacheInputs,
  });

  return JSON.stringify({
    transcript_path: args.transcript_path,
    window: {
      totalTurns: allTurns.length,
      analyzedTurns: window.length,
    },
    metrics: {
      hitRate: metrics.hitRate,
      writeAmplification: metrics.writeAmplification,
      totalInputTokens: metrics.totalInputTokens,
      cacheReadTokens: metrics.cacheReadTokens,
      cacheCreationTokens: metrics.cacheCreationTokens,
      uncachedInputTokens: metrics.uncachedInputTokens,
      outputTokens: metrics.outputTokens,
    },
    cost: {
      actual: formatCost(metrics.cost.actual),
      ifAllCached: formatCost(metrics.cost.ifAllCached),
      ifNoCache: formatCost(metrics.cost.ifNoCache),
      savedVsNoCache: formatCost(metrics.cost.savedVsNoCache),
    },
    diagnoses,
  }, null, 2);
}

async function handleLoopStatus(args: {
  transcript_path: string;
  current_model?: string;
  consecutive_low_roi_threshold?: number;
}): Promise<string> {
  const reader = new TranscriptReader(args.transcript_path);
  if (!reader.exists()) {
    return JSON.stringify({
      error: `transcript not found: ${args.transcript_path}`,
    });
  }
  const view = await loadCachedSessionView(args.transcript_path);
  const turns = view.turns;
  const walk = view.walk ?? {
    sessionROI: {
      cumulativeRoiScore: 0,
      totalProductiveTokens: 0,
      totalRecursiveTokens: 0,
      totalTokens: 0,
      consecutiveLowRoiTurns: 0,
      lowRoiStreak: [],
    },
    perTurn: [],
  };

  // If the caller didn't pass a model, infer from the most recent assistant turn.
  const inferredModel =
    args.current_model ??
    (walk.lastTurn ? turns[turns.length - 1]?.model : undefined);

  const decision = evaluateLoopBlock(walk, {
    consecutiveLowRoiThreshold: args.consecutive_low_roi_threshold ?? 3,
    currentModel: inferredModel,
  });

  return JSON.stringify(
    {
      transcript_path: args.transcript_path,
      totalTurns: turns.length,
      sessionROI: {
        cumulativeRoiScore: walk.sessionROI.cumulativeRoiScore,
        consecutiveLowRoiTurns: walk.sessionROI.consecutiveLowRoiTurns,
        totalTokens: walk.sessionROI.totalTokens,
        totalProductiveTokens: walk.sessionROI.totalProductiveTokens,
        totalRecursiveTokens: walk.sessionROI.totalRecursiveTokens,
      },
      lastTurn: walk.lastAnalysis
        ? {
            turnNumber: walk.lastAnalysis.turnNumber,
            classification: walk.lastAnalysis.classification,
            roiScore: walk.lastAnalysis.roiScore,
            signals: walk.lastAnalysis.signals,
          }
        : null,
      decision,
      blockMessage: decision.shouldBlock
        ? formatLoopBlockMessage(decision)
        : null,
    },
    null,
    2
  );
}

function handleRoutingSuggestion(args: {
  current_model: string;
  consecutive_low_roi_turns: number;
}): string {
  const suggestion = getModelRoutingSuggestion(
    args.current_model,
    args.consecutive_low_roi_turns
  );
  return JSON.stringify(suggestion, null, 2);
}

interface LineDiff {
  unified: string;
  added: number;
  removed: number;
  /** True when the inputs exceeded the LCS table cap and the diff was skipped. */
  skipped?: boolean;
}

// Cap on the LCS DP table size. 4M cells ≈ 32 MB at 8 bytes/Number — beyond
// this the table-based diff isn't worth computing for a token-cost estimate,
// and the caller falls through to "send signatures or full" anyway.
const MAX_DIFF_CELLS = 4_000_000;

function computeUnifiedDiff(before: string, after: string): LineDiff {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const n = beforeLines.length;
  const m = afterLines.length;
  if (n * m > MAX_DIFF_CELLS) {
    return { unified: "", added: 0, removed: 0, skipped: true };
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0)
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        beforeLines[i - 1] === afterLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const out: string[] = [];
  let added = 0;
  let removed = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      out.push(`+${afterLines[j - 1]}`);
      added++;
      j--;
    } else if (i > 0) {
      out.push(`-${beforeLines[i - 1]}`);
      removed++;
      i--;
    } else {
      break;
    }
  }
  out.reverse();
  return { unified: out.join("\n"), added, removed };
}

// Refuse to read files larger than this from disk in diff_context — a giant
// minified bundle would otherwise pin the MCP event loop and starve every
// concurrent tool call. Callers that want a diff on something bigger must
// pass `content` themselves.
const MAX_DIFF_FILE_BYTES = 10 * 1024 * 1024;

async function handleDiffContext(args: {
  file_path: string;
  content?: string;
  previously_seen_sha256?: string;
  previously_seen_content?: string;
  model?: string;
  large_file_threshold?: number;
}): Promise<string> {
  const model = args.model ?? "gpt-4o";
  let content = args.content;
  if (content === undefined) {
    try {
      const stat = await fs.promises.stat(args.file_path);
      if (stat.size > MAX_DIFF_FILE_BYTES) {
        return JSON.stringify({
          file_path: args.file_path,
          error: `file too large for diff_context (${stat.size} bytes > ${MAX_DIFF_FILE_BYTES}); pass content explicitly if a diff is still desired`,
        });
      }
      content = await fs.promises.readFile(args.file_path, "utf-8");
    } catch (e) {
      return JSON.stringify({
        error: `cannot read ${args.file_path}: ${(e as Error).message}`,
      });
    }
  }

  const currentSha = sha256Hex(content);
  const fullTokens = countTokens(content, model).tokens;
  const threshold = args.large_file_threshold ?? 1500;

  // Decision 1: unchanged since last send → tell caller it's already in
  // context (zero new tokens).
  if (
    args.previously_seen_sha256 &&
    args.previously_seen_sha256 === currentSha
  ) {
    return JSON.stringify(
      {
        file_path: args.file_path,
        sha256: currentSha,
        decision: "unchanged",
        payload: null,
        sentTokens: 0,
        fullFileTokens: fullTokens,
        message:
          "File unchanged since last send — already in context. Skip the re-read.",
      },
      null,
      2
    );
  }

  // Decision 2: have previous content → try a diff.
  if (args.previously_seen_content !== undefined) {
    const diff = computeUnifiedDiff(args.previously_seen_content, content);
    const diffTokens = countTokens(diff.unified, model).tokens;
    if (diffTokens > 0 && diffTokens <= fullTokens * 0.3) {
      return JSON.stringify(
        {
          file_path: args.file_path,
          sha256: currentSha,
          decision: "diff",
          payload: diff.unified,
          sentTokens: diffTokens,
          fullFileTokens: fullTokens,
          added: diff.added,
          removed: diff.removed,
          savingsPercent: Math.round((1 - diffTokens / fullTokens) * 100),
        },
        null,
        2
      );
    }
  }

  // Decision 3: large file with no baseline → AST signatures.
  if (fullTokens > threshold) {
    try {
      const squeezed = squeezeFile(content, args.file_path, {
        tier: "structural",
      });
      return JSON.stringify(
        {
          file_path: args.file_path,
          sha256: currentSha,
          decision: "signatures",
          payload: squeezed.compressedCode,
          sentTokens: squeezed.compressedTokens,
          fullFileTokens: fullTokens,
          savingsPercent: squeezed.savingsPercent,
        },
        null,
        2
      );
    } catch {
      // fall through to full
    }
  }

  return JSON.stringify(
    {
      file_path: args.file_path,
      sha256: currentSha,
      decision: "full",
      payload: content,
      sentTokens: fullTokens,
      fullFileTokens: fullTokens,
    },
    null,
    2
  );
}

async function handleCompactionCheck(args: {
  transcript_path: string;
  window_turns?: number;
}): Promise<string> {
  const reader = new TranscriptReader(args.transcript_path);
  if (!reader.exists()) {
    return JSON.stringify({
      error: `transcript not found: ${args.transcript_path}`,
    });
  }
  const { turns } = await loadCachedSessionView(args.transcript_path);
  if (turns.length < 2) {
    return JSON.stringify({
      transcript_path: args.transcript_path,
      totalTurns: turns.length,
      detected: false,
      reason: "Not enough turns to compare.",
    });
  }
  const splitAt =
    args.window_turns && args.window_turns > 0
      ? Math.min(args.window_turns, turns.length - 1)
      : Math.floor(turns.length / 2);

  const before = turns.slice(0, splitAt);
  const after = turns.slice(splitAt);

  // Build pre-compaction buffer from turn text (best-effort approximation —
  // a real PreCompact hook would supply the exact transcript window).
  // The helper also yields `beforeContent` so both sides go through the
  // SAME tokenizer (MessageBuffer.getTotalTokens is heuristic and would
  // disagree with countTokens by tens of percent, triggering spurious
  // "compaction detected" verdicts).
  const { buffer, beforeContent } = projectTurnsToBuffer(before);

  const postContent = after
    .map((t) => t.textContent)
    .filter((s) => s)
    .join("\n");

  // Both sides through the SAME tokenizer — see comment above.
  const beforeTokens = countTokens(beforeContent, "gpt-4o").tokens;
  const afterTokens = countTokens(postContent, "gpt-4o").tokens;
  const detected = detectCompaction(beforeTokens, afterTokens, 0.5);

  const diff = analyzeCompaction(buffer, postContent, splitAt);

  return JSON.stringify(
    {
      transcript_path: args.transcript_path,
      totalTurns: turns.length,
      splitAt,
      detected,
      lostReferences: diff.lostReferences.map((r) => ({
        item: r.item,
        category: r.category,
        original_turn: r.original_turn,
      })),
      tokensBefore: diff.tokensBefore,
      tokensAfter: diff.tokensAfter,
      tokensRemoved: diff.tokensRemoved,
      overheadCostUsd: diff.overheadCostUsd,
      summary: diff.summary,
    },
    null,
    2
  );
}

// ============================================================================
// SLO (SRE Error Budget pattern for AI cost)
// ============================================================================

import { SloManager } from "@prune/slo";

async function withSloManager<T>(
  sqlitePath: string | undefined,
  fn: (mgr: SloManager, sink: LocalSqliteSink) => Promise<T>
): Promise<T> {
  const sink = new LocalSqliteSink({ path: defaultBudgetSqlitePath(sqlitePath) });
  await sink.init();
  try {
    return await fn(new SloManager(sink), sink);
  } finally {
    await sink.close();
  }
}

async function handleSloDefine(args: {
  name: string;
  scope_envelope_name: string;
  target_usd_per_task: number;
  error_budget_usd: number;
  window_days: number;
  warning_pct?: number;
  task_dimension?: string;
  sqlite_path?: string;
}): Promise<string> {
  return withSloManager(args.sqlite_path, async (mgr) => {
    const row = await mgr.define({
      name: args.name,
      scopeEnvelopeName: args.scope_envelope_name,
      targetUsdPerTask: args.target_usd_per_task,
      errorBudgetUsd: args.error_budget_usd,
      windowDays: args.window_days,
      warningPct: args.warning_pct,
      taskDimension: args.task_dimension,
    });
    return JSON.stringify({ ok: true, slo: row }, null, 2);
  });
}

async function handleSloCheck(args: {
  name: string;
  sqlite_path?: string;
}): Promise<string> {
  return withSloManager(args.sqlite_path, async (mgr) => {
    const decision = await mgr.check(args.name);
    return JSON.stringify(
      {
        slo: args.name,
        verdict: decision.verdict,
        rule: decision.rule,
        rationale: decision.rationale,
        remediations: decision.remediations,
        sli: {
          window_start: decision.sli.windowStart,
          window_end: decision.sli.windowEnd,
          total_task_count: decision.sli.totalTaskCount,
          compliant_task_count: decision.sli.compliantTaskCount,
          violating_task_count: decision.sli.violatingTaskCount,
          compliance_ratio: decision.sli.complianceRatio,
          excess_spend_usd: decision.sli.excessSpendUsd,
          error_budget_remaining_usd: decision.sli.errorBudgetRemainingUsd,
          error_budget_burn_pct: decision.sli.errorBudgetBurnPct,
          p50_task_cost_usd: decision.sli.p50TaskCostUsd,
          p95_task_cost_usd: decision.sli.p95TaskCostUsd,
          p99_task_cost_usd: decision.sli.p99TaskCostUsd,
          mean_task_cost_usd: decision.sli.meanTaskCostUsd,
        },
      },
      null,
      2
    );
  });
}

async function handleSloStatus(args: {
  name: string;
  sqlite_path?: string;
}): Promise<string> {
  return withSloManager(args.sqlite_path, async (mgr) => {
    const sli = await mgr.sli(args.name);
    return JSON.stringify(
      {
        slo: sli.slo,
        window_start: sli.windowStart,
        window_end: sli.windowEnd,
        total_task_count: sli.totalTaskCount,
        compliant_task_count: sli.compliantTaskCount,
        violating_task_count: sli.violatingTaskCount,
        compliance_ratio: sli.complianceRatio,
        excess_spend_usd: sli.excessSpendUsd,
        error_budget_remaining_usd: sli.errorBudgetRemainingUsd,
        error_budget_burn_pct: sli.errorBudgetBurnPct,
        p50_task_cost_usd: sli.p50TaskCostUsd,
        p95_task_cost_usd: sli.p95TaskCostUsd,
        p99_task_cost_usd: sli.p99TaskCostUsd,
        mean_task_cost_usd: sli.meanTaskCostUsd,
        tasks: sli.tasks,
      },
      null,
      2
    );
  });
}

// ============================================================================
// Attribution (cross-vendor per-developer / per-PR / per-project rollup)
// ============================================================================

import { rollup, type RollupKey } from "@prune/attribution";

async function handleAttributionRollup(args: {
  envelope_name: string;
  group_by?: string[];
  since?: string;
  until?: string;
  sqlite_path?: string;
  limit?: number;
}): Promise<string> {
  const sink = new LocalSqliteSink({ path: defaultBudgetSqlitePath(args.sqlite_path) });
  await sink.init();
  try {
    const env = await sink.getBudgetEnvelope(args.envelope_name);
    if (!env) {
      return JSON.stringify({ error: `envelope "${args.envelope_name}" not found` });
    }
    const charges = await sink.getRecentBudgetCharges(env.envelope_id, args.limit ?? 5000);
    const groupBy = (args.group_by ?? ["developer"]) as RollupKey[];
    const groups = rollup(charges, {
      groupBy,
      since: args.since,
      until: args.until,
    });
    return JSON.stringify(
      {
        envelope: args.envelope_name,
        group_by: groupBy,
        since: args.since ?? null,
        until: args.until ?? null,
        charge_count: charges.length,
        group_count: groups.length,
        groups,
      },
      null,
      2
    );
  } finally {
    await sink.close();
  }
}

// ============================================================================
// Exporters (OTel GenAI semconv + FOCUS v1.3)
// ============================================================================

import {
  mapChargesToFocus,
  mapChargesToOtel,
  rowsToCsv,
  FOCUS_COLUMNS,
} from "@prune/export";

async function handleExportFocusCsv(args: {
  envelope_name: string;
  sqlite_path?: string;
  sub_account_id?: string;
  sub_account_name?: string;
  limit?: number;
}): Promise<string> {
  return withBudgetGate(args.sqlite_path, async (gate, sink) => {
    const env = await gate.getEnvelope(args.envelope_name);
    if (!env) {
      return JSON.stringify({ error: `envelope "${args.envelope_name}" not found` });
    }
    const charges = await sink.getRecentBudgetCharges(env.envelope_id, args.limit ?? 1000);
    const rows = mapChargesToFocus(charges, {
      subAccountId: args.sub_account_id,
      subAccountName: args.sub_account_name,
    });
    // Coerce: FocusRow has strict types but rowsToCsv accepts any
    // Record<string, unknown>. The shape is compatible at runtime.
    const csv = rowsToCsv(
      rows as unknown as Array<Record<string, unknown>>,
      FOCUS_COLUMNS as unknown as ReadonlyArray<string>
    );
    return csv;
  });
}

async function handleExportOtel(args: {
  envelope_name: string;
  sqlite_path?: string;
  limit?: number;
}): Promise<string> {
  return withBudgetGate(args.sqlite_path, async (gate, sink) => {
    const env = await gate.getEnvelope(args.envelope_name);
    if (!env) {
      return JSON.stringify({ error: `envelope "${args.envelope_name}" not found` });
    }
    const charges = await sink.getRecentBudgetCharges(env.envelope_id, args.limit ?? 1000);
    return JSON.stringify(mapChargesToOtel(charges), null, 2);
  });
}

// ============================================================================
// Sentinel (pre-prompt secret scan + MCP-response injection shield)
// ============================================================================

import {
  scanPromptForSecrets,
  scanMcpResponseForInjection,
} from "@prune/sentinel";

async function handleSentinelScanPrompt(args: {
  payload: string;
  block_on_pattern_ids?: string[];
  min_entropy?: number;
}): Promise<string> {
  const report = scanPromptForSecrets(args.payload, {
    blockOnPatternIds: args.block_on_pattern_ids,
    entropy: args.min_entropy !== undefined ? { minEntropy: args.min_entropy } : undefined,
  });
  return JSON.stringify(
    {
      verdict: report.verdict,
      reason: report.reason,
      secret_findings: report.secretFindings,
      entropy_findings: report.entropyFindings,
      redacted_payload: report.redactedPayload,
    },
    null,
    2
  );
}

async function handleSentinelScanMcp(args: {
  payload: string;
  block_on_categories?: Array<
    "SHADOWING" | "PATH_TRAVERSAL" | "ARGUMENT_INJECTION" | "HIDDEN_HTML" | "INDIRECT_MARKUP"
  >;
}): Promise<string> {
  const report = scanMcpResponseForInjection(args.payload, {
    blockOnCategories: args.block_on_categories,
  });
  return JSON.stringify(
    {
      verdict: report.verdict,
      reason: report.reason,
      injection_findings: report.injectionFindings,
    },
    null,
    2
  );
}

// ============================================================================
// Router (three-tier deterministic classifier + policy)
// ============================================================================

import { classifyRequest, route } from "@prune/router";

async function handleRoutingDecide(args: {
  prompt: string;
  estimated_tokens_in: number;
  files_in_context?: number;
  recent_error?: boolean;
  floor?: "FAST" | "STD" | "STRONG";
  fast_model?: string;
  std_model?: string;
  strong_model?: string;
}): Promise<string> {
  const classification = classifyRequest({
    prompt: args.prompt,
    estimatedTokensIn: args.estimated_tokens_in,
    filesInContext: args.files_in_context,
    recentError: args.recent_error,
  });
  const decision = route(classification, {
    floor: args.floor,
    tierMap: {
      ...(args.fast_model ? { FAST: args.fast_model } : {}),
      ...(args.std_model ? { STD: args.std_model } : {}),
      ...(args.strong_model ? { STRONG: args.strong_model } : {}),
    },
  });
  return JSON.stringify(
    {
      tier: decision.tier,
      model: decision.model,
      rule: decision.rule,
      rationale: decision.rationale,
      classification: decision.classification,
    },
    null,
    2
  );
}

// ============================================================================
// Repo Map (Aider-class symbol graph)
// ============================================================================

import { indexRepo, queryMap } from "@prune/repo-map";

async function handleRepoMap(args: {
  root: string;
  task_query?: string;
  top_k?: number;
  damping?: number;
}): Promise<string> {
  const map = await indexRepo(args.root);
  const ranked = queryMap(map, {
    taskQuery: args.task_query,
    topK: args.top_k ?? 50,
    damping: args.damping,
  });
  return JSON.stringify(
    {
      root: map.root,
      files_scanned: map.filesScanned,
      bytes_scanned: map.bytesScanned,
      total_symbols: map.symbols.length,
      ranked_count: ranked.length,
      ranked,
    },
    null,
    2
  );
}

// ============================================================================
// Replay Vault (audit/attestation front-end)
// ============================================================================

import { ReplayVault } from "@prune/replay-vault";

function defaultVaultSqlitePath(override?: string): string {
  const p =
    override ||
    process.env.PRUNE_VAULT_SQLITE ||
    joinPath(homedir(), ".prune", "vault.sqlite");
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

async function withVault<T>(
  sqlitePath: string | undefined,
  keyPath: string | undefined,
  fn: (vault: ReplayVault, sink: LocalSqliteSink) => Promise<T>
): Promise<T> {
  const sink = new LocalSqliteSink({ path: defaultVaultSqlitePath(sqlitePath) });
  await sink.init();
  try {
    return await fn(new ReplayVault(sink, { keyPath }), sink);
  } finally {
    await sink.close();
  }
}

async function handleReplayVerify(args: {
  session_id: string;
  sqlite_path?: string;
  key_path?: string;
}): Promise<string> {
  return withVault(args.sqlite_path, args.key_path, async (vault) => {
    const result = await vault.verify(args.session_id);
    return JSON.stringify(
      {
        session_id: args.session_id,
        ok: result.ok,
        broke_at_sequence: result.brokeAtSequence,
        records_checked: result.recordsChecked,
        signer_fingerprint: vault.fingerprint(),
        per_row: result.perRow,
      },
      null,
      2
    );
  });
}

async function handleReplayList(args: {
  session_id: string;
  sqlite_path?: string;
}): Promise<string> {
  return withVault(args.sqlite_path, undefined, async (vault) => {
    const rows = await vault.list(args.session_id);
    return JSON.stringify(
      {
        session_id: args.session_id,
        count: rows.length,
        records: rows,
      },
      null,
      2
    );
  });
}

// ============================================================================
// Subagent Status (runaway-prevention front-end)
// ============================================================================

import {
  analyzeSubagents,
  evaluateSubagentBlock,
  analyzeCacheCoPilot,
} from "@prune/intelligence";

async function handleCacheCoPilot(args: {
  transcript_path: string;
  min_cacheable_prefix_tokens?: number;
  min_consecutive_turns_for_silent_failure?: number;
}): Promise<string> {
  const { turns } = await loadCachedSessionView(args.transcript_path);
  const inputs = turns.map((t) => ({ model: t.model, usage: t.usage }));
  const timestamps = turns.map((t) => t.endedAt ?? t.startedAt ?? "");
  const allTimestamped = timestamps.every((s) => s !== "");
  const report = analyzeCacheCoPilot({
    turns: inputs,
    turnTimestamps: allTimestamped ? timestamps : undefined,
    minCacheablePrefixTokens: args.min_cacheable_prefix_tokens,
    minConsecutiveTurnsForSilentFailure: args.min_consecutive_turns_for_silent_failure,
  });
  return JSON.stringify(
    {
      silent_failures: report.silentFailures.map((s) => ({
        start_turn_index: s.startTurnIndex,
        end_turn_index: s.endTurnIndex,
        consecutive_turns: s.consecutiveTurns,
        uncached_input_tokens: s.uncachedInputTokens,
        estimated_extra_cost_usd: s.estimatedExtraCostUsd,
        suggestion: s.suggestion,
      })),
      ttl_penalties: report.ttlPenalties.map((t) => ({
        from_turn_index: t.fromTurnIndex,
        to_turn_index: t.toTurnIndex,
        gap_minutes: t.gapMinutes,
        cache_create_tokens: t.cacheCreateTokens,
        estimated_extra_cost_usd: t.estimatedExtraCostUsd,
        suggestion: t.suggestion,
      })),
      total_lost_usd: report.totalLostUsd,
      recommended_actions: report.recommendedActions,
      ttl_penalty_inspection_possible: allTimestamped,
    },
    null,
    2
  );
}

async function handleSubagentStatus(args: {
  transcript_path: string;
  proposed_task_count?: number;
  max_concurrent?: number;
  max_burst?: number;
  max_parallel_in_turn?: number;
  max_subagent_minutes?: number;
}): Promise<string> {
  const { turns } = await loadCachedSessionView(args.transcript_path);
  const activity = analyzeSubagents(turns);
  const decision = evaluateSubagentBlock(activity, {
    proposedTaskCount: args.proposed_task_count ?? 0,
    maxConcurrentSubagents: args.max_concurrent,
    maxBurstCount: args.max_burst,
    maxParallelInOneTurn: args.max_parallel_in_turn,
    maxSubagentMinutes: args.max_subagent_minutes,
  });
  return JSON.stringify(
    {
      activity: {
        active_count: activity.activeCount,
        total_count: activity.totalCount,
        longest_active_minutes: activity.longestActiveMinutes,
        peak_parallel_in_one_turn: activity.peakParallelInOneTurn,
        bursts: activity.bursts.map((b) => ({
          window_start: b.windowStart.toISOString(),
          window_end: b.windowEnd.toISOString(),
          count: b.count,
        })),
      },
      decision: {
        should_block: decision.shouldBlock,
        pattern: decision.pattern,
        reason: decision.reason,
        warnings: decision.warnings,
        suggestion: decision.suggestion ?? null,
      },
    },
    null,
    2
  );
}

// ============================================================================
// Budget Status / Configure (BudgetGate front-end)
// ============================================================================

import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { dirname, join as joinPath } from "node:path";
import { LocalSqliteSink } from "@prune/persistence";
import { BudgetGate } from "@prune/budget-gate";

function defaultBudgetSqlitePath(override?: string): string {
  const p =
    override ||
    process.env.PRUNE_BUDGET_SQLITE ||
    joinPath(homedir(), ".prune", "budget.sqlite");
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

async function withBudgetGate<T>(
  sqlitePath: string | undefined,
  fn: (gate: BudgetGate, sink: LocalSqliteSink) => Promise<T>
): Promise<T> {
  const sink = new LocalSqliteSink({ path: defaultBudgetSqlitePath(sqlitePath) });
  await sink.init();
  try {
    return await fn(new BudgetGate(sink), sink);
  } finally {
    await sink.close();
  }
}

async function handleBudgetStatus(args: {
  name: string;
  sqlite_path?: string;
}): Promise<string> {
  return withBudgetGate(args.sqlite_path, async (gate) => {
    const env = await gate.getEnvelope(args.name);
    if (!env) {
      return JSON.stringify(
        {
          error: `envelope "${args.name}" not found`,
          hint: 'Create one with the budget_configure tool, e.g. { "name": "default", "limit_usd": 200, "period_kind": "month" }',
        },
        null,
        2
      );
    }
    const state = await gate.getState(args.name);
    return JSON.stringify(
      {
        envelope: {
          name: state.envelope.name,
          limit_usd: state.envelope.limit_usd,
          period_kind: state.envelope.period_kind,
          period_start: state.envelope.period_start,
          period_end: state.envelope.period_end,
          soft_cap_pct: state.envelope.soft_cap_pct,
          hard_cap_pct: state.envelope.hard_cap_pct,
          parent_envelope_id: state.envelope.parent_envelope_id,
        },
        state: {
          spent_usd: state.spentUsd,
          remaining_usd: state.remainingUsd,
          pct_spent: state.pctSpent,
          pct_time_elapsed: state.pctTimeElapsed,
          is_expired: state.isExpired,
          burn_rate_per_day_usd: state.burnRatePerDay,
          days_left_in_period: state.daysLeftInPeriod,
          projected_spend_at_period_end_usd: state.projectedSpendAtPeriodEnd,
          projected_exhaustion_at: state.projectedExhaustionAt?.toISOString() ?? null,
          as_of: state.asOf.toISOString(),
        },
      },
      null,
      2
    );
  });
}

async function handleBudgetConfigure(args: {
  name: string;
  limit_usd: number;
  period_kind: "day" | "week" | "month" | "custom";
  period_start?: string;
  period_end?: string;
  soft_cap_pct?: number;
  hard_cap_pct?: number;
  parent_envelope_name?: string;
  sqlite_path?: string;
}): Promise<string> {
  return withBudgetGate(args.sqlite_path, async (gate) => {
    const row = await gate.createEnvelope({
      name: args.name,
      limitUsd: args.limit_usd,
      periodKind: args.period_kind,
      periodStart: args.period_start ? new Date(args.period_start) : undefined,
      periodEnd: args.period_end ? new Date(args.period_end) : undefined,
      softCapPct: args.soft_cap_pct,
      hardCapPct: args.hard_cap_pct,
      parentEnvelopeName: args.parent_envelope_name,
    });
    return JSON.stringify(
      {
        ok: true,
        envelope: row,
        hint:
          "Wire the budget-gate hook (apps/extension/hooks/budget-gate.mjs) " +
          "as a Stop hook in Claude Code to enforce this envelope, or call " +
          "budget_status to inspect spend.",
      },
      null,
      2
    );
  });
}

// ============================================================================
// Request Handlers
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "analyze_context":
        result = await handleAnalyzeContext(args as { files: string[]; model?: string });
        break;
      case "squeeze_files":
        result = await handleSqueezeFiles(args as { files: string[]; tier?: SqueezeTier });
        break;
      case "check_budget":
        result = await handleCheckBudget();
        break;
      case "cache_report":
        result = await handleCacheReport(args as {
          transcript_path: string;
          window_turns?: number;
          ttl?: "5m" | "1h";
          system_prompt?: string;
        });
        break;
      case "loop_status":
        result = await handleLoopStatus(args as {
          transcript_path: string;
          current_model?: string;
          consecutive_low_roi_threshold?: number;
        });
        break;
      case "routing_suggestion":
        result = handleRoutingSuggestion(args as {
          current_model: string;
          consecutive_low_roi_turns: number;
        });
        break;
      case "diff_context":
        result = await handleDiffContext(args as {
          file_path: string;
          content?: string;
          previously_seen_sha256?: string;
          previously_seen_content?: string;
          model?: string;
          large_file_threshold?: number;
        });
        break;
      case "compaction_check":
        result = await handleCompactionCheck(args as {
          transcript_path: string;
          window_turns?: number;
        });
        break;
      case "slo_define":
        result = await handleSloDefine(args as {
          name: string;
          scope_envelope_name: string;
          target_usd_per_task: number;
          error_budget_usd: number;
          window_days: number;
          warning_pct?: number;
          task_dimension?: string;
          sqlite_path?: string;
        });
        break;
      case "slo_check":
        result = await handleSloCheck(args as {
          name: string;
          sqlite_path?: string;
        });
        break;
      case "slo_status":
        result = await handleSloStatus(args as {
          name: string;
          sqlite_path?: string;
        });
        break;
      case "attribution_rollup":
        result = await handleAttributionRollup(args as {
          envelope_name: string;
          group_by?: string[];
          since?: string;
          until?: string;
          sqlite_path?: string;
          limit?: number;
        });
        break;
      case "export_focus_csv":
        result = await handleExportFocusCsv(args as {
          envelope_name: string;
          sqlite_path?: string;
          sub_account_id?: string;
          sub_account_name?: string;
          limit?: number;
        });
        break;
      case "export_otel_genai":
        result = await handleExportOtel(args as {
          envelope_name: string;
          sqlite_path?: string;
          limit?: number;
        });
        break;
      case "sentinel_scan_prompt":
        result = await handleSentinelScanPrompt(args as {
          payload: string;
          block_on_pattern_ids?: string[];
          min_entropy?: number;
        });
        break;
      case "sentinel_scan_mcp":
        result = await handleSentinelScanMcp(args as {
          payload: string;
          block_on_categories?: Array<
            "SHADOWING" | "PATH_TRAVERSAL" | "ARGUMENT_INJECTION" | "HIDDEN_HTML" | "INDIRECT_MARKUP"
          >;
        });
        break;
      case "routing_decide":
        result = await handleRoutingDecide(args as {
          prompt: string;
          estimated_tokens_in: number;
          files_in_context?: number;
          recent_error?: boolean;
          floor?: "FAST" | "STD" | "STRONG";
          fast_model?: string;
          std_model?: string;
          strong_model?: string;
        });
        break;
      case "repo_map":
        result = await handleRepoMap(args as {
          root: string;
          task_query?: string;
          top_k?: number;
          damping?: number;
        });
        break;
      case "replay_verify":
        result = await handleReplayVerify(args as {
          session_id: string;
          sqlite_path?: string;
          key_path?: string;
        });
        break;
      case "replay_list":
        result = await handleReplayList(args as {
          session_id: string;
          sqlite_path?: string;
        });
        break;
      case "cache_copilot":
        result = await handleCacheCoPilot(args as {
          transcript_path: string;
          min_cacheable_prefix_tokens?: number;
          min_consecutive_turns_for_silent_failure?: number;
        });
        break;
      case "subagent_status":
        result = await handleSubagentStatus(args as {
          transcript_path: string;
          proposed_task_count?: number;
          max_concurrent?: number;
          max_burst?: number;
          max_parallel_in_turn?: number;
          max_subagent_minutes?: number;
        });
        break;
      case "subagent_cost_predict":
        result = handleSubagentCostPredict(
          args as unknown as Parameters<typeof handleSubagentCostPredict>[0]
        );
        break;
      case "reasoning_effort_route":
        result = handleReasoningEffortRoute(
          args as unknown as Parameters<typeof handleReasoningEffortRoute>[0]
        );
        break;
      case "result_prune":
        result = handleResultPrune(
          args as unknown as Parameters<typeof handleResultPrune>[0]
        );
        break;
      case "max_tokens_calibrate":
        result = handleMaxTokensCalibrate(
          args as unknown as Parameters<typeof handleMaxTokensCalibrate>[0]
        );
        break;
      case "diff_vs_rewrite":
        result = handleDiffVsRewrite(
          args as unknown as Parameters<typeof handleDiffVsRewrite>[0]
        );
        break;
      case "open_tab_audit":
        result = handleOpenTabAudit(
          args as unknown as Parameters<typeof handleOpenTabAudit>[0]
        );
        break;
      case "reward_integrity_check":
        result = handleRewardIntegrityCheck(
          args as unknown as Parameters<typeof handleRewardIntegrityCheck>[0]
        );
        break;
      case "observation_mask_plan":
        result = handleObservationMaskPlan(
          args as unknown as Parameters<typeof handleObservationMaskPlan>[0]
        );
        break;
      case "read_gate_check":
        result = handleReadGateCheck(
          args as unknown as Parameters<typeof handleReadGateCheck>[0]
        );
        break;
      case "program_slice":
        result = handleProgramSlice(
          args as unknown as Parameters<typeof handleProgramSlice>[0]
        );
        break;
      case "price_quote":
        result = handlePriceQuote(
          args as unknown as Parameters<typeof handlePriceQuote>[0]
        );
        break;
      case "prefix_warm_plan":
        result = handlePrefixWarmPlan(
          args as unknown as Parameters<typeof handlePrefixWarmPlan>[0]
        );
        break;
      case "wastebench_attest":
        result = handleWastebenchAttest(
          args as unknown as Parameters<typeof handleWastebenchAttest>[0]
        );
        break;
      case "tool_audit":
        result = handleToolAudit(
          args as unknown as Parameters<typeof handleToolAudit>[0]
        );
        break;
      case "qpd_report":
        result = handleQpdReport(args as {
          baseline: ModelAggregate;
          candidates: ModelAggregate[];
          ar_margin?: number;
          cost_dominance_ratio?: number;
        });
        break;
      case "context_health_report":
        result = await handleContextHealthReport(args as {
          transcript_path: string;
          window_turns?: number;
        });
        break;
      case "trajectory_replay_report":
        result = handleTrajectoryReplay(
          args as unknown as Parameters<typeof handleTrajectoryReplay>[0]
        );
        break;
      case "semantic_cache_probe":
        result = handleSemanticCacheProbe(
          args as unknown as Parameters<typeof handleSemanticCacheProbe>[0]
        );
        break;
      case "code_mode_generate_api":
        result = handleCodeModeGenerateApi(
          args as unknown as Parameters<typeof handleCodeModeGenerateApi>[0]
        );
        break;
      case "code_mode_harness":
        result = handleCodeModeHarness(
          args as unknown as Parameters<typeof handleCodeModeHarness>[0]
        );
        break;
      case "replay_cost_plan":
        result = handleReplayCostPlan(
          args as unknown as Parameters<typeof handleReplayCostPlan>[0]
        );
        break;
      case "mcp_proxy_trim":
        result = handleMcpProxyTrim(
          args as unknown as Parameters<typeof handleMcpProxyTrim>[0]
        );
        break;
      case "cache_habits":
        result = handleCacheHabits(
          args as unknown as Parameters<typeof handleCacheHabits>[0]
        );
        break;
      case "cache_habits_from_transcript":
        result = await handleCacheHabitsFromTranscript(
          args as unknown as Parameters<typeof handleCacheHabitsFromTranscript>[0]
        );
        break;
      case "budget_status":
        result = await handleBudgetStatus(args as {
          name: string;
          sqlite_path?: string;
        });
        break;
      case "budget_configure":
        result = await handleBudgetConfigure(args as {
          name: string;
          limit_usd: number;
          period_kind: "day" | "week" | "month" | "custom";
          period_start?: string;
          period_end?: string;
          soft_cap_pct?: number;
          hard_cap_pct?: number;
          parent_envelope_name?: string;
          sqlite_path?: string;
        });
        break;
      default:
        throw new Error("Unknown tool: " + name);
    }

    // Caller-side feature telemetry (f10/f11): record the handler's
    // quality_proof AFTER the handler returned, so the pure handlers stay pure.
    // Gated behind PRUNE_MCP_TELEMETRY=1 (default OFF). Best-effort and
    // self-contained — recordToolFeatureEventBestEffort never throws — but we
    // also belt-and-suspenders guard here so a future change can't let a
    // recording failure mask the result the caller already computed.
    try {
      await recordToolFeatureEventBestEffort(name, result);
    } catch {
      /* unreachable in practice; recording is internally fail-safe */
    }

    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: String(error) }),
        },
      ],
      isError: true,
    };
  }
});

// ============================================================================
// Main
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Prune MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

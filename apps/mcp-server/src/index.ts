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
} from "@prune/intelligence";

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
      default:
        throw new Error("Unknown tool: " + name);
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

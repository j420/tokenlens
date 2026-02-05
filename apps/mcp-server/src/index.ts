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

import { countTokens, countTokensBatch, estimateCost, formatTokens, formatCost } from "@prune/tokenizer";
import { squeezeFile, type SqueezeTier } from "@prune/squeezer";
import { fetchCursorUsage } from "@prune/state-scraper";

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

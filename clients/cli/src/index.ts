#!/usr/bin/env node
import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import WebSocket from "ws";
import chalk from "chalk";

// Event types from WebSocket stream
interface TokenUpdateEvent {
  type: "token_update";
  session_id: string;
  cumulative_session_cost_usd: number;
  cumulative_session_tokens: number;
  turn_cost: number;
  turn_tokens: number;
  roi_score: number | null;
}

interface PruneSuggestionEvent {
  type: "prune_suggestion";
  total_tokens: number;
  relevant_tokens: number;
  estimated_savings_usd: number;
  auto_dismiss_seconds: number;
  confidence: number;
}

interface BurnAlertEvent {
  type: "burn_alert";
  session_id: string;
  pattern: string;
  message_title: string;
  message_body: string;
  tokens_wasted: number;
  cost_wasted_usd: number;
  suggestions: Array<{ label: string; detail: string }>;
}

interface CompactionEvent {
  type: "compaction_event";
  session_id: string;
  turn_number: number;
  tokens_before: number;
  tokens_after: number;
  lost_references: Array<{ item: string; original_turn: number }>;
}

type StreamEvent = TokenUpdateEvent | PruneSuggestionEvent | BurnAlertEvent | CompactionEvent;

// Config from environment
const API_KEY = process.env["PRUNE_API_KEY"] || "";
const API_URL = process.env["PRUNE_API_URL"] || "wss://delimit.dev/api/v1/stream";

// Color thresholds
const THRESHOLD_AMBER_COST = parseFloat(process.env["PRUNE_THRESHOLD_AMBER"] || "2");
const THRESHOLD_RED_COST = parseFloat(process.env["PRUNE_THRESHOLD_RED"] || "5");
const THRESHOLD_AMBER_ROI = 70;
const THRESHOLD_RED_ROI = 40;

// State
let ws: WebSocket | null = null;
let sessionCost = 0;
let lastPruneSuggestion: PruneSuggestionEvent | null = null;
let childProcess: ChildProcess | null = null;

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  // Supported commands
  if (!["claude", "codex"].includes(command)) {
    console.error(chalk.red(`Unknown command: ${command}`));
    printUsage();
    process.exit(1);
  }

  // Connect to WebSocket
  if (API_KEY) {
    connectWebSocket();
  }

  // Spawn the underlying command
  spawnCommand(command, commandArgs);
}

function printUsage(): void {
  console.log(`
${chalk.bold("Prune CLI Wrapper")} - AI cost tracking

${chalk.bold("Usage:")}
  prune claude "your prompt"
  prune codex "your prompt"

${chalk.bold("Environment:")}
  PRUNE_API_KEY      Your Prune API key (required for tracking)
  PRUNE_API_URL      WebSocket URL (default: wss://delimit.dev/api/v1/stream)

${chalk.bold("Shell alias (recommended):")}
  alias claude="prune claude"
  alias codex="prune codex"
`);
}

function connectWebSocket(): void {
  try {
    ws = new WebSocket(`${API_URL}?api_key=${API_KEY}`);

    ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString()) as StreamEvent;
        handleEvent(event);
      } catch {
        // Ignore parse errors
      }
    });

    ws.on("error", () => {
      // Silent - don't disrupt the CLI experience
      ws = null;
    });

    ws.on("close", () => {
      ws = null;
    });
  } catch {
    // Silent
  }
}

function spawnCommand(command: string, args: string[]): void {
  childProcess = spawn(command, args, {
    stdio: ["inherit", "pipe", "inherit"],
    shell: true,
  });

  // Buffer output to detect end of response
  let outputBuffer = "";
  let outputTimer: NodeJS.Timeout | null = null;

  childProcess.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    process.stdout.write(text);
    outputBuffer += text;

    // Reset the timer on each chunk
    if (outputTimer) clearTimeout(outputTimer);

    // After 100ms of no output, assume response is complete
    outputTimer = setTimeout(() => {
      if (outputBuffer.trim()) {
        // Response complete - one-liner will be printed by token_update event
        outputBuffer = "";
      }
    }, 100);
  });

  childProcess.on("close", (code) => {
    if (ws) ws.close();
    process.exit(code ?? 0);
  });

  childProcess.on("error", (err) => {
    console.error(chalk.red(`Failed to start ${command}: ${err.message}`));
    if (ws) ws.close();
    process.exit(1);
  });
}

function handleEvent(event: StreamEvent): void {
  switch (event.type) {
    case "token_update":
      handleTokenUpdate(event);
      break;
    case "prune_suggestion":
      handlePruneSuggestion(event);
      break;
    case "burn_alert":
      handleBurnAlert(event);
      break;
    case "compaction_event":
      handleCompaction(event);
      break;
  }
}

function handleTokenUpdate(e: TokenUpdateEvent): void {
  sessionCost = e.cumulative_session_cost_usd;

  const turnTokens = formatTokens(e.turn_tokens);
  const turnCost = `$${e.turn_cost.toFixed(2)}`;
  const roi = e.roi_score !== null ? `${Math.round(e.roi_score * 100)}%` : "N/A";
  const sessionTotal = `$${sessionCost.toFixed(2)}`;

  // Color the ROI
  let roiColored: string;
  if (e.roi_score === null) {
    roiColored = chalk.gray(roi);
  } else if (e.roi_score * 100 >= THRESHOLD_AMBER_ROI) {
    roiColored = chalk.green(roi);
  } else if (e.roi_score * 100 >= THRESHOLD_RED_ROI) {
    roiColored = chalk.yellow(roi);
  } else {
    roiColored = chalk.red(roi);
  }

  // Color the session total
  let sessionColored: string;
  if (sessionCost >= THRESHOLD_RED_COST) {
    sessionColored = chalk.red(sessionTotal);
  } else if (sessionCost >= THRESHOLD_AMBER_COST) {
    sessionColored = chalk.yellow(sessionTotal);
  } else {
    sessionColored = chalk.green(sessionTotal);
  }

  // Print the one-liner
  console.log(
    chalk.dim(`\n  ↳ Prune: ${turnTokens} tokens · ${turnCost} · ROI ${roiColored} · session total ${sessionColored}`)
  );
}

function handlePruneSuggestion(e: PruneSuggestionEvent): void {
  if (e.confidence < 0.75) return;

  lastPruneSuggestion = e;

  const total = formatTokens(e.total_tokens);
  const relevant = formatTokens(e.relevant_tokens);
  const savings = e.estimated_savings_usd.toFixed(2);

  console.log(
    chalk.cyan(`\n  ✂️  Prune: Sending ${total} tokens but ~${relevant} are relevant.`)
  );
  console.log(chalk.cyan(`  Trim to save $${savings}? [Y/n/a(lways)] `));

  // Read user input with timeout
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answered = false;

  const timeout = setTimeout(() => {
    if (!answered) {
      answered = true;
      console.log(chalk.dim("  (timeout, sending full)"));
      rl.close();
    }
  }, 5000);

  rl.question("", (answer) => {
    answered = true;
    clearTimeout(timeout);

    const choice = answer.toLowerCase().trim();
    if (choice === "y" || choice === "") {
      console.log(chalk.green(`  ✓ Trimmed. Forwarding ${relevant} tokens.`));
    } else if (choice === "a") {
      console.log(chalk.green("  ✓ Saved. Future similar requests will auto-trim."));
    } else {
      console.log(chalk.dim("  Sending full context."));
    }

    rl.close();
    lastPruneSuggestion = null;
  });
}

function handleBurnAlert(e: BurnAlertEvent): void {
  const wasted = formatTokens(e.tokens_wasted);
  const cost = e.cost_wasted_usd.toFixed(2);

  console.log(chalk.yellow(`\n  ⚠  PRUNE ALERT: ${e.message_title}`));
  console.log(chalk.yellow(`  │  ${e.message_body}`));
  console.log(chalk.yellow(`  │  ${wasted} tokens ($${cost}) wasted.`));
  console.log(chalk.yellow(`  │`));

  const suggestions = e.suggestions
    .filter((s) => s.label !== "Dismiss")
    .map((s) => s.detail || s.label)
    .join(" · ");
  if (suggestions) {
    console.log(chalk.yellow(`  │  Try: ${suggestions}`));
  }
  console.log(chalk.yellow(`  └${"─".repeat(60)}`));
}

function handleCompaction(e: CompactionEvent): void {
  const before = formatTokens(e.tokens_before);
  const after = formatTokens(e.tokens_after);
  const count = e.lost_references.length;

  console.log(chalk.blue(`\n  📋 Context compacted (${before} → ${after} tokens). ${count} references may be lost:`));

  for (const ref of e.lost_references.slice(0, 5)) {
    console.log(chalk.blue(`  │  • ${ref.item} (turn ${ref.original_turn})`));
  }
  if (e.lost_references.length > 5) {
    console.log(chalk.blue(`  │  ... and ${e.lost_references.length - 5} more`));
  }
  console.log(chalk.blue(`  │`));
  console.log(chalk.blue(`  │  Consider re-stating these in your next prompt.`));
  console.log(chalk.blue(`  └${"─".repeat(60)}`));
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return `${tokens}`;
}

// Handle process signals
process.on("SIGINT", () => {
  if (childProcess) childProcess.kill("SIGINT");
  if (ws) ws.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (childProcess) childProcess.kill("SIGTERM");
  if (ws) ws.close();
  process.exit(0);
});

// Run
main();

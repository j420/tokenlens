/**
 * The single synthetic session every flow is driven against: a developer fixing
 * a login bug across a small auth module. One fixture builds:
 *   - a real Claude Code JSONL transcript on disk (consumed by the
 *     transcript-reading MCP tools and the spawned hooks),
 *   - the workspace source files (Smart Copy / squeeze / relevance), and
 *   - the typed inputs the pure MCP tools need (tabs, replay segments, diff
 *     pairs, output samples, tool defs, model aggregates, effort outcomes,
 *     subagent samples, proxy catalog).
 *
 * Everything is realistic but fixed, so outputs are deterministic. Timestamps
 * are deliberately far in the past so the idle-gap rules (CH-004 /
 * cache-habits-advisor) fire against a real wall clock without flaking.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolDefinitionInfo, ToolUsageWindow } from "@prune/intelligence";
import type { ModelAggregate, EffortOutcomeStats } from "@prune/qpd-bench";

export const ACTIVE_MODEL = "claude-sonnet-4-5-20250929";
export const SWITCH_MODEL = "claude-opus-4-1-20250805";
/** A model deliberately absent from the price table (strict-pricing edge). */
export const UNPRICED_MODEL = "acme-frontier-v9-20260101";

// --- workspace source (small, real TypeScript the squeezer/analyzer parse) ---

const AUTH_SERVICE_TS = `import { Token, AuthConfig, Credentials } from "./types";
import { hash, verify } from "../crypto/bcrypt";

/** Issues and validates session tokens. */
export class AuthService {
  constructor(private config: AuthConfig) {}

  async login(creds: Credentials): Promise<Token> {
    const user = await this.lookup(creds.email);
    if (!user) throw new Error("no such user");
    // BUG: compares plaintext; should verify() against the stored hash.
    if (user.password !== creds.password) throw new Error("bad password");
    return this.issue(user.id);
  }

  private issue(userId: string): Token {
    const expiresAt = new Date(Date.now() + this.config.expiry * 1000);
    return { value: hash(userId + expiresAt.toISOString()), expiresAt };
  }

  private async lookup(email: string) {
    return this.config.users.find((u) => u.email === email) ?? null;
  }
}
`;

const AUTH_TYPES_TS = `export interface Token {
  value: string;
  expiresAt: Date;
}

export interface AuthConfig {
  jwtSecret: string;
  expiry: number;
  users: StoredUser[];
}

export interface Credentials {
  email: string;
  password: string;
}

export interface StoredUser {
  id: string;
  email: string;
  password: string;
}
`;

const LOGIN_ROUTE_TS = `import { AuthService } from "../auth/service";
import { Credentials } from "../auth/types";

export async function loginRoute(svc: AuthService, body: Credentials) {
  try {
    const token = await svc.login(body);
    return { status: 200, token };
  } catch (e) {
    return { status: 401, error: (e as Error).message };
  }
}
`;

const UNRELATED_TS = `// Image thumbnailing — unrelated to the auth task.
export function thumbnail(buf: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < out.length; i++) out[i] = buf[i % buf.length] ?? 0;
  return out;
}
`;

export interface WorkspaceFile {
  path: string;
  content: string;
}

export interface SessionFixture {
  dir: string;
  transcriptPath: string;
  sessionId: string;
  activeModel: string;

  /** Workspace files for Smart Copy / squeeze / context analysis. */
  files: WorkspaceFile[];
  /** The file the editor is focused on. */
  activeFile: WorkspaceFile;
  /** A genuinely unrelated file (relevance/open-tab audit should deprioritize). */
  unrelatedFile: WorkspaceFile;

  /** open_tab_audit input. */
  tabs: Array<{ path: string; tokenCount: number }>;
  importEdges: Array<{ from: string; to: string }>;

  /** diff_vs_rewrite: a tiny edit (diff wins) and a near-total rewrite. */
  smallEdit: { original: string; proposed: string };
  bigRewrite: { original: string; proposed: string };

  /** A large, repetitive tool result for result_prune. */
  largeToolResult: string;

  /** Observed output-token samples for max_tokens_calibrate. */
  outputSamples: number[];

  /** replay_cost_plan segments + a single-segment mutation. */
  replaySegments: Array<{
    role: "system" | "user" | "assistant" | "tool";
    payload: unknown;
    tokens_in: number;
    tokens_out: number;
  }>;
  replayMutation: { at_index: number; new_payload: unknown; new_tokens_in?: number };

  /** tool_audit inputs. */
  toolDefs: ToolDefinitionInfo[];
  toolUsage: ToolUsageWindow;

  /** qpd_report baseline + candidates. */
  qpdBaseline: ModelAggregate;
  qpdCandidates: ModelAggregate[];

  /** reasoning_effort_route outcomes. */
  effortOutcomes: EffortOutcomeStats[];

  /** subagent_cost_predict history. */
  subagentHistory: Array<{ tokensIn: number; tokensOut: number; costUsd?: number }>;

  /** mcp_proxy_trim catalog (intent "debug"). */
  proxyTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;

  cleanup(): void;
}

/** Build a JSONL transcript line (Claude Code shape). */
function userLine(sessionId: string, ts: string, text: string): string {
  return JSON.stringify({
    type: "user",
    sessionId,
    timestamp: ts,
    message: { role: "user", content: text },
  });
}
function assistantLine(
  sessionId: string,
  ts: string,
  model: string,
  text: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  }
): string {
  return JSON.stringify({
    type: "assistant",
    sessionId,
    timestamp: ts,
    message: {
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      usage,
    },
  });
}

export function buildSession(): SessionFixture {
  const dir = mkdtempSync(join(tmpdir(), "prune-e2e-session-"));
  const sessionId = "e2e-login-bug";
  const transcriptPath = join(dir, "transcript.jsonl");

  // Deliberately past-dated so (now − lastTurn) >> any cache TTL → the idle-gap
  // rules fire deterministically against the real clock.
  const lines = [
    userLine(sessionId, "2020-01-01T10:00:00Z", "the login always rejects valid users, help me fix it"),
    assistantLine(
      sessionId,
      "2020-01-01T10:00:02Z",
      ACTIVE_MODEL,
      "Reading the auth service and types to find the bug.",
      { input_tokens: 4200, output_tokens: 180, cache_creation_input_tokens: 4000, cache_read_input_tokens: 0 }
    ),
    userLine(sessionId, "2020-01-01T10:00:30Z", "yes it's in login()"),
    assistantLine(
      sessionId,
      "2020-01-01T10:00:33Z",
      ACTIVE_MODEL,
      "Found it: login compares plaintext instead of verifying the bcrypt hash.",
      { input_tokens: 300, output_tokens: 220, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000 }
    ),
    userLine(sessionId, "2020-01-01T10:01:10Z", "write the fix and a test"),
    assistantLine(
      sessionId,
      "2020-01-01T10:01:14Z",
      ACTIVE_MODEL,
      "Applying verify() and adding a unit test for the bad-password path.",
      { input_tokens: 280, output_tokens: 540, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000 }
    ),
  ];
  writeFileSync(transcriptPath, lines.join("\n") + "\n");

  const files: WorkspaceFile[] = [
    { path: "src/auth/service.ts", content: AUTH_SERVICE_TS },
    { path: "src/auth/types.ts", content: AUTH_TYPES_TS },
    { path: "src/routes/login.ts", content: LOGIN_ROUTE_TS },
    { path: "src/media/thumbnail.ts", content: UNRELATED_TS },
  ];
  const activeFile = files[0];
  const unrelatedFile = files[3];

  // A large, highly repetitive tool result (log dump) for the pruner.
  const largeToolResult = [
    "Build log:",
    ...Array.from({ length: 400 }, () => "INFO  compiling module... ok"),
    "",
    "",
    "",
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    "warning: 0 issues",
  ].join("\n");

  return {
    dir,
    transcriptPath,
    sessionId,
    activeModel: ACTIVE_MODEL,
    files,
    activeFile,
    unrelatedFile,

    tabs: [
      { path: "src/auth/service.ts", tokenCount: 320 },
      { path: "src/auth/types.ts", tokenCount: 140 },
      { path: "src/routes/login.ts", tokenCount: 120 },
      { path: "src/media/thumbnail.ts", tokenCount: 110 },
      { path: "docs/CHANGELOG.md", tokenCount: 900 },
    ],
    importEdges: [
      { from: "src/routes/login.ts", to: "src/auth/service.ts" },
      { from: "src/auth/service.ts", to: "src/auth/types.ts" },
    ],

    smallEdit: {
      original: AUTH_SERVICE_TS,
      proposed: AUTH_SERVICE_TS.replace(
        "if (user.password !== creds.password) throw new Error(\"bad password\");",
        "if (!verify(creds.password, user.password)) throw new Error(\"bad password\");"
      ),
    },
    bigRewrite: {
      original: AUTH_SERVICE_TS,
      proposed: UNRELATED_TS + "\n" + LOGIN_ROUTE_TS + "\n// rewritten from scratch\n",
    },

    largeToolResult,
    // ≥20 samples so the calibrator clears its default minSamples gate.
    outputSamples: [
      180, 220, 540, 200, 260, 310, 175, 480, 230, 290, 205, 250, 300, 195,
      420, 240, 270, 330, 210, 360, 185, 455, 225, 285,
    ],

    replaySegments: [
      { role: "system", payload: { sys: "You are a coding assistant." }, tokens_in: 1200, tokens_out: 0 },
      { role: "user", payload: { ask: "fix login bug" }, tokens_in: 60, tokens_out: 0 },
      { role: "assistant", payload: { plan: "read auth/service.ts" }, tokens_in: 0, tokens_out: 180 },
      { role: "tool", payload: { read: "src/auth/service.ts", hash: "abc123" }, tokens_in: 800, tokens_out: 0 },
    ],
    replayMutation: { at_index: 3, new_payload: { read: "src/auth/service.ts", hash: "DIFFERENT" }, new_tokens_in: 820 },

    toolDefs: [
      { name: "fs__read", server: "filesystem", definitionTokens: 220 },
      { name: "fs__write", server: "filesystem", definitionTokens: 240 },
      { name: "git__log", server: "git", definitionTokens: 600 },
      { name: "jira__create_issue", server: "jira", definitionTokens: 1800, protected: false },
      { name: "figma__export", server: "figma", definitionTokens: 1500 },
    ],
    toolUsage: {
      windowDays: 14,
      sessionsInWindow: 40,
      invocations: { fs__read: 320, fs__write: 110, git__log: 8 },
      lastUsedAgeDays: { fs__read: 0, fs__write: 0, git__log: 6, jira__create_issue: Infinity, figma__export: Infinity },
      sessionsLoadingTool: { fs__read: 40, fs__write: 40, git__log: 40, jira__create_issue: 40, figma__export: 40 },
    },

    qpdBaseline: aggregate(SWITCH_MODEL, "login-debug", { n: 60, accepted: 57, meanCost: 0.092 }),
    qpdCandidates: [
      aggregate(ACTIVE_MODEL, "login-debug", { n: 60, accepted: 56, meanCost: 0.021 }),
      aggregate("claude-haiku-4-5-20251001", "login-debug", { n: 60, accepted: 41, meanCost: 0.004 }),
    ],

    // Standard clearly DOMINATES high here (≥ acceptance, ≥ test-pass, ⅓ cost),
    // so the statistical non-inferiority gates clear deterministically and the
    // router down-routes. (A borderline standard would correctly HOLD — that
    // case is asserted in the edge-case matrix.)
    effortOutcomes: [
      { effort: "high", n: 60, acceptedCount: 54, testPassRate: 0.9, testN: 60, testPassedCount: 54, meanCostUsd: 0.08 },
      { effort: "standard", n: 60, acceptedCount: 59, testPassRate: 0.98, testN: 60, testPassedCount: 59, meanCostUsd: 0.03 },
    ],

    subagentHistory: [
      { tokensIn: 8000, tokensOut: 1200 },
      { tokensIn: 6500, tokensOut: 900 },
      { tokensIn: 9000, tokensOut: 1500 },
    ],

    proxyTools: [
      { name: "fs__read", description: "Read a file from disk to debug code.", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
      { name: "git__blame", description: "Show git blame to debug when a line changed.", inputSchema: { type: "object", properties: { file: { type: "string" } } } },
      { name: "figma__export_png", description: "Export a design frame as a PNG image.", inputSchema: { type: "object", properties: { frame: { type: "string" } } } },
      { name: "jira__create_issue", description: "Create a project-management ticket.", inputSchema: { type: "object", properties: { title: { type: "string" } } } },
    ],

    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

function aggregate(
  model: string,
  clusterId: string,
  o: { n: number; accepted: number; meanCost: number }
): ModelAggregate {
  const acceptanceRate = o.accepted / o.n;
  return {
    model,
    clusterId,
    n: o.n,
    acceptedCount: o.accepted,
    acceptanceRate,
    testPassRate: acceptanceRate,
    testN: o.n,
    testPassedCount: o.accepted,
    meanCost: o.meanCost,
    totalCost: o.meanCost * o.n,
    qpdRaw: o.meanCost > 0 ? acceptanceRate / o.meanCost : Infinity,
  };
}

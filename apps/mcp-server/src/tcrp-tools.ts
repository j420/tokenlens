/**
 * MCP tool handlers for the TCRP cost-reduction features (F2, F4, F6).
 *
 * Pure functions that parse the tool args, call the tested package cores, and
 * shape a JSON response. Kept out of index.ts (whose top-level main() starts
 * the stdio server) so they can be unit-tested directly, including the safety
 * guarantees surviving the MCP boundary.
 */

import {
  auditToolDefinitions,
  predictSubagentCost,
  type ToolDefinitionInfo,
  type ToolUsageWindow,
  type SubagentCostSample,
} from "@prune/intelligence";
import {
  classifyPareto,
  recommendForCluster,
  routeReasoningEffort,
  type ModelAggregate,
  type EffortOutcomeStats,
  type ReasoningEffort,
} from "@prune/qpd-bench";
import { loadCachedSessionView } from "@prune/telemetry";
import {
  buildReport,
  resolveConfig,
  type ContextHealthReport,
} from "@prune/context-health";
import {
  runReplayHarness,
  type F1ShadowEvent,
} from "@prune/trajectory-diet";
import {
  SemanticCache,
  contentShaFreshness,
  type SerializedSemanticCache,
} from "@prune/semantic-cache";
import {
  generateToolboxApi,
  runEquivalenceHarness,
  type CodeModeTaskOutcome,
  type McpToolDef,
} from "@prune/code-mode-mcp";
import {
  buildTimeline,
  planReplay,
  buildQualityProof as buildReplayCostProof,
  REPLAY_COST_FEATURE_ID,
  type SegmentRole,
} from "@prune/replay-cost";
import {
  indexCatalog,
  McpProxy,
  ALL_INTENTS,
  buildQualityProof as buildMcpProxyProof,
  MCP_PROXY_FEATURE_ID,
  type IntentKind,
  type McpTool,
  type IntentOverride,
  type ToolTokenCost,
} from "@prune/mcp-proxy";
import {
  lint as lintCacheHabits,
  buildQualityProof as buildCacheHabitsProof,
  CACHE_HABITS_FEATURE_ID,
  type ProposedAction,
  type SessionSnapshot,
  type CacheTtl,
  type ModelFamily,
} from "@prune/cache-habits";
import { pruneResult, calibrateMaxTokens } from "@prune/response-tuner";
import { diffEnforce } from "@prune/diff-enforcer";
import { auditOpenTabs } from "@prune/tab-auditor";
import {
  evaluateRewardIntegrity,
  type ProposedWrite,
  type RewardIntegrityConfig,
} from "@prune/reward-integrity";
import {
  planMask,
  type MaskConfig,
  type Observation,
} from "@prune/observation-mask";
import {
  stepReadGate,
  emptyResidentSet,
  type ReadRequest,
  type ResidentSet,
} from "@prune/read-gate";
import {
  computeSlice,
  type SliceGraphInput,
  type SliceDirection,
} from "@prune/program-slice";
import {
  buildCacheHabitsInputs,
  type ProposedActionInput,
  type SnapshotContextInput,
} from "@prune/host-adapters";
import type { Provider } from "@prune/shared";

// TCRP feature ids for the two MCP-tool features whose quality_proof rides the
// caller-side telemetry path (PRUNE_MCP_TELEMETRY) exactly like f10/f11. Kept
// local so the id lives next to the handler that stamps it; the recorder's
// TOOL_FEATURE_IDS map is the matching half of this contract.
const TOOL_AUDIT_FEATURE_ID = "f2";
const QPD_REPORT_FEATURE_ID = "f4";

export interface ToolAuditArgs {
  tools: ToolDefinitionInfo[];
  usage: ToolUsageWindow;
  critical_allowlist?: string[];
  /**
   * Vendor scoping. When "anthropic-claude-code", the auditor
   * short-circuits with a vendor-native-mechanism notice instead of
   * running per-tool analysis (Claude Code 2.1+ ships on-demand tool
   * search default-on).
   */
  vendor?:
    | "anthropic-claude-code"
    | "cursor"
    | "openai-codex"
    | "openai-other"
    | "unknown";
}

export function handleToolAudit(args: ToolAuditArgs): string {
  if (!Array.isArray(args.tools) || !args.usage) {
    return JSON.stringify({ error: "tool_audit requires `tools` and `usage`." });
  }
  try {
    return runToolAudit(args);
  } catch (e) {
    // Honor the per-handler contract — a malformed element (e.g. a null in
    // `tools`) returns a JSON error, never a throw across the MCP wire.
    return JSON.stringify({ error: `tool_audit: ${(e as Error).message}` });
  }
}

function runToolAudit(args: ToolAuditArgs): string {
  const report = auditToolDefinitions(args.tools, args.usage, {
    criticalAllowlist: args.critical_allowlist,
    vendor: args.vendor,
  });
  const recoverableTokensPerWeek = Math.round(report.recoverableTokensPerWeek);
  return JSON.stringify(
    {
      windowDays: report.windowDays,
      sessionsInWindow: report.sessionsInWindow,
      totalDefinitionTokens: report.totalDefinitionTokens,
      recoverableTokensPerWeek,
      recommendationCount: report.recommendationCount,
      newInstallGuardActive: report.newInstallGuardActive,
      // PII-safe quality_proof: aggregate counts/tokens only — never tool names,
      // schemas, or per-tool rationale. The caller-side recorder persists this
      // (gated on PRUNE_MCP_TELEMETRY) so f2 lands in the same events stream as
      // f10/f11; the dashboard's f2 decoder reads exactly these fields.
      quality_proof: {
        featureId: TOOL_AUDIT_FEATURE_ID,
        vendor: args.vendor ?? "unknown",
        windowDays: report.windowDays,
        sessionsInWindow: report.sessionsInWindow,
        toolCount: report.entries.length,
        totalDefinitionTokens: report.totalDefinitionTokens,
        recoverableTokensPerWeek,
        recommendationCount: report.recommendationCount,
        newInstallGuardActive: report.newInstallGuardActive,
      },
      entries: report.entries.map((e) => ({
        name: e.name,
        server: e.server,
        utility: e.utility,
        invocations: e.invocations,
        invocationsPerWeek: Number(e.invocationsPerWeek.toFixed(2)),
        wastedTokensPerWeek: Math.round(e.wastedTokensPerWeek),
        recommendRemoval: e.recommendRemoval,
        rationale: e.rationale,
      })),
    },
    null,
    2
  );
}

export interface QpdReportArgs {
  baseline: ModelAggregate;
  candidates: ModelAggregate[];
  ar_margin?: number;
  cost_dominance_ratio?: number;
}

export function handleQpdReport(args: QpdReportArgs): string {
  if (!args.baseline || !Array.isArray(args.candidates)) {
    return JSON.stringify({
      error: "qpd_report requires `baseline` and `candidates` aggregates.",
    });
  }
  try {
    return runQpdReport(args);
  } catch (e) {
    // Per-handler contract: a malformed baseline/candidate element returns a
    // JSON error rather than throwing across the MCP wire.
    return JSON.stringify({ error: `qpd_report: ${(e as Error).message}` });
  }
}

function runQpdReport(args: QpdReportArgs): string {
  const rec = recommendForCluster(args.baseline, args.candidates, {
    arMargin: args.ar_margin,
    costDominanceRatio: args.cost_dominance_ratio,
  });
  const frontier = classifyPareto(
    [args.baseline, ...args.candidates].map((m) => ({
      model: m.model,
      cost: m.meanCost,
      quality: m.acceptanceRate,
    }))
  );
  const recommendedCount = rec.recommendations.filter((r) => r.recommended).length;
  const paretoFrontierSize = frontier.filter((p) => p.onFrontier).length;
  return JSON.stringify(
    {
      clusterId: rec.clusterId,
      baselineModel: rec.baselineModel,
      // PII-safe quality_proof: cluster id + model identifiers (not user data)
      // and aggregate gate outcomes. Rides PRUNE_MCP_TELEMETRY like f10/f11; the
      // dashboard's f4 decoder reads exactly these fields.
      quality_proof: {
        featureId: QPD_REPORT_FEATURE_ID,
        clusterId: rec.clusterId,
        baselineModel: rec.baselineModel,
        candidateCount: args.candidates.length,
        recommendedCount,
        bestProjectedSavingsPct: rec.best
          ? Number(rec.best.projectedSavingsPct.toFixed(1))
          : null,
        paretoFrontierSize,
      },
      best: rec.best
        ? {
            model: rec.best.model,
            projectedSavingsPct: Number(rec.best.projectedSavingsPct.toFixed(1)),
            qpdRelative: Number(rec.best.qpdRelative.toFixed(2)),
          }
        : null,
      paretoFrontier: frontier.filter((p) => p.onFrontier).map((p) => p.model),
      recommendations: rec.recommendations.map((r) => ({
        model: r.model,
        recommended: r.recommended,
        costRatio: Number.isFinite(r.costRatio)
          ? Number(r.costRatio.toFixed(3))
          : null,
        projectedSavingsPct: Number(r.projectedSavingsPct.toFixed(1)),
        gates: {
          ar: r.arGate.passed,
          tpr: r.tprGate.passed,
          cost: r.costGate.passed,
          sampleSize: r.sampleSizeGate.passed,
        },
        arDetail: r.arGate.detail,
      })),
    },
    null,
    2
  );
}

export interface ContextHealthReportArgs {
  transcript_path: string;
  /**
   * Optional max number of recent turns to include in the report's
   * `ecfSeries`. Defaults to "all turns". Out-of-range values are
   * silently clamped.
   */
  window_turns?: number;
}

/**
 * F6 — Context-Health Report. Streams the transcript via SessionCache,
 * computes the ECF series and CUSUM regime, and returns a single JSON
 * payload that's safe to JSON-stringify (no functions, no circular
 * refs). The MCP boundary takes the JSON; the hook (which writes
 * advisories to additionalContext) uses a different entry-point.
 */
export async function handleContextHealthReport(
  args: ContextHealthReportArgs
): Promise<string> {
  if (!args || typeof args.transcript_path !== "string" || args.transcript_path.length === 0) {
    return JSON.stringify({
      error: "context_health_report requires a non-empty `transcript_path`.",
    });
  }
  const config = resolveConfig(process.env);
  const view = await loadCachedSessionView(args.transcript_path);

  // Apply window_turns if supplied — clamp non-finite / negative values.
  const all = view.turns;
  const window =
    typeof args.window_turns === "number" &&
    Number.isFinite(args.window_turns) &&
    args.window_turns > 0
      ? Math.min(Math.trunc(args.window_turns), all.length)
      : all.length;
  const turns = window === all.length ? all : all.slice(all.length - window);

  const report: ContextHealthReport = buildReport(turns, { config });
  return JSON.stringify(report, null, 2);
}

export interface TrajectoryReplayArgs {
  /**
   * F1 shadow events to evaluate. Caller (extension or a CI job)
   * sources these from the local persistence sink where
   * `feature_id = "f1"`, projecting `quality_proof` into the shape
   * expected by F1ShadowEvent.
   */
  events: F1ShadowEvent[];
  num_bins?: number;
  min_pairs_for_gate?: number;
  /** Optional margins override (acceptanceRate, testPassRate, alpha). */
  margins?: {
    acceptanceRate?: number;
    testPassRate?: number;
    alpha?: number;
  };
}

/**
 * F1 v2 — Trajectory Replay Report. Computes calibration metrics and
 * the NI-gate verdict over a set of shadow-mode F1 events. Stateless;
 * the caller provides the events. Never throws on malformed input —
 * out-of-range events are reported under `malformedEvents`.
 */
export function handleTrajectoryReplay(args: TrajectoryReplayArgs): string {
  if (!args || !Array.isArray(args.events)) {
    return JSON.stringify({
      error: "trajectory_replay_report requires `events` (F1ShadowEvent[]).",
    });
  }
  const margins =
    args.margins && typeof args.margins === "object"
      ? {
          acceptanceRate: args.margins.acceptanceRate ?? 0.01,
          testPassRate: args.margins.testPassRate ?? 0.005,
          alpha: args.margins.alpha ?? 0.05,
        }
      : undefined;
  const report = runReplayHarness(args.events, {
    numBins:
      typeof args.num_bins === "number" && args.num_bins > 0
        ? Math.trunc(args.num_bins)
        : undefined,
    minPairsForGate:
      typeof args.min_pairs_for_gate === "number" && args.min_pairs_for_gate > 0
        ? Math.trunc(args.min_pairs_for_gate)
        : undefined,
    margins,
  });
  return JSON.stringify(report, null, 2);
}

export interface SemanticCacheProbeArgs {
  /** Optional persisted cache state (from SemanticCache.toJSON()). */
  state?: SerializedSemanticCache;
  /** A list of queries to probe; each must carry its freshness parts. */
  probes: Array<{
    query: string;
    freshness_parts: string[];
  }>;
}

/**
 * F7 — Semantic Cache Probe. Stateless. Hydrates a cache from the
 * supplied serialized state, runs `decide()` over each probe, and
 * returns the hit/miss verdicts with similarity. Never throws on
 * malformed input.
 */
export function handleSemanticCacheProbe(
  args: SemanticCacheProbeArgs
): string {
  if (!args || !Array.isArray(args.probes)) {
    return JSON.stringify({
      error: "semantic_cache_probe requires `probes: [{ query, freshness_parts }]`.",
    });
  }
  const cache = args.state
    ? SemanticCache.fromJSON(args.state)
    : new SemanticCache();
  const verdicts = args.probes.map((p) => {
    if (
      !p ||
      typeof p.query !== "string" ||
      !Array.isArray(p.freshness_parts)
    ) {
      return { error: "malformed probe", query: null, decision: null };
    }
    const fresh = contentShaFreshness(
      ...p.freshness_parts.filter((s) => typeof s === "string")
    );
    const d = cache.decide(p.query, fresh);
    return {
      query: p.query,
      decision: d,
    };
  });
  return JSON.stringify(
    {
      cacheSize: cache.size,
      modelName: cache.modelName,
      verdicts,
    },
    null,
    2
  );
}

export interface CodeModeApiArgs {
  tools: McpToolDef[];
  toolbox_name?: string;
}

/**
 * F8 — Code-Mode API generator. Takes a set of MCP tool definitions
 * and emits a typed TypeScript Toolbox module. Pure code generation.
 */
export function handleCodeModeGenerateApi(args: CodeModeApiArgs): string {
  if (!args || !Array.isArray(args.tools)) {
    return JSON.stringify({
      error: "code_mode_generate_api requires `tools: McpToolDef[]`.",
    });
  }
  const spec = generateToolboxApi(args.tools, {
    toolboxName:
      typeof args.toolbox_name === "string" && args.toolbox_name.length > 0
        ? args.toolbox_name
        : undefined,
  });
  return JSON.stringify(
    {
      code: spec.code,
      methodNames: spec.methodNames,
      nameMap: spec.nameMap,
    },
    null,
    2
  );
}

export interface CodeModeHarnessArgs {
  outcomes: CodeModeTaskOutcome[];
}

/**
 * F8 — Code-Mode Equivalence Harness aggregator. Reports pass rate,
 * byte reduction, sandbox-escape attempts over a caller-supplied
 * corpus.
 */
export function handleCodeModeHarness(args: CodeModeHarnessArgs): string {
  if (!args || !Array.isArray(args.outcomes)) {
    return JSON.stringify({
      error: "code_mode_harness requires `outcomes: CodeModeTaskOutcome[]`.",
    });
  }
  const report = runEquivalenceHarness(args.outcomes);
  return JSON.stringify(report, null, 2);
}

// ===========================================================================
// F11 — replay_cost_plan (What-If Deterministic Replay Engine)
// ===========================================================================

export interface ReplayCostPlanArgs {
  /** Model id used for pricing (e.g. "claude-sonnet-4-5-20250929"). */
  model: string;
  /** Provider hint; defaults to "anthropic". */
  provider?: Provider;
  /** Ordered session segments. `index` is assigned from array position. */
  segments: Array<{
    role: SegmentRole;
    payload: unknown;
    tokens_in: number;
    tokens_out: number;
  }>;
  /** The single-segment mutation to evaluate. */
  mutation: {
    at_index: number;
    new_payload: unknown;
    /** New input-token count; omitted ⇒ reuse the original segment's count. */
    new_tokens_in?: number;
  };
}

/**
 * F11 — plan a what-if replay. Builds a hash-chained timeline from the
 * caller's segments, applies the single-segment mutation, and returns the
 * divergence point + the naive-vs-replay cost breakdown + the f11
 * quality_proof. Pure and deterministic; no model is called. Token counts are
 * caller-supplied (the engine never fabricates one). Mirrors the boundary
 * discipline of the other TCRP handlers: bad input → a JSON `error`, never a
 * throw across the MCP wire.
 */
export function handleReplayCostPlan(args: ReplayCostPlanArgs): string {
  if (!args || !Array.isArray(args.segments) || args.segments.length === 0) {
    return JSON.stringify({
      error: "replay_cost_plan requires a non-empty `segments` array.",
    });
  }
  if (
    !args.mutation ||
    typeof args.mutation.at_index !== "number" ||
    !Number.isInteger(args.mutation.at_index)
  ) {
    return JSON.stringify({
      error:
        "replay_cost_plan requires `mutation: { at_index: int, new_payload, new_tokens_in? }`.",
    });
  }
  if (typeof args.model !== "string" || args.model.length === 0) {
    return JSON.stringify({ error: "replay_cost_plan requires a `model` string." });
  }

  let timeline;
  try {
    timeline = buildTimeline({
      model: args.model,
      provider: args.provider ?? "anthropic",
      segments: args.segments.map((s, i) => ({
        index: i,
        role: s.role,
        payload: s.payload,
        tokensIn: s.tokens_in,
        tokensOut: s.tokens_out,
      })),
    });
  } catch (e) {
    return JSON.stringify({
      error: `replay_cost_plan: invalid timeline — ${(e as Error).message}`,
    });
  }

  let plan;
  try {
    plan = planReplay(timeline, {
      atIndex: args.mutation.at_index,
      newPayload: args.mutation.new_payload,
      newTokensIn: args.mutation.new_tokens_in,
    });
  } catch (e) {
    return JSON.stringify({ error: `replay_cost_plan: ${(e as Error).message}` });
  }

  return JSON.stringify(
    {
      featureId: REPLAY_COST_FEATURE_ID,
      divergence: plan.divergence,
      cost: plan.cost,
      reusedOriginalTokens: plan.reusedOriginalTokens,
      quality_proof: buildReplayCostProof(timeline.rootHash, plan),
    },
    null,
    2
  );
}

// ===========================================================================
// F10 — mcp_proxy_trim (Cross-Vendor Lazy-Schema MCP Proxy)
// ===========================================================================

export interface McpProxyTrimArgs {
  /**
   * Caller-classified intent for the upcoming turn, or null/omitted to get the
   * full catalog back (with the lazy-schema savings still reported).
   */
  intent?: IntentKind | null;
  /** The merged upstream tool catalog. */
  tools: McpTool[];
  /** Optional per-tool tokenized cost map: name → { schemaTokens, descriptionTokens }. */
  token_cost_by_name?: Record<string, ToolTokenCost>;
  /** Optional intent overrides for tools whose names carry no verb signal. */
  overrides?: IntentOverride[];
  /** Include the fail-safe (verb-inconclusive) tools in the trim. Default true. */
  include_fallback?: boolean;
}

const VALID_INTENTS = new Set<string>(ALL_INTENTS);

/**
 * F10 — trim an MCP `tools/list` for the current intent. Indexes the catalog,
 * serves the intent-matched manifest (full schemas held back for lazy load),
 * and returns the trimmed list + the reduction audit + the f10 quality_proof.
 * Pure and deterministic. Fail-safe-to-include: an unrecognized intent or an
 * all-matching intent returns the full catalog rather than risk hiding a tool.
 */
export function handleMcpProxyTrim(args: McpProxyTrimArgs): string {
  if (!args || !Array.isArray(args.tools)) {
    return JSON.stringify({ error: "mcp_proxy_trim requires `tools: McpTool[]`." });
  }
  // Validate intent up front so a typo'd intent is a clear error rather than a
  // silent full-catalog passthrough the caller can't distinguish from success.
  const intent: IntentKind | null =
    args.intent === undefined || args.intent === null ? null : args.intent;
  if (intent !== null && !VALID_INTENTS.has(intent)) {
    return JSON.stringify({
      error:
        `mcp_proxy_trim: unknown intent "${intent}". ` +
        `Valid: ${[...VALID_INTENTS].join(", ")}, or null for the full catalog.`,
    });
  }

  const tokenCostByName =
    args.token_cost_by_name && typeof args.token_cost_by_name === "object"
      ? new Map<string, ToolTokenCost>(Object.entries(args.token_cost_by_name))
      : undefined;

  let result;
  try {
    const idx = indexCatalog(
      { tools: args.tools },
      { tokenCostByName, overrides: args.overrides }
    );
    const proxy = new McpProxy(idx, {
      match: { includeFallback: args.include_fallback ?? true },
    });
    const served = proxy.serveToolsList(intent);
    result = {
      featureId: MCP_PROXY_FEATURE_ID,
      trimmed: served.trimmed,
      audit: served.audit,
      quality_proof: buildMcpProxyProof(served.audit),
    };
  } catch (e) {
    return JSON.stringify({ error: `mcp_proxy_trim: ${(e as Error).message}` });
  }

  return JSON.stringify(result, null, 2);
}

// ===========================================================================
// F9 — cache_habits (full pre-action cache-habits linter)
// ===========================================================================

const VALID_TTL = new Set<CacheTtl>(["5m", "1h", "none"]);
const VALID_FAMILY = new Set<ModelFamily>([
  "sonnet", "opus", "haiku", "gpt-4o", "gpt-4o-mini", "other",
]);
const VALID_EFFORT = new Set(["standard", "high", "xhigh", "max"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function effortOrNull(v: unknown): "standard" | "high" | "xhigh" | "max" | null {
  return typeof v === "string" && VALID_EFFORT.has(v)
    ? (v as "standard" | "high" | "xhigh" | "max")
    : null;
}

function coerceProposedAction(raw: Record<string, unknown>): ProposedAction {
  const prompt = isObj(raw.prompt) ? raw.prompt : {};
  const changes = isObj(raw.changes) ? raw.changes : {};
  const pasted = Array.isArray(prompt.pastedBlocks) ? prompt.pastedBlocks : [];
  const family = raw.modelFamily;
  return {
    modelFamily: (typeof family === "string" && VALID_FAMILY.has(family as ModelFamily)
      ? family
      : "other") as ModelFamily,
    model: str(raw.model, ""),
    ttl: (typeof raw.ttl === "string" && VALID_TTL.has(raw.ttl as CacheTtl)
      ? raw.ttl
      : "none") as CacheTtl,
    prompt: {
      text: str(prompt.text, ""),
      pastedBlocks: pasted
        .filter(isObj)
        .map((b) => ({
          tokens: numOr(b.tokens, 0),
          source: ((): "clipboard" | "url" | "file" | "unknown" => {
            const s = b.source;
            return s === "clipboard" || s === "url" || s === "file" ? s : "unknown";
          })(),
        })),
    },
    changes: {
      systemPromptTokens: numOrNull(changes.systemPromptTokens),
      toolListOrderHash: strOrNull(changes.toolListOrderHash),
      reasoningEffort: effortOrNull(changes.reasoningEffort),
      temperature: numOrNull(changes.temperature),
      mcpServersAdded: strArray(changes.mcpServersAdded),
      mcpServersRemoved: strArray(changes.mcpServersRemoved),
    },
    now: str(raw.now, new Date().toISOString()),
  };
}

function coerceSnapshot(
  raw: Record<string, unknown>,
  fallbackModel: string
): SessionSnapshot {
  const effort = effortOrNull(raw.reasoningEffort);
  const snap: SessionSnapshot = {
    currentModel: str(raw.currentModel, fallbackModel),
    currentTtl: (typeof raw.currentTtl === "string" && VALID_TTL.has(raw.currentTtl as CacheTtl)
      ? raw.currentTtl
      : "none") as CacheTtl,
    lastTurnAt: strOrNull(raw.lastTurnAt),
    turnsSoFar: numOr(raw.turnsSoFar, 0),
    cacheReadTokensSoFar: numOr(raw.cacheReadTokensSoFar, 0),
    cacheCreationTokensSoFar: numOr(raw.cacheCreationTokensSoFar, 0),
    systemPromptTokens: numOrNull(raw.systemPromptTokens),
    toolListOrderHash: strOrNull(raw.toolListOrderHash),
    mcpServers: strArray(raw.mcpServers),
  };
  if (effort) snap.reasoningEffort = effort;
  const temp = numOrNull(raw.temperature);
  if (temp !== null) snap.temperature = temp;
  return snap;
}

export interface CacheHabitsArgs {
  /** What the user is about to send — the host's proposed-action diff. */
  action: unknown;
  /** Prior session state to compare against. */
  snapshot: unknown;
  /** Rule ids to suppress (e.g. a rule that fires spuriously in this env). */
  suppress?: string[];
  /** Per-rule severity overrides, e.g. demote "block" to "warn" in shadow. */
  severity_overrides?: Record<string, "info" | "warn" | "block">;
}

/**
 * F9 — run the FULL cache-habits linter (all 12 rules CH-001..CH-012) over a
 * caller-supplied proposed-action diff. This is the runtime surface for the 11
 * rules a transcript hook can't reach: those need the host's proposed-action vs
 * session-snapshot diff (model switch, tool-list reorder, system-prompt
 * mutation, large paste, MCP server mutation, TTL/effort/temperature changes),
 * which only the editor/host has. The cache-habits-advisor hook still handles
 * the one transcript-derivable rule (CH-004 idle-TTL); this tool handles the
 * rest. Pure + deterministic; bad input → a JSON `error`, never a throw across
 * the MCP wire. Emits the f9 quality_proof on the caller-side telemetry path.
 */
export function handleCacheHabits(args: CacheHabitsArgs): string {
  if (!args || !isObj(args.action) || !isObj(args.snapshot)) {
    return JSON.stringify({
      error:
        "cache_habits requires `action` (ProposedAction) and `snapshot` (SessionSnapshot) objects.",
    });
  }
  const action = coerceProposedAction(args.action);
  if (!action.model) {
    return JSON.stringify({ error: "cache_habits: action.model is required." });
  }
  const snapshot = coerceSnapshot(args.snapshot, action.model);

  const suppress = Array.isArray(args.suppress)
    ? args.suppress.filter((s): s is string => typeof s === "string")
    : undefined;
  const severityOverrides =
    args.severity_overrides && isObj(args.severity_overrides)
      ? args.severity_overrides
      : undefined;

  let report;
  try {
    // No default suppression — the WHOLE point of this surface is the full rule
    // set the hook can't run. Callers may still opt to suppress explicitly.
    report = lintCacheHabits(action, snapshot, { suppress, severityOverrides });
  } catch (e) {
    return JSON.stringify({ error: `cache_habits: ${(e as Error).message}` });
  }

  return JSON.stringify(
    {
      featureId: CACHE_HABITS_FEATURE_ID,
      verdict: report.verdict,
      findings: report.findings,
      totals: {
        estimatedWasteUsd: report.totalEstimatedWasteUsd,
        estimatedWasteTokens: report.totalEstimatedWasteTokens,
        findingCount: report.findings.length,
      },
      skipped: report.skipped,
      quality_proof: buildCacheHabitsProof(report, action, snapshot),
    },
    null,
    2
  );
}

// ===========================================================================
// F9 (end-to-end) — cache_habits_from_transcript
// ---------------------------------------------------------------------------
// The `cache_habits` tool above requires the CALLER to hand-build the typed
// `{ action, snapshot }`. This tool removes that burden for the SNAPSHOT half:
// it reads a REAL Claude Code transcript and DERIVES the session snapshot
// (active model, idle gap, cumulative cache tokens, turn count) via
// @prune/host-adapters `buildCacheHabitsInputs`, then runs the same full 12-rule
// linter. The proposed NEXT action stays caller-supplied — by construction no
// transcript can record an action before it is taken — so this NARROWS, not
// closes, the host-wiring gap, and the response says so plainly (the `derived`
// block separates transcript-derived facts from the caller's declaration).
//
// Discipline carried through: the adapter never fabricates a token/cost/clock
// (absent ⇒ null, and the firing time defaults to the last turn's time so
// CH-004 can't fire from an invented clock); a missing/unreadable transcript is
// fail-safe (empty turns ⇒ snapshot.currentModel falls back to the proposed
// model ⇒ no spurious CH-001 switch); bad input ⇒ a JSON `error`, never a throw
// across the MCP wire.
// ===========================================================================

/** Coerce raw args into the host-adapter `ProposedActionInput`. Null ⇒ no model. */
function coerceProposedActionInput(
  raw: Record<string, unknown>
): ProposedActionInput | null {
  const model = str(raw.model, "");
  if (!model) return null;
  const input: ProposedActionInput = { model };

  if (typeof raw.ttl === "string" && VALID_TTL.has(raw.ttl as CacheTtl)) {
    input.ttl = raw.ttl as CacheTtl;
  }
  if (typeof raw.promptText === "string") input.promptText = raw.promptText;
  if (Array.isArray(raw.pastedBlocks)) {
    input.pastedBlocks = raw.pastedBlocks.filter(isObj).map((b) => ({
      tokens: numOr(b.tokens, 0),
      source: ((): "clipboard" | "url" | "file" | "unknown" => {
        const s = b.source;
        return s === "clipboard" || s === "url" || s === "file" ? s : "unknown";
      })(),
    }));
  }
  // Preserve the adapter's undefined-vs-null contract: an OMITTED field stays
  // unset (⇒ "unknown"); an explicitly-supplied junk value coerces to null
  // (⇒ "unknown") — never to a fabricated number/string.
  if (raw.systemPromptTokens !== undefined) {
    input.systemPromptTokens = numOrNull(raw.systemPromptTokens);
  }
  if (raw.toolListOrderHash !== undefined) {
    input.toolListOrderHash = strOrNull(raw.toolListOrderHash);
  }
  const eff = effortOrNull(raw.reasoningEffort);
  if (eff) input.reasoningEffort = eff;
  const temp = numOrNull(raw.temperature);
  if (temp !== null) input.temperature = temp;
  if (Array.isArray(raw.mcpServers)) input.mcpServers = strArray(raw.mcpServers);
  if (typeof raw.now === "string") input.now = raw.now;
  return input;
}

/** Coerce raw args into the host-adapter `SnapshotContextInput`. */
function coerceSnapshotContext(raw: Record<string, unknown>): SnapshotContextInput {
  const ctx: SnapshotContextInput = {};
  if (typeof raw.currentTtl === "string" && VALID_TTL.has(raw.currentTtl as CacheTtl)) {
    ctx.currentTtl = raw.currentTtl as CacheTtl;
  }
  if (raw.systemPromptTokens !== undefined) {
    ctx.systemPromptTokens = numOrNull(raw.systemPromptTokens);
  }
  if (raw.toolListOrderHash !== undefined) {
    ctx.toolListOrderHash = strOrNull(raw.toolListOrderHash);
  }
  const eff = effortOrNull(raw.reasoningEffort);
  if (eff) ctx.reasoningEffort = eff;
  const temp = numOrNull(raw.temperature);
  if (temp !== null) ctx.temperature = temp;
  if (Array.isArray(raw.mcpServers)) ctx.mcpServers = strArray(raw.mcpServers);
  return ctx;
}

export interface CacheHabitsFromTranscriptArgs {
  /** Absolute path to the Claude Code session transcript (JSONL). */
  transcript_path: string;
  /**
   * The host's DECLARED next action. A transcript cannot supply this (the
   * action hasn't happened yet), so the caller must. At minimum `{ model }`.
   */
  proposed_action: unknown;
  /**
   * Prior-state the transcript cannot record (configured TTL, system-prompt
   * token count, tool-list order hash, active effort/temperature, MCP servers).
   * Optional — omitted fields stay "unknown" and the dependent rules stay quiet.
   */
  snapshot_context?: unknown;
  /** Rule ids to suppress (e.g. one that fires spuriously in this env). */
  suppress?: string[];
  /** Per-rule severity overrides, e.g. demote "block" to "warn" in shadow. */
  severity_overrides?: Record<string, "info" | "warn" | "block">;
}

/**
 * F9 end-to-end — derive the snapshot from a real transcript, then run the full
 * cache-habits linter against the caller's proposed next action.
 *
 * Async because it reads the transcript via the same `loadCachedSessionView`
 * entry point the f6 context-health tool uses. Fail-safe and pure-output:
 * returns a JSON string, never throws across the MCP wire.
 */
export async function handleCacheHabitsFromTranscript(
  args: CacheHabitsFromTranscriptArgs
): Promise<string> {
  if (!args || typeof args.transcript_path !== "string" || !args.transcript_path) {
    return JSON.stringify({
      error: "cache_habits_from_transcript requires a `transcript_path` string.",
    });
  }
  if (!isObj(args.proposed_action)) {
    return JSON.stringify({
      error:
        "cache_habits_from_transcript requires a `proposed_action` object — the " +
        "host's next action, which no transcript can supply. At minimum: { model }.",
    });
  }
  const proposed = coerceProposedActionInput(args.proposed_action);
  if (!proposed) {
    return JSON.stringify({
      error: "cache_habits_from_transcript: proposed_action.model is required.",
    });
  }
  const context = isObj(args.snapshot_context)
    ? coerceSnapshotContext(args.snapshot_context)
    : {};

  // Load the transcript view. Fail-safe: a missing/unreadable file yields an
  // empty turn set, and the adapter then derives currentModel from the proposal
  // (⇒ no spurious model switch) rather than throwing.
  let view;
  try {
    view = await loadCachedSessionView(args.transcript_path);
  } catch (e) {
    return JSON.stringify({
      error: `cache_habits_from_transcript: could not read transcript — ${(e as Error).message}`,
    });
  }

  const { snapshot, action } = buildCacheHabitsInputs(view, proposed, context);

  const suppress = Array.isArray(args.suppress)
    ? args.suppress.filter((s): s is string => typeof s === "string")
    : undefined;
  const severityOverrides =
    args.severity_overrides && isObj(args.severity_overrides)
      ? args.severity_overrides
      : undefined;

  let report;
  try {
    report = lintCacheHabits(action, snapshot, { suppress, severityOverrides });
  } catch (e) {
    return JSON.stringify({
      error: `cache_habits_from_transcript: ${(e as Error).message}`,
    });
  }

  return JSON.stringify(
    {
      featureId: CACHE_HABITS_FEATURE_ID,
      verdict: report.verdict,
      findings: report.findings,
      totals: {
        estimatedWasteUsd: report.totalEstimatedWasteUsd,
        estimatedWasteTokens: report.totalEstimatedWasteTokens,
        findingCount: report.findings.length,
      },
      skipped: report.skipped,
      quality_proof: buildCacheHabitsProof(report, action, snapshot),
      // Transparency: separate what was DERIVED from the transcript from what the
      // caller DECLARED. Never hide the boundary — the proposed next action is
      // always caller-supplied because no transcript records it.
      derived: {
        transcriptHadTurns: snapshot.turnsSoFar > 0,
        turnsObserved: snapshot.turnsSoFar,
        currentModel: snapshot.currentModel,
        lastTurnAt: snapshot.lastTurnAt,
        cacheReadTokensSoFar: snapshot.cacheReadTokensSoFar,
        cacheCreationTokensSoFar: snapshot.cacheCreationTokensSoFar,
        note:
          "The snapshot above is derived from the transcript; the proposed next " +
          "action (model/ttl/effort/temperature/…) is caller-supplied because a " +
          "transcript cannot record an action before it is taken. This narrows, " +
          "not closes, host wiring: the host still declares the next action.",
      },
    },
    null,
    2
  );
}

// ===========================================================================
// N6 — subagent_cost_predict (pre-spawn subagent cost predictor)
// ===========================================================================

export interface SubagentCostPredictArgs {
  /** Observed per-subagent usage samples from this session (caller-supplied). */
  history?: SubagentCostSample[];
  /** How many subagents are about to be spawned. Default 1. */
  proposed_count?: number;
  /** Model the proposed subagents will run on (for pricing the history). */
  model: string;
  /** Provider hint; inferred from the model name when omitted. */
  provider?: Provider;
}

/**
 * N6 — project the cost of a proposed subagent fan-out before it runs.
 * Complements the count-based subagent-warden by answering "what will this
 * cost?". The predictor core is pure and tested in @prune/intelligence; this is
 * the boundary wrapper: validate the model, default the count, and shape the
 * JSON. Bad input → a JSON `error`, never a throw across the MCP wire. Strict
 * pricing and caller-supplied numbers are enforced by the core — nothing here
 * fabricates a token count or a rate.
 */
export function handleSubagentCostPredict(args: SubagentCostPredictArgs): string {
  if (!args || typeof args.model !== "string" || args.model.length === 0) {
    return JSON.stringify({
      error: "subagent_cost_predict requires a `model` string.",
    });
  }
  const prediction = predictSubagentCost({
    history: Array.isArray(args.history) ? args.history : [],
    proposedCount:
      typeof args.proposed_count === "number" ? args.proposed_count : 1,
    model: args.model,
    provider: args.provider,
  });
  return JSON.stringify(prediction, null, 2);
}

// ===========================================================================
// 2.4(d) — reasoning_effort_route (Reasoning-Effort Auto-Router)
// ===========================================================================

export interface ReasoningEffortRouteArgs {
  /** The effort dial currently in use. */
  current_effort: ReasoningEffort;
  /** Per-effort outcome stats on the user's task class (caller-supplied). */
  outcomes: EffortOutcomeStats[];
  /** Task class id (qpd cluster). Default "default". */
  task_class?: string;
  /** Never recommend below this effort. Default "standard". */
  floor?: ReasoningEffort;
  ar_margin?: number;
  tpr_margin?: number;
  cost_dominance_ratio?: number;
  min_samples?: number;
}

/**
 * 2.4(d) — recommend the lowest reasoning effort that is quality-non-inferior to
 * the current one on the caller's task class, so the dial is set right up front
 * (actuating CH-009, which warns about mid-session effort changes). Down-route
 * only; holds on insufficient data or when no lower effort clears the gates.
 * Pure; bad input → a JSON error, never a throw across the MCP wire.
 */
export function handleReasoningEffortRoute(args: ReasoningEffortRouteArgs): string {
  if (!args || typeof args.current_effort !== "string" || !Array.isArray(args.outcomes)) {
    return JSON.stringify({
      error:
        "reasoning_effort_route requires `current_effort` and an `outcomes` array.",
    });
  }
  const rec = routeReasoningEffort(args.current_effort, args.outcomes, {
    taskClass: args.task_class,
    floor: args.floor,
    arMargin: args.ar_margin,
    tprMargin: args.tpr_margin,
    costDominanceRatio: args.cost_dominance_ratio,
    minSamples: args.min_samples,
  });
  return JSON.stringify(rec, null, 2);
}

// ===========================================================================
// Phase-8 Tier-1 features (boundary wrappers over tested package cores).
// Each parses args, calls the pure core, and shapes JSON. The cores live in
// @prune/response-tuner, @prune/diff-enforcer, @prune/tab-auditor and own the
// real algorithms + tests; these handlers add only arg validation and the
// "never throw across the wire → JSON error" boundary discipline.
// ===========================================================================

export interface ResultPruneArgs {
  /** The large tool-result text to prune. */
  text: string;
  /** Pass-through PruneOptions (layer toggles, thresholds). The core sanitizes. */
  options?: Record<string, unknown>;
}

/** 2.4(a) — shrink a large tool result; real token accounting + manifest. */
export function handleResultPrune(args: ResultPruneArgs): string {
  if (!args || typeof args.text !== "string") {
    return JSON.stringify({ error: "result_prune requires a `text` string." });
  }
  return JSON.stringify(pruneResult(args.text, args.options ?? {}), null, 2);
}

export interface MaxTokensCalibrateArgs {
  /** Observed output-token-count samples for the task class. */
  samples: number[];
  /** Pass-through CalibrateOptions (p, safetyMargin, bucket, minSamples, …). */
  options?: Record<string, unknown>;
}

/** 2.4(b) — recommend a max_tokens reservation from observed output lengths. */
export function handleMaxTokensCalibrate(args: MaxTokensCalibrateArgs): string {
  if (!args || !Array.isArray(args.samples)) {
    return JSON.stringify({
      error: "max_tokens_calibrate requires a `samples` array of output-token counts.",
    });
  }
  return JSON.stringify(calibrateMaxTokens(args.samples, args.options ?? {}), null, 2);
}

export interface DiffVsRewriteArgs {
  original: string;
  proposed: string;
  /** Pass-through DiffEnforceOptions (model, context, thresholds). */
  options?: Record<string, unknown>;
}

/** 2.4(c) — recommend diff vs full rewrite by real token cost, diff verified. */
export function handleDiffVsRewrite(args: DiffVsRewriteArgs): string {
  if (!args || typeof args.original !== "string" || typeof args.proposed !== "string") {
    return JSON.stringify({
      error: "diff_vs_rewrite requires `original` and `proposed` strings.",
    });
  }
  return JSON.stringify(diffEnforce(args.original, args.proposed, args.options ?? {}), null, 2);
}

export interface OpenTabAuditArgs {
  tabs: unknown[];
  activeFile: string;
  task_keywords?: string[];
  import_edges?: Array<{ from: string; to: string }>;
  /** Pass-through AuditOptions (dropThreshold, weights). */
  options?: Record<string, unknown>;
}

/** 2.4(e) — score open editor tabs and recommend drops with honest savings. */
export function handleOpenTabAudit(args: OpenTabAuditArgs): string {
  if (!args || !Array.isArray(args.tabs) || typeof args.activeFile !== "string") {
    return JSON.stringify({
      error: "open_tab_audit requires a `tabs` array and an `activeFile` string.",
    });
  }
  return JSON.stringify(
    auditOpenTabs(
      {
        tabs: args.tabs as never,
        activeFile: args.activeFile,
        taskKeywords: args.task_keywords,
        importEdges: args.import_edges,
      },
      args.options ?? {}
    ),
    null,
    2
  );
}

export interface RewardIntegrityArgs {
  /** The file path the write targets. */
  path: string;
  /** On-disk content before the write (null on file creation). */
  before?: string | null;
  /** Proposed content after the write (null on deletion). */
  after?: string | null;
  /** Designated grader/oracle path suffixes the agent must not write. */
  grader_paths?: string[];
  /** Extra repo-specific test-file suffixes. */
  extra_test_suffixes?: string[];
}

/**
 * F14 — Reward-Integrity check. Given a proposed write, returns the structural
 * verdict (ok | suspicious | violation | inconclusive) for whether the edit
 * weakens the tests/grader the agent is judged against. AST + content-hash;
 * deterministic; never blocks here (the hook decides) — this surfaces the
 * verdict for AI self-regulation.
 */
export function handleRewardIntegrityCheck(args: RewardIntegrityArgs): string {
  if (!args || typeof args.path !== "string") {
    return JSON.stringify({
      error: "reward_integrity_check requires a `path` string.",
    });
  }
  const write: ProposedWrite = {
    path: args.path,
    before: args.before ?? null,
    after: args.after ?? null,
  };
  const config: RewardIntegrityConfig = {
    graderPaths: args.grader_paths ?? [],
    extraTestSuffixes: args.extra_test_suffixes ?? [],
  };
  return JSON.stringify(evaluateRewardIntegrity(write, config), null, 2);
}

export interface ObservationMaskArgs {
  /** The observation buffer: { id, turn, tokens, contentHash, pinned?, nextUseTurn? }. */
  observations: Observation[];
  current_turn: number;
  window_turns: number;
  placeholder_tokens?: number;
  token_budget?: number | null;
  previously_masked_ids?: string[];
}

/**
 * F15 — Observation-mask plan. Given the observation buffer and a window,
 * returns which observations to replace with placeholders (and the reclaimed
 * tokens), capping retained context at O(window). Deterministic; reclaim is
 * computed from caller-measured token counts (never fabricated).
 */
export function handleObservationMaskPlan(args: ObservationMaskArgs): string {
  if (!args || !Array.isArray(args.observations)) {
    return JSON.stringify({
      error: "observation_mask_plan requires an `observations` array.",
    });
  }
  if (typeof args.current_turn !== "number" || typeof args.window_turns !== "number") {
    return JSON.stringify({
      error: "observation_mask_plan requires numeric `current_turn` and `window_turns`.",
    });
  }
  const config: MaskConfig = {
    currentTurn: args.current_turn,
    windowTurns: args.window_turns,
    placeholderTokens: args.placeholder_tokens,
    tokenBudget: args.token_budget ?? null,
    previouslyMaskedIds: args.previously_masked_ids ?? [],
  };
  return JSON.stringify(planMask(args.observations, config), null, 2);
}

export interface ReadGateArgs {
  /** The file read being proposed. */
  path: string;
  /** SHA of the file's current content. */
  content_hash: string;
  turn: number;
  tokens: number;
  epoch: number;
  /** Prior resident set to evaluate against (omit for a fresh set). */
  resident_set?: ResidentSet;
}

/**
 * F16 — Read-gate check. Given a proposed read and the prior resident set,
 * returns the verdict (allow | deny) and the updated resident set. A `deny`
 * means the identical content is provably still in context (same hash + epoch),
 * so it is information-lossless. Deterministic; reclaim from caller-measured
 * tokens.
 */
export function handleReadGateCheck(args: ReadGateArgs): string {
  if (
    !args ||
    typeof args.path !== "string" ||
    typeof args.content_hash !== "string" ||
    typeof args.turn !== "number" ||
    typeof args.tokens !== "number" ||
    typeof args.epoch !== "number"
  ) {
    return JSON.stringify({
      error:
        "read_gate_check requires `path`, `content_hash`, `turn`, `tokens`, `epoch`.",
    });
  }
  const set: ResidentSet =
    args.resident_set && typeof args.resident_set === "object"
      ? args.resident_set
      : emptyResidentSet(args.epoch);
  const req: ReadRequest = {
    path: args.path,
    contentHash: args.content_hash,
    turn: args.turn,
    tokens: args.tokens,
    epoch: args.epoch,
  };
  const { verdict, set: nextSet } = stepReadGate(set, req);
  return JSON.stringify({ verdict, resident_set: nextSet }, null, 2);
}

export interface ProgramSliceArgs {
  /** Dependency graph nodes: { id, tokens? }. */
  nodes: Array<{ id: string; tokens?: number }>;
  /** Directed dependency edges: { from, to } meaning `from` depends on `to`. */
  edges: Array<{ from: string; to: string }>;
  /** Seed symbol ids (the task's targets). */
  seeds: string[];
  direction?: SliceDirection;
  max_depth?: number;
  token_budget?: number | null;
}

/**
 * F17 — Program-slice context selection. Returns the backward static slice
 * (transitive dependency closure) of the seed symbols over the dependency graph
 * — the sound context set. With no token_budget the slice drops nothing
 * (`sound: true`); forward direction gives the change-impact set. Deterministic.
 */
export function handleProgramSlice(args: ProgramSliceArgs): string {
  if (
    !args ||
    !Array.isArray(args.nodes) ||
    !Array.isArray(args.edges) ||
    !Array.isArray(args.seeds)
  ) {
    return JSON.stringify({
      error: "program_slice requires `nodes`, `edges`, and `seeds` arrays.",
    });
  }
  const graph: SliceGraphInput = { nodes: args.nodes, edges: args.edges };
  return JSON.stringify(
    computeSlice(graph, {
      seeds: args.seeds,
      direction: args.direction,
      maxDepth: args.max_depth,
      tokenBudget: args.token_budget ?? null,
    }),
    null,
    2
  );
}

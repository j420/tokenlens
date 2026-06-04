/**
 * @prune/host-adapters
 *
 * Turns REAL, available session data into the typed inputs the caller-fed MCP
 * tools require — so those tools are driven from genuine sources, not
 * hand-stubbed payloads. Two adapters ship here, and two deliberately do NOT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT SHIPS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. buildCacheHabitsInputs (cache-habits-inputs.ts)
 *    Source: the typed transcript view (NormalizedTurn[] from @prune/telemetry
 *    loadCachedSessionView) + the host's DECLARED next action.
 *    Produces: the full `{ snapshot, action }` the cache_habits linter consumes
 *    so all 12 CH rules can fire (not just the idle-gap rule the
 *    UserPromptSubmit hook can prove). The real, testable core is the
 *    change-detection: each `action.changes` field is non-null ONLY when the
 *    proposal genuinely differs from the transcript-derived snapshot.
 *
 * 2. recordHudTransition (hud-recorder.ts)
 *    Source: the f5 HUD `quality_proof` (buildHudQualityProof) emitted on a real
 *    spend-severity zone transition. Records it via @prune/persistence
 *    (recordFeatureEvent + LocalSqliteSink). Fire-and-forget, fail-safe,
 *    PRUNE_TELEMETRY_DISABLED-gated, refuses /proc & /sys paths.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT DOES *NOT* SHIP — AND WHY (THE NO-FAKE RULE)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A raw Claude Code transcript is the only "free" session source available
 * locally. It records, per turn: the model, timestamps, the assistant/user
 * message blocks, tool uses/results, and an aggregate `usage` (input, output,
 * cache_read, cache_creation). Crucially, it does NOT attribute that usage to
 * any finer unit. Two requested adapters need exactly such attribution, so
 * building them from a transcript would require inventing numbers — which
 * violates the project's no-fake rule (CLAUDE.md: "NEVER fabricate a token
 * count / cost / timestamp"). We therefore do not ship them, rather than ship a
 * stub that guesses.
 *
 * • NO subagent-cost-sample adapter.
 *   Data contract the tool needs: per-SUBAGENT token usage and cost — i.e. for
 *   each spawned sub-agent / Task invocation, how many input/output/cache
 *   tokens IT consumed and the dollar cost attributable to IT.
 *   Why the transcript can't supply it: the transcript's per-turn `usage` is an
 *   aggregate for the whole turn. When a turn spawns a Task tool, the sub-agent
 *   runs in its OWN context whose usage is not broken out and re-attributed back
 *   into the parent transcript's usage rows. There is no per-subagent token
 *   ledger to read. Summing the parent turn's usage and calling it "the
 *   subagent's cost" would be a fabricated attribution. This requires host
 *   instrumentation that meters each sub-agent invocation separately.
 *
 * • NO reasoning-effort-outcome adapter.
 *   Data contract the tool needs: per-EFFORT outcome samples — for a given
 *   reasoning-effort dial setting, the realized cost AND the acceptance/success
 *   outcome (did the user accept the result without a retry?).
 *   Why the transcript can't supply it: a transcript records neither the effort
 *   dial used per turn (it isn't a logged field) nor an acceptance/retry signal
 *   tied to a specific effort level. Acceptance is a host-surface event
 *   (user accepted/rejected/edited the diff), and the effort setting is host
 *   configuration — neither is in the JSONL. Pairing a guessed effort with a
 *   guessed outcome would be doubly fabricated. This requires host
 *   instrumentation that logs (effort, cost, accepted?) tuples at the surface.
 *
 * In both cases the linter/tool already does the honest thing when fed a null:
 * a missing count yields a null estimate, not a guessed one. The right fix is
 * host instrumentation, not a transcript-derived stub.
 */

export {
  buildCacheHabitsInputs,
  type CacheHabitsInputs,
  type ProposedActionInput,
  type SnapshotContextInput,
  type TranscriptViewLike,
  type ReasoningEffort,
} from "./cache-habits-inputs.js";

export {
  recordHudTransition,
  isUnsafeSinkPath,
  type RecordHudTransitionParams,
} from "./hud-recorder.js";

# Prune hooks for Claude Code

Standalone hook scripts that run the Prune intelligence layer against a
live session. They read the Claude Code hook payload on stdin (a JSON
object with `transcript_path` and `hook_event_name`), do their analysis,
and emit a JSON decision on stdout per the
[Claude Code hooks spec](https://code.claude.com/docs/en/hooks).

Each script depends only on the workspace packages — no compilation
step. You can run them directly with Node 20+:

```bash
echo '{"hook_event_name":"Stop","transcript_path":"/abs/path/to/session.jsonl"}' | \
  node apps/extension/hooks/loop-breaker.mjs
```

| Script | Hook events | What it does |
|---|---|---|
| `loop-breaker.mjs` | `Stop`, `PostToolUse` | Replay the transcript ROI; if 3 consecutive low-ROI turns, exit 2 with a block message and routing suggestion. |
| `cache-stabilize.mjs` | `UserPromptSubmit` | Inspect the recent window for cache-bust signals (timestamps, MCP tool drift, low hit rate) and emit advisory `additionalContext`. |
| `compaction-recover.mjs` | `PostCompact` | Analyze what entities were lost on compaction; emit a recovery reminder as `additionalContext`. |
| `budget-gate.mjs` | `Stop` | Active budget enforcement. Records each new turn's usage as a charge against a named envelope; emits `decision:block` on hard-cap breach, `additionalContext` on soft-cap / burn-rate warning. Configure via env vars `PRUNE_BUDGET_ENVELOPE`, `PRUNE_BUDGET_SQLITE`, `PRUNE_BUDGET_DISABLED`. Create the envelope first via the `budget_configure` MCP tool. |
| `subagent-warden.mjs` | `PreToolUse` (matcher: `Task`) | Runaway-prevention. Reads the live session, projects the proposed Task into the activity state, and blocks on documented incident patterns (`FAN_OUT_RUNAWAY` 49-subagent burst, `UNATTENDED_LOOP` 23-subagent 3-day, `CONCURRENT_CAP`, `PEAK_PARALLEL_IN_TURN`). Configure via env vars `PRUNE_SUBAGENT_MAX_CONCURRENT` (15), `PRUNE_SUBAGENT_MAX_BURST` (10), `PRUNE_SUBAGENT_MAX_PARALLEL` (12), `PRUNE_SUBAGENT_MAX_MINUTES` (30), `PRUNE_SUBAGENT_DISABLED`. |

Install (manual for now): point a Claude Code hook entry at the script
path. A future `prune.installHooks` extension command will automate
this with user-scoped vs project-scoped settings management.

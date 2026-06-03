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
| `replay-recorder.mjs` | `Stop`, `PostToolUse` (any matcher) | Tamper-evident audit log. Appends each hook fire to the local hash-chained + ed25519-signed `ReplayVault` for EU AI Act Art 12 / ISO 42001 A.6.1.6 / NIST RMF Measure 2.5 compliance. Configure via `PRUNE_VAULT_SQLITE`, `PRUNE_VAULT_KEY`, `PRUNE_VAULT_DISABLED`. Verify integrity with the `replay_verify` MCP tool. |
| `sentinel-prompt.mjs` | `UserPromptSubmit` | Pre-prompt secret scanner. Blocks vendor API keys, private keys, connection URLs (gitleaks/TruffleHog patterns) before they enter the cloud context. Responds to GitGuardian's 3.2% AI-commit leak baseline. Configure via `PRUNE_SENTINEL_DISABLED`, `PRUNE_SENTINEL_WARN_ONLY`. |
| `sentinel-mcp.mjs` | `PostToolUse` (any matcher) | MCP-response prompt-injection shield. Blocks SHADOWING / PATH_TRAVERSAL / ARGUMENT_INJECTION signatures in tool results. Responds to the Jan 20 2026 RCE in Anthropic's Git MCP server (arXiv 2601.17548). Configure via `PRUNE_SENTINEL_MCP_DISABLED`, `PRUNE_SENTINEL_MCP_WARN_ONLY`. |
| `slo-breaker.mjs` | `Stop` | Cost SLO + circuit-breaker (SRE Error Budget pattern for AI cost). Reads the named SLO from the sink and emits `decision:block` when the error budget is exhausted, or `additionalContext` when the warning threshold trips. Wire AFTER budget-gate.mjs so the latest turn's charge is recorded first. Configure via `PRUNE_SLO_NAME`, `PRUNE_SLO_SQLITE`, `PRUNE_SLO_DISABLED`, `PRUNE_SLO_WARN_ONLY`. |
| `trajectory-diet.mjs` (TCRP F1) | `PreToolUse` | Scores the proposed tool call for predicted influence on the final output and, when F1 is promoted past shadow (`~/.prune/feature-flags.json`), emits an advisory to skip/narrow a low-influence step. Never blocks, never skips — advisory only. Conservative online (utilization unknowable pre-execution); F1's high-confidence skips come from offline trajectory analysis. |
| `speculative-prune.mjs` (TCRP F3) | `PreToolUse` | Advisory: when a proposed `Read` targets a file byte-identical (content-SHA) to one already read this session, nudges the agent that it already has the current content — saving the re-read. Goes silent the moment the file changes. Reads the cache built by `speculative-record.mjs`. Gated by the F3 flag (shadow ⇒ no-op). Hard verified substitution is the Agent SDK adapter's job (per the per-surface honesty matrix). |
| `speculative-record.mjs` (TCRP F3) | `PostToolUse` (matcher: `Read`) | Builds the session-scoped speculative cache (`~/.prune/cache/spec-<hash>.json`) that the PreToolUse advisory reads: stores each read file's content with its content-SHA freshness token. Runs regardless of flag (building the cache is harmless; only surfacing is gated). |

Install (manual for now): point a Claude Code hook entry at the script
path. A future `prune.installHooks` extension command will automate
this with user-scoped vs project-scoped settings management.

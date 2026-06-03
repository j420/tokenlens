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
| `skill-capture.mjs` (F12) | `Stop` | Distills the session's INFLUENTIAL trajectory (the complement of trajectory-diet's low-influence advisories) into a typed skill and appends it to the local skill library (`~/.prune/skills/library.json`, atomic write, content-hash dedup, LRU prune at `PRUNE_SKILLS_MAX`). Building the library is a harmless local write, so capture runs regardless of flag; the library is only surfaced by `skill-advisor.mjs`. Config: `PRUNE_SKILLS_PATH`, `PRUNE_SKILLS_MAX`, `PRUNE_SKILLS_DISABLED`. |
| `skill-advisor.mjs` (F12) | `UserPromptSubmit` | Fingerprints the new prompt and matches it (Jaccard ≥ `PRUNE_SKILLS_THRESHOLD`) against the skill library. On a match, emits an `additionalContext` advisory naming the cached influential tool sequence and the projected token/$ saving, so the agent can skip re-discovery. Advisory only; the host must verify target freshness before acting. Gated on f12. Config: `PRUNE_SKILLS_PATH`, `PRUNE_SKILLS_THRESHOLD`, `PRUNE_SKILLS_MODEL`, `PRUNE_SKILLS_DISABLED`. |
| `cache-habits-advisor.mjs` (F9) | `UserPromptSubmit` | Runs the transcript-derivable subset of the cache-habits linter — CH-004 (idle gap exceeded the active TTL → cached prefix expired, this turn rewrites it). The richer rules (model switch, tool-list reorder, system-prompt mutation, large paste) need the host's proposed-action diff, which the hook payload doesn't carry, and run in the editor integration / the `cache_habits` MCP tool instead. Gated on f9. Config: `PRUNE_CACHE_TTL` (`5m`/`1h`/`none`), `PRUNE_CACHE_HABITS_DISABLED`. |

Install (manual for now): point a Claude Code hook entry at the script
path. A future `prune.installHooks` extension command will automate
this with user-scoped vs project-scoped settings management.

## Feature telemetry (`quality_proof` → events sink)

The `skill-capture` (f12), `skill-advisor` (f12), and `cache-habits-advisor`
(f9) hooks record their `quality_proof` to the shared events sink so the
telemetry lands in one stream the dashboard / Postgres export reads, keyed by
`feature_id`. This is the first EventRow-recording path in the repo (the
`events.feature_id` / `events.quality_proof` columns existed; nothing wrote
them before), routed through `@prune/persistence`'s `buildFeatureEventRow` /
`recordFeatureEvent` so every feature row is shaped identically.

It is deliberately conservative:

- **Best-effort.** Any failure (lock contention, disk, bad params) is
  swallowed — recording can never break an advisory. Recording happens
  *before* the feature-flag gate, so shadow mode still collects telemetry while
  the user-facing advisory stays gated.
- **Idempotent.** Event ids are deterministic (skill content hash, idle
  session+timestamp), so re-firing a hook upserts rather than duplicates.
- **Hang-proof.** The events DB must live on a real filesystem; pseudo-fs
  paths (`/proc`, `/sys`) are refused up front, because a `mkdir` lookup under
  procfs blocks at the syscall level (a synchronous hang no JS timeout can
  rescue). Every normal failure throws in ~1 ms and is caught.
- **Measured latency, never fabricated.** Each recording hook wraps its real
  analysis (`performance.now()` from transcript/library load through the
  detector) and records the elapsed wall-clock as `latency_ms`. A feature that
  did no measurable work records `0`; nothing is invented.

Config: `PRUNE_EVENTS_SQLITE` (default `~/.prune/events.sqlite`),
`PRUNE_TELEMETRY_DISABLED=1` to turn recording off.

f10 (mcp-proxy) and f11 (replay-cost) emit their `quality_proof` in the
`mcp_proxy_trim` / `replay_cost_plan` MCP tool responses; the MCP server's
CallTool dispatch records that proof to the SAME events sink, caller-side,
**gated behind `PRUNE_MCP_TELEMETRY=1` (default OFF)** so the pure tool handlers
stay pure and existing behavior is unchanged. The recording is best-effort and
fail-safe with the identical `/proc`/`/sys` refusal and deterministic
`event_id` (`mcp-<feature>-<hash(proof)>`) for idempotent upserts. f13
(speculative-pipeline) emits via its host-integration API.

## Features whose runtime surface is NOT a transcript hook

Three Phase-9.7 features deliberately do not ship as Claude Code hooks,
because the hook model (synchronous pre/post events over a session
transcript) is the wrong shape for them. Forcing them into a hook would
be theatre, not wiring:

- **`@prune/mcp-proxy` (f10)** intercepts the MCP JSON-RPC `tools/list` /
  `tools/call` handshake between an MCP host and its servers — a
  transport-level proxy, not a transcript event. Its runtime surface is a
  proxy entrypoint the host mounts, or an on-demand MCP tool for catalog
  trimming — the latter is now registered in `apps/mcp-server` as
  `mcp_proxy_trim`. It is host-neutral by design (Cursor / Codex CLI / Cline /
  Continue / Aider), none of which fire Claude Code hooks. The package exposes
  the full `McpProxy` API today.
- **`@prune/replay-cost` (f11)** is an on-demand what-if engine: the user
  asks "what would this prompt variant cost?" It is invoked against a
  captured timeline, not fired automatically per turn. Its natural surface
  is an MCP tool / CLI — now registered in `apps/mcp-server` as
  `replay_cost_plan`; the package exposes `planReplay` / `WhatIfEngine` today.
- **`@prune/speculative-pipeline` (f13)** drives PARALLEL speculative tool
  execution while the model is still generating — a stateful concurrent
  loop owned by a host with a parallel executor. A synchronous hook cannot
  express it. Its surface is the host runtime integration; the package
  exposes the full `SpeculativePipeline` API for that.

The MCP-tool registrations for f10/f11 are wired (`mcp_proxy_trim`,
`replay_cost_plan`) with caller-side telemetry; the host integration for f13 is
the remaining wiring step (tracked separately). The flags below already exist
so those surfaces can promote through shadow → general when wired.

The feature flags f9–f13 are defined in `@prune/shared` (`feature-flags.ts`)
so all five share the same shadow → canary → general promotion machinery,
regardless of whether their runtime surface is a hook, an MCP tool, or a
host integration.

## Flag-promotion CLI (`flags.mjs`)

Promote a TCRP feature out of shadow — or take it back down — without
hand-editing `~/.prune/feature-flags.json` (the file every hook reads to decide
whether a feature is live). It is an operator tool, not a hook: plain output,
real exit codes (`0` ok, `1` usage/validation error), no model call.

```bash
node apps/extension/hooks/flags.mjs list                 # id, name, enabled, mode, LIVE marker
node apps/extension/hooks/flags.mjs enable f10 canary     # by id
node apps/extension/hooks/flags.mjs enable mcpProxy general  # or by name
node apps/extension/hooks/flags.mjs disable f10           # enabled=false, mode="disabled"
```

- `<id|name>` accepts an id (`f10`) or the canonical name (`mcpProxy`), resolved
  via `@prune/shared` `resolveFeatureId`; an unknown identifier is **refused**
  (exit 1) with the valid set, never silently ignored.
- `enable` only accepts the user-visible modes `general` / `canary` (a feature
  is "live" only when `enabled && (general | canary)`); `shadow` / `disabled`
  are rejected — use `disable` to take a feature down.
- Mutations go through `@prune/shared` `withFeatureMutation`; the file is
  validated on read (`validateFlags`), so a pre-existing malformed file is
  repaired to defaults rather than propagated, and written atomically
  (tmp + `rename`) so a concurrent hook reader never sees a torn file.
- Override the file path with `PRUNE_FLAGS_PATH` (default
  `~/.prune/feature-flags.json`).

Tests: `npx vitest run apps/extension/hooks/flags.test.mjs` (run on demand —
the extension package has no turbo `test` task).

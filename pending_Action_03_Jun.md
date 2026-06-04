# Pending Actions — 03 Jun 2026

Status snapshot at branch `claude/codebase-orientation-fVmqj` (HEAD `860ce40`),
full workspace **64/64 turbo tasks green**, working tree clean, everything
committed and pushed. This file records what is **NOT yet done**. Nothing below
is in the working tree as uncommitted work — these are forward actions.

> **Most of the list below has since shipped — see the dated Status update
> immediately following before treating any row as outstanding.**

---

## Status update — 04 Jun 2026

The bulk of the actions originally captured here are now **done in the tree**.
Verified against the current working set (paths cited so each claim is
checkable). What genuinely **remains** is, in every case, an ops/deploy/product
decision or host glue — not unbuilt core logic. No overclaiming below.

### DONE since the 03 Jun snapshot

- **1.1 Live-Postgres test** — `packages/persistence/src/postgres.live.integration.test.ts`
  exists and is gated on `PRUNE_PG_TEST_URL` (self-skips with no DB). It proves
  the real postgres-js driver result shaping, numeric/jsonb coercion, ON CONFLICT
  upsert, and the `(session_id, sequence)` unique-index race that PGlite cannot.
  CI now runs it against a `postgres:16` service container — see
  `.github/workflows/ci.yml` (`postgres-live` job).
- **1.2 f2 / f4 MCP-tool telemetry** — wired in `apps/mcp-server`
  (`feature-telemetry.ts` + `tcrp-tools.ts`, with tests).
- **1.3 f5 (HUD) telemetry** — addressed in `apps/extension` (HUD honesty fix;
  see strict-pricing note below — HUDs now show "insufficient_data" rather than a
  fabricated default cost).
- **1.4 local-sqlite → dashboard forwarder** — `packages/persistence/src/forward.ts`
  (+ `forward.test.ts`).
- **1.6 Hook auto-install** — `prune.installHooks` is present in
  `apps/extension/src/extension.ts` (installer alongside `apps/extension/hooks/`).
- **2.1 cache-habits as an MCP tool** — `cache_habits` exposed via
  `apps/mcp-server/src/tcrp-tools.ts` (rules in `packages/cache-habits/`).
- **2.2 sandboxed-worktree executor** — `packages/speculative-pipeline/src/worktree-executor.ts`
  (+ `host.ts`, tests).
- **2.3 subagent cost-predictor** — `packages/intelligence/src/subagent-cost-predictor.ts`
  (+ tests).
- **2.4 Phase-8 Tier-1, all five** —
  (a) tool-result sub-token pruner `packages/response-tuner/src/result-pruner.ts`;
  (b) `max_tokens` calibrator `packages/response-tuner/src/max-tokens-calibrator.ts`;
  (c) diff-vs-rewrite enforcer `packages/diff-enforcer/`;
  (d) reasoning-effort auto-router `packages/qpd-bench/src/effort-router.ts`;
  (e) IDE open-tab auditor `packages/tab-auditor/`.
- **3.1 citations** — the inherited attributions (GitGuardian 3.2%, arXiv
  2601.17548, arXiv 2604.04979) are now labelled to their sources in
  `packages/sentinel/src/{index,secrets,injection,sentinel}.ts` etc.
- **Strict-pricing API + HUD honesty** — `packages/shared/src/pricing.ts` adds
  `getModelPricingStrict` / `getModelPricingStrictByName` returning `null` for
  unregistered models (discipline: "unknown model → null, never a default rate").

### GENUINELY REMAINS (ops / deploy / product decisions — not unbuilt logic)

- **1.5 Flag promotion** — f7–f13 still `mode: shadow`. Machinery + CLI exist;
  promoting to canary/general is an **operational** call, intentionally not made
  in code.
- **1.4 forwarding (deploy side)** — the forwarder code exists; pointing it at a
  hosted ingest endpoint and actually shipping local telemetry is a **deploy**
  step, not a code gap.
- **2.1 E3 full linter — host wiring** — the remaining cache-habit rules need the
  host's *proposed-action diff*, which a Claude Code hook payload doesn't carry.
  The rules/tool exist; feeding them caller-supplied diffs is **host wiring**.
- **Strict-null cost semantics** — *how* downstream surfaces should present a
  `null` (unpriced) cost — block, warn, or annotate — is a **product decision**;
  the strict API is in place to support whichever is chosen.
- **3.2 Signal-gated f1–f6 telemetry** — **no action**: recording only when an
  advisor/decision fires is correct (no telemetry spam); dashboard cards stay
  empty until a real session triggers a signal. Left as-is by design.

---

## Done (so it's clear what is NOT pending)

- Flagship features **E1–E5** built, tested, wired:
  - f9 cache-habits · f10 mcp-proxy · f11 replay-cost · f12 skill-library · f13 speculative-pipeline
- Cache features **N2** (delta cache-resend), **N5** (session-idle cache guard),
  **N3** (cross-turn input recompression planner) in `@prune/agent-sdk-adapter`.
- Reviewer **HIGH-1/2/3** fixes applied + independently re-audited (verdict:
  credible / enterprise-grade); the f13 v2 quality_proof schema seam reconciled.
- Telemetry recording path established: `@prune/persistence`
  `buildFeatureEventRow` / `recordFeatureEvent`; hooks emitting f9, f12, and
  (retrofit) f1, f3, f6.
- Dashboard read-side rolls up **all f1–f13** (rich decoders f9–f13, generic
  rollup f1–f8); `GET /api/v1/features` + `/dashboard/telemetry` page.
- `PostgresSink` (full `PersistenceSink` interface) proven against PGlite.
- Flag enum f1–f13; flag-promotion CLI `apps/extension/hooks/flags.mjs`.
- Repo hygiene: `.claude/worktrees/` gitignored.

---

## 1. Standing follow-ups (honest caveats from this session)

| # | Action | Why pending | Surface |
|---|--------|-------------|---------|
| 1.1 | **Live-Postgres smoke test** for `PostgresSink` | Proven against PGlite (WASM); a real Postgres server (numeric/jsonb edges, concurrency, migration-provisioned schema) is untested. The code documents this. | `packages/persistence` (needs a live DB or testcontainers) |
| 1.2 | **Wire f2 / f4 MCP-tool telemetry** | f2 (tool-def-auditor) + f4 (qpd-bench) are MCP tools; can ride the gated `PRUNE_MCP_TELEMETRY` path like f10/f11. Currently show as generic/zero on the dashboard. | `apps/mcp-server` |
| 1.3 | **f5 (hud) telemetry** | Status-bar feature with no per-event signal; decide whether/how it emits, or document it as N/A. | `apps/extension` |
| 1.4 | **local-sqlite → dashboard forwarding hook** | Dashboard read-side works (POST→GET proven) but nothing forwards the developer's local `~/.prune/events.sqlite` to the hosted ingest API → prod dashboard reads zero real telemetry. | new hook + `apps/dashboard` ingest |
| 1.5 | **Flag promotion** | All f7–f13 sit in `mode: shadow`. Machinery + CLI exist; none promoted to canary/general. | `flags.mjs` (operational) |
| 1.6 | **Hook auto-install (`prune.installHooks`)** | 16 hooks wired by hand against `~/.claude/settings.json`; no automated installer. | `apps/extension` |

---

## 2. Larger roadmap (unbuilt features)

| # | Action | Scope |
|---|--------|-------|
| 2.1 | **E3 full linter** | Only CH-004 (idle-TTL) is wired as a hook. The other 11 cache-habit rules (model switch, tool-list reorder, system-prompt mutation, large paste, MCP server mutation, TTL switch, reasoning-effort, temperature, unknown paste, compound) need the host's *proposed-action diff*, which a Claude Code hook payload doesn't carry → belongs in the VS Code extension or a dedicated MCP tool. |
| 2.2 | **E5 real sandboxed-worktree executor** | Host driver ships an injectable-executor *contract* + a labeled fake; a real read-only executor against a throwaway worktree is host glue, not built. |
| 2.3 | **N6 — Pre-spawn subagent cost-predictor UX** | Predictor doesn't exist; only the blocking subagent-warden does. |
| 2.4 | **Phase 8 Tier-1 (5 features)** | (a) Tool-Result Sub-Token Pruner · (b) `max_tokens` Calibrator · (c) Diff-vs-Rewrite Enforcer · (d) Reasoning-Effort Auto-Router (would actuate CH-009) · (e) IDE Open-Tab Auditor. |

---

## 3. Cross-cutting debt

| # | Action | Notes |
|---|--------|-------|
| 3.1 | **Verify inherited citations** | `arXiv 2604.04979` (Squeez), `arXiv 2601.17548` (Git MCP RCE), `GitGuardian 3.2%` in sentinel/squeezer comments — propagated from the plan, not independently checked (unlike the Anthropic cache economics + TokenMix, verified/corrected this session). Attributions, not load-bearing math; confirm or relabel to "per vendor docs (URL)". |
| 3.2 | **F1–F6 telemetry is signal-gated** | f1/f3/f6 record only when their advisor/decision fires (correct — no spam); dashboard cards stay empty until a real session triggers a signal. No action unless richer always-on telemetry is wanted. |

---

## Recommended order

1. **1.4 + 1.2** — close the observability loop end-to-end (forwarding hook +
   f2/f4 telemetry) so the dashboard shows live data across all features.
   Small, high-synergy, low-risk.
2. **3.1** — citation verification pass (cheap, removes the last trust debt).
3. **2.4(d) Reasoning-Effort Auto-Router** (pairs with CH-009) **or 2.1 E3 full
   linter** — the next net-new value.

---

## Discipline reminders (apply to every action above)

- No regex for parsing/classification; no model calls in deterministic logic.
- Caller-supplied numbers; never fabricate a token count, cost, or latency;
  strict pricing (unknown model → null, never a default rate).
- Fail-safe: hooks/tools must never hang, throw uncaught, or block the agent.
- Deterministic + idempotent; PII-safe telemetry (hashes/counts, never prompt
  or file bodies).
- Every change ships vitest tests including adversarial edge cases.
- No fluff, no faking, no overclaiming — state limitations plainly.

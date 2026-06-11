# @prune/outcome-bench — Benchmark v2: Outcomes, Not Tokens

The claim under test: **an agent completes the same coding tasks at the same
success rate with TokenLens governance, at materially lower provider-billed
cost.** The dogfood benchmark proved accounting integrity (84.5% compression);
this benchmark proves (or refutes) *value* — outcomes graded by test oracles,
tokens provider-reported, statistics pre-registered.

## Design

- **Tasks (20):** revert-and-refix. Each task pins a real commit `C` that
  fixed/added something WITH tests; the workspace is a fresh worktree at
  `C~1` with `C`'s test files applied (tests fail); the oracle is the test
  command (exit 0 = success). No human grading, no LLM judging. 12 tasks are
  mined from this repo's history (`tasks/self/`, all `ready`); 8 external
  tasks are committed as `draft` until commits are pinned post-cutoff
  (`tasks/external/README.md` documents the procedure — no fabricated SHAs).
- **Arms:** `naive` = headless Claude Code alone. `governed` = identical
  invocation + TokenLens: read-gate (f16) and observation-mask (f15) hooks
  promoted to `general` in the workspace's project settings, plus a
  deterministic repo-map context brief gated by the L4-20 eligibility
  arithmetic. The arm setup is the ONLY difference; same model pin, caps,
  prompt. Timeout/cap exhaustion = failure in BOTH arms.
- **Trials:** K=3 per task per arm, interleaved naive/governed in time, fresh
  worktree per trial, append-only JSONL trial log (re-runs resume, never
  re-spend).
- **Metrics:** provider-reported usage only (`input`, `output`, `cache_read`,
  `cache_creation` from the session transcript). USD via strict pricing —
  unknown model ⇒ `null`, and the analysis falls back to raw token totals
  and SAYS SO. Cost per completed task via `@prune/task-ledger`.
- **Statistics (`@prune/quality`), pre-registered in `src/types.ts`
  (`PRE_REGISTRATION`) and in the committed manifests:**
  - Primary: paired per-task cost reduction — Wilcoxon signed-rank,
    one-sided, on per-task mean deltas. Powered at n≈20 pairs.
  - Secondary: success-rate non-inferiority at a **10pp screening margin**
    + McNemar on paired majority outcomes. The achieved-power arithmetic is
    printed in the report; at 60 trials/arm the NI verdict is a screening
    signal, never "proven equal".
- **Attestation:** per-task counterfactual savings (baseline = naive,
  optimized = governed, overhead = governance-injected tokens) →
  `@prune/wastebench` manifest, Ed25519-signed. The reflexive SLO fails the
  attestation if governance costs more than it saves.

## Two phases, two costs

- **Phase 1 (this package, zero model spend):** the full pipeline runs
  against deterministic fixture transcripts. `node scripts/dry-run.mjs`
  (after `npm run build`) writes a FIXTURE-bannered report + attestation to
  `out/`. Fixture numbers are pipeline tests, never evidence.
- **Phase 2 (real matrix, gated on operator go-ahead):** `ClaudeCliRunner`
  spawns headless Claude Code (`claude -p … --output-format stream-json`)
  with the operator's existing auth (Claude subscription quota or API key).
  Run the 3-task smoke subset first. Both pinned models (Sonnet, then Opus)
  must be added to `packages/shared/src/pricing.ts` with verified rates
  before USD is reported — otherwise the report shows tokens and `null`
  dollars, per the repo's honesty discipline.

## Disclosed limitations

- Cache-write tokens are billed at the input rate (no multiplier in the
  pricing table) — slightly understates spend, equally in both arms.
- Subagent usage aggregates into the parent turn (no fabricated attribution).
- Track-1 tasks come from this repo's own history; bias disclosed, Track-2
  external tasks control for it.

## Layout

- `src/` — manifest schema/loader, accounting, workspace planners (pure argv
  plans + executor), arm setup, context brief, citeback proxy, runners,
  stats, report/attestation, fixture generator.
- `tasks/self/*.json` — 12 pre-registered ready tasks (real pinned commits).
- `tasks/external/*.json` — 8 drafts + curation README.
- `scripts/mine-tasks.mjs` — proposes candidate commits for curation.
- `scripts/dry-run.mjs` — end-to-end zero-spend pipeline check.

# Phase 2 Runbook — the first live proof (smoke, then matrix)

Everything below runs from the repo root. Spend happens ONLY at steps 3–4,
under explicit budgets, with the stop-loss armed. Steps 1–2 are free.

## 0. Prerequisites (one-time)

- Claude Code CLI installed and authenticated (`claude` on PATH; a Pro/Max
  login consumes plan quota — no API key required; an API key works too).
- This repo built: `npm install && npm run build`.
- Pricing pins are already in `packages/shared/src/pricing.ts`
  (`claude-sonnet-4-6`, `claude-opus-4-8`, `claude-haiku-4-5`), rates
  verified against the official pricing docs on 2026-06-11. An unpriced
  model ABORTS a live prove by design — do not run with an unpinned model.

## 1. Pre-flight (free)

```bash
npx prune-proof status --repo .                # current proof state
node -e "require('@prune/repo-proof')"         # package resolvable
claude --version                                # CLI present (prove re-checks this)
```

## 2. Pick the smoke subset (free)

Three cheapest tasks — one debug, one navigate, one mid-size — from the
committed, three-state-verified suite:

- `ob-locate-null-pricing`      (maxBudget $1, 25 turns)
- `ob-tokenizer-cache-key-collision` ($2, 40 turns)
- `ob-cost-security-detector-review` ($3, 60 turns)

Worst-case bound: (1+2+3) × 1 trial × 2 arms = **$12**; observed spend will
be far lower. Per-session wall clock is derived from each task's maxTurns
(`defaultSessionTimeoutMs`: max(20 min, maxTurns × 60 s)) and is identical
across arms by construction.

## 3. Smoke run (spends, ≤ $12 hard bound)

```bash
npx prune-proof prove --repo . \
  --tasks-dir packages/outcome-bench/tasks/self \
  --task ob-locate-null-pricing \
  --task ob-tokenizer-cache-key-collision \
  --task ob-cost-security-detector-review \
  --trials 1 --budget 12 \
  --model claude-sonnet-4-6 \
  --hooks-dir apps/extension/hooks
```

Expected outcomes and what each means:
- **exit 0** — matrix complete; analysis/attestation/report written under
  `.prune/proof/`. Inspect `report.md`; n=3 is a plumbing check, not
  evidence.
- **exit 2** — honest refusal/abort (budget pre-flight or stop-loss; the
  message says which). Resume by re-running the same command — completed
  trials are never re-bought.
- **exit 1** — infrastructure error (auth, CLI flags, worktree). Fix and
  re-run; nothing was spent beyond the failed trial, and the trial log
  shows exactly what completed.

First-contact checklist while it runs: transcripts non-empty under the
work dir; usage fields parsed (`status --json` → trials.total grows);
governed-arm briefs appear under `.prune/proof/briefs/`.

## 4. Full matrix (spends, ≤ $228 hard bound; observed will be ~$30–80)

Only after a clean smoke:

```bash
npx prune-proof prove --repo . \
  --tasks-dir packages/outcome-bench/tasks/self \
  --trials 3 --budget 100 \
  --model claude-sonnet-4-6 \
  --hooks-dir apps/extension/hooks
```

(Worst case Σ maxBudgetUsd × 3 × 2 = $228 exceeds a $100 budget, so the
pre-flight will refuse — that is correct behavior. Either raise the budget
to 228 for the true hard bound, or run the matrix in two halves. The
stop-loss makes the practical exposure the OBSERVED spend, not the bound.)

Then:

```bash
npx prune-proof promote --repo . --hooks-dir apps/extension/hooks
npx prune-proof status --repo .
```

Promotion only happens if all five gates pass on the real data; the
decision (either way) lands in `.prune/proof/promotion.json`.

## 5. Honesty notes for whoever reads the result

- n=12 tasks powers the Wilcoxon cost endpoint; the success-rate NI verdict
  at this n is a SCREENING signal (the report prints achieved power).
- All Track-1 tasks come from this repo's own history (bias disclosed in
  the report); the external track exists to control for it.
- The brief-injection overhead is counted with the local tokenizer +10%
  (labeled estimate, direction-safe); Phase-2 data will let us calibrate it
  against provider-reported deltas.

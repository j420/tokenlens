# List3 — External-Evidence Feature Proposals (M4 + M7 + M6, grounded in 2026 vibe-coding research)

> Produced by **actually executing** generators **M4, M7, M6** from `docs/RESEARCH-META-PROMPTS.md`,
> each seeded with the 2026 external waste-evidence in **Part F.3** (verified via live web search,
> June 2026). Generators ran as independent subagents; **M9** (red-team) was applied to every candidate
> by the orchestrator; prior-art dedup was checked against the **shipped hooks on disk**
> (`apps/extension/hooks/*`, `packages/cost-security`). Dated **June 2026**.

## Run provenance

- **Scope decision (user-confirmed):** run the *proven* generators on the new evidence — **not** all 16
  prompts. Rounds 1–2 (M1–M8, X1–X7) are frozen in `RESEARCH-FEATURE-PROPOSALS.md` + `-L2.md`; re-running
  the saturated/low-yield generators would rehash them. M4 (detector engine), M7 (provider-mechanic), M6
  (frontier) are the three the evidence actually feeds.
- **Ensemble honesty:** single-model, K≈2–3 independent samples per generator (within-model
  self-consistency). A true **cross-model ensemble** (other frontier models as independent samples) — the
  biggest untapped lever for recurrence-confidence — is **a documented follow-up, not run here** (this
  environment cannot invoke other vendors' models).
- **The headline discipline:** M4's determinism screen + honest dedup. Most external findings turned out
  to **corroborate features TokenLens already ships** (re-prioritization, not new code); the genuinely new
  surface is small and is reported as such.

---

> **Build status (June 2026).** The three deterministic, autonomous-hook items from the recommended
> sequencing are SHIPPED, runtime-neutral (Claude Code / Cursor / Codex — tool vocabulary is configurable),
> fail-open, and verified end-to-end (firing on real waste-pattern transcripts + a negative control):
> - **`navigation-to-edit-ratio`** → `assessNavigationRatio` (`@prune/cost-security`) + `navigation-ratio.mjs`
>   (PostToolUse). 13 unit tests; revisited-path gate keeps a first-pass distinct-file survey from firing.
> - **`tool-error-rate-breaker`** → `assessToolErrorRate` (`@prune/cost-security`) + `tool-error-rate.mjs`
>   (PostToolUse). 9 unit tests; reads ONLY the host-tagged `is_error` boolean; `insufficient_signal` no-op
>   when the field is absent (never text-matches).
> - **`degeneration-loop` fold** → `evaluateIdenticalActionLoop` (`@prune/intelligence`) wired as a second
>   trip in `loop-breaker.mjs`. 21 unit tests; result-SHA gate makes same-args-different-result (real
>   progress) never block.
>
> All three are env-configurable (`PRUNE_NAV_RATIO_*`, `PRUNE_TOOL_ERROR_*`, `PRUNE_IDENTICAL_ACTION_*`),
> registered in the installer (30 bindings), and carry the cost-security non-negotiables (no regex, no model,
> no fabricated numbers, PII-safe SHAs only). Still HELD pending verification: `stateful-transport-advisor`
> (M7-1, unverified mechanic) and `CH-013` (cache-habits transport-tier extension) — see sequencing #3.

## Summary

- **2 NEW autonomous hook-detectors** survive M9 with confirmed host signals: `navigation-to-edit-ratio`,
  `tool-error-rate-breaker`.
- **1 NEW provider-mechanic advisory pair** survives, **unverified-gated** (no claimed saving):
  `stateful-transport-advisor` (M7-1) + `transport-regression-sentinel / CH-013` (M7-2).
- **1 REVISE→FOLD:** `degeneration-loop-detector` — fold into `loop-breaker`, do not ship standalone.
- **1 SHARPENS-LIST1:** `retrieval-depth-frontier` quantifies List1 #6 `context-budget-frontier` (not a
  new feature — a cited protocol upgrade).
- **3 CORROBORATES-EXISTING** (no new feature): reads-dominance, communication-tax, repeated-reads.
- **REJECTS:** 1 quality-knee cutoff (non-deterministic) + **7 LLM-judge-only failure modes** (determinism
  screen) + 1 auto-migration actuator (builds on an unverified mechanic).

**The honest takeaway:** 2026 vibe-coding research **validates TokenLens's existing detector suite far more
than it expands it.** Its real contribution is (a) two new deterministic signals (the *navigation:edit
ratio* and *host-tagged tool-error-rate*), (b) non-fabricated thresholds to re-prioritize shipped hooks,
and (c) a quantified target for the context-size frontier.

---

## Corroboration table (external finding → shipped feature)

The dominant result. Each row is evidence that an already-built hook targets a *measured, named* waste
pattern — a re-prioritization signal, **not** a new feature.

| External finding (Part F.3) | Already shipped | Action |
|---|---|---|
| Reads = **76.1%** of agent tokens (SWE-Pruner) | `speculative-record` (F3 SHA read-cache) · `cost-guard` (oversized-result guard) · List1 `tool-output-bounding-at-source` | Raise read-bounding flag-tier **shadow→active**; reads are the #1 lever |
| **Communication tax**, input 53.9% (Tokenomics) | List1 `intra-request-content-dedup` (byte-SHA collapse) · `cache-stabilize` / `cache-habits-advisor` | Re-prioritize dedup + prefix-stability; highest expected payoff |
| **60–80%** waste, "re-reads same 400-line file 3rd time" (practitioner) | `speculative-record` (serves repeat reads) · `context-health` (f6, re-transmission pressure) | Confirms F3's impact; no new mechanism |
| Failed trajectories **12–82%** longer (Code Agent Behaviour) | `loop-breaker` (low-ROI streak) | Complemented by the NEW `navigation-to-edit-ratio` below |
| Excess tokens ≠ accuracy, **30×** variance | `budget-gate` · `slo-breaker` (caller-budget caps) | Honest budget caps already cover this; the *quality-knee* variant is rejected |

---

## NEW — autonomous hook-detectors (M9: SURVIVES)

### 1. `navigation-to-edit-ratio` — *M4 / E2 · M9: SURVIVES · NEW*

Detect post-localization over-exploration: many Read/Grep/Glob/LS calls with **zero** Write/Edit over a
turn window, on **re-visited** files. Grounded in arXiv 2511.00197 (navigation dominates patch-writing;
localization usually fine ≥72%).

- **cost_lever:** fresh_input + cache_read_input + output (each navigation turn re-transmits context).
- **decision_procedure (deterministic):** over the last `W` turns from `loadCachedSessionView`, classify
  each `toolCalls[].tool_name` into NAV={Read,Grep,Glob,LS} | MUT={Write,Edit,MultiEdit}; from
  `fileTimeline`, count paths re-visited (same path in ≥2 of `W`). Fire advisory iff
  `mut_count===0 ∧ nav_count≥navFloor ∧ revisited≥1`. Set-membership + path equality only — no regex,
  no model.
- **novelty_vs_prior_art:** vs `loop-breaker` (keys on ROI *magnitude* — a normal-cost turn that is pure
  navigation with zero commit never trips it; this keys on *tool-call composition*). vs `thrash-detector`
  (needs an edit A→B→A oscillation; this fires when there are **no edits at all**). Clean delta.
- **equivalence_gate:** n/a (advisory, transforms nothing).
- **cost_model:** `net_saved = avoided_nav_turns × mean_turn_input_tokens`; caller-supplied counts; USD
  null on unknown model; advisory has zero context cost → no waterbed.
- **credibility:** arXiv 2511.00197 (Nov 2025).
- **M9 verdict:** SURVIVES. **Residual risk:** a legitimate wide read-only survey ("explain this module")
  resembles wasteful exploration — mitigated by the *revisited-path* gate + advisory-only (never blocks).
  Threshold tuning is the real work. **effort_risk:** M.

### 2. `tool-error-rate-breaker` — *M4 / E6 · M9: SURVIVES · NEW*

Detect a degeneration signal that `loop-breaker` misses: a sustained high **tool-error rate** over a turn
window (malformed args / file-not-found / non-zero exit, retried). The *mechanical* facet of "incorrect
tool invocation" — distinct from the *semantic* facet, which is rejected.

- **Signal CONFIRMED on disk:** `turns[].toolResults[].is_error` exists in the normalized transcript
  (`packages/telemetry/src/turn-mapper.ts:25`, `schema.ts:40`). This is a host-tagged boolean — **not**
  inferred from free text.
- **decision_procedure (deterministic):** over last `W` turns, `error_calls/total_calls` from the
  `is_error===true` flag; fire advisory iff `ratio≥thr ∧ total≥floor`. **No regex on error content**
  (that would be the prohibited semantic classification). Fail-open: if `is_error` is absent → emitNoop
  (never sniff prose).
- **novelty_vs_prior_art:** vs `loop-breaker` (token-ROI magnitude) — a session can have non-low ROI yet a
  rising error-rate (args repeatedly malformed) loop-breaker won't catch. Detection is on the
  error-vs-success *outcome*, not *why*.
- **equivalence_gate:** n/a (advisory).
- **credibility:** 2026 SWE-agent failure-taxonomy (degeneration-loop / tool-invocation modes).
- **M9 verdict:** SURVIVES. **Residual risk:** `is_error` is an *optional* field — on hosts/turns that
  don't populate it the detector degrades to a permanent honest no-op (it must NOT fall back to
  text-matching). **effort_risk:** M.

---

## REVISE→FOLD

### 3. `degeneration-loop-detector` — *M4 / E6 · M9: REVISE → fold into `loop-breaker`*

Flag a repeated `(tool_name, canonical tool_input)` recurring ≥R times with an **identical result-SHA**
each time (true no-progress), broader than thrash's edit-oscillation. **Why not standalone:** the novel
sliver — "an identical-action loop even when ROI isn't classified low and the tool isn't a cacheable read"
— is thin; `speculative-record` already serves the repeated result and `loop-breaker` already blocks
sustained no-progress. **Required revision:** add the identical-action-loop (SHA-gated) condition as an
extra trip in `loop-breaker` rather than a new hook. Build only if the sliver is confirmed real in
telemetry. **effort_risk:** M (mostly de-risking the overlap).

---

## SHARPENS-LIST1

### 4. `retrieval-depth-frontier` — *M6 · M9: SURVIVES as a sharpening (NOT a new feature)*

Quantifies List1 #6 `context-budget-frontier`. Sweeps the **context-size / retrieval-depth** axis (untouched
by f4=model, P8d=reasoning) for the smallest depth `d*` statistically **non-inferior** to full depth.

- **What it ADDS over List1 #6:** (a) a *cited prevalence number* — reads = 76.1% of tokens; 23–54%
  illustrative headroom (SWE-Pruner, arXiv 2601.16746), converting "there is headroom" into a bounded,
  falsifiable target; (b) a concrete protocol reusing the repo's **`recommendForCluster`**
  (`packages/qpd-bench/src/recommender.ts`) + frozen **`evaluateQualityGate`** (`packages/quality`, AR 1pp
  / TPR 0.5pp / Wilcoxon PWED) with each depth as a `ModelAggregate` arm; (c) the coarse-screen→fine-monitor
  margin handoff with HOLD-full on no clearing depth.
- **decision_procedure (deterministic):** the *sweep + NI test* is the decision core (the upstream chunk
  ranker — repo-map / f1 / even SWE-Pruner's scores — is outside it; **the cut depth is chosen by
  statistics, not a model**).
- **equivalence_gate:** acceptance via `@prune/equivalence` (similarity ≥ 0.85) — a depth whose output is
  non-equivalent fails AR by construction.
- **cost_model:** `saved = C_read(d_full) − C_read(d*)`, NET; unknown model ⇒ `null`/`insufficient_data`;
  the 23–54% figure stays **illustrative/cited**, never emitted as our measured result.
- **M9 verdict:** SURVIVES as a sharpening. Not double-counted as a new feature. **effort_risk:** L (needs
  labelled paired depth×prompt data — same dependency List1 #6 flagged).

---

## NEW — provider-mechanic (M7), unverified-gated

> Both ship as **advisories only** and assert **no number derived from the unverified mechanic**. They
> report caller-observed token volume (fact) + verified-Part-F stateless/cache rates; any stateful-side
> saving stays `null`/contingent until a **primary** OpenAI Realtime/Responses billing doc confirms it.

### 5. `stateful-transport-advisor` — *M7-1 · M9: SURVIVES (advisory) · verification: unverified-needs-primary-source*

Over a long multi-turn session on a **stateless HTTP** transport, the growing stable prefix is re-sent and
re-billed every turn. When `turnCount ≥ minTurns ∧ stablePrefixTokens ≥ minPrefix ∧ reCommunicatedTokens > 0`,
advise migrating to the stateful/WebSocket transport so history stops being re-transmitted.

- **novelty:** different lever from `cache-planner.ts` (reduces the *price* of re-sent bytes; bytes still
  cross the wire) and N2 `delta-resend` (salvages a stable leading run within a re-send). M7-1 questions
  whether the re-send should happen at all — a *transport-tier* choice no CH rule reasons about.
- **cost_model:** reports observed `reCommunicatedTokens` (fact); `netSavingUsd` emitted **only** if the
  caller also supplies the stateful per-turn rate, else `null` + `contingent:true`. (M9 FABRICATION check:
  passes — no NM1-derived number.)
- **M9 verdict:** SURVIVES (advisory). **Residual risk:** the entire premise is unverified → if NM1 proves
  illusory, M7-1 degrades to a no-op advisory (the existing cache-planner/N2/N5 remain the mitigations).
  **effort_risk:** S.

### 6. `transport-regression-sentinel` / **CH-013** — *M7-2 · M9: SURVIVES · fails-safe*

Catch a **stateful→stateless silent fallback** (connection drop / SDK reconnect in HTTP) that resumes
re-billing the whole history — the transport-tier analogue of the verified 1h→5m TTL regression hazard.

- **novelty:** none of CH-001..012 reason about *transport* drift (they lint prefix/parameter drift on a
  fixed stateless transport). Complementary to M7-1 (opposite trigger direction).
- **Why it's the cleaner M7 item:** its emitted cost figure prices only the **verified stateless fallback**
  (verified-Part-F input rate × caller-supplied re-billed tokens), so the warning is **sound even if NM1
  never verifies** — it fails *safe*.
- **M9 verdict:** SURVIVES. **effort_risk:** S (slots into the existing CH-rule harness).

---

## M9 reject log (auditable cut)

| candidate | source | verdict | killing objection |
|-----------|--------|---------|-------------------|
| `intermediate-cost-knee-cutoff` | M4 / E3 | **REJECT (non-determinism)** | Locating the accuracy "knee" needs output grading (LLM-judge). The *budget*-based variant already ships as `budget-gate` / `slo-breaker` (caps on a caller-supplied budget, not inferred quality). |
| `task-drift` | M4 / E6 | **REJECT (determinism screen)** | "Still on-task?" = compare output meaning to prompt → model judgement. |
| `reward-hacking` | M4 / E6 | **REJECT (determinism screen)** | Detecting a gamed objective needs intent-vs-shortcut understanding. |
| `alignment-faking` | M4 / E6 | **REJECT (determinism screen)** | Requires inferring hidden intent; no host signal. |
| `positional-bias` | M4 / E6 | **REJECT (determinism screen)** | A property of model attention; invisible to tool-name/usage signals. |
| `mode-collapse` | M4 / E6 | **REJECT (determinism screen)** | Needs judging output diversity/semantics. |
| `version-drift` | M4 / E6 | **REJECT (determinism screen)** | Stale-API detection needs semantic comparison (a version regex = prohibited semantic-classification-by-regex). |
| `semantic wrong-tool` | M4 / E6 | **REJECT (determinism screen)** | Goal-appropriateness of a tool is a judgement (the *mechanical* error facet survives as `tool-error-rate-breaker`). |
| `auto-migration actuator` | M7 | **REJECT (unverified premise)** | Would perform an equivalence-gated transform whose saving rests on the `unverified` NM1 mechanic — violates "no saving on an unverified mechanic." |

---

## Cross-model follow-up (recorded, not run)

This run is single-model self-consistency. The **highest-leverage next step** for raising confidence in
these survivors is a **cross-model ensemble**: run the same M4/M7/M6 prompts (Part F.3 grounding) on other
frontier models as independent samples, and count cross-model recurrence — genuinely independent
corroboration, not within-model agreement. Requires wiring non-Anthropic model access into the run harness.

---

## Recommended sequencing

1. **Cheapest, highest-confidence:** ship `navigation-to-edit-ratio` and `tool-error-rate-breaker` — both
   deterministic, both with **confirmed host signals** (`toolCalls[].tool_name`, `toolResults[].is_error`),
   both advisory/fail-open. Fold `degeneration-loop-detector` into `loop-breaker` at the same time.
2. **Zero-code re-prioritization:** act on the corroboration table — raise the read-bounding /
   intra-request-dedup flag-tiers from shadow→active; reads are empirically the 76.1% lever.
3. **Provider-mechanic:** ship `CH-013` (fails-safe today) now; hold `stateful-transport-advisor` behind a
   flag until a primary OpenAI billing doc verifies the stateful-transport mechanic.
4. **Heavier:** `retrieval-depth-frontier` when labelled paired depth×prompt data exists (List1 #6's
   standing dependency).

---

*Sources (Part F.3):* [SWE-Pruner 2601.16746](https://arxiv.org/abs/2601.16746) ·
[Code Agent Behaviour 2511.00197](https://arxiv.org/abs/2511.00197) ·
[How Do AI Agents Spend Your Money? 2604.22750](https://arxiv.org/abs/2604.22750) ·
[Tokenomics 2601.14470](https://arxiv.org/abs/2601.14470) ·
[Don't Vibe, They Control 2512.14012](https://arxiv.org/abs/2512.14012) ·
[Vantage](https://www.vantage.sh/blog/agentic-coding-costs) · [Sourcegraph](https://sourcegraph.com/blog/agentic-coding).
Re-verify all rates and the unverified stateful-transport mechanic before building.

# RESEARCH-LIST5 — Token/Cost-Saving Feature Catalog (v3 instrument run)

> The COMBINED catalog produced by executing the v3 meta-prompt library
> (`docs/RESEARCH-META-PROMPTS-V3.md`) generators **M14–M20** as a real discovery
> run on 2026-06-12. Seven independent persona-generators fired in one Round-1
> (P1 nominal-groups: no cross-talk), each reading its verbatim instrument + the
> shared slot definitions, greping `packages/`+`apps/` for on-disk duplicates, and
> emitting proposals in the canonical Part-D schema. The orchestrator then ran the
> **M9v3 gate** (feasibility → debate → tokenizer-drift → hidden-billing), deduped
> across generators, recurrence-ranked (P5), and re-greped every survivor.
>
> **Yield: 31 proposals + 1 labelled needs-host-signal**, spanning 4 new buildable
> packages (`@prune/replay-regret`, `@prune/context-rent`, `@prune/subagent-toll`,
> `@prune/advisor-rebate`), an `outcome-bench` frontier/ablation extension, and a set
> of cost-security detectors + provider-mechanics guards/planners. One survivor
> (**L5-01**) also fixes a **live, fetch-verified correctness bug** in shipped code.
>
> Honesty bar unchanged (CLAUDE.md / v2 Part C / v3 M9v3): deterministic decision
> cores (no model call, no regex classification), null on unknown model, fail-safe,
> equivalence-gated transforms, PII-safe, vitest+adversarial. Every quantitative
> claim is caller-supplied, `[P]` verified-primary, `[S]` verified-secondary, or
> cited literature — never a fabricated number.

---

## Part 1 — M9v3 Gate Ledger

**Cross-generator dedup (P5 recurrence is a RANKING signal only — same-model recurrence
orders within a credibility band, never proves value; the hivemind caveat, v3 Part 0):**

| Theme | Generators that independently hit it | Recurrence | Resolution |
|-------|--------------------------------------|:---------:|------------|
| OpenAI free-24h-retention + Flex/Batch tier selection | M18-2, M18-3, M20-6 | **3 (top)** | **MERGE** M18-2 → **L5-26** (superset planner); keep **L5-12** (deadline-scheduling competitive-ratio math) as its risk-model component. Strongest cross-generator signal — but all `[S]`, so gated on primary verification. |
| MCP-server schema standing cost → mcp-proxy lazy-load | M17-3, M19-2 | 2 | Both SURVIVE, complementary: **L5-19** *measures* which servers to defer (outcome ablation); **L5-23** *prices* the allocation (slot auction). Cross-referenced. |
| 4-breakpoint / 20-position lookback cache miss | M18-4, M20-3 | 2 | Both SURVIVE, complementary: **L5-11** is the cross-turn paging *policy*; **L5-03** is the witnessed-miss *detector*. |
| Prune's own advisor reflexive overhead | M17-2, M19-4 | 2 | Both SURVIVE, complementary: **L5-18** offline *ablation verdict* (demote); **L5-24** online *emission gate* (suppress/coalesce). |
| Cache-expiry rent (5m/1h TTL) | M14-4, M18-1 | 2 | Both SURVIVE, complementary: **L5-07** retrospective *regret accountant*; **L5-09** forward *ski-rental policy*. |
| Output-token economy (CoD/TALE lever) | M14-2, M16-4 | 2 | Both SURVIVE, complementary: **L5-05** retrospective output-regret; **L5-16** forward output-budget injector. |

**Debate-gate (M9v3 §D) — strongest surviving adversary objection per cluster, and the ruling:**

- *Regret accountants (L5-04..08):* adversary — "hindsight regret isn't actionable spend." Ruling **SURVIVES**: each is gated to a *provable* outcome-invariance (content-SHA, AST round-trip, oracle NI, suffix-reachability closure), and feeds per-repo flag promotion (the f20 pattern), not a vanity metric.
- *Ablation harnesses (L5-15, L5-17):* adversary — "a category demoted on tested families may matter on untested ones." Ruling **SURVIVES** with mandatory `untested for X` labelling + `keep`/`defer`-on-uncertainty (never `delete`).
- *`[S]`-derived provider planners (L5-12, L5-25, L5-26):* adversary — "you're pricing off unverified rates." Ruling **SURVIVES as advisory-contingent**: dollar claims stay `contingent` and the feature's FIRST milestone is primary verification (the >272K premium and Flex/24h-only eligibility are Part W′ rows).
- *Mechanism-design markets (L5-22..24):* adversary — "an auction is a model-y decision." Ruling **SURVIVES**: bids and clearing are arithmetic on caller-supplied counts; null λ ⇒ fail-open no-op (the f18 contract).
- *Subagent report toll (L5-21):* adversary — "the citation signal doesn't exist in hook payloads." Ruling **SURVIVES as needs-host-signal**: degrades to admit-full (no-op) when `orchestrator-action provenance` is absent.

**Tokenizer-drift attack (M9v3 §E):** every cross-model $/task comparison (L5-06 tier-regret,
L5-14 per-task-budget) re-tokenizes per generation; L5-20 *operationalizes the gate itself* as a
shippable barrier. No survivor reuses one tokenizer across the Opus-4.7 boundary. ✓

**Hidden-billing attack (M9v3 §F):** every cost_model names the usage fields it sums; L5-02
*is* the fix for the compaction `usage.iterations` blind spot. No survivor reads top-level usage
only where a hidden term applies. ✓

**Final re-grep (M9v3 §1):** 4 new package names free; `outcome-bench` has no frontier/ablation;
the L5-01 bug confirmed at `packages/cache-habits/src/cache-econ.ts:130`. No survivor collides
with a Part B/B′ forbidden-theme.

---

## Part 2 — Ranked Survivors (EV = net_saving × frequency × confidence ÷ effort; risk vetoes)

Confidence band by the v3 credibility ladder: **A** = verified provider mechanic `[P]` ·
**B** = replicated literature · **C** = single-paper / mechanism-design theory. `[S]` provider
rows sit in their own gated lane.

| # | id | gen | lever | band | effort | note |
|---|----|-----|-------|:----:|:------:|------|
| **L5-01** | per-model-cache-minimum-guard | M20 | cache_read/write | A `[P]` | **S** | **fixes a live bug** (cache-econ.ts:130) |
| **L5-02** | compaction-iterations-accountant | M20 | output/accounting | A `[P]` | M | enabler; closes a hidden-billing blind spot |
| **L5-09** | ski-rental-ttl-controller | M18 | cache_write | A `[P]` | S | 1.625-competitive; replaces a clairvoyant estimator |
| **L5-10** | no-final-termination-detector | M15 | request_count | A `[P]` | S | consumes `stop_reason` (parsed, unread today) |
| **L5-13** | max-tokens-truncation-retry-detector | M15 | request_count | A `[P]` | S | `stop_reason:"max_tokens"` recurrence |
| **L5-03** | breakpoint-lookback-guard | M20 | cache_read | A `[P]` | M | witnessed-miss; Anthropic-gated |
| **L5-20** | tokenizer-drift-comparison-barrier | M20 | tier accounting | A `[P]` | M | operationalizes M9v3 §E as a guardrail |
| **L5-04** | regret-redundant-reread | M14 | fresh_input | A/B `[P]` | S | byte-SHA × epoch; zero-replay |
| **L5-07** | regret-expired-prefix-rebuild | M14 | cache_write | A `[P]` | S | waterbed-gated expiry regret |
| **L5-11** | breakpoint-eviction-paging | M18 | cache_read | A `[P]` | M | 4-slot paging, k-competitive |
| **L5-12** | flex-vs-batch-deadline-scheduler | M18 | tier selection | A/`[S]` | M | 3-lane; arXiv 2601.22996 |
| **L5-25** | thinking-clear-rent-or-buy | M18 | cache_read | A `[P]` | S | forecast-dependent (labelled) |
| **L5-08** | token-spiral-growth-detector | M15 | ctx pressure | B `[P]` | S | 2nd-diff on token mass (≠ spawn count) |
| **L5-14** | category-sink-detector | M15 | fresh_input | B | S | cumulative per-tool mass |
| **L5-16** | output-budget-instruction-injector | M16 | output | B | S | CoD/TALE; guard-not-truncate |
| **L5-05** | regret-overshoot-output | M14 | output | B | M | diff-enforcer round-trip as certificate |
| **L5-06** | regret-tier-overshoot | M14 | tier rate | B | M | outcome-bench dry-run NI gate |
| **L5-15** | category-ablation-harness | M17 | fresh_input | B | M | the substrate L5-17/19 build on |
| **L5-17** | advisor-reflexive-ablation | M17 | reflexive | B | S/M | Prune audits its own advisors |
| **L5-19** | schema-attribution-lazyload | M17 | fresh_input | B | M | outcome-measured server deferral |
| **L5-21** | frontier-sweep-harness | M16 | measurement | B | M | fits the distortion-rate curve |
| **L5-22** | query-conditioned-slice-budget | M16 | fresh_input | B | M | query-aware cut order (f17 delta) |
| **L5-14b** | per-task-budget-selector | M16 | fresh_input | B | M | consumes the frontier knee |
| **L5-26** | free-retention-and-flex-planner | M20 | tier/retention | `[S]` | M | absorbs M18-2; primary-verify gated |
| **L5-23** | schema-slot-auction | M19 | fresh_input/write | C | M | VCG over the tools-block budget |
| **L5-22m** | context-rent-clearing-house | M19 | cache_read | C | M | carry-horizon × λ (f18 delta) |
| **L5-24** | advisor-injection-rebate | M19 | reflexive | C | S | emission gate; coalesces duplicates |
| **L5-21t** | subagent-report-toll | M19 | fresh_input | C | M | the 15× lever; needs host signal |
| **L5-18** | regret-speculative-burn | M14 | fresh/output | B (novel) | M | targets the Part W′ open gap |
| **L5-27** | openai-272k-repricing-cap-planner | M20 | input/output | `[S]` | M | OpenAI cliff; primary-verify gated |
| **L5-28** | regret-tier (dry-run only) → folded | — | — | — | — | see L5-06 |
| **HS-1** | orphaned-context-detector | M15 | fresh_input | — | L | **needs host signal**: per-block last-reference position |

> IDs with letter suffixes (L5-14b, L5-21t, L5-22m) are distinct survivors that shared a
> base number during gating; they are full entries below. The table is the index; Part 3 is
> authoritative.

---

## Part 3 — Full Catalog (canonical Part-D schema, by generator)

> Each entry carries every schema field. Constraint checklists are abbreviated to the
> seven boxes (all ✓ unless noted); full per-box justifications are in the generator
> transcripts. `[P]`/`[S]` tag the rate-sheet confidence of the mechanic each derives from.

### M14 — Hindsight-Optimal Regret Decomposition → `@prune/replay-regret` + MCP `regret_decompose` (read-only)

All five compose the EXISTING substrate (replay-vault canonicalization, replay-cost cost-model,
outcome-bench dry-run, task-ledger outcome enum, diff-enforcer round-trip, `@prune/equivalence`,
`@prune/shared` strict pricing) at **zero new API spend** (the Vidur property), each with a
suffix-invariance / reachable-closure proof (the CausalFlow property).

**L5-04 · regret-redundant-reread** — *lever:* fresh_input (REDUNDANT class). *tier:* 1.
*mechanism:* on a completed session, a step re-injecting a payload whose content-SHA already
sits in the live prefix at the same compaction-epoch added zero information but paid full
fresh-input; regret = Σ(tokensIn × input_rate) over such steps. Audits what read-gate (f16)
prevents online, producing the per-repo redundancy ledger that gates f16 promotion.
*feasibility:* replay-vault RFC-8785 SHAs + host compaction-epoch + caller tokensIn all exist;
ships as `decomposeRedundantRegret(timeline, epochMap)`; falsifier — dup-within-epoch flagged at
exact cost, one-byte mutation ⇒ 0, dup-across-epoch ⇒ 0. *evidence_anchor:* AgentDiet (2509.23586)
+ CausalFlow suffix-invariance (2605.25338). *novelty:* vs read-gate f16 (forward deny, no
quantification/aggregation) & marginal-value F8 (model-in-loop per-chunk) — this is a zero-replay
SHA-identity *regret measurement*. *decision:* epoch→SHA-set map, O(n) fold. *equivalence:* byte.
*cost_model:* Σ redundant tokensIn × input_rate; null on unpriced; no waterbed (bytes already
resident). *measurement:* dup/mutation/epoch/unpriced + 10⁶-step no-OOM. *constraints:* all ✓.
*credibility:* 2509.23586, 2601.16746, 2605.25338. *effort_risk:* S — degrade to single-epoch
(conservative) if host omits epoch.

**L5-05 · regret-overshoot-output** — *lever:* output (5× input) + reasoning_tokens (USELESS).
*tier:* 1. *mechanism:* for an accepted turn, hindsight-optimal output = shortest generation
AST-equivalent to the landed bytes; regret = (actual − diff_tokens) × output_rate where the diff
is certified by diff-enforcer's sound round-trip. Prices, on the trace, output a diff would have
saved on turns that actually landed — the evidence that promotes diff-vs-rewrite per-repo.
*feasibility:* replay-cost tokensOut + accepted post-image + diff-enforcer round-trip all exist;
`decomposeOutputRegret(turn, acceptedPostImageTokens, model)`; falsifier — rewrite→diff priced
exactly, non-round-tripping diff ⇒ 0. *evidence_anchor:* CoD (2502.18600), TALE (2412.18547),
NoWait (2506.08343). *novelty:* vs diff-enforcer P8c (forward) & response-tuner P8b (reservation)
— retrospective output-regret accountant using P8c's proof as the certificate. *decision:* diff
round-trip + arithmetic. *equivalence:* ast. *cost_model:* Σ max(0,(out_actual−out_hindsight)×
output_rate); null on unpriced; NET (diff's extra input netted by P8c). *measurement:* no-op edit ⇒
0, giant file bounded. *constraints:* all ✓. *effort_risk:* M — M9v3 §E: hindsight tokens
re-tokenized with the SAME model's tokenizer; refuse cross-tokenizer compares.

**L5-06 · regret-tier-overshoot** — *lever:* model-tier rate multiplier (USELESS). *tier:* 1.
*mechanism:* a turn on Opus whose accepted output a cheaper tier would have produced equivalently
overpaid (rate_high−rate_low)×tokens; regret gated on outcome-bench's paired dry-run (zero-spend
replay of logged inputs on the cheaper tier, oracle-graded) passing a pre-registered NI margin.
*feasibility:* replay-cost tokens+model, outcome-bench dry-run + `@prune/quality` NI, strict
pricing — all exist; `decomposeTierRegret(taskSet, currentTier, candidateTier)`; falsifier —
NI-pass ⇒ Σ tokens×Δrate, NI-fail ⇒ 0. *evidence_anchor:* RouteLLM (2406.18665) + Vidur
(2405.05465) zero-spend simulation. *novelty:* vs qpd-bench f4/router (forward) — backward
regret on accepted tasks, gated on the oracle over ACTUAL logged inputs. *decision:* NI test +
arithmetic. *equivalence:* coverage (oracle NI). *cost_model:* re-tokenized per candidate tier
(§E); null if either tier unpriced; reported `bounded_estimate` until a budgeted real run confirms
(f20 gate). *constraints:* all ✓. *effort_risk:* M — dry-run fidelity; never realized savings
from dry-run alone.

**L5-07 · regret-expired-prefix-rebuild** — *lever:* cache_write multiplier + forfeited 0.1×
read (EXPIRED). *tier:* 1. *mechanism:* an idle gap exceeding the prefix TTL rebuilds at the
write multiplier instead of re-serving at 0.1×; regret = (write−read)×prefix_tokens per
provably over-TTL rebuild, **waterbed-gated** to reject rebuilds whose keep-alive would have cost
more. *feasibility:* replay-vault timestamps + per-model TTL/min-prefix (Part A′ §1) + caller
tokensIn; `decomposeExpiryRegret(timeline, ttlPolicy)`; falsifier — 12-min gap on 5-min TTL priced
exactly; gap where keep-alive costs more ⇒ 0. *evidence_anchor:* Part A′ §1 cache economics `[P]`
+ ski-rental. *novelty:* vs prefix-warm/churn-pin/ttl-regression (forward) — retrospective expiry
accountant with the keep-alive-overhead subtraction. *decision:* timestamp+price arithmetic with
refresh-on-hit keep-alive model. *equivalence:* n/a (byte-identical prefix). *cost_model:* NET of
keep-alive overhead; null on unpriced/missing multiplier; per-model min-prefix never assumed flat.
*constraints:* all ✓. *effort_risk:* S — TTL tier from caller `cache_control`; assume 5-min
(under-counts) + label `ttl_assumed` if absent.

**L5-18 · regret-speculative-burn** — *lever:* fresh_input+output on speculative work that never
landed (**SPECULATIVE class — Part W′ open gap, no published ablation; novel**). *tier:* 1.
*mechanism:* a branch (bet tool path / spawned subagent / parallel edit) whose entire output-SHA
set is disjoint from the accepted final's reachable closure billed pure regret. f13 tracks only
host-CPU misses ("never tokens"); real agents speculate with billed tokens (e.g. an exploratory
subagent report the orchestrator reads then discards). *feasibility:* replay-vault canonicalizes
subagent reports + tool exchanges with SHAs and parent/child structure; task-ledger outcome enum;
accepted-suffix reachable-SHA set computable; `decomposeSpeculativeRegret(timeline,
acceptedSuffixShaSet)`; falsifier — disjoint-SHA report priced; report reaching the accepted edit
⇒ 0. *evidence_anchor:* Part W′ named gap + Anthropic 15× multiplier (verified) + CausalFlow
(2605.25338). *novelty:* vs speculative-pipeline f13 (CPU-only ledger, explicitly never tokens) &
subagent-warden (forward fan-out cap) — first detector for f13's acknowledged unmeasured token
class. *decision:* transitive content-SHA closure + set-disjointness; visited-set guards cycles.
*equivalence:* coverage (suffix-reachability). *cost_model:* Σ wasted-branch (in+out)×rates; null
on unpriced; empty accepted suffix ⇒ whole session is regret, reported honestly. *constraints:* all
✓. *effort_risk:* M — needs parent/child + cite-back graph; absent ⇒ shallow-closure upper bound
labelled `closure:shallow`.

### M15 — Failure-Taxonomy Detector Sweep → `@prune/cost-security` detectors (hooks, no MCP)

Swept four published taxonomies (2606.01365, 2510.26585, 2602.20021 *Agents of Chaos*,
2601.14470 *Tokenomics*) into a 19-row coverage matrix: 13 classes already covered, 1 honestly
ABSENT (task-drift — its only detector is a model call, forbidden), 4 uncovered with a
deterministic shadow, 1 needs-host-signal. All consume fields the telemetry schema already parses
but no detector reads; pure arithmetic/set-membership; fail-open `insufficient_signal`; null USD on
unknown model.

**L5-10 · no-final-termination-detector** — *lever:* request_count (each non-terminating round-trip
re-pays the prefix) + input/output. *tier:* 1. *mechanism:* a tail of consecutive turns whose
`stop_reason` ∉ {end_turn, stop, stop_sequence} with monotone-rising input_tokens = provable
non-progress toward an answer, distinct from a content loop. *feasibility:* `stop_reason` parsed
today (`telemetry/src/schema.ts`) but consumed by nothing — the gap billing-tier-drift filled for
`service_tier`; `assessTermination(turns)` → Stop-hook `termination-stall.mjs`; falsifier — 6
tool_use turns rising ⇒ fire; any end_turn ⇒ no fire; all-null ⇒ insufficient_signal.
*evidence_anchor:* *Agents of Chaos* (2602.20021) no-final class; `stop_reason` API field.
*novelty:* vs loop-breaker (needs identical SHA — varied non-terminating work never trips it) &
preturn-forecast (forecasts before a turn). *decision:* terminal-set membership + monotone check,
O(n). *equivalence:* n/a. *cost_model:* Σ_tail(input+cache_read+output); null on unpriced; names
its summed fields (§F). *constraints:* all ✓. *effort_risk:* S — hosts omitting `stop_reason` ⇒
insufficient_signal.

**L5-08 · token-spiral-growth-detector** — *lever:* context-window pressure + input/cache_read.
*tier:* 1. *mechanism:* per-turn `input_tokens` strictly increasing with non-negative second
difference (accelerating) and no compaction marker between = a token spiral; fanout-acceleration's
exact math retargeted from spawn-count to token-mass (a single-agent session can spiral and
fanout-accel is structurally blind). *feasibility:* `usage.input_tokens` series in UsageSchema;
session-store already keeps per-turn buckets; `assessTokenSpiral(series)` → hook `token-spiral.mjs`;
falsifier — [5k,12k,22k,40k] ⇒ fire; rise-then-drop-at-marker ⇒ no fire; flat/sawtooth ⇒ no fire.
*evidence_anchor:* *Agents of Chaos* (2602.20021). *novelty:* vs fanout-acceleration (spawn count
≠ token mass) & context-health f6 (fullness %, not the cost derivative). *decision:* second-diff
arithmetic, marker-gated fail-open. *equivalence:* n/a. *cost_model:* Σ marginal re-billed input
over the window; null on unpriced. *constraints:* all ✓. *effort_risk:* S — requires *accelerating*
growth (not mere growth) to avoid flagging legitimate long-context tasks.

**L5-13 · max-tokens-truncation-retry-detector** — *lever:* request_count + input/cache_read +
output. *tier:* 1. *mechanism:* `stop_reason === "max_tokens"` recurring across ≥k turns on the
SAME target (tool_use id / path) = a calibration failure re-paying the prefix to re-emit truncated
output. *feasibility:* `stop_reason` + tool id/path present; `assessTruncationRetry(turns)` → hook
`max-tokens-retry.mjs`, may actuate P8b calibrator; falsifier — 3 max_tokens on one path ⇒ fire; 3
on distinct targets ⇒ no fire; recovered ⇒ no fire. *evidence_anchor:* 2510.26585 runtime
supervision; `stop_reason:"max_tokens"`. *novelty:* vs P8b (calibrates before; this detects the
runtime loop) & loop-breaker (different resultSHA each truncated retry ⇒ blind). *decision:* string
equality + grouping by target. *equivalence:* n/a. *cost_model:* retries × (input+cache_read) +
truncated output; null on unpriced. *constraints:* all ✓. *effort_risk:* S — minRetries ≥ 3 on the
same target avoids flagging one legitimately-long output.

**L5-14 · category-sink-detector** — *lever:* input/cache_read (one tool's cumulative result mass
re-billed every turn). *tier:* 1. *mechanism:* a per-tool cumulative result-token counter; fire when
one tool's share ≥ θ of total result tokens over ≥n calls — the integral cost-guard's per-event
ceiling cannot see. *feasibility:* `@prune/tokenizer` counts + tool name per result event;
`assessCategorySink(perToolTokens)` → Stop-hook `category-sink.mjs`; falsifier — {Read:80k,Edit:5k,
Bash:5k}@θ0.5 flags Read; even split flags none; below minCalls ⇒ no fire. *evidence_anchor:*
Tokenomics (2601.14470, review=59.4% sink). *novelty:* vs cost-guard (per-result, not cumulative) &
tool_audit f2 (definition mass, not result mass) & attribution (per-dev/PR, not per-tool share).
*decision:* division + grouping, zero-guarded. *equivalence:* n/a (flag only). *cost_model:*
sinkTokens − fair share; null on unpriced. *constraints:* all ✓. *effort_risk:* S–M — a legitimately
review-heavy session; advisory-only, tunable θ.

**HS-1 · orphaned-context-detector** — **needs host signal: per-block last-reference position.**
*lever:* input/cache_read (a never-re-used tool result re-billed every cached turn — AgentDiet
"expired"). The honest detector needs, per content block, whether it was referenced after turn t;
that signal exists in NO Claude Code hook payload today (the transcript records what entered
context, not what the model attended to), and a regex/embedding "was it mentioned" check is
non-deterministic classification (forbidden). Emitted labelled per the schema; would ship as
`assessOrphanedContext(blocks)` with a reversible-placeholder (f15) gate once the host exposes
last-reference/citation positions. *novelty:* vs read-gate (prevents re-read) & observation-mask
(window heuristic) — suppress *never-used* content by *measured* last-reference. *effort_risk:* L
(blocked on host capability, not engineering).

> *Dropped at self-verify:* circular agent↔agent exchange (row 15) — its delta vs L5-21t's
> subagent-report pricing is governance, not a new detector, and its required report-SHA overlaps
> an M19 mechanism (recurrence without a clean delta).

### M16 — Bound-Gap Prospecting → `outcome-bench` frontier extension + `program-slice`/`response-tuner` deltas

**L5-21 · frontier-sweep-harness** — *lever:* measurement substrate (ships no saving; locates every
other candidate on the distortion-rate curve so claimed savings are falsifiable against an empirical
bound). *tier:* 1. *mechanism:* outcome-bench runs ONE governed point, qpd-bench sweeps only model
tier — neither fits a distortion-rate curve over the context/output BUDGET axis. Adds a budget-sweep
arm factory + envelope fitter; the current squeezer/slice/tuner config is plotted ON the same axes;
the gap is then measured, not asserted. *feasibility:* outcome-bench `arms` list + FixtureRunner
(zero-spend) + pre-registered manifests exist; `outcome-bench/src/frontier.ts`
(`buildBudgetSweepArms`, `fitFrontier`) → MCP `outcome_frontier_report`; falsifier — budgets
{2k,4k,8k,16k}@pass{.4,.7,.9,.9} ⇒ knee at 8k, 16k flagged dominated. *evidence_anchor:*
rate-distortion limits (2407.15504, NeurIPS 2024) + token complexity (2503.01141). *novelty:* a NEW
sweep axis (token budget, not model id) + a NEW object (fitted frontier with current config
located). *decision:* per-task non-dominated set + aggregate knee, arithmetic on recorded pass/fail.
*equivalence:* n/a (oracle-graded). *cost_model:* zero saving by construction (instrumentation);
own overhead zero in dry-run; billedUsd null on unpriced. *constraints:* all ✓. *effort_risk:* M —
small-n frontiers labelled "screening".

**L5-22 · query-conditioned-slice-budget** — *lever:* fresh_input. *tier:* 1. *mechanism:*
program-slice (f17) drops farthest-hop symbols first — a query-AGNOSTIC cut; rate-distortion's
verified-critical property is query-awareness. Adds a query-conditioned tie-break at the eviction
frontier ONLY (keep symbols whose identifier tokens ∈ the caller-supplied, pre-tokenized query
set), preserving f17 soundness when unbudgeted. *feasibility:* slice seeds + per-node tokens + query
token-set all caller-supplied; `cutPolicy: "hop"|"query-conditioned"` on `computeSlice`, default
unchanged; falsifier — query-named 2-hop symbol survives a forced cut; unbudgeted run byte-identical
to hop. *evidence_anchor:* 2407.15504 (query-awareness critical). *novelty:* vs f17 (topological
cut) & context-analyzer (file-level regex keywords) — symbol-graph set-membership tie-break, no
regex. *decision:* set intersection + sort. *equivalence:* coverage + f17 closure when unbudgeted.
*cost_model:* same token mass at equal budget — the lever is QUALITY at fixed saving, measured via
L5-21 oracle NI; null USD on unpriced. *constraints:* all ✓. *effort_risk:* M — ships only if it
beats hop at equal budget on the frontier test; "hop" stays default.

**L5-14b · per-task-budget-selector** — *lever:* fresh_input. *tier:* 1. *mechanism:* squeezer tier
& slice budget are caller-fixed CONSTANTS; token complexity shows each task has a sharp minimal-token
threshold. Selects budget/tier per task from a frozen, model-keyed table mapping a task's complexity
bucket (intentClass, slice-closure size band) to the empirically-measured frontier knee (from an
L5-21 run) — a table lookup, not a predictor. *feasibility:* seed/closure counts + intentClass + a
committed frontier artifact; `selectBudget(bucketFeatures, frontierTable) → budget|null` (null on
unknown bucket — never guess); falsifier — known bucket → its budget; unknown bucket → null.
*evidence_anchor:* token complexity (2503.01141) + TALE (2412.18547). *novelty:* vs squeezer/f17
(caller-fixed) & qpd-bench (model axis) — sweeps & freezes the BUDGET axis into a per-bucket table;
consumes (not measures) the frontier; picks the budget (vs L5-22 ordering within a budget).
*decision:* map lookup. *equivalence:* selected budget enforced by f17 coverage gate. *cost_model:*
full_closure − selected_budget when below the old constant; null on unknown bucket/model — table is
model-keyed (Opus 4.7+ +30–35% drift). *constraints:* all ✓. *effort_risk:* M — table drift; null on
absent live model.

**L5-16 · output-budget-instruction-injector** — *lever:* output (~5× input) + reasoning_tokens.
*tier:* 1. *mechanism:* response-tuner's output side only RESERVES max_tokens (truncation guard) and
prunes what's READ — neither reduces GENERATED tokens. Injects a deterministic, caller-templated
output-budget instruction (CoD: ~80% fewer output tokens at near-parity) AND sets max_tokens as a
guard strictly ABOVE the budget, so the budget shapes generation while the cap only catches outliers
— never truncating a compliant answer. *feasibility:* intentClass + per-class output budget (L5-21
output-axis knee) + static template; `buildOutputBudgetPrompt(intentClass, table) →
{prefix, maxTokensGuard}|null`; falsifier — "explain"@300 ⇒ ≤300 template + guard>300; unknown class
⇒ null. *evidence_anchor:* CoD (2502.18600), TALE (2412.18547); output 5× input (Part A′). *novelty:*
vs P8b (reserves, never shapes) & P8a (prunes input) & Appendix-S #9 (seed; this grounds N in a
fitted frontier + guard-not-truncate). *decision:* lookup + static template + arithmetic guard.
*equivalence:* text (output-equivalence relation gates over-compression). *cost_model:* NET
output-saved (5×) minus prefix-input (1×); null on unpriced. *constraints:* all ✓. *effort_risk:* S
— a prompt nudge, not a guarantee; text-equivalence gate rejects over-compression; ships behind the
output-axis frontier NI test.

### M17 — Attribution-Ablation Audit → `outcome-bench` ablation harness + MCP `*_report` (read-only)

**L5-15 · category-ablation-harness** — *lever:* fresh_input/cache_read (every injected category
re-bills each turn). *tier:* 1. *mechanism:* the bench only knows naive vs governed; this adds a
category-keyed arm constructor that runs the SAME tasks with exactly ONE category present/suppressed
(everything else byte-identical), reading attribution as the paired oracle NI delta — a $-per-utility
*ranking procedure* per category, not a guessed ranking. *feasibility:* outcome-bench UsageBreakdown
+ oracle + FixtureRunner + planArmSetup exist; the only new piece is a present/suppressed category
param (each maps to a real suppression: hook flag, CLAUDE.md elision, MCP `tools` subset, tab drop,
`clear_tool_uses`); `runAblationMatrix(tasks, categories, config, runner)` → MCP
`category_ablation_report`; falsifier — zero-attribution category ⇒ suppress + exact tokenMass;
oracle-flipping category ⇒ keep + significant delta. *evidence_anchor:* ContextCite (2409.00729) +
context-editing 84% (claude.com/blog/context-management, `[P]`) + free count_tokens preview.
*novelty:* vs context-utility F1 (online per-atom) & outcome-bench (binary naive/governed) &
tab-auditor (structural, no outcome). *decision:* paired trials + `nonInferiorityProportion` +
count_tokens mass, byte-diff guard against confounding. *equivalence:* coverage (oracle NI margin).
*cost_model:* $0 dry-run; live saving = Σ tokenMass×turnsCarried×rate − overhead; null on unpriced;
sums UsageBreakdown fields (§F). *constraints:* all ✓. *effort_risk:* M — confounding (byte-diff
guard) + underpower ⇒ `untested`, never false suppress.

**L5-17 · advisor-reflexive-ablation** — *lever:* fresh_input + the reflexive-overhead term (a
*negative* lever: stop Prune's advice costing more than it saves). *tier:* 1. *mechanism:* runs each
advisor hook (cache-habits, context-health, trajectory-diet, skill) through the L5-15 harness
present vs flag-disabled; an advisor whose presence doesn't move the oracle at material token mass is
reflexive overhead that self-demotes to opt-in (the f19 discipline, the f22 earn-your-cost pattern).
*feasibility:* advisor messages real (`emitAdditionalContext`), overheadTokens already computed,
flags.mjs disables any advisor, FixtureRunner replays free; MCP `advisor_reflexive_report` +
wastebench `advisorAttribution`; falsifier — zero-attribution advisor ⇒ demote + recoveredTokens;
behavior-changing advisor ⇒ keep; edited message ⇒ prior verdict invalidated (content-SHA).
*evidence_anchor:* counterfactual asset auditing (2605.11946) + f19 reflexive-overhead SLO.
*novelty:* vs f19 (measures overhead, takes saving as given) & anti-synergy G1–G3 (duplicate flag) —
measures the advisor's causal attribution. *decision:* paired NI + content-SHA-keyed verdict;
null-attestation ⇒ keep (never silence the unmeasured). *equivalence:* coverage. *cost_model:*
recovered overheadTokens of a demoted advisor; null on unpriced; NET. *constraints:* all ✓.
*effort_risk:* S/M — rare-trigger advisor ⇒ `untested for X`, never demote; demotion flips default
to shadow (reversible), never deletes.

**L5-19 · schema-attribution-lazyload** — *lever:* fresh_input + cache_write (a tool-def change busts
the whole `tools→system→messages` hierarchy). *tier:* 1. *mechanism:* tool_audit f2 flags schema
bloat by SIZE; mcp-proxy f10 lazy-loads by intent; neither measures realized attribution per MCP
server. Keys the L5-15 harness to `mcp-server:<name>` (suppression via mcp-proxy's existing subset
return); a server with zero tool-calls AND zero attribution at material schema mass is a lazy-load
candidate, deferred until first intent-match with guaranteed on-demand restore. *feasibility:*
tool-call records flattened by outcome-bench + per-server schema mass via count_tokens + mcp-proxy
lazy path + hierarchical-invalidation rule (`[P]`); MCP `schema_attribution_report` extending
tool_audit with an attribution column; falsifier — never-called + zero-attribution server ⇒
lazyLoadCandidate + cacheBustAvoided; called-on-critical-path ⇒ keep. *evidence_anchor:* TracLLM
(2506.04202) + hierarchical invalidation (`[P]`); GitHub-MCP 42–55K (Part W′) used as motivation,
MEASURED not quoted. *novelty:* vs f2 (size) & f10 (per-turn intent) & F1 (per-atom) — outcome-keyed
server verdict that pre-seeds proxy's default-defer. *decision:* paired NI + callCount + schemaTokens,
server-qualified tool ids. *equivalence:* coverage + availability invariant (tool stays reachable).
*cost_model:* schemaTokens×turnsBeforeUse×rate + avoided cache-bust − restore round-trip; null on
unpriced; sums input+cacheCreate (§F). *constraints:* all ✓. *effort_risk:* M — cross-server name
collisions (qualified ids); keep-on-uncertainty default.

> *Recorded "cannot ablate":* compaction summaries (no client-side on/off per arm — needs host
> signal); host system-prompt (outside the sidecar boundary); repo-map/skill+memory (already governed
> by f22 self-demotion — folded into L5-17's keep-on-uncertainty rather than duplicated).

### M18 — Rent-or-Buy Frontier → `@prune/agent-sdk-adapter` policies (competitive ratios stated)

**L5-09 · ski-rental-ttl-controller** — *lever:* cache_write (1.25× vs 2.0×) + read amortization.
*tier:* 1. *mechanism:* the shipped `chooseTtl` picks 5m/1h from a read-RATE fingerprint (clairvoyant:
assumes last hour predicts next). Recast as ski-rental: renting = repeated 5m write (1.25×/rebuild),
buying = one 1h write (2.0×); rent until accrued rent ≥ buy price, then buy — forecast-free, regret
bounded. Breakeven 2.0/1.25 = 1.6 cycles ⇒ switch on the 2nd accrued cold rebuild within the hour;
**competitive ratio (1.25+2.0)/2.0 = 1.625**. *feasibility:* per-fingerprint rebuild count from
`EventRow.cache_creation_input_tokens` exists; `skiRentalTtl(rebuildHistory)` as a drop-in
`TtlChooser`; falsifier — adversarial burst-then-55-min-silence: rate-policy mis-buys 1h (0.75×
wasted), ski-rental holds 5m (only 1 rebuild). *evidence_anchor:* Part A′ §1 ratios `[P]` + ski-rental
(CIDR 2025). *novelty:* vs ttl-amortization.ts (point-estimate rate, no regret bound). *decision:*
integer threshold on a count; unknown multipliers ⇒ "5m" fail-safe. *equivalence:* n/a (cache identity
preserved). *cost_model:* 0.75 input-units per over-bought write avoided; null on unpriced;
competitive-ratio assertion in tests. *constraints:* all ✓. *effort_risk:* S — needs rebuild COUNT;
absent ⇒ "needs host signal" no-op.

**L5-11 · breakpoint-eviction-paging** — *lever:* cache_read under the 4-breakpoint/20-position
limits. *tier:* 1. *mechanism:* with only 4 breakpoints, choosing which prefixes stay cached is paging
with cache size 4 over an adversarial sequence; the shipped planner places breakpoints greedily by
token span (no eviction policy, no lookback awareness). Applies a competitive paging policy
(marking/LRU) over the 4 slots, guaranteeing no live segment sits beyond its breakpoint's 20-block
lookback. *feasibility:* per-breakpoint serve history (replay-vault) + block-count past each
breakpoint (the adapter's flattened request); `pageBreakpoints(candidates, slotHistory,
lookbackLimit=20)` post-processing planBreakpoints; falsifier — 5-prefix thrash trace: paging hits >
greedy; 21-block append flagged beyond-lookback. *evidence_anchor:* Part A′ §1 (4 breakpoints, 20
lookback) `[P]` + k-competitive paging. *novelty:* vs cache-planner.ts (re-plans each request by
static size, no cross-turn eviction, no lookback guard). *decision:* integer paging; **k=4
competitive**; fall back to greedy on bad input. *equivalence:* n/a (position selection). *cost_model:*
prefixTokens×0.9×input per retained-and-hit prefix; null on unpriced. *constraints:* all ✓.
*effort_risk:* M — needs served-turn history; absent ⇒ LRU on in-process state, else pass through
greedy (no regression).

**L5-12 · flex-vs-batch-deadline-scheduler** — *lever:* service-tier selection (Flex/Batch ≈0.5× vs
sync 1.0×) + avoided value-forfeit from a missed deadline. *tier:* 1. *mechanism:* the shipped
batch-router is 2-way (Batch iff slack ≥ minSlack), with NO deadline-risk model and NO Flex — it
declines every interactive turn to full price and cannot serve a sequential agent loop at all. Adds a
3-lane non-clairvoyant deadline-scheduling rule: Flex for sync-tolerable work under preemption, Batch
only when slack ≫ 24h AND deferrable, sync otherwise; routed against the offline optimum that knows
deadline/preemption outcomes. *feasibility:* caller-declared interactive/slack/deadline/preemption-
tolerable flags (same shape as today's BatchRequest) + model-family Flex eligibility lookup;
`routeTier(request)` extending batch_route with a `tier` field (backward-compatible); falsifier —
sequential preemption-tolerable GPT-5 ⇒ FLEX (router loses ~50% today); interactive ⇒ sync.
*evidence_anchor:* Part A′ §2/§3 Flex mechanics `[S]` + deadline scheduling (2601.22996). *novelty:*
vs batch-router (no Flex/deadline-risk/preemption) & futures-desk (commitment, not per-request tier).
*decision:* declared-flag predicate chain; defaults to sync on any doubt. *equivalence:* n/a (content
identical across lanes). *cost_model:* discount(lane) MINUS expected preemption-retry (Flex) / deadline-
miss forfeit (Batch); null on unpriced/unknown eligibility; **Flex eligibility `[S]` ⇒ gate behind
primary verification + caller `flexEligible` flag**. *constraints:* all ✓. *effort_risk:* M — `[S]`
eligibility list; unknown model never silently routes to a lane it can't use.

**L5-25 · thinking-clear-rent-or-buy** — *lever:* cache_read (preserved prefix) vs fresh_input
(freed-then-rebuilt). *tier:* 1. *mechanism:* clearing thinking (`clear_thinking_20251015`) frees
those tokens but invalidates cache at the clearing point (rewrite the tail at the write multiplier);
keeping thinking preserves cache but carries the tokens at 0.1× every remaining turn. Rent-or-buy:
clear iff N×T×R > A×w (price cancels). No shipped feature makes this decision; uses the FREE
count_tokens context-management preview as the `cleared_input_tokens` oracle; respects the
"first-in-edits-array" rule. *feasibility:* thinking-block mass + position + caller remaining-turns +
free count_tokens preview; `clearThinkingDecision({thinkingTokens, tokensAfterClearPoint, writeMult,
readMult, remainingTurns})` → MCP `thinking_clear_quote`; falsifier — N below breakeven ⇒ KEEP; above
⇒ CLEAR; planner T defers to count_tokens oracle when supplied. *evidence_anchor:* Part A′ §1
clear_thinking semantics + free preview `[P]`. *novelty:* vs recompress-planner (compresses a suffix,
not thinking; no first-in-array constraint, no free-oracle reconciliation). *decision:* algebraic
threshold; KEEP + insufficient_data on unpriced/zero-mass. *equivalence:* n/a for cost; provider
clear_thinking semantics + advisory actuation. *cost_model:* N×T×R − A×w input-units; null on
unpriced; NET. *constraints:* all ✓. *effort_risk:* S — **forecast-DEPENDENT in remaining-turns
(labelled the weaker class)**; defaults to KEEP when N absent.

> *Dropped:* compact-now-vs-later (collapses to recompress-planner's breakeven AND needs the L5-02
> iterations-accounting first — a dependency, not a clean bound); re-warm-vs-let-die (prefix-warm's
> shipped policy; generalized into L5-09's ski-rental frame).

### M19 — Externality Pricing Sweep → `@prune/context-rent` / `@prune/subagent-toll` / `@prune/advisor-rebate` (+ mcp-proxy)

All four price a PRODUCER that injects content / consumes a scarce slot without bidding into the f18
λ; clearing is arithmetic on caller-supplied counts; null λ ⇒ fail-open no-op; strategic silence
(the VCG outcome) is a first-class result.

**L5-22m · context-rent-clearing-house** — *lever:* cache_read + fresh_input (the per-session
"context-window pressure" term — pricing *persistence*, not insertion). *tier:* 1. *mechanism:* a
block injected once is re-billed every subsequent turn (replay-cost's `sharedPrefixTokensIn`), but
the producer never sees that bill, so there's no back-pressure on long-lived bloat. Turns f18's λ into
a recurring rent: each resident block is charged λ × (residentTokens × E[remainingTurns]) at insertion
and re-quoted each compaction epoch; a Vickrey-style cutoff over the resident set under the
compaction-trigger headroom as capacity. *feasibility:* replay-cost carry fields + EventRow resident
mass + epoch boundaries + replay-vault block-survival curve (E[remainingTurns], not a constant);
`@prune/context-rent.quoteResidentRent(...)` → MCP `context_rent_quote` + PostToolUse advisory;
falsifier — 4K result resident 30 turns priced at λ×4000×measured-remaining; recomputed re-bill must
match; a "drop" whose summary re-injects next turn nets ≤ 0 ⇒ not recommended. *evidence_anchor:*
token-level auctions (2310.10826, WWW 2024) + cache-read 0.1× re-bill (`[P]`). *novelty:* vs f18
clearing-price (one-shot single token cost — this adds the carry-horizon multiplier) & context-health
f6 (holistic ECF, no per-producer charge-back) & f15/f16 (mask/deny, not rent). *decision:* rent
arithmetic + sorted cutoff; abstain on null λ/quality/thin survival samples. *equivalence:* coverage
— drops routed through f16 content-SHA / f15 reversible placeholder (never deletes). *cost_model:*
NET of placeholder residual carry + advisory cost; null on unpriced. *constraints:* all ✓.
*effort_risk:* M — survival-curve horizon is the only forward input; re-quoted per epoch bounds the
error.

**L5-23 · schema-slot-auction** — *lever:* fresh_input + cache_write invalidation (schemas sit in the
cached `tools` block; a tool-set change busts the whole hierarchy). *tier:* 1. *mechanism:* N MCP
servers each inject full catalogs into a shared `tools` block; each marginal schema looks free to its
server while imposing a re-bill on every turn. A standing-slot auction over the 4-breakpoint /
tools-block budget: each server bids measured invocation utility (trailing-window call count) against
λ × resident-schema-tokens × expected turns; clear greedily by utility-per-resident-token; losers
deferred to mcp-proxy lazy-load. The auction is **turn-stable** (verdicts change only at a compaction
epoch) so it never itself busts the cache. *feasibility:* tool-def-auditor per-tool cost + usage
frequency + mcp-proxy lazy path + tool-use overhead table + 20-position limit (`[P]`); extend
mcp-proxy with `clearSchemaSlots(...)` → MCP `schema_slot_clear` at session-start/PostCompact;
falsifier — 3 servers/60K tokens, server-C never called ⇒ defer C, per-turn cache-read drops by C's
mass×turns. *evidence_anchor:* VCG bid-to-speak / strategic silence (2511.13193) + hierarchical
invalidation (`[P]`); 22–55K mass (Part W′) motivation only. *novelty:* vs tool-audit f2 (flags
individually, no shared budget) & mcp-proxy f10 (per-turn intent, can thrash the cache) & F15
allowance-market (per-ACTOR, not per-PRODUCER slot). **Complements L5-19** (L5-19 *measures* which to
defer; L5-23 *prices* the allocation). *decision:* utility/cost ranking + budget fill; abstain ⇒ full
catalog. *equivalence:* availability invariant (deferred tool resolvable via lazy call). *cost_model:*
NET of expected lazy-fetch re-bills and avoided cache-bust (floor excludes the bust term); null on
unpriced. *constraints:* all ✓. *effort_risk:* M — avoided-bust term is host-dependent (computed as
upside, not floor).

**L5-21t · subagent-report-toll** — *lever:* fresh_input (orchestrator re-read — the dominant share
of the ~15× multi-agent multiplier). *tier:* 1. *mechanism:* a subagent's report is injected into the
orchestrator and re-billed there, then carried every subsequent orchestrator turn; the subagent is
never charged for the re-read it imposes, so reports are verbose "for free." A toll: before admission,
a report must clear λ × (reportTokens × E[orchestrator remaining turns]) against its declared
decision-utility (did the orchestrator's next action cite/depend on it?); reports past the cutoff are
admitted as a structured digest (counts + result-SHA + cited span) with the body parked in
replay-vault, lazy-fetchable. *feasibility:* subagent-cost-predictor quantiles + subagent-warden
activity view + EventRow orchestrator re-read mass + replay-vault report payload;
`@prune/subagent-toll.tollReports(...)` → MCP `subagent_report_toll` + SubagentStop advisory;
falsifier — 5-subagent fan-out, 40K reports carried 10 turns: digesting the 3 never-cited reports cuts
re-read by their mass×carry; a digested-then-expanded report nets ≤ 0. *evidence_anchor:* Anthropic
15× (verified) + strategic silence (2511.13193). *novelty:* vs subagent-warden (caps spawn count, not
report mass) & subagent-cost-predictor N6 (pre-spawn forecast) & response-tuner P8a (generic byte
prune, not a decision-utility toll on report carry). *decision:* toll arithmetic + one host-supplied
citation boolean; null citation ⇒ admit-full. *equivalence:* coverage (digest preserves result-SHA +
lazy-recoverable body). *cost_model:* NET of digest carry + expansion re-fetch; 15× is evidence, not a
multiplier in the formula; null on unpriced. *constraints:* all ✓. *effort_risk:* M — **needs host
signal: orchestrator-action provenance**; absent ⇒ admit-full no-op.

**L5-24 · advisor-injection-rebate** — *lever:* fresh_input carry of Prune's OWN advisory/hook
messages (the reflexive externality). *tier:* 1. *mechanism:* each advisor injects text the
orchestrator carries and re-bills; no advisor is charged for its residency, so ~30 hooks risk an
"advisory storm." A rebate-gated emission: before emitting, an advisory must clear λ × (advisoryTokens
× E[remainingTurns]) against its f19-attested net saving; overlapping advisories (same rule, same
target SHA) are coalesced so the externality is paid once. Strategic silence is the headline outcome.
*feasibility:* f19 attested net-saving + advisory token counts (the hook composes the string) +
flag-system active set + anti-synergy G1–G3 duplicate detection; a shared `@prune/advisor-rebate.
shouldInject(...)` in the hook `emit()` path (fail-open, no MCP); falsifier — two hooks emitting the
same CH-009 for one target SHA ⇒ coalesce to one; an advisory whose attested saving < carry cost ⇒
suppress, and a replay confirms suppression didn't raise downstream waste. *evidence_anchor:* f19
reflexive SLO + strategic silence (2511.13193) + anti-synergy advisory-storm. *novelty:* vs f19
(measures overhead; this ACTS pre-emission) & anti-synergy G1–G3 (binary duplicate flag; this prices
coalescing against λ×horizon). **Complements L5-17** (offline demote verdict vs online emission gate).
*decision:* SHA-equality coalesce + rebate arithmetic; **null λ or null attestation ⇒ inject (never
silence the unmeasured)**. *equivalence:* n/a (no model-visible content removed); safety invariant =
never suppress an un-attested advisor. *cost_model:* suppressed/coalesced tokens × carry × input −
lost-saving-of-any-genuinely-positive-suppressed-advisor; null on unpriced; NET. *constraints:* all ✓.
*effort_risk:* S — failure mode is "advise too much" (safe), never "silently stop advising."

### M20 — Provider-Mechanics Diff Futures → `@prune/cache-habits` / `@prune/telemetry` / `@prune/cost-security` (GUARD · PLANNER · ACCOUNTING)

**L5-01 · per-model-cache-minimum-guard** *(GUARD — fixes a live bug)* — *lever:* cache_read/write
(a silently-uncached short prefix pays full fresh_input forever). *tier:* 1. *mechanism:* the verified
rate sheet fixes the minimum cacheable prefix PER-MODEL (512/1024/2048/4096) and it CHANGED from the
coarse family buckets the repo hard-codes. **Confirmed bug:** `cache-econ.ts:130` maps `opus → 4096`,
but Opus 4.8's minimum is **1,024** — so CH-002 false-positives a 1,500-token Opus 4.8 prefix (flags
"too small" when it caches fine) and the family key can't separate Opus 4.8 (1,024) from Opus 4.6/4.5
(4,096). Replaces the bucket map with the exact per-model table + a PostToolUse cross-check (declared
prefix ≥ min but `cache_creation_input_tokens === 0` = witnessed silent miss). *feasibility:*
`action.model` + prefix token count + observed `cache_creation_input_tokens` all flow through the
cache-habits path today; `MIN_CACHEABLE_BY_MODEL` table consumed by CH-002/003/012 + the cross-check;
falsifier — Opus 4.8 @1,500 must NOT fire (min 1,024); Haiku 4.5 @2,000 MUST fire (min 4,096);
declared 6,000 + observed cache_creation 0 ⇒ "witnessed silent non-cache". *evidence_anchor:* Part A′
§1 per-model minimums **`[P]` — resolves v2's RE-VERIFY flag, no primary-verify milestone needed**.
*novelty:* vs CH-002 / minCacheablePrefix (3-value family bucket, provably wrong for Opus 4.8) — exact
per-model table + witnessed-miss cross-check. *decision:* table lookup + integer comparison; unlisted
model ⇒ family fallback labelled "approximate". *equivalence:* n/a (advisory). *cost_model:* prefix ×
(input − cached_input) per sub-minimum turn; null on unpriced; distinct from CH-bust costs (no
waterbed). *constraints:* all ✓. *effort_risk:* S — table drift; CI gate "every priced model has a min
entry".

**L5-02 · compaction-iterations-accountant** *(ACCOUNTING — enabler)* — *lever:* output (compaction
summary billed as output) + session accounting. *tier:* 1. *mechanism:* server-side compaction emits
a summary billed as OUTPUT but reported ONLY in `usage.iterations` (type "compaction"); top-level
input/output EXCLUDE it, so every shipped meter under-reports true spend — `SUM(output_tokens)`
under-counts. Promotes the `usage.iterations` field (already on the schema's `.passthrough()`) and
sums the compaction entries, surfacing a corrected total alongside the top-level figure, null on
unknown. *feasibility:* `usage.iterations` already preserved-but-unconsumed; UsageSchema extension +
`sumCompactionIterations(usage)` + Stop-hook `compaction-accountant.mjs`; falsifier — top-level 1000 +
iterations 4000 ⇒ corrected 5000; no iterations ⇒ top-level exactly; malformed ⇒ top-level, never
throws. *evidence_anchor:* Part A′ §1 compaction billing **`[P]`** + §3 hidden-billing asymmetry row.
*novelty:* vs compaction-recover.mjs / intelligence compaction-auditor (CLIENT-side decision recovery;
neither reads provider `usage.iterations`) & orthogonal to CLAUDE.md follow-up #1 (null-masking, a
different field). **Enabler for L5-25's dropped compact-now-vs-later.** *decision:* integer array sum
over `type==="compaction"`. *equivalence:* n/a. *cost_model:* compaction output × output_rate; null on
unpriced; NET addition (tokens in no other term ⇒ no waterbed). *constraints:* all ✓ (10⁶-iteration
DoS O(n)). *effort_risk:* M — exact iterations JSONL shape uncalibrated; **first milestone: calibrate
against one real compacting transcript** before the persistence path consumes it (Stop-hook advisory
is safe meanwhile — only ADDS a labelled number).

**L5-03 · breakpoint-lookback-guard** *(GUARD)* — *lever:* cache_read (a turn appending >20 blocks
past its last breakpoint silently misses). *tier:* 1. *mechanism:* lookup checks at most 20 positions
back from each breakpoint; appending >20 content blocks pushes the cached prefix out of the window —
the hit silently fails, `cache_read_input_tokens` collapses to 0, the turn re-pays fresh input. A NEW
cache-killer class distinct from every CH rule (those track prefix MUTATION, not block-COUNT growth).
*feasibility:* content blocks countable from the transcript + `cache_read_input_tokens` confirms the
witnessed miss; `assessBreakpointLookback(blocksSinceBreakpoint, cacheReadTokens)` → PostToolUse hook
`breakpoint-lookback.mjs`; falsifier — 21 blocks + cache_read 0 (prior large read) ⇒ fire; 19 ⇒ no;
21 + cache_read > 0 (hit landed) ⇒ no. *evidence_anchor:* Part A′ §1 (20-position lookback, 4
breakpoints) **`[P]`** + §3 (Anthropic-only). *novelty:* vs CH-001/005/006/007 (prefix-content
change) — block-count growth under an UNCHANGED prefix; no shipped detector models the lookback
window. *decision:* integer count + provider gate (`detectProvider==="anthropic"`). *equivalence:*
n/a (breakpoint annotation preserves bytes). *cost_model:* prefix × (input − cached_input) per missed
turn; null on unpriced; distinct from CH-bust (no waterbed). *constraints:* all ✓. *effort_risk:* M —
predictive variant needs the breakpoint block index from the adapter; ship the PostToolUse
witnessed-miss variant first (fully feasible).

**L5-20 · tokenizer-drift-comparison-barrier** *(GUARD — operationalizes M9v3 §E)* — *lever:*
tier-selection accounting (prevents a WRONG cheaper-model pick from comparing $/task across
generations with one tokenizer, under-counting the newer model by 30–35%). *tier:* 1. *mechanism:*
Opus 4.7+ tokenizes the same text into ~30–35% more tokens; any cross-model comparison counting tokens
once and multiplying by each rate under-prices the newer model and can flip a routing/QpD verdict. A
barrier refuses to emit a cross-generation $ comparison unless each candidate's tokens were counted
with ITS OWN tokenizer (or a declared drift factor is applied). *feasibility:* `@prune/tokenizer` does
per-family counting + model id always available; needs a per-count tokenizer-id tag (the package knows
it); `crossModelComparable(countA, countB)` in qpd-bench/quality, wired into tier comparison +
subagent-cost-predictor; falsifier — Opus 4.5 vs 4.8 with a SINGLE count ⇒ reject (or require
re-tokenization); per-tokenizer counts ⇒ pass; same-generation ⇒ pass. *evidence_anchor:* Part A′ §1
tokenizer regression **`[P]`** + M9v3 §E. *novelty:* vs qpd-bench f4 / subagent-cost-predictor (compare
tiers; neither knows the count is generation-dependent) — a correctness BARRIER invalidating a class
of comparison they silently perform. *decision:* metadata identity check; missing tokenizer-id ⇒ fail
closed (reject). *equivalence:* n/a (gates a numeric comparison). *cost_model:* a guardrail — prevents
a fabricated saving (a wrong pick raising true cost up to ~30–35% of input); null on unpriced.
*constraints:* all ✓. *effort_risk:* M — needs a stable per-generation tokenizer id (+ an Opus-4.7+
tokenizer for the drift-factor path); ships fail-closed if only one generation's tokenizer is present.

**L5-26 · free-retention-and-flex-eligibility-planner** *(PLANNER · absorbs M18-2)* — *lever:*
cache_read (free 24h retention extends hit-eligibility) + service-tier selection (Flex/Batch 50% vs
full). *tier:* 1. *mechanism:* two OpenAI-only decisions with computable optima — (1)
`prompt_cache_retention:"24h"` costs NOTHING extra, so for any reuse beyond the ~5–10-min default it
weakly dominates (gpt-5.5+ is 24h-only anyway); (2) Flex is the only synchronous 50% lane a sequential
loop can use, and batch-caching is GPT-5-family-only (pre-GPT-5 should use Flex). Emits the
deterministic retention+tier choice per (family, sync-requirement, reuse-horizon), null on unknown.
*feasibility:* model→family/provider + caller sync/deferrable flags + logged idle/turn cadence;
`planRetentionAndTier({model, syncRequired, reuseHorizonMin, deferrableDeadlineMin})` → MCP planner +
advisory, OpenAI-gated; falsifier — GPT-5 + sync + reuse-beyond-window ⇒ {24h, flex}; gpt-5.5 ⇒ 24h
forced; Anthropic ⇒ no-op. *evidence_anchor:* Part A′ §2/§3 retention-free + Flex + batch-cache
eligibility **`[S]` — FIRST milestone: primary-verify the Flex multiplier & GPT-5-only batch-cache**.
*novelty:* vs batch-router (predates verified Flex/24h-retention/GPT-5-only batch-cache) &
prefix-warm/ttl-amortization (Anthropic-TTL-shaped, no OpenAI free-retention notion) — the OpenAI-
specific, model-family-conditional decision tree. **Absorbs M18-2 (retention dominance) as its
retention leg; L5-12 supplies the deadline/preemption risk math.** *decision:* decision tree over
declared flags + family; non-OpenAI/unknown ⇒ no-op. *equivalence:* n/a (billing-parameter selection).
*cost_model:* tier saving CONTINGENT until Flex multiplier primary-verified; retention saving = avoided
cold rebuild when reuse lands in 24h but outside the default window; null on unpriced; NET of
preemption/deadline risk. *constraints:* all ✓. *effort_risk:* M — `[S]` eligibility drift; dollar
claims stay contingent until the primary fetch clears.

**L5-27 · openai-272k-repricing-cap-planner** *(GUARD)* — *lever:* fresh_input + output (prevents the
>272K whole-request 2×/1.5× repricing). *tier:* 1. *mechanism:* an OpenAI cliff with no Anthropic
analogue — input >272K reprices the WHOLE request at 2× input / 1.5× output (GPT-5.4/5.5 era), across
standard/batch/flex. The repo's only long-context handling (context-health f6) models fullness vs the
WINDOW, not a billing-multiplier threshold. Computes the marginal cost of the next op that would cross
272K and advises capping/splitting (routing the reduction to program-slice/squeezer's gated
reducers) when the cliff penalty exceeds the reduction cost. *feasibility:* current input count (f6
ECF / `usage.input_tokens`) + `detectProvider`; threshold/multipliers are config gated behind the
verify milestone; `assessLongContextRepricing(inputTokens, model, …)` → advisory `long-context-cap.
mjs`; falsifier — 271k GPT-5 ⇒ warn cliff; 280k ⇒ realized penalty; Anthropic @280k ⇒ no fire (1M
standard). *evidence_anchor:* Part A′ §2 >272K premium + §3 OpenAI-cap row **`[S]` + Part W′ — FIRST
milestone is mandatory primary verification**. *novelty:* vs context-health f6 (window fullness, not a
$-cliff at a count below the window) — OpenAI-only billing-multiplier threshold. *decision:* threshold
comparison + arithmetic + provider gate; non-OpenAI ⇒ no-op. *equivalence:* routes reduction to
program-slice (sound) / squeezer (AST) gates — never lossy truncation. *cost_model:* cliff penalty
formula; USD "contingent — multiplier unverified" until primary-verified (the CH-014 pattern); null on
unpriced. *constraints:* all ✓. *effort_risk:* M — advisory-only until the primary fetch clears;
ships the token-proximity warning meanwhile.

> *Dropped at self-verify:* `inference_geo` 1.1× guard (duplicate-adjacent to billing-tier-drift's
> per-token-rate-multiplier class, no distinct decision signal beyond a config flag); Fast-Mode 2×
> guard (priced premium is `[P]` but its actuation overlaps billing-tier-drift's flip detection; the
> "re-bills whole context" sub-claim is `[U]`/Part W′).

---

## Part 4 — Shipped-Code Finding (actionable now, independent of any new feature)

**`packages/cache-habits/src/cache-econ.ts:128-134` — `minCacheablePrefix` is wrong for current Opus.**
It maps `opus → 4096`, but the fetch-verified June-2026 table (Part A′ §1, `[P]`,
platform.claude.com 2026-06-12) sets Opus 4.8's minimum cacheable prefix to **1,024** (only Opus
4.6/4.5 are 4,096). The function is family-keyed and cannot distinguish Opus generations, so CH-002
(`system_prompt_too_small`) and CH-003/CH-012 currently misfire on Opus 4.8 — flagging cacheable
prefixes as "too small" and steering users away from a cache that would have worked. This is the core
of **L5-01**; it can also be fixed as a standalone one-file correction (per-model table keyed by exact
model id with a documented family fallback) ahead of the broader feature. Not auto-applied here — the
List5 catalog is the deliverable — but flagged for a focused follow-up.

---

## Part 5 — Run Accounting

- **Instrument:** `docs/RESEARCH-META-PROMPTS-V3.md` generators M14–M20, executed 2026-06-12.
- **Protocol:** Round-1 independent (P1), 7 persona-generators, forbidden-themes = Part B + B′
  (shipped f1–f22, value levers F1–F21, cost-security suite, the frozen lists), grep against
  `packages/`+`apps/` per generator, then orchestrator M9v3 gate + dedup + recurrence-rank + re-grep.
- **Yield:** 31 surviving proposals (+1 needs-host-signal HS-1), 4 new packages, 1
  outcome-bench extension, 1 shipped-code bug. Recorded saturated/dropped: M14 ×2, M15 ×1 (+1
  honestly-absent class), M17 ×3 cannot-ablate, M18 ×2, M20 ×2.
- **Recurrence (P5, ranking only):** OpenAI tier/retention ×3 (top), then five ×2 clusters — all
  resolved by merge or complementary cross-reference (Part 1).
- **Honesty ledger:** every cost_model is null-on-unknown-model; every `[S]`-derived planner (L5-12,
  L5-26, L5-27) carries primary-verification as its first milestone; L5-18 targets the Part W′ open
  speculative-waste gap (novel — no published ablation); L5-20 and L5-02 are themselves the
  enforcement of M9v3 §E and §F.
- **Single-model-ensemble caveat (v3 Part 0):** these 7 generators ran on one model family;
  recurrence ranked candidates, it did not prove novelty/value — every survivor still requires the
  outcome-bench / repo-proof empirical gate before promotion past `shadow`.

# Research Meta-Prompt Library v3 — Token/Cost-Saving Feature Discovery

> The evidence-grounded successor to `docs/RESEARCH-META-PROMPTS-V2.md`. **v3 SUPPLEMENTS
> v2 — it does not replace it.** The v2 Run Protocol (Part P), Constraints (Part C), Output
> Schema (Part D), Rubric (Part E), and generators M1v2–M13 remain in force. v3 adds:
> (1) a re-verified June-2026 rate sheet that RESOLVES two v2 `RE-VERIFY` flags,
> (2) seven NEW generators (M14–M20) built on discovery methodologies that did not exist in
> the v1/v2 technique set, and (3) a hardened evaluator amendment (M9v3).
>
> Produced by an executed deep-research pass (2026-06-12): 5 parallel research agents
> (Anthropic billing primary-docs, OpenAI billing, compression literature, agentic-workflow
> economics, discovery methodologies) + 2 independent adversarial verifiers over the 35
> load-bearing claims. **Verdict: 35/35 SUPPORTED** (25 literature attributions, 10 billing
> mechanics), with 2 precision refinements encoded below where they bite.

---

## Part 0 — Provenance & Honesty Bar

**How this version was produced.** Every claim below was surfaced by a research agent and
then attacked by a separate adversarial verifier (SUPPORTED / REFUTED+correction /
UNVERIFIABLE). Unlike the v2 pass, **platform.claude.com WAS directly fetchable this run**
(2026-06-12), so every Anthropic billing row marked `verified-primary` means *fetched from
the live official page*, not snippet-corroborated. OpenAI domains still 403'd; OpenAI rows
rest on ≥2 independent corroborations incl. fetchable mirrors (Azure docs, GitHub issues
quoting the docs) — labelled `verified-secondary`.

**Two v2 flags RESOLVED this run:**

1. v2's `RE-VERIFY-AT-RUN-TIME` on the Anthropic minimum-cacheable prefix is resolved: it is
   **per-model, 512–4,096 tokens** (full table in Part A′ §1) — never a flat constant.
2. v2's "mode-switch re-billing" advisory is **partially confirmed**: Fast Mode premium
   pricing + separate rate limits are verified-primary; the "re-bills the whole accumulated
   context on switch" sub-claim remains UNVERIFIED and stays in Part W′.

**Precision refinements carried from verification (encode, don't round off):**

- ACON's own abstract says it "**largely preserves** task performance" (improvement holds
  only for smaller distilled agents) — do not quote it as uniformly improving success.
- The "~99% of agent tokens are input tokens" figure is an **OpenRouter platform-level
  observation** cited by AgentDiet as motivation, not a benchmark measurement.

**Honesty discipline (unchanged from v1/v2/`CLAUDE.md`).** Deterministic decision core — no
model call, no regex classification; never fabricate a token/cost number (unknown model ⇒
`null`); fail-safe; equivalence/quality-gated transforms; PII-safe telemetry. Part E of v2
remains the gate; M9v3 (below) enforces it with one new attack.

---

## How v3 composes with v2

```
deep-research refresh → Part A′ (this file) + v2 Part F   (rates drift; re-verify)
  ROUND 1 (independent, P1): M1v2, M10, M7v2  +  M16, M20          (spanning + evidence-anchored)
  ROUND 2 (P3 forbidden-themes fed): M4v2, M12 +  M14, M15, M17    (trace- and taxonomy-driven)
  ROUND 3 (targeted):              M6v2, M8v2 +  M18, M19          (theory levers)
  → M9v3 gates EVERYTHING → debate gate (new, §M9v3-D) → dedup → recurrence-rank → top-N
```

Persona rotation (v2 P4): the seven M14–M20 personas are all NEW vs the v2 roster,
satisfying the ~50% turnover rule for any mixed run.

| Goal | Use |
|------|-----|
| Mine logged traces for provably skippable spend | **M14** |
| Sweep published failure taxonomies for missing detectors | **M15** |
| Measure remaining headroom against a theoretical bound | **M16** |
| Rank context categories by measured causal utility | **M17** |
| Derive worst-case-optimal rent-or-buy policies (TTL/tier/deferral) | **M18** |
| Price contention for scarce resources (context, cache, turns) | **M19** |
| Turn provider-mechanics CHANGES into features mechanically | **M20** |
| Gate any candidate (now with debate + oversight-budget) | **M9v3** |

---

## Part A′ — June-2026 Verified Rate Sheet (updates v2 Part A / F.1)

Injected as `{{RATE_SHEET_V3}}`. Confidence labels: **[P]** = verified-primary (fetched
official page 2026-06-12) · **[S]** = verified-secondary (≥2 independent corroborations,
primary unfetchable) · **[U]** = unverified, advisory only (also listed in Part W′).

### §1 Anthropic (all [P] unless marked)

- **Cache economics:** read `0.1×` input; write `1.25×` (5-min TTL) / `2.0×` (1-hour TTL);
  refresh-on-hit at no charge. Batch (50% off input+output) **stacks multiplicatively**:
  cached read in batch = `0.05×` input. Discounts also stack with the `inference_geo` 1.1×
  multiplier.
- **Minimum cacheable prefix is PER-MODEL:** 512 (Fable 5, Mythos 5) · 1,024 (Opus 4.8,
  Sonnet 4.6/4.5, Opus 4.1/4, Sonnet 4; also Fable 5/Mythos 5 **on Bedrock**) · 2,048
  (Opus 4.7, Mythos Preview, Haiku 3.5) · 4,096 (Opus 4.6, Opus 4.5, Haiku 4.5). Shorter
  prefixes silently don't cache (`cache_creation_input_tokens: 0`, no error).
- **Breakpoint mechanics:** max 4 `cache_control` breakpoints; cache lookup checks **at most
  20 positions** back from each breakpoint — agentic turns appending >20 content blocks
  silently miss. Invalidation is hierarchical `tools → system → messages`: a tool-def change
  busts everything; `tool_choice`/image/thinking-param changes bust system+messages but
  PRESERVE the tools cache.
- **Context editing** (`context-management-2025-06-27`): `clear_tool_uses_20250919`
  (default trigger 100K input tokens, keep 3 tool pairs; `exclude_tools`,
  `clear_tool_inputs`) and `clear_thinking_20251015` (must be FIRST in the edits array;
  clearing thinking invalidates cache at the clearing point, keeping it preserves cache).
  **`count_tokens` accepts `context_management` and previews `cleared_input_tokens` for
  free** — a zero-spend what-if oracle.
- **Server-side compaction** (`compact-2026-01-12`; Fable 5, Mythos 5/Preview, Opus
  4.8/4.7/4.6, Sonnet 4.6): default trigger 150K (min 50K); summary billed as OUTPUT and
  reported ONLY in `usage.iterations` (type `"compaction"`) — **top-level
  `input_tokens`/`output_tokens` EXCLUDE compaction iterations**; any honest cost model must
  sum `usage.iterations`.
- **Effort + thinking:** `output_config.effort` is GA (`low`/`medium`/`high`/`xhigh`/`max`;
  default `high`; throttles ALL response tokens incl. tool calls). Adaptive thinking replaces
  `budget_tokens` (deprecated Opus/Sonnet 4.6; HTTP 400 on Opus 4.7+). Thinking is billed at
  FULL generated tokens regardless of display — `display:"omitted"` cuts latency, never cost.
- **Tool-use overheads (per-request system-prompt tokens):** Opus 4.8: 290 (`auto`/`none`) /
  410 (`any`/`tool`); Opus 4.7: 675/804; Opus 4.6 & Sonnet 4.6: 497/589; Opus 4.5, Sonnet
  4.5, Haiku 4.5: 496/588. Anthropic-defined tools add: bash 245, text-editor 700,
  computer-use 735 (+466–499 system). The `token-efficient-tools-2025-02-19` and
  `output-128k-2025-02-19` beta headers are **no-ops on Claude 4+** — remove them.
- **Per-call fees:** web search $10/1k calls (errors free); web fetch free beyond tokens
  (cap with `max_content_tokens`); code execution free with `web_search_20260209`/
  `web_fetch_20260209`, else $0.05/container-hour after 1,550 free org-hours/month, 5-min
  minimum — **file preloads bill container time even if the tool never runs**.
- **Rate-limit asymmetry:** `cache_read_input_tokens` do NOT count toward ITPM for most
  models (exception: Haiku 3.5) — cache hits buy rate-limit headroom, not just dollars.
  `count_tokens` is **free** with independent RPM limits.
- **Tiers/modes:** `service_tier: "auto"|"standard_only"`; response `usage.service_tier`
  reports assignment; Priority is committed capacity (burndown weights: cache read 0.1×,
  5-min write 1.25×, 1-h write 2.0×, `inference_geo:"us"` 1.1×). Fast Mode (research
  preview, `speed:"fast"`): Opus 4.8 at 2× standard ($10/$50), Opus 4.6/4.7 at $30/$150;
  separate `anthropic-fast-*` limits; incompatible with Batch.
- **Models (per MTok in/out):** Fable 5 & Mythos 5 $10/$50 (1M ctx, 128K out) · Opus
  4.8/4.7/4.6/4.5 $5/$25 · Sonnet 4.6/4.5 $3/$15 · Haiku 4.5 $1/$5. **No long-context
  premium** — 1M-ctx models include it at standard pricing. **Tokenizer regression:** Opus
  4.7+ tokenizes the SAME text into ~30–35% more tokens than pre-4.7 models — cross-model
  $/task comparisons must re-tokenize, never reuse counts.
- Batch-incompatible params: `stream`, `speed`, `store`, `previous_thread_event_id`,
  `cache_hint`, `context_hint`, `max_tokens: 0` (the documented cache-prewarm pattern),
  `research_preview_2026_02`.
- Mid-conversation `role:"system"` injection (`mid-conversation-system-2026-04-07`)
  preserves the cached prefix vs editing top-level `system` — **[U]** header string
  unverified; feature page existence only.

### §2 OpenAI (all [S] unless marked)

- **Caching:** automatic, exact-prefix, ≥1,024 tokens, 128-token increments; routing by hash
  of ~first 256 tokens + optional `prompt_cache_key`. Discount is **model-dependent: ~50%
  (GPT-4o class) vs 90% (GPT-5 family)** — e.g. gpt-5.1 $1.25 → $0.125 cached.
  **`prompt_cache_retention: "24h"` costs NOTHING extra** (KV offload to GPU-local storage);
  on gpt-5.5/gpt-5.5-pro and later, `24h` is the only/default mode.
- **Batch:** 50% off, 24-h window, 50K requests/file, incl. embeddings. **Caching inside
  Batch: GPT-5 family ONLY** (stacked ≈75% off cached input, e.g. gpt-5.4 $2.50 → $0.625);
  pre-GPT-5 models get NO cache hits in batch — the cookbook's own advice: use **Flex**.
- **Flex** (`service_tier:"flex"`): ~50% off with SYNCHRONOUS semantics, preemptible
  (uncharged 429s); GPT-5-family eligible — the only 50% tier a sequential agent loop can
  actually use. **Priority**: ≈2× premium [U on exact multiplier].
- **Reasoning:** `reasoning_effort` on gpt-5.1: `none` (DEFAULT) / `low` / `medium` /
  `high`; `xhigh` on gpt-5.1-codex-max. Reasoning tokens billed as output, reported in
  `usage.output_tokens_details.reasoning_tokens`. Encrypted reasoning items
  (`store:false` + `include:["reasoning.encrypted_content"]`) enable stateless reasoning
  reuse; passing reasoning items back raised cache utilization 40%→80% in OpenAI's own
  cookbook test.
- **Responses API:** `previous_response_id` does NOT reduce billing — the full chain
  re-bills as input each turn; caching is the only mitigation.
- **Predicted Outputs:** rejected prediction tokens billed at OUTPUT rate
  (`rejected_prediction_tokens`); gpt-4o/4.1 families ONLY (not GPT-5) — a latency feature
  that can RAISE cost; net-positive only at high acceptance ratios.
- **Long-context premium [S, weakest billing row — re-verify before hard-coding]:** input
  >272K tokens bills the WHOLE request at 2× input / 1.5× output (GPT-5.4/5.5 era), across
  standard/batch/flex.
- **Free/cheap infrastructure:** Moderation endpoint FREE; text-embedding-3-small
  $0.02/MTok ($0.01 batch) — the cost floor for any client-side semantic cache/router.
  Usage API (1-min granularity) + Costs API (`/v1/organization/costs`, daily buckets).
- Tool/function definitions bill as input tokens after conversion to an internal format —
  raw JSON size ≠ billed tokens; only `usage` is authoritative. Structured-output schema
  preprocessing adds first-call latency, not billed tokens.

### §3 Cross-provider asymmetries (each one is a STANDING FEATURE PROMPT — see M20)

| Mechanic | Anthropic | OpenAI | Discovery pressure |
|---|---|---|---|
| Cache control | explicit breakpoints, 2 TTLs | automatic, retention param | breakpoint planners are Anthropic-only features; retention choice is OpenAI-only |
| Batch × cache | stacks for all models (0.05×) | GPT-5 family only | batch-routing decisions are provider- AND model-conditional |
| Sync discount tier | none (Batch is async) | Flex (~50%, sync) | agent loops: deferral logic differs per provider |
| Free what-if oracle | `count_tokens` (+ context-mgmt preview) | none documented | zero-spend replay/preview features lean Anthropic |
| Server compaction | billed in `usage.iterations` | codex-max native compaction | hidden-billing audit features |
| Rate-limit cache credit | cache reads exempt from ITPM | n/a documented | cache-hit value > dollar value on Anthropic |
| Premium speed | Fast Mode 2× | Priority ≈2× | tier-drift detectors need per-provider price tables |
| Long-context premium | none (1M standard) | >272K: 2×/1.5× whole request | context-cap enforcement is an OpenAI-side $ lever |

---

## Part B′ — Forbidden-Themes Additions (append to v2 Part B for `{{FORBIDDEN_THEMES}}`)

Shipped since the v2 prior-art map froze: **f20** repo-proof (evidence-gated flag
promotion), **f21** knowledge compiler, **f22** proof-carrying asset store (`memory_*`
tools), the **tool-call-coalescing** hook (L4-27), the **billing-tier-drift** hook (L4-35),
and the full MCP exposure of the value levers (`apps/mcp-server/src/value-tools.ts`).
Duplication is still checked against CODE (`packages/`, `apps/`), not lists.

---

## Part W′ — Weak-Evidence Flags (do NOT encode as method; carry forward v2 Part W)

- OpenAI >272K long-context multipliers (2×/1.5×): survived adversarial attack via ≥4
  concordant secondary sources, but NO primary fetch — re-verify before any `pricing.ts` row.
- "Mode/tier switch re-bills the whole accumulated context": still UNVERIFIED (the priced
  premium part IS verified).
- GitHub MCP server ≈42–55K tokens of tool definitions; Claude Code sessions starting
  20–30K tokens deep: consistent practitioner reports, none fetch-verified.
- gpt-5.2 / gpt-5.4 individual prices: UNVERIFIED.
- ACE's "~86.9% lower adaptation latency": circulated, unfetched.
- **Published GAP (an opportunity, not a flag):** no ablation quantifying wasted-token
  overhead of SPECULATIVE (vs planned-parallel) tool execution exists — f13's cost model is
  ahead of the literature; M14 runs target it.

---

## Part G′ — The New Meta-Prompts (verbatim)

Slot tokens: `{{V2_PREAMBLE}}`, `{{COST_EQUATION}}`, `{{PRIOR_ART}}`, `{{CONSTRAINTS}}`,
`{{OUTPUT_SCHEMA}}`, `{{SELF_VERIFY}}`, `{{FORBIDDEN_THEMES}}` as defined in v2;
`{{RATE_SHEET_V3}}` = Part A′ of this file. Every generator below carries the v2 preamble
(independence, forbidden themes, search plan, format-only schema).

### M14 — Hindsight-Optimal Regret Decomposition  *(NEW — counterfactual trace replay)*

Evidence base: causal responsibility scoring over agent traces (CausalFlow, arXiv
2605.25338; Counterfactual Trace Auditing, arXiv 2605.11946), the three-class waste
typology — useless / redundant / expired (AgentDiet, arXiv 2509.23586), zero-spend
trace-driven policy simulation (Vidur, arXiv 2405.05465, MLSys 2024 — optimal configs for
~$10 of CPU vs ~$218K of live exploration), and observation-masking halving cost at equal
solve rate (The Complexity Trap, arXiv 2508.21433). All verified 2026-06-12.

```
{{V2_PREAMBLE}}

PERSONA (P2): You are a CAUSAL-INFERENCE researcher who audits logged agent traces. Your
knowledge partition: counterfactual replay and per-step attribution — NOT billing mechanics,
NOT the literature beyond the five papers named in your evidence base.

GROUNDING (authoritative; do not contradict)
- Cost model: {{COST_EQUATION}}   - Rates: {{RATE_SHEET_V3}}
- Prior art: {{PRIOR_ART}}        - Constraints: {{CONSTRAINTS}}
- Trace substrate that EXISTS in this repo: replay-vault (tamper-evident logs, pinned
  canonicalization), replay-cost (f11, what-if re-serve vs re-run), outcome-bench (paired
  A/B, zero-spend dry-run), host-adapters (typed session data).

DISCOVERY STRATEGY — hindsight-optimal regret decomposition
Define, for a COMPLETED logged session, the hindsight-optimal policy: the cheapest
step-subset + parameter assignment (model tier, effort, masking, cache plan) that provably
reaches the same final outcome under an equivalence gate. The session's REGRET is
(actual_cost − hindsight_cost). Then:
  1. Decompose regret into NAMED terms, each tied to one cost-equation term and one of the
     three waste classes (useless / redundant / expired) — plus a fourth class you must
     treat separately: SPECULATIVE waste (work that was a bet; the literature has NO
     published ablation here — Part W′ — so any finding is novel).
  2. For each regret term: propose the DETERMINISTIC detector that identifies it at replay
     time from caller-supplied counts only (no model call), and the feature that would have
     avoided it (advisor, breaker, or plan transform).
  3. For each proposed feature: state how the EXISTING replay substrate measures its
     counterfactual saving with ZERO new API spend (the Vidur property), and the suffix-
     invariance check that proves the outcome unchanged (the CausalFlow property).
  4. Reject any term whose "saving" reappears in another regret term (waterbed).

REASONING SCAFFOLD
- A step is skippable only if outcome-invariance is PROVABLE (content-SHA, equivalence
  gate), never plausible. "The model probably didn't need it" is not evidence.
- Regret terms must be measurable per-session and aggregable per-repo; a term you cannot
  compute from logged usage fields does not exist.
- Mind the AgentDiet refinement: the 99%-input-token figure is platform-level motivation,
  not a per-session invariant — compute the actual ratio from the trace.

OUTPUT — {{OUTPUT_SCHEMA}} (feasibility_check BEFORE novelty). Nothing else.
SELF-VERIFICATION — {{SELF_VERIFY}}
STOP — when a regret term yields only duplicates of prior art, mark it saturated and move
on. 3 strong terms beat an exhaustive weak taxonomy.
```

### M15 — Failure-Taxonomy Detector Sweep  *(NEW — external taxonomy as forcing structure)*

Evidence base: failure-aware waste observability and its failure-mode classes (arXiv
2606.01365), runtime supervision cutting tokens −29.7% at equal success (Stop Wasting Your
Tokens, arXiv 2510.26585), token-spiral characterization across 7 frameworks (Agents of
Chaos, arXiv 2602.20021), and the Tokenomics category measurements (arXiv 2601.14470).
Delta vs M4v2 (waste-trace mining): M4v2 mines OUR traces bottom-up; M15 walks PUBLISHED
failure taxonomies top-down and finds the classes we have NO detector for.

```
{{V2_PREAMBLE}}

PERSONA (P2): You are a RELIABILITY ENGINEER (SRE) who treats wasted spend as an incident
class. Your knowledge partition: published agent-failure taxonomies and this repo's hook
inventory — NOT billing rates, NOT compression literature.

GROUNDING
- Constraints: {{CONSTRAINTS}}   - Prior art: {{PRIOR_ART}}
- The repo's EXISTING detector inventory (do not re-propose): loop-breaker (identical-action
  result-SHA), thrash-detector, navigation-ratio, tool-error-rate, edit-amplification,
  fanout-acceleration, injection-cost, cost-guard, preturn-forecast, tool-call-coalescing,
  billing-tier-drift, subagent-warden, slo-breaker.

DISCOVERY STRATEGY — taxonomy × detector coverage matrix
  1. Enumerate VERBATIM the failure classes from the four published taxonomies in your
     evidence base (orchestration loops, step repetition, no-final termination, evidence
     failure, circular exchanges, token spirals, category-level sinks, ...). One row each.
  2. For each row, fill three columns: (a) which existing hook (if any) already detects it —
     name the exact hook; (b) the deterministic signal in a Claude Code hook payload (or a
     documented usage field from {{RATE_SHEET_V3}}) that COULD detect it; (c) the token
     cost per incident, computable from caller-supplied counts.
  3. Every row with (a) empty and (b) non-empty is a candidate feature. Rows with (b) empty
     are "needs host signal: X" — emit them too, labelled, per the schema.
  4. For each candidate: specify detector predicate, fail-open behavior, and the adversarial
     test (the malformed/DoS input that must NOT make it hang or false-positive).

REASONING SCAFFOLD
- The taxonomy is the coverage guarantee: you are not brainstorming, you are filling a
  matrix. Do not skip rows because they seem unlikely in this repo — say WHY instead.
- A detector that needs a model call to classify is a violation; find the deterministic
  shadow of the failure class (counts, SHAs, ratios, monotone growth) or mark it absent.

OUTPUT — {{OUTPUT_SCHEMA}}. Include the full matrix as an appendix table.
SELF-VERIFICATION — {{SELF_VERIFY}}
STOP — the matrix is finite; complete it, then stop. No invented taxonomy rows.
```

### M16 — Bound-Gap Prospecting  *(NEW — distance-to-theoretical-optimum as the search signal)*

Evidence base: rate-distortion limits of black-box prompt compression — current compressors
sit FAR from the optimum and query-awareness is critical (Nagle et al., NeurIPS 2024, arXiv
2407.15504); per-question token complexity — sharp minimal-token thresholds, prompt-based
strategies far from the frontier (arXiv 2503.01141); TALE token budgets (−68.9% tokens,
<5% accuracy loss, arXiv 2412.18547); Chain-of-Draft (~80% fewer output tokens at near-CoT
accuracy on GSM8K, arXiv 2502.18600). All verified.

```
{{V2_PREAMBLE}}

PERSONA (P2): You are an INFORMATION THEORIST. Your knowledge partition: rate-distortion,
sufficiency, and minimal-description arguments — NOT provider billing, NOT the hook system.

GROUNDING
- Cost model: {{COST_EQUATION}}   - Constraints: {{CONSTRAINTS}}   - Prior art: {{PRIOR_ART}}
- Repo compressors/selectors that define the CURRENT operating point: squeezer (3 tiers),
  repo-map (signatures+PageRank), program-slice (f17, sound closure), response-tuner
  (result pruning + max_tokens calibration), context-analyzer, prune-intelligence DAG.

DISCOVERY STRATEGY — measure the gap to the bound, then decompose it
For each task family the repo serves (debug, edit, generate, explain, review):
  1. Define the empirical bound-estimation procedure: sweep context/output budgets over a
     fixed task set (outcome-bench's paired, oracle-graded harness), fit the distortion-rate
     curve, and locate the repo's current compressors ON that curve. The procedure must be
     runnable as a deterministic bench — specify inputs, sweep grid, and oracle.
  2. The GAP between current operating point and the empirical frontier is the prize. For
     each task family with a material gap, ask WHICH structural property of the frontier
     the current method lacks: query-awareness (the NeurIPS-verified critical factor)?
     per-task budget adaptation (the token-complexity threshold result)? output-side
     economy (the CoD result — output tokens cost 5× input)?
  3. Each lacking property → one candidate feature with a deterministic decision core.
     Input-side and output-side gaps are SEPARATE candidates; never blend them.
  4. State for each candidate the falsifiable bench result that would kill it: "if the
     frontier point at distortion ≤ m is not ≥ X% cheaper than current, reject."

REASONING SCAFFOLD
- You are forbidden from proposing the bound-estimation bench itself as the feature unless
  it ships as a deterministic, zero-spend (dry-run) harness extension — name the delta vs
  outcome-bench and qpd-bench if you do.
- Distortion must be an equivalence-gated or oracle-graded quantity, never "looks fine".
- A gap explained by a Part W′ unverified mechanic is not a gap; flag it instead.

OUTPUT — {{OUTPUT_SCHEMA}}.   SELF-VERIFICATION — {{SELF_VERIFY}}
STOP — one candidate per lacking structural property per task family, max. No padding.
```

### M17 — Attribution-Ablation Audit  *(NEW — measured causal utility per context category)*

Evidence base: ContextCite sparse-surrogate context attribution (arXiv 2409.00729, NeurIPS
2024), TracLLM long-context attribution (arXiv 2506.04202), TokenShapley (arXiv 2507.05261),
counterfactual skill auditing — assets that never influence behavior are context-cost-only
(arXiv 2605.11946), and context-editing's verified 84% token reduction in Anthropic's
100-turn eval (claude.com/blog/context-management). Delta vs context-utility (F1, shipped):
F1 learns per-atom utility from outcomes ONLINE; M17 designs OFFLINE ablation experiments
whose verdicts create/kill whole context CATEGORIES.

```
{{V2_PREAMBLE}}

PERSONA (P2): You are an INTERPRETABILITY researcher specializing in context attribution.
Your knowledge partition: ablation design and surrogate attribution — NOT billing, NOT
online learning (the shipped F1 owns that; your delta is experimental design).

GROUNDING
- Constraints: {{CONSTRAINTS}}   - Prior art: {{PRIOR_ART}} (note context-utility F1,
  tab-auditor, trajectory-diet — your output must name its delta vs each)
- Ablation substrate that EXISTS: outcome-bench (paired A/B, oracle-graded), replay-vault
  (deterministic re-execution contract), knowledge/f22 (assets with provenance), the free
  Anthropic count_tokens + context-management preview ({{RATE_SHEET_V3}} §1).

DISCOVERY STRATEGY — category-level ablation matrix with $-per-utility verdicts
  1. Enumerate every context CATEGORY this repo's surfaces inject or could suppress:
     system-prompt sections, CLAUDE.md blocks, MCP tool schemas (per server), open-tab
     contents, tool results by tool, skill/memory assets, repo-map sections, compaction
     summaries, advisor hook messages themselves (yes — Prune's own injections are a
     category; audit them like everything else).
  2. For each category: design the paired ablation (with vs without, same tasks, oracle
     grade), the attribution readout (outcome delta, not vibes), and the token mass it
     occupies (caller-supplied counts). Output a $-per-utility ranking procedure, not a
     guessed ranking.
  3. Categories whose measured attribution is ~0 across k tasks at material token mass are
     feature candidates: suppression, lazy-loading, or self-demotion (the f22 pattern:
     assets must EARN their context cost or demote). Specify the deterministic decision
     rule and its reversibility guarantee.
  4. Required honesty: the experiment plan must state sample sizes and the non-inferiority
     margin (v2 Part E statistics) — an ablation without a margin is unfalsifiable.

REASONING SCAFFOLD
- Attribution mass ≈ 0 is only actionable when the ablation held the task distribution
  fixed; name the task families the verdict covers and mark all others "untested".
- Self-audit is mandatory: if Prune's advisor messages fail their own ablation, the
  finding ships (reflexive-overhead discipline, f19).

OUTPUT — {{OUTPUT_SCHEMA}}.   SELF-VERIFICATION — {{SELF_VERIFY}}
STOP — every category gets a designed experiment or an explicit "cannot ablate because X".
```

### M18 — Rent-or-Buy Frontier  *(NEW — competitive analysis of every irreversible spend decision)*

Evidence base: ski-rental/elastic caching theory (Linear Elastic Caching via Ski Rental,
CIDR 2025; ML-advised ski rental, TCS 2022), non-clairvoyant KV/deadline scheduling for
LLM serving (arXiv 2601.22996), and the verified price ratios that instantiate the problem:
Anthropic 1.25×/2.0× write vs 0.1× read with refresh-on-hit; OpenAI free 24h retention;
Batch 24h windows; Flex preemption ({{RATE_SHEET_V3}}). Delta vs prefix-warm/churn-pin
(shipped): those implement SPECIFIC policies; M18 derives worst-case-optimal policies with
competitive ratios for EVERY rent-or-buy decision point, including ones with no feature yet.

```
{{V2_PREAMBLE}}

PERSONA (P2): You are an ONLINE-ALGORITHMS theorist. Your knowledge partition: competitive
analysis, ski-rental, paging, deadline scheduling — NOT the editor, NOT the literature
outside algorithms. You think in adversarial futures and competitive ratios.

GROUNDING
- Rates: {{RATE_SHEET_V3}} (the price ratios ARE the problem instances)
- Constraints: {{CONSTRAINTS}}   - Prior art: {{PRIOR_ART}} (name deltas vs prefix-warm,
  churn-pin, batch_route, the agent-sdk-adapter cache/TTL planners — they shipped policies;
  you ship BOUNDS and the decisions they change)

DISCOVERY STRATEGY — enumerate the rent-or-buy decision points, derive the breakeven
  1. List every decision under future uncertainty where the repo (or a host agent) commits
     spend now to avoid spend later, or vice versa. Minimum set to cover: 5-min vs 1-h
     cache write; re-warm an expiring prefix vs let it die; OpenAI in_memory vs 24h
     retention (free — when is it ever wrong?); defer to Batch (24h deadline risk) vs Flex
     (preemption risk) vs sync; pin vs evict under the 4-breakpoint / 20-position lookback
     limits; compact now (pay output tokens) vs later (risk cache bust); keep thinking
     blocks (cache preserved) vs clear (tokens freed, cache split at the clearing point).
  2. For each: write the ski-rental (or paging/scheduling) reduction — cost of renting, cost
     of buying, the unknown (next-reuse time, preemption, deadline) — and derive the
     deterministic breakeven condition IN THE VERIFIED RATIOS (e.g. 1-h write amortizes at
     ≥2 reads; recompute, don't quote).
  3. A candidate feature exists where (a) the current shipped policy violates the breakeven
     under plausible logged reuse distributions, or (b) NO policy exists for the decision
     point. State the competitive ratio of the proposed policy and what side information
     (churn signal, TTL telemetry) tightens it (the ML-advised variant).
  4. Every saving must survive the waterbed check: a write avoided is a read forfeited.

REASONING SCAFFOLD
- The adversary chooses the future; your policy must bound regret WITHOUT predicting. If a
  proposal needs a forecast to work, it is a different (weaker) class — label it.
- Reuse probabilities come from logged telemetry (replay-vault, session-store) — named
  fields only, never assumed constants.

OUTPUT — {{OUTPUT_SCHEMA}}.   SELF-VERIFICATION — {{SELF_VERIFY}}
STOP — decision points are finite; cover the listed minimum set, add at most 3 you found,
then stop.
```

### M19 — Externality Pricing Sweep  *(NEW — auction the scarce resources)*

Evidence base: token-level auctions for LLMs (Duetting et al., Google, arXiv 2310.10826,
WWW 2024), budget-constrained VCG "bid to speak" with strategic silence (arXiv 2511.13193),
and multi-agent token multipliers that make message externalities expensive (~15× chat,
Anthropic multi-agent post, verified). Delta vs clearing-price f18 / allowance-market F15:
those price ACTUATOR actions against one λ; M19 hunts UNPRICED contention points — above
all, content that enters context without ever bidding.

```
{{V2_PREAMBLE}}

PERSONA (P2): You are a MECHANISM-DESIGN economist. Your knowledge partition: auctions,
externalities, incentive compatibility — NOT compression, NOT hooks plumbing. You see every
context insertion as a transaction someone else pays for.

GROUNDING
- Constraints: {{CONSTRAINTS}}   - Prior art: {{PRIOR_ART}} (mandatory deltas vs f18
  clearing-price, F15 allowance-market, F16 futures-desk, F17 bounty — the priced economy
  that EXISTS; your job is what it does NOT yet price)
- Scarce resources in scope: context-window tokens, the 4 cache breakpoints, turn budget,
  rate-limit headroom (note {{RATE_SHEET_V3}}: cache reads are ITPM-exempt on Anthropic —
  headroom has a price distinct from dollars), subagent fan-out slots, compaction trigger
  headroom.

DISCOVERY STRATEGY — find the unpriced externalities, then design the minimal mechanism
  1. Inventory every PRODUCER that injects content into context or consumes a scarce slot
     WITHOUT bidding into the f18 price: tool results, MCP schemas, advisor/hook messages,
     skill/memory assets, compaction summaries, subagent reports, open tabs. For each:
     who pays (which future request re-bills it), and is that cost ever charged back?
  2. For each unpriced producer: design the smallest mechanism that internalizes the
     externality — a bid dimension, an aggregation/clearing rule, and the no-op default
     when the price quote is null (the f18 fail-safe). Strategic silence (the VCG result)
     is an allowed outcome: the mechanism may conclude "this producer should often say
     nothing."
  3. Check incentive properties deterministically: can a producer free-ride (consume
     context paid by others) under your rule? If yes, the mechanism is broken — fix or drop.
  4. Multi-agent: apply the 15× multiplier evidence — price subagent REPORTS (the tokens
     the orchestrator re-reads), not just subagent spawning.

REASONING SCAFFOLD
- A mechanism with a model call in clearing is a violation; bids and clearing are arithmetic
  on caller-supplied counts.
- Externality estimates must come from logged re-billing (how many future requests carried
  the inserted tokens) — replay-vault gives this exactly.

OUTPUT — {{OUTPUT_SCHEMA}}.   SELF-VERIFICATION — {{SELF_VERIFY}}
STOP — mechanisms are expensive to build; emit at most 4, ranked by unpriced token mass.
```

### M20 — Provider-Mechanics Diff Futures  *(NEW — mine the time-derivative of the rate sheet)*

Evidence base: this run's own verified deltas — mechanics that did not exist (or were not
verified) at the v2 freeze: effort param GA; server-side compaction billed in
`usage.iterations`; `inference_geo` 1.1×; Fast Mode 2×; per-model cache minimums 512–4,096;
20-position breakpoint lookback; free 24h retention (OpenAI); `reasoning_effort: none`
default; flex GA for GPT-5 family; >272K premium [S]; per-call tool fees; Opus 4.7+
tokenizer +30–35%. Delta vs M7v2 (provider arbitrage): M7v2 mines the CURRENT mechanics
snapshot; M20 mines the DIFF between snapshots and the cross-provider asymmetry table —
every new/changed/asymmetric mechanic is mechanically converted into feature candidates.

```
{{V2_PREAMBLE}}

PERSONA (P2): You are a PROVIDER-MECHANICS archaeologist. Your knowledge partition: the
rate-sheet DIFF and the asymmetry table ({{RATE_SHEET_V3}} §3) — what changed since the
last freeze and what exists on exactly one provider. NOT the literature, NOT traces.

GROUNDING
- Rates + diff source: {{RATE_SHEET_V3}} (its Part 0 lists what is NEW since v2)
- Constraints: {{CONSTRAINTS}}   - Prior art: {{PRIOR_ART}}

DISCOVERY STRATEGY — three mechanical conversions, applied to every diff row
For EACH new/changed mechanic and EACH asymmetry-table row, run all three conversions:
  A. GUARD conversion: does the change create a new way to silently overpay? (Examples to
     reason from, not copy: a model whose cache minimum rose to 4,096 silently stops
     caching short prefixes; compaction spend invisible to any consumer reading top-level
     usage; a >20-block turn silently missing its breakpoint; the >272K whole-request
     repricing.) Guard = deterministic detector + advisory, fail-open.
  B. PLANNER conversion: does the change create a new decision with a computable optimum?
     (New TTL/retention options, effort levels, tier choices, geo multipliers, batch-vs-flex
     eligibility by model family.) Planner = deterministic decision rule in verified ratios;
     null on unknown model.
  C. ACCOUNTING conversion: does the change break an existing cost model? (New usage
     fields, per-call fees alongside token fees, tokenizer drift +30–35% across model
     generations breaking cross-model comparisons, burndown weights ≠ billing weights.)
     Accounting = schema/cost-model extension keeping the null-on-unknown discipline.
  For every candidate: name the diff row it derives from (evidence_anchor is MANDATORY
  here — "first-principles" is not allowed in M20 output), and check {{FORBIDDEN_THEMES}}.

REASONING SCAFFOLD
- Mechanics marked [S] or [U] in the rate sheet produce candidates whose FIRST milestone is
  primary verification — encode that as the feature's gating step, never skip it.
- An asymmetry row is a candidate factory even with no diff: a mechanic on provider A with
  no analogue on B implies either a B-side feature gap or an A-only feature flagged
  provider-conditional.

OUTPUT — {{OUTPUT_SCHEMA}}.   SELF-VERIFICATION — {{SELF_VERIFY}}
STOP — the diff is finite. Convert every row or mark it "no conversion: why", then stop.
```

### M9v3 — Falsification / Red-Team  *(evaluator amendment — supersedes M9v2 §order, adds §D)*

Evidence base for the additions: persuasive debate raising judge accuracy 76% vs 48%
baseline (Khan et al., ICML 2024, arXiv 2402.06782); oversight-accuracy scaling with
judge-capability gap (arXiv 2504.18530); generator/critic architectures beating
self-reflection for non-derivative ideation (AI-Scientist survey lineage, arXiv 2505.13259).

Amendments to M9v2 (everything else in M9v2 stands):

```
§D — DEBATE GATE (new, after the feasibility attack, before the novelty attack):
For each surviving candidate, stage a structured exchange:
  ADVOCATE: states the saving with its evidence_anchor and cost_model.
  ADVERSARY: argues the strongest induced-cost case — waterbed re-incurrence, reflexive
    overhead (the f19 SLO), cache-invalidation side effects, rate-limit interactions, and
    the Part W′ flag list. The adversary MUST cite trace fields or rate-sheet rows; vibes
    are inadmissible for both sides.
  JUDGE: rules on the WRITTEN exchange only. Verdict: SURVIVES / REVISE (with the exact
    weakness) / REJECT.
Roles are three separate model contexts (independence, P1). Judge tier selection is a QpD
decision: use the cheapest tier whose verdicts agree with a stronger judge on a 10-case
calibration set (the oversight-scaling result) — and record the calibration, don't assume it.

§E — TOKENIZER-DRIFT ATTACK (new): any candidate whose cost_model compares token counts
across model generations fails unless it re-tokenizes (Opus 4.7+ ≈ +30–35% tokens for
identical text). Cross-model $/task claims using one tokenizer are REJECT.

§F — HIDDEN-BILLING ATTACK (new): any candidate reading only top-level input/output usage
fails if its target mechanic bills elsewhere (compaction in usage.iterations; per-call tool
fees; rejected_prediction_tokens). The cost model must name every usage field it sums.
```

---

## Part F′ — Verification Ledger (this run, 2026-06-12)

35/35 load-bearing claims SUPPORTED by independent adversarial verification.

| Cluster | Claims | Verdict | Notes |
|---|---|---|---|
| Anthropic billing (10 sub-claims incl. batch×cache stacking, cache ratios, free count_tokens, context-editing defaults, ITPM cache exemption) | 10 | SUPPORTED, **verified-primary** (live platform.claude.com fetches) | resolves v2's 403 caveat for Anthropic rows |
| OpenAI billing (24h retention free; 50%-vs-90% cache discount; effort `none` default; flex; batch×cache model-conditional; predicted-output billing; previous_response_id re-billing; free moderation; embedding floor) | 9 | SUPPORTED, verified-secondary | gpt-5.5+ is 24h-only (refinement); >272K premium survived but stays [S] |
| Literature attributions (Complexity Trap, ACON, TALE, CoD, RouteLLM, rate-distortion, ContextCite, AgentDiet, LLM mechanism design, VCG speak-bidding, Vidur, token complexity, AWM, context-folding, GPT semantic cache, debate, AI Agents That Matter, HAL, 3× Anthropic posts, Manus, Mullen 1991, Hivemind, NOVA) | 25 | SUPPORTED | 2 precision refinements (ACON wording; 99%-input provenance) encoded in Part 0 |

Full verdicts with URLs live in the session research record; re-verify [S]/[U] rows before
hard-coding any number into a package (Working Agreement 5 / CLAUDE.md honesty bar).

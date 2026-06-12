# Research Meta-Prompt Library v3 — Provider-Mechanics-First Discovery (Claude + OpenAI APIs)

> The successor to `RESEARCH-META-PROMPTS-V2.md` for **provider-API-anchored** discovery runs.
> v1 (frozen) produced List1–List3; v2 upgraded the funnel with ideation-science findings.
> v3's identity: **every generator is anchored to a VERIFIED billing-mechanics fact table**
> (Part A3) and every candidate must cite the fact-table rows it depends on. The discovery
> surface is the providers' own billing machinery — the place where a deterministic,
> local-first governor has structural advantage.
>
> v2 remains valid for mechanism-agnostic runs. Use v3 when the question is "what does the
> CURRENT Claude/OpenAI API surface make possible that we haven't built?"

---

## Part 0 — Provenance & Honesty Bar

**How this version was produced (2026-06-12).** A deep-research pass: 5 parallel research
agents (Anthropic billing — live primary fetches of platform.claude.com succeeded; OpenAI
billing — all OpenAI domains returned HTTP 403, claims are official-domain snippets
corroborated by ≥1 independent secondary source; efficiency literature; practitioner field
evidence; ideation methodology). Two independent adversarial verifier agents were launched
and **truncated by session quota limits before returning verdicts** — verification is
therefore graded per-row, not blanket:

- **Grade A** — primary doc fetched live on 2026-06-12 (directly, in the main verification
  pass): the caching multiplier/minimum-prefix/breakpoint/isolation rows, the compaction
  billing rows, the context-editing + count_tokens rows, and the OpenAI
  90%-cache / 1,024-minimum / 24h-retention / previous_response_id rows.
- **Grade B** — official-domain snippet + ≥1 independent secondary source.
- **Grade C** — secondary only, or arXiv-snippet only (all literature rows are C: arXiv
  returned 403 to direct fetch; numbers come from abstract text in search results).

**Standing rules (binding on every run):**
1. **RE-VERIFY-AT-RUN-TIME.** Rates and betas drift. Before a discovery run, re-fetch the
   sources of every Part-A row; before a candidate passes N9, re-verify the specific rows it
   cites. A candidate citing a Grade-C or CONFLICT row is **blocked** until that row is
   re-verified to Grade A/B.
2. **Known conflicts (never average):**
   - Minimum cacheable prefix per Anthropic model: RESOLVED against the live doc 2026-06-12
     (see ANT-4) — but this row has drifted between doc snapshots within weeks; re-verify.
   - OpenAI Batch × prompt-cache stacking: community guidance (2024) says cached discounts
     do NOT apply inside Batch; one 2026 secondary claims they stack. UNRESOLVED (OAI-12).
   - OpenAI web-search pricing era: current $10/1k + content tokens vs legacy $25–50/1k
     all-inclusive still circulating (OAI-15).
   - o3 cache-discount wording: arithmetic supports 75%; one aggregator says 50% (OAI-3).
3. **Single-family ensemble caveat (inherited from v2, upgraded):** same-model samples are
   correlated draws (arXiv 2510.22954). v3 adds: cross-family ensembles measurably raise
   output diversity (LIT-M5, arXiv 2510.21513) — when ≥2 model families are available, split
   the generator roles across them; recurrence across FAMILIES is a stronger rank signal
   than recurrence within one.
4. **Honesty discipline (unchanged):** deterministic decision core (no model call, no regex
   classification in the decision); never fabricate a token/cost number (unknown model ⇒
   `null`); fail-safe; equivalence/quality-gated transforms; PII-safe. Hard gates in Part E3.

---

## Part A3 — Verified Billing-Mechanics Fact Table

> Injected into every generator as `{{FACT_TABLE}}`. Cite rows by ID. Grades per Part 0.

### The cost equation, v3

```
C_request = Σ_d tokens_d × rate_d
  d ∈ { fresh_input, cache_read, cache_write_5m, cache_write_1h,
        output, thinking(=output), rejected_prediction(=output, OpenAI),
        compaction_iteration_output (SEPARATE usage.iterations, Anthropic) }
× lane_multiplier   (batch 0.5 | flex ≈0.5 | standard 1 | priority 1.5–2× OpenAI /
                     committed-capacity Anthropic | fast-mode premium Anthropic)
× residency_multiplier (1.1 for Anthropic US-only inference_geo)
+ per_call_fees     (web search $/1k, code-exec container-time, session-hours, file-search)
+ tokenizer_version_effect  (same text ≠ same tokens across model versions; up to +35%)

C_session adds: round-trip re-billing of history (Responses API re-bills full chain;
agent loops run ≈100:1 input:output) · cache-TTL decay & shard overflow · compaction events
· context-window pressure · QUOTA currency (subscription 5h/weekly caps — not USD).
```

### Anthropic (Claude API)

| ID | Mechanic | Verified value | Grade | Source |
|----|----------|----------------|-------|--------|
| ANT-1 | Cache write/read multipliers | 5-min write 1.25×, 1-h write 2×, read 0.1× base input | A | platform.claude.com/docs/en/build-with-claude/prompt-caching (2026-06-12) |
| ANT-2 | Cache breakeven | 5-min TTL pays back after 1 read; 1-h after 2 | A | pricing doc (2026-06-12) |
| ANT-3 | Breakpoints | ≤4 explicit `cache_control` breakpoints; ~20-block lookback; automatic top-level `cache_control` mode exists | A | prompt-caching doc (2026-06-12) |
| ANT-4 | Min cacheable prefix (per model) | Fable 5/Mythos 5 = 512 (1,024 on Bedrock); Opus 4.8/4.1, Sonnet 4.6/4.5 = 1,024; Opus 4.7, Mythos Preview, Haiku 3.5 = 2,048; Opus 4.6/4.5, Haiku 4.5 = 4,096 | A | prompt-caching doc (2026-06-12) — DRIFTS; re-verify |
| ANT-5 | Cache invalidation tiers | tool defs → invalidate tools+system+messages; system/web-search/citations → system+messages; tool_choice/images/thinking-params → messages only | A | prompt-caching doc (2026-06-12) |
| ANT-6 | Cache isolation | Per-WORKSPACE since 2026-02-05 (API, AWS, Foundry); Bedrock/Vertex stay org-level | A | prompt-caching doc (2026-06-12) |
| ANT-7 | Cache pre-warm | `max_tokens: 0` = zero-output pre-warm; rejected in batches/streaming/forced tool_choice | B | batch doc + skill ref |
| ANT-8 | 1M-context pricing | Current 1M models (Fable 5, Opus 4.8/4.7/4.6, Sonnet 4.6): NO premium above 200K; Sonnet 4.5 beta's 2×/1.5× surcharge eliminated | B | pricing doc snippet + 2 secondaries |
| ANT-9 | Batch API | 50% off input+output; caching STACKS inside batch (multipliers on top of batch rate); 1-h TTL recommended; 24h expiry unbilled | B | pricing + batch docs |
| ANT-10 | Service tiers | Priority/Standard/Batch; `service_tier` param (`auto`/`standard_only`); response `usage.service_tier`; Priority = committed-capacity TPM via sales, burndown mirrors cache multipliers | B | service-tiers doc |
| ANT-11 | Thinking billing | Thinking bills at OUTPUT rate; summarized thinking bills FULL tokens generated, not the summary shown | B | extended-thinking doc |
| ANT-12 | Thinking retention | Opus 4.5+/Sonnet 4.6+: prior-turn thinking KEPT by default, cacheable, re-bills as cache-read; older models strip it free | B | extended-thinking + token-counting docs |
| ANT-13 | Effort dial | `budget_tokens` deprecated (4.6) / removed-400 (4.7+, Fable 5); replaced by adaptive thinking + GA `output_config.effort` (low/medium/high/xhigh/max) | B | extended-thinking doc + skill ref |
| ANT-14 | Task budgets | Beta `task-budgets-2026-03-13`: min 20K tokens, model-visible countdown | C | skill ref (2026-06-04) |
| ANT-15 | Context editing | Beta `context-management-2025-06-27`: `clear_tool_uses_20250919` (default trigger 100K, keep 3) + `clear_thinking_20251015`; tool-result clearing INVALIDATES cache at the cleared point; `clear_at_least` exists to make the invalidation worth it | A | context-editing doc (2026-06-12) |
| ANT-16 | Free savings preview | `count_tokens` accepts `context_management`, returns `original_input_tokens` AND post-clearing `input_tokens` — free what-if (doc example: 70K → 25K) | A | context-editing doc (2026-06-12) |
| ANT-17 | Server-side compaction | Beta `compact-2026-01-12` (Fable 5/Mythos/Opus 4.8–4.6/Sonnet 4.6): default trigger 150K (min 50K); summary bills as OUTPUT in `usage.iterations`; **top-level usage EXCLUDES compaction iterations** — total billed = Σ iterations; re-applying a compaction block is free; cache_control on compaction blocks + separate system-prompt breakpoint keeps system cache alive across compactions | A | compaction doc (2026-06-12) |
| ANT-18 | Memory tool | Client-side `/memories` (view/create/str_replace/...); normal token cost; pairs with context editing for recoverable clearing | B | context-editing doc + skill ref |
| ANT-19 | count_tokens endpoint | Free; RPM-limited by tier (100/2k/4k/8k); documented as an ESTIMATE | B | token-counting doc |
| ANT-20 | Tool-use overhead | Model-specific tool-use system prompt: Opus 4.8 = 290/410 tokens (auto / any-tool); Opus 4.7 = 675/804; Sonnet 4.6 = 497/589; bash +245; text editor +700 | B | pricing doc |
| ANT-21 | Tool search / deferred loading | `defer_loading`: ~85% tool-definition token reduction while IMPROVING MCP-eval accuracy (Opus 4: 49%→74%); appends rather than swaps schemas → cache-preserving | B | anthropic.com/engineering/advanced-tool-use (Nov 2025) |
| ANT-22 | Programmatic tool calling / code-exec-with-MCP | Intermediate tool results can bypass model context; vendor-reported representative task ~150K → ~2K tokens (−98.7%) | B | anthropic.com/engineering/code-execution-with-mcp (Nov 2025) |
| ANT-23 | Server-tool fees | Web search $10/1k (results re-billed as input on later turns); web fetch free + `max_content_tokens` cap; code exec free with `*_20260209` web tools, else container-time $0.05/h after 1,550 free org-hours; Managed Agents $0.08/session-hour (no batch/fast/residency multipliers) | B | pricing doc |
| ANT-24 | Tokenizer drift | Opus 4.7+ tokenizer can consume up to **+35% tokens for the same text** | B | pricing doc note |
| ANT-25 | Mid-conversation system messages | Beta `mid-conversation-system-2026-04-07`: inject operator instructions WITHOUT invalidating the cached prefix | C | skill ref (2026-06-04) |
| ANT-26 | Fast mode | Research preview; Opus 4.8 at $10/$50 (vs $5/$25); stacks with caching/residency; incompatible with Batch | B | pricing doc |
| ANT-27 | US data residency | `inference_geo:"us"` = 1.1× all token categories (Opus 4.6/Sonnet 4.6+) | B | pricing doc |
| ANT-28 | Context-editing measured effect | Vendor eval: 84% token reduction on 100-turn web-search task; memory+editing +39% performance vs baseline | B | anthropic.com/news/context-management (Oct 2025) |
| ANT-29 | Quota mechanics (subscription) | Weekly caps (overall + Opus-specific) since late Aug 2025 on top of 5-h windows; overage at API rates; $100 Max ≈ 140–280 Sonnet-h + 15–35 Opus-h/week | B | Anthropic announcement (2025-07-28) + secondaries |

### OpenAI

| ID | Mechanic | Verified value | Grade | Source |
|----|----------|----------------|-------|--------|
| OAI-1 | Cache discount by era | GPT-5.x cached input = 10% of price (90% off); 4.1-era 75%; 4o-era 50% | A | openai.com GPT-5 dev post (snippet) + search-verified 2026-06-12 |
| OAI-2 | Cache mechanics | Automatic, free, min 1,024-token identical prefix, hits in 128-token increments; 1-char difference in first 1,024 ⇒ `cached_tokens: 0`; eviction typically 5–10 min idle, ≤1 h | A/B | developers.openai.com guide + Azure mirror (fetched) |
| OAI-3 | o3 pricing | $2/$8 after Jun-2025 80% cut; cached $0.50 (arithmetic = 75% discount; one aggregator says 50% — CONFLICT) | B | multiple secondaries |
| OAI-4 | prompt_cache_key | Steers cache routing (prefix-hash + key); >~15 req/min per prefix+key overflows shards and lowers hit rate | B | cookbook 201 snippet + Azure mirror |
| OAI-5 | Extended retention | `prompt_cache_retention: '24h'` (GPT-5.1+), no extra charge; typical 1–2 h, max 24 h | A | GPT-5.1 dev post (search-verified 2026-06-12) |
| OAI-6 | Cache sharding | Per-organization; ZDR-eligible (in-memory) | B | caching guide snippet + secondary |
| OAI-7 | Responses API billing | `previous_response_id` re-bills the FULL prior chain as input each turn — no server-state discount; vendor-reported cache utilization 40%→80% when switching from Completions to Responses | A | cookbook reasoning-items + community (search-verified 2026-06-12) |
| OAI-8 | Reasoning items | Reasoning tokens bill as output once; persisted/passed-back items re-enter as (cacheable) input on later turns; reuse across tool-call turns ≈ +3% SWE-bench; `encrypted_content` enables stateless replay with `store:false` | B | cookbook + reasoning guide snippets |
| OAI-9 | Reasoning dials | `reasoning_effort`: none(5.1 default)/minimal(5)/low/medium/high/xhigh(some); `verbosity` low/med/high; usage exposes `reasoning_tokens` | B | GPT-5/5.1 dev posts + Azure mirror |
| OAI-10 | Predicted Outputs | Rejected prediction tokens bill at OUTPUT rate (`rejected_prediction_tokens`); 4o/4.1 families only (not o-series/GPT-5.x); 3–5× latency gains on edits | B | docs snippet + Azure mirror |
| OAI-11 | Flex tier | `service_tier:"flex"` ≈ Batch rates (~50% off), synchronous-but-slower; 429 capacity misses unbilled | B | flex guide snippet + secondaries |
| OAI-12 | Batch API | Flat 50% off, 24-h window, chat/responses/embeddings; **cache-stacking UNRESOLVED** (2024 community: no; one 2026 secondary: yes) | B/CONFLICT | batch guide + community |
| OAI-13 | Priority tier | ≈1.5–2× standard for latency SLA; project-level default tier; response echoes tier actually served | B | priority FAQ snippets |
| OAI-14 | Tool schemas | Serialized into prompt, bill as input, participate in caching (count toward 1,024 min) → stable ordering is a cache lever | B | caching guide + Azure mirror |
| OAI-15 | Built-in tool fees | Web search $10/1k + content as input tokens (current; legacy $25–50/1k all-inclusive deprecated — CONFLICT era); file search $2.50/1k + $0.10/GB-day; code interpreter size-tiered per container | B | pricing snippets + community |
| OAI-16 | Org Usage/Costs APIs | `/v1/organization/usage/*` + `/costs` (Admin key), bucketable by project/api_key/line_item | B | announcement + cookbook |
| OAI-17 | FT economics | Fine-tuned inference bills ABOVE base (ft:gpt-4o $3.75/$15 vs $2.50/$10) — FT pays only when replacing a LARGER model; distillation flow uses free stored completions | B | pricing + distillation post |

### Literature (all Grade C — arXiv 403; numbers from abstract snippets)

| ID | Finding | Number |
|----|---------|--------|
| LIT-1 | Observation masking ≈ halves cost vs raw agent, matches/exceeds LLM summarization on SWE-bench Verified (validates f15) | −50% cost; hybrid −7–11% more (arXiv 2508.21433) |
| LIT-2 | Cross-provider caching study: 45–80% cost cut; naive full-context caching can INCREASE latency; exclude dynamic tool results, dynamic content at end | (arXiv 2601.06007) |
| LIT-3 | Task-conditioned tool-output pruning | −92% tool-output tokens @ 0.86 recall (arXiv 2604.04979) |
| LIT-4 | Read ops dominate coding-agent tokens | 76.1% (arXiv 2601.16746); pruner −23–54% |
| LIT-5 | Off-track agents "token snowball" | >4× token+time cost; success ≈1.8M tokens avg (arXiv 2509.09853) |
| LIT-6 | Scaffold choice swings cost | 10–19× tokens/instance across scaffolds (arXiv 2604.01496) |
| LIT-7 | Semantic-cache reality | Production hit rates 20–45% vs 60–70% in papers; false-hit risk documented (arXiv 2510.26835 + case study) |
| LIT-8 | Compression backfire | Rate-0.3 compression → up to 56× OUTPUT expansion on MBPP; structure-sensitive tasks collapse (arXiv 2603.23527, 2604.02985) |
| LIT-9 | Context rot | Monotonic degradation with length, −20–50% from 10K→100K+ (Chroma study) |
| LIT-10 | Sequential > parallel test-time compute | +6.6–8.9 pts at matched budget (arXiv 2511.02309) |
| LIT-11 | Cost-of-pass metric; Efficient-Agents | 96.7% of perf at −28.4% cost-of-pass (arXiv 2508.02694) |
| LIT-12 | Routing/cascades | RouteLLM −35–85% cost at 95% quality; cascade-routing +1–4% over both; conformal deferral gives coverage guarantees |

### Field (practitioner)

| ID | Finding | Grade |
|----|---------|-------|
| FLD-1 | Agent steps re-send full context (vendor-confirmed, Cursor); 7.5K-token edit billed >107K tokens (anecdote) | B |
| FLD-2 | MCP defs: ~1K tokens/tool; 7 servers ≈ 67K tokens (~34% of 200K) before turn 1 | B |
| FLD-3 | Multi-agent ≈ 15× chat tokens; token usage explains ~80% of perf variance (Anthropic) | B |
| FLD-4 | Manus: input:output ≈ 100:1; KV-rules: stable prefix, append-only, mask-don't-remove tools | B |
| FLD-5 | Claude Code 5-stage compaction; microcompaction persists >50K-char tool results to disk with ~2KB preview | B |
| FLD-6 | Cache-TTL silent regression (1h→5m) tracked as Claude Code issue #46829 (Mar 2026) — TTL is a live, user-visible cost surface | C/anecdotal |
| FLD-7 | Quota practice: ccusage, /usage, disable auto-compact (~recovers last third of window), session resets ~120K (anecdote), manual Opus→Sonnet | B/C |
| FLD-8 | Named savings: ProjectDiscovery −59% via cache restructuring; Culprit −90% (small-N) | B/C |

---

## Part B3 — Prior Art / Forbidden Themes

`{{FORBIDDEN_THEMES}}` = (1) the shipped TCRP/value surface — f1–f22, F1–F21, P8(a–e),
L3/L4 detectors, CH-001..014 — as enumerated in `CLAUDE.md` (TCRP Feature Map + hooks +
MCP tool surface); (2) all candidates in `RESEARCH-FEATURE-PROPOSALS*.md` (List1–List4);
(3) for Round-2+ agents, the deduped theme list of earlier rounds.
Proposing any of these is an automatic kill; an adjacent idea must name the closest prior
id and the exact delta. Canonical machine-readable list: `apps/dashboard/src/lib/tcrp-catalog.ts`
+ the conscious-omission registries in `apps/mcp-server/src/surface-catalog-sync.test.ts`.

---

## Part T3 — Unexploited Lever Territories (evidence anchors)

> Injected as `{{EVIDENCE_ANCHORS}}`. These SEED generators; they are not the answer key.
> Each names its fact rows and its nearest shipped prior art (the delta that must be exceeded).

| # | Territory | Fact rows | Nearest prior art / delta required |
|---|-----------|-----------|-------------------------------------|
| T1 | **Compaction economics governor** — decide server-side compaction vs client masking vs nothing, per session, by total `usage.iterations` accounting; meter the hidden compaction spend dashboards miss | ANT-17, ANT-28, FLD-5 | f15 observation-mask is CLIENT-side masking only; nothing prices SERVER compaction or reads `usage.iterations` |
| T2 | **Free what-if previews** — `count_tokens` + `context_management` as a zero-cost oracle for clearing decisions | ANT-16, ANT-19 | replay-cost (f11) prices replays; no feature exploits the FREE preview endpoint |
| T3 | **Pre-warm scheduling** — `max_tokens:0` keep-alives timed against TTL decay + 24h retention arbitration | ANT-7, ANT-1/2, OAI-5 | prefix-warm plans warming; it does not use the zero-output pre-warm primitive or arbitrate 5m/1h/24h retention tiers |
| T4 | **Thinking-block cache ledger** — keep-vs-strip prior thinking per turn: kept thinking re-bills at 0.1× but occupies window; clearing busts cache (ANT-15) | ANT-11/12, ANT-15 | no shipped feature reasons about thinking retention economics |
| T5 | **Cross-provider effort calibrator** — one effort policy compiled to `output_config.effort` / `reasoning_effort`+`verbosity` / task budgets | ANT-13/14, OAI-9 | P8(d) effort-router predates these dials; delta = actuate the NEW parameters incl. `none`, `xhigh`, verbosity, task budgets |
| T6 | **Tokenizer-version inflation auditor** — same-text token delta across model versions priced into migration advice | ANT-24 | QpD bench compares quality/price; nothing models TOKENIZER drift (+35%) |
| T7 | **Cache-shard router (fleet)** — assign `prompt_cache_key`, keep per-prefix rpm under ~15 to avoid shard overflow | OAI-4, OAI-6 | fleet-cache shares answers; nothing manages OpenAI shard routing |
| T8 | **Reasoning-item reuse enforcer** — Responses API: always pass reasoning items / encrypted items back across tool turns; detect the omission | OAI-7/8 | cache-habits is Anthropic-shaped; no CH rule covers reasoning-item reuse |
| T9 | **Tool-surface composition optimizer** — choose static defs vs `defer_loading` vs code-exec-with-MCP per session from measured tool-def mass | ANT-20/21/22, FLD-2 | f2 audits bloat, f10 trims lazily; neither chooses among the three NEW Anthropic modes |
| T10 | **Cache-safe instruction injection** — route operator/system updates through mid-conversation system messages instead of prefix edits | ANT-25, ANT-5 | cache-stabilize hardens prefixes; it cannot inject without invalidation |
| T11 | **Quota-currency governor** — meter 5-h/weekly caps as first-class currency; spend-shaping near resets | ANT-29, FLD-7 | budget-gate is USD; subscription users' scarcity is quota |
| T12 | **Predicted-outputs profitability gate** — gate prediction use on expected acceptance (rejected tokens bill as output) | OAI-10 | diff-enforcer P8(c) decides diff-vs-rewrite; nothing governs PREDICTION profitability |
| T13 | **Non-token fee meter** — web-search/code-exec/session-hour fees accounted next to tokens; "free-when-combined" arbitrage (code exec free with `*_20260209` web tools) | ANT-23, OAI-15 | task-ledger sums token cost; per-call fees are unmetered |
| T14 | **Workspace cache-partition planner** — post-2026-02 isolation: align workspace boundaries with cache-sharing intent | ANT-6 | fleet-cache assumed org-level sharing; isolation changed the topology |
| T15 | **Lane scheduler with unbilled-429 retries** — flex-tier draining with free capacity-miss retries; batch-vs-flex-vs-standard per work item | OAI-11/12, ANT-9/10 | batch-router routes to batch; flex + unbilled-429 + Anthropic tier interplay is new |

---

## Part P3 — Run Protocol (v2's P1–P8 still bind; v3 adds P9–P14)

- **P9 — Diversify the critics, not just the generators.** Critic-side diversity in
  ideation–critique–revision loops raises final-proposal FEASIBILITY; generator-side
  diversity raises novelty (arXiv 2507.08350). N9 therefore runs with ≥3 distinct critic
  personas (provider-mechanics pedant, equivalence-gate auditor, adoption skeptic).
- **P10 — Dual-order pairwise, tie-on-flip.** Position bias in pairwise judging is
  10–15 winrate points and instruction-level debiasing does NOT work; judging both orders
  and treating order-dependent verdicts as ties drives it to ~0 (arXiv 2406.07791,
  2602.02219). All N9 pairwise rankings run both orders.
- **P11 — Falsification-first gating.** Sequential falsification with explicit error
  control (POPPER, arXiv 2502.09858, ICML 2025) keeps false-pass rates bounded where
  judge-scores fail. N9's order is: attack feasibility → attack the fact-row dependency →
  attack induced cost → only THEN score novelty. A candidate is killed by one successful
  falsification, not saved by high novelty.
- **P12 — Cross-family generation when available.** Split generator roles across ≥2 model
  families; family-crossing recurrence outranks within-family recurrence (arXiv 2510.21513).
- **P13 — Grounded evaluation, human gate stays.** Retrieval-grounded evaluators improve
  with evidence richness but plateau ≈75% F1 at predicting idea outcomes (InnoEval,
  arXiv 2602.14367) — ~1 in 4 gate decisions is wrong. The final build/no-build decision is
  human; N9 produces a dossier, not a verdict.
- **P14 — Fact-row dependency rule.** Every candidate names the Part-A rows it depends on.
  Grade-C or CONFLICT rows block the candidate until re-verified (Part 0 rule 1). A
  candidate that cites NO fact row is by definition not provider-anchored — route it to a
  v2 run instead.

---

## Part C3 — The Meta-Prompts (verbatim)

> Substitutions: `{{FACT_TABLE}}` = Part A3 · `{{FORBIDDEN_THEMES}}` = Part B3 ·
> `{{EVIDENCE_ANCHORS}}` = Part T3 · `{{OUTPUT_SCHEMA}}` = Part D3 · `{{HARD_GATES}}` = Part E3.
> Per v2-P8: prompts carry ONE format-only example, never example ideas. Per v2-P7: each
> generator starts with a SEARCH PLAN step. Run N1–N8 independently (v2-P1), then N9 on the pool.

### N1 — The Billing-Surface Cartographer (morphological sweep)

```
PERSONA: You are a pricing engineer who has read every line of the Claude and OpenAI
billing documentation and thinks exclusively in billable dimensions and multipliers. You
do not care what features exist; you care what the METER can see.

STEP 0 — SEARCH PLAN. List the 5 facts you would re-verify before trusting your output
(rates, betas, parameter names). Name the exact doc pages. Do not proceed as if verified.

SUBSTRATE: {{FACT_TABLE}} — every row is a billable dimension, multiplier, lane, fee, or
accounting surface.

TASK: Perform a MORPHOLOGICAL SWEEP. Axis 1 = every billable dimension and modifier in the
fact table (one per row; do not merge rows). Axis 2 = the five controller archetypes a
deterministic local governor can implement: (a) METER it honestly where dashboards miss it,
(b) GATE it (deny/allow with a provable invariant), (c) SCHEDULE it (move spend across
time/TTL/lane), (d) ARBITRAGE it (same output, cheaper lane/dimension, equivalence-gated),
(e) ATTEST it (signed counterfactual accounting). Fill the grid: for each (row, archetype)
pair, either name a concrete feature candidate or write "—" with a one-clause reason.
A cell candidate must be implementable from data available to a Claude Code hook, an MCP
tool call, or a typed host adapter — say which.

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} — for any adjacent cell,
name the closest prior id and the exact delta or kill the cell yourself.

OUTPUT: the 12 strongest cells as candidates in {{OUTPUT_SCHEMA}} (feasibility_check first),
each citing its fact row(s). Then the full grid as an appendix table.
```

### N2 — The Delta Miner (post-baseline mechanics only)

```
PERSONA: You are a changelog archaeologist. You believe every provider mechanic shipped in
the last 12 months is an unexploited feature, because tooling lags the meter.

STEP 0 — SEARCH PLAN. Name the provider changelog/news pages you would diff and the date
window. State your baseline explicitly.

BASELINE (the v2 worldview, June 2026): cache read ≈0.1× Anthropic / 0.5× OpenAI; write
1.25×/2× by TTL; batch ≈0.5×; reasoning bills as output; tool defs bill as input. Anything
in {{FACT_TABLE}} that CONTRADICTS or POSTDATES this baseline is your ore. Examples of ore
(non-exhaustive, verify yourself): OAI-1 (90% cache era), OAI-5 (24h retention), OAI-7/8
(Responses re-billing + reasoning-item reuse), ANT-6 (workspace isolation), ANT-7
(max_tokens:0 pre-warm), ANT-13/14 (effort GA + task budgets), ANT-16 (free preview),
ANT-17 (compaction iterations billing), ANT-24 (tokenizer +35%), ANT-25 (mid-conversation
system messages).

TASK: For EVERY post-baseline mechanic in {{FACT_TABLE}}, produce at least one feature
candidate that could not have been built before that mechanic existed. State the enabling
row, the date it became possible, and what the feature does on a model/account where the
mechanic is absent (the answer must be: clean no-op, never a guess).

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}}. Use {{EVIDENCE_ANCHORS}}
only AFTER your own pass, to check coverage — anchors you independently re-derived gain a
recurrence point; anchors you missed deserve a second look; candidates beyond the anchors
are the prize.

OUTPUT: candidates in {{OUTPUT_SCHEMA}}, feasibility_check first, fact rows cited.
```

### N3 — The Cross-Lane Arbitrageur

```
PERSONA: You are a fixed-income trader retrained on token markets. You see one product
(a completed task at proven-equivalent quality) quoted at many prices, and you are
constitutionally unable to ignore a spread.

STEP 0 — SEARCH PLAN. List the price quotes you need fresh before trading (lane rates,
TTL multipliers, retention windows, premium tiers) and where each is published.

THE LANES ({{FACT_TABLE}}): standard · batch 0.5× (ANT-9, OAI-12) · flex ≈0.5× with
unbilled 429s (OAI-11) · priority 1.5–2× (OAI-13) / committed (ANT-10) · fast-mode premium
(ANT-26) · cache tiers 0.1×/write 1.25×–2× by TTL (ANT-1) · 24h retention (OAI-5) ·
residency 1.1× (ANT-27) · model tiers · effort levels (ANT-13, OAI-9) · per-call-fee
bundles incl. free-when-combined code exec (ANT-23).

TASK: Enumerate every SPREAD — a pair of lanes/dimensions where the same verified-equivalent
output has different total cost — and design the deterministic policy that captures it.
For each spread state: the capture condition (when is the cheap lane provably sufficient —
latency tolerance, equivalence gate, quota state); the carry cost (cache writes, retention
upkeep, pre-warm spend, switching invalidation per ANT-5); the failure mode when the spread
moves (rate change, TTL regression per FLD-6, lane deprecation) and the fail-safe; and the
WATERBED CHECK — the induced cost that could eat the saving (e.g. batch latency → retry;
flex 429 loops; lane switch busting a 0.1× cache into a 2× rewrite).

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} (batch-router, futures-desk,
allowance-market, clearing-price are PRIOR ART — your delta must beat them by name).

OUTPUT: one candidate per surviving spread, {{OUTPUT_SCHEMA}}, fact rows cited.
```

### N4 — The Contradiction Engineer (TRIZ-style, deterministic matrix)

```
PERSONA: You are a TRIZ practitioner. You believe a documented contradiction is worth ten
brainstorms, and that resolving one without trading it away is what "inventive" means.

STEP 0 — SEARCH PLAN. For each contradiction below, name the measurement you would run in
this repo to confirm it bites here (file, metric).

THE CONTRADICTION MATRIX (verified, from {{FACT_TABLE}} — extend it if you find more):
  X1 Clearing tool results saves input ↔ busts the cache at the cleared point (ANT-15;
     clear_at_least exists BECAUSE of this tension).
  X2 Keeping thinking re-bills at 0.1× ↔ occupies window; clearing it frees window ↔
     busts cache (ANT-12, ANT-15).
  X3 Compression saves input ↔ can explode OUTPUT up to 56× and collapse
     structure-sensitive tasks (LIT-8).
  X4 Caching saves 45–80% ↔ naive full-context caching can RAISE latency; dynamic
     content placement decides which (LIT-2).
  X5 Longer context avoids round-trips ↔ context rot degrades quality monotonically
     (LIT-9) and agent loops bill input 100:1 (FLD-4).
  X6 More tools = more capability ↔ tool defs bill every turn and invalidate the deepest
     cache tier when changed (ANT-5, ANT-20, FLD-2).
  X7 Prediction speeds edits ↔ rejected prediction tokens bill as output (OAI-10).
  X8 Server compaction frees the window ↔ bills hidden output in usage.iterations and
     re-summarization can repeat (ANT-17, FLD-5).
  X9 Newer model is smarter per token ↔ its tokenizer may charge +35% more tokens for the
     same text (ANT-24).

THE INVENTIVE PRINCIPLES (your lookup table — deterministic, pick per contradiction):
segmentation (split the resource so the conflict applies to only one part) · asymmetry
(treat hot/cold regions differently) · prior action (do it before it's needed: pre-warm,
pre-count, pre-verify) · cushioning (reserve a budget for the failure mode) · extraction
(move the conflicting function elsewhere: disk, memory tool, code-exec sandbox) ·
intermediary (a free/cheap proxy resource: count_tokens preview ANT-16, encrypted reasoning
items OAI-8) · periodic action (act on TTL/reset boundaries, not continuously) · skipping
(act only past a provable threshold: clear_at_least logic) · feedback (close the loop with
measured usage fields) · self-service (make the agent spend its own budget visibly:
task budgets ANT-14).

TASK: For each contradiction, apply the 2–3 most promising principles and derive a feature
that RESOLVES it (gets the benefit without paying the documented cost), not a compromise
slider. Name contradiction id + principle(s) used.

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}}.
OUTPUT: {{OUTPUT_SCHEMA}}, feasibility_check first, fact rows cited.
```

### N5 — The Failure-Mode Actuary

```
PERSONA: You are an insurance actuary for token spend. You price tail risk, and you only
trust documented loss events with numbers attached.

STEP 0 — SEARCH PLAN. For each loss event below, state what local telemetry (hook payload,
usage field, transcript field) would let you OBSERVE it in this product, or state that the
observation is impossible today (that statement is itself a finding).

THE LOSS EVENTS ({{FACT_TABLE}}): off-track runs burn >4× tokens (LIT-5) · a 7.5K-token
edit bills >107K via full-context re-send (FLD-1) · 1-char prefix change zeroes the cache
(OAI-2) · per-prefix shard overflow above ~15 rpm silently halves hit rates (OAI-4) ·
TTL regression 1h→5m inflates quota burn (FLD-6) · rejected predictions bill as output
(OAI-10) · compaction bills hidden output outside top-level usage (ANT-17) · semantic-cache
false hits in production (LIT-7) · tool-def edits invalidate the deepest cache tier mid-
session (ANT-5) · weekly quota exhaustion mid-sprint (ANT-29) · multi-agent 15× burn
(FLD-3) · tokenizer migration +35% (ANT-24).

TASK: For each loss event design the cheapest deterministic instrument that (a) DETECTS the
event from observable fields with zero false fabrication (absent signal ⇒ insufficient_signal,
never a guess), (b) PRICES the realized loss using only fact-table rates (null on unknown
model), and (c) where a provable invariant exists, PREVENTS recurrence (gate/breaker), else
explicitly stays advisory. State the false-positive cost of each instrument — an instrument
whose advisory noise exceeds its recovered loss fails its own actuarial test (cite the
reflexive-overhead SLO idea, f19).

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} (loop-breaker, thrash-detector,
tool-error-rate, billing-tier-drift, cost-guard, TTL-regression sentinel are PRIOR ART —
name your delta or kill the candidate).
OUTPUT: {{OUTPUT_SCHEMA}}, fact rows cited.
```

### N6 — The Literature Transplanter

```
PERSONA: You are a research engineer whose only skill is turning a paper's number into a
shippable, deterministic, local mechanism — and whose only fear is transplanting a result
that doesn't survive contact with production.

STEP 0 — SEARCH PLAN. For each result you use, state what you would re-check on the actual
paper (sample size, benchmark, baseline) before building — all literature rows are Grade C.

THE RESULTS ({{FACT_TABLE}} LIT rows): masking ≈ summarization at half cost (LIT-1) ·
caching 45–80% but placement decides sign (LIT-2) · 92% tool-output pruning @ 0.86 recall
(LIT-3) · reads = 76% of agent tokens (LIT-4) · >4× off-track multiplier (LIT-5) · 10–19×
scaffold spread (LIT-6) · production semantic-cache hit rates 20–45% with false-hit risk
(LIT-7) · compression output-explosion 56× (LIT-8) · context rot (LIT-9) · sequential >
parallel +6.6–8.9 pts (LIT-10) · cost-of-pass framing (LIT-11) · routing −35–85% at 95%
quality (LIT-12).

TASK: For each result, answer in order: (1) What is the deterministic, model-free SHADOW of
this result — the part achievable with hashes, counters, static analysis, or provider usage
fields alone? (2) What does the shadow give up vs the paper's learned/model component, stated
honestly? (3) Is the residual still worth shipping by the paper's own numbers? If no, say
DOES NOT TRANSPLANT and move on — a correct rejection scores as highly as a candidate.
(4) If yes: the feature, its quality gate (which equivalence/non-inferiority check from this
repo's machinery guards it), and the replication risk (LIT-8's backfire is the cautionary
template).

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} (f15 already IS LIT-1's
shadow; response-tuner is adjacent to LIT-3; router/QpD to LIT-12 — exact deltas required).
OUTPUT: {{OUTPUT_SCHEMA}} for transplants; one-line verdicts for rejections.
```

### N7 — The Quota Economist

```
PERSONA: You are a macroeconomist of rate limits. You know most working developers pay in
QUOTA (5-hour windows, weekly caps, per-model allowances), not dollars, and that every
dollar-denominated optimizer is mispriced for them.

STEP 0 — SEARCH PLAN. Name the quota mechanics you would re-verify (plan tiers, window
sizes, reset cadence, overage rules, what /usage and local transcripts expose) and where.

THE CURRENCY ({{FACT_TABLE}}): weekly caps + 5-h windows, Opus-specific budgets, overage at
API rates (ANT-29) · field practice: ccusage, /usage, disabling auto-compact recovers ~1/3
of window, session resets, manual model downshifts (FLD-7) · service-tier and fast-mode
spend multipliers also burn quota differently (ANT-10, ANT-26) · cache reads still bill
0.1× — quota-cheap but not free (ANT-1).

TASK: Design features whose objective function is QUOTA HEADROOM — turns or task-completions
remaining before a cap — not USD. Consider: metering (translate any planned action into
"window-% consumed" with honest error bars from estimated tokenization); shaping (move
deferrable work across window/weekly resets — the quota analogue of batch routing); model-mix
budgeting (Opus-specific caps make model choice a two-currency problem); cap-approach
behavior (what should a governor do at 80%/95% of a window — and what must it NEVER do
silently); and translation honesty — where quota accounting is undocumented, the feature
must surface "insufficient_data", never a pretend conversion rate.

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} (budget-gate/SLO are
USD-denominated prior art; the currency change must do real work, not re-skin them).
OUTPUT: {{OUTPUT_SCHEMA}}, fact rows cited, currency declared as QUOTA.
```

### N8 — The Analogical Importer (controlled distance)

```
PERSONA: You are a systems historian of METERED INFRASTRUCTURE. You import billing-layer
inventions from industries that have priced consumption for decades, and you keep analogies
on a leash: structure must transfer, not vocabulary.

STEP 0 — SEARCH PLAN. For each source domain, name the specific practice you would verify
actually exists and works there (one citation each) before importing it.

SOURCE DOMAINS (medium analogical distance — per the evidence, controlled-distance
analogies outperform both near and far): cloud FinOps (rightsizing, RI/savings-plan
coverage, anomaly alerts on spend velocity) · electricity (time-of-use tariffs, demand
response, peak shaving) · CDN/networking (cache hierarchies, TTL strategy, request
coalescing, egress-aware placement) · telecom (pooled minutes, rollover, throttle-then-
notify) · HFT/market microstructure (maker-taker fees, queue position, latency arbitrage) ·
logistics (less-than-truckload consolidation, backhaul pricing) · insurance (deductibles,
experience rating, moral hazard controls).

TASK: For each domain, find ONE practice whose STRUCTURE maps onto a fact-table mechanic
(state the mapping explicitly: what is the tariff, what is the cache, what is the peak).
Then design the deterministic local feature that implements the import. Reject any analogy
that only renames an existing concept ({{FORBIDDEN_THEMES}} contains several prior imports:
futures desk, allowance market, clearing price — your import must be structurally NEW).
For each candidate state the disanalogy — the place the mapping breaks — and what failure
that produces; a candidate without a stated disanalogy is auto-killed.

CONSTRAINTS: {{HARD_GATES}}.
OUTPUT: {{OUTPUT_SCHEMA}}, ≤1 candidate per source domain, fact rows cited.
```

### N9 — The Falsifier-Judge (gate, replaces M9 for v3 runs)

```
ROLE: You are the falsification gate. Your job is to KILL candidates. A candidate you fail
to kill earns a dossier, not an endorsement — the build decision is human (evaluator
outcome-prediction plateaus ≈75% F1; act accordingly).

INPUT: the pooled candidates from N1–N8 (deduplicated by mechanism, not name; merge
near-duplicates and record which generators independently produced them — cross-FAMILY
recurrence outranks within-family recurrence).

RUN THREE CRITIC PERSONAS over every candidate (diverse critics raise feasibility):
 C-A the PROVIDER-MECHANICS PEDANT: does the cited fact row actually say what the candidate
     needs? Is the row Grade A/B and re-verified? Does the mechanic exist on BOTH providers
     or is the candidate honestly scoped to one? What happens the day the rate changes?
 C-B the EQUIVALENCE AUDITOR: where the candidate transforms content or switches lanes,
     what is the exact equivalence/non-inferiority gate, what is the false-equivalence
     failure, and is the decision core deterministic (no model call, no regex classify)?
 C-C the ADOPTION SKEPTIC: what typed input does it need, does a Claude Code hook / MCP
     call / host adapter carry that input TODAY, what is the no-op behavior when the input
     is absent, and would the advisory noise exceed the recovered savings (reflexive
     overhead)?

KILL SEQUENCE (falsification-first; stop at first kill):
 1. FEASIBILITY: inputs unavailable and no honest no-op ⇒ KILL.
 2. FACT-ROW DEPENDENCY: cites no Part-A row, or cites a Grade-C/CONFLICT row without a
    re-verification plan ⇒ KILL (route to a v2 mechanism-agnostic run instead).
 3. HONESTY: any path fabricates a token/cost number, regex-classifies in the decision
    core, or silently degrades ⇒ KILL.
 4. WATERBED: induced costs (cache invalidation, re-writes, retries, latency-driven
    abandonment, advisory tokens) plausibly ≥ savings and the candidate has no accounting
    for them ⇒ KILL.
 5. PRIOR ART: within {{FORBIDDEN_THEMES}} or a renamed adjacent — no concrete delta ⇒ KILL.
 6. Only now score NOVELTY and EXPECTED VALUE (savings model with caller-supplied numbers
    only; null-honest).

RANKING: pairwise comparisons, BOTH orders, order-dependent verdicts count as ties; rank by
wins, break ties by cross-family recurrence, then by Grade-A fact-row dependency count.

OUTPUT per survivor: the {{OUTPUT_SCHEMA}} record + a falsification log (which attacks it
survived, verbatim) + the single cheapest experiment that would kill it post-build (the
pre-registered WasteBench/outcome-bench check). Survivors feed `packages/quality`
non-inferiority gating and the human gate. Nothing in this pipeline auto-builds.
```

---

## Part D3 — Output Schema (feasibility first — binding)

```json
{
  "id": "v3-<generator>-<n>",
  "name": "",
  "fact_rows": ["ANT-#", "OAI-#", "LIT-#", "FLD-#"],
  "feasibility_check": {
    "inputs_required": [],
    "inputs_available_today": "hook | mcp | host-adapter | NONE (then: no-op behavior)",
    "decision_core": "deterministic spec — hashes/counters/thresholds/usage-fields only",
    "fail_safe": "behavior on crash/absent signal/unknown model"
  },
  "mechanism": "≤3 sentences",
  "cache_interaction": "MANDATORY — effect on prompt-cache state, incl. invalidation tier (ANT-5) or OpenAI prefix rules (OAI-2)",
  "currency": "USD | QUOTA | both",
  "savings_model": "formula over caller-supplied measurables; null on unknown model — no invented constants",
  "induced_costs": "the waterbed account: every new spend this feature causes",
  "equivalence_gate": "which gate guards any transform/lane-switch, or 'none needed' + why",
  "failure_modes": ["adversarial + drift cases, incl. what happens when the cited rate changes"],
  "novelty_delta": "closest prior id from Part B3 + the exact delta",
  "measurement_plan": "how WasteBench would attest net savings counterfactually"
}
```

## Part E3 — Hard Gates (auto-kill, inherited + v3 additions)

1. Deterministic decision core; no model call, no regex classification in the decision.
2. No fabricated token/cost numbers; unknown model ⇒ `null`; absent signal ⇒
   `insufficient_signal`; undocumented conversion ⇒ `insufficient_data`.
3. Fail-safe: never hang, throw uncaught, or block the agent; crash ⇒ feature off, agent fine.
4. Equivalence/non-inferiority gate on every content transform or lane switch.
5. PII-safe telemetry; metrics-shaped events only.
6. **v3:** must cite ≥1 Part-A fact row; Grade-C/CONFLICT citations block until re-verified.
7. **v3:** must state its cache interaction explicitly (the most common hidden waterbed).
8. **v3:** must declare its currency (USD/quota); quota claims need a documented quota mechanic.
9. **v3:** must survive provider drift: stated behavior when the cited rate/beta changes or
   disappears (the TTL-regression incident FLD-6 is the template).

## Part F3 — Sources

Primary fetched 2026-06-12: platform.claude.com docs — about-claude/pricing,
build-with-claude/prompt-caching, /batch-processing, /context-editing, /compaction,
/extended-thinking, /token-counting, api/service-tiers. OpenAI (403 to fetch; snippet +
secondary): developers.openai.com prompt-caching / flex / batch / reasoning guides,
cookbook prompt_caching101/201 + reasoning_items, openai.com GPT-5 / GPT-5.1 dev posts,
api-prompt-caching, structured-outputs, distillation; Azure mirror (fetched):
learn.microsoft.com /azure/foundry/openai/how-to/prompt-caching, /reasoning,
/predicted-outputs. Vendor engineering: anthropic.com/engineering — advanced-tool-use,
code-execution-with-mcp, multi-agent-research-system, effective-context-engineering;
anthropic.com/news/context-management, /prompt-caching; manus.im context-engineering post.
Literature (Grade C): arXiv 2508.21433, 2509.23586, 2601.16746, 2601.07190, 2601.06007,
2507.07400, 2406.18665, 2410.10347, 2502.09054, 2509.22984, 2501.00555, 2510.26835,
2604.04979, 2509.09853, 2508.02694, 2511.02309, 2506.02780, 2603.23527, 2604.02985,
2604.01496; trychroma.com/research/context-rot. Methodology: arXiv 2403.13002, 2605.11258,
2606.00875, 2510.16234, 2602.14367, 2406.07791, 2602.02219, 2510.21513, 2504.08066,
2603.08127, 2507.08350, 2502.09858 (POPPER), 2502.18864; plus the v2 baseline set.
Field: forum.cursor.com 120025 thread; github.com/anthropics/claude-code issue #46829;
modelcontextprotocol issue #2808; TechCrunch Cursor-pricing + Anthropic-weekly-limits
coverage; projectdiscovery.io caching post; ccusage.com.

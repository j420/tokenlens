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

### Round-2 additions (direct primary research, 2026-06-12 — no skill harness)

| ID | Mechanic | Verified value | Grade | Source |
|----|----------|----------------|-------|--------|
| ANT-30 | Usage-object field inventory | `usage` exposes: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, **`cache_creation.ephemeral_5m_input_tokens` / `.ephemeral_1h_input_tokens`** (per-TTL write breakdown), **`output_tokens_details.thinking_tokens`**, `service_tier` (standard/priority/batch), **`inference_geo`**, **`server_tool_use.web_search_requests` / `.web_fetch_requests`**; billing identity: total billed = input + cache_creation + cache_read + output | A | platform.claude.com/docs/en/api/messages (fetched 2026-06-12) |
| OAI-18 | Usage-object field inventory | `usage` exposes: `input_tokens` + `input_tokens_details.cached_tokens`, `output_tokens` + `output_tokens_details.reasoning_tokens`, **`accepted_prediction_tokens` / `rejected_prediction_tokens`**, `total_tokens`; response-level `service_tier` echoes the tier actually served | B | api-reference + predicted-outputs guide (snippets) + Azure mirror |
| OAI-19 | Server-side compaction endpoint | A `POST .../responses/compact` endpoint appears in the OpenAI API reference ("Compact a response") — OpenAI-side native compaction surfaced via API (Codex lineage) | C — RE-VERIFY | platform.openai.com/docs/api-reference/responses/compact (search result only) |

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
| FLD-9 | Aborted/cancelled streaming requests bill for tokens generated up to the abort, but SDK usage accounting is LOST (the final usage event never arrives) — documented as openai-agents-js issue #995 + community threads: an unmeterable-spend hole | B/C (2026-06-12 search) |
| FLD-10 | Error-path billing is UNDOCUMENTED: whether 4xx/5xx/529 `overloaded_error` requests bill input is stated nowhere primary; official SDKs auto-retry 529 with exponential backoff (a silent spend multiplier when combined with full-input re-billing on the eventual success) | C — RE-VERIFY |

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

## Part C3-R2 — Round-2 Generators (N10–N16)

> **Provenance.** Produced 2026-06-12 by a direct research pass (no skill harness): live
> primary fetch of the Messages API usage-object reference (ANT-30), snippet-verified OpenAI
> usage fields (OAI-18), and the OpenAI compact endpoint sighting (OAI-19, RE-VERIFY).
> **Round-2 rule (P3):** for these generators, `{{FORBIDDEN_THEMES}}` additionally includes
> the Round-1 generator outputs and ALL of Part T3 (T1–T15). Round 2 exists to occupy
> DIFFERENT epistemic territory: free resources, defaults, observed-signals, time structure,
> composition, formal optimality, and demonstrated demand. N9 gates Round-2 output unchanged.

### N10 — The Unpriced-Resource Prospector

```
PERSONA: You are a value engineer who reads price lists backwards. Where others see what
things cost, you inventory what is FREE — and you know free resources are mispriced levers
until the provider notices.

STEP 0 — SEARCH PLAN. List the free surfaces you would re-confirm are still free (and
their rate limits) before building anything on them.

THE FREE LIST ({{FACT_TABLE}} — extend it if you find more): count_tokens is free, incl.
context_management previews of clearing savings (ANT-16/19) · flex-tier capacity 429s are
unbilled (OAI-11) · expired batch requests are unbilled (ANT-9) · web fetch has no per-use
fee and takes max_content_tokens (ANT-23) · code execution is FREE when used with the
*_20260209 web tools, and has 1,550 free org-hours standalone (ANT-23) · 24h cache
retention costs nothing extra (OAI-5) · automatic caching costs nothing to enable (ANT-3,
OAI-2) · re-applying an existing compaction block is free (ANT-17) · stored completions
for distillation are free (OAI-17) · system-added tokens are counted but never billed
(ANT-19).

TASK: Design features that SUBSTITUTE a priced operation with a free one. For each: the
substitution rule (what priced call/work the free resource replaces); the proof condition
under which the free path is sufficient (never "probably"); the fragility analysis — free
things carry rate limits (count_tokens RPM tiers) and can be repriced; state the feature's
behavior the day the resource stops being free (fail-safe, no silent degradation); and the
exploitation ceiling (how much spend this can actually displace, formula not vibes).

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} incl. Round-1 themes and
T1–T15 (T2 already claims the count_tokens preview as a what-if oracle — your delta must
go beyond previewing).
OUTPUT: {{OUTPUT_SCHEMA}}, fact rows cited.
```

### N11 — The Default-Settings Auditor

```
PERSONA: You are a former provider pricing-team member turned customer advocate. You know
every API default was chosen for the GENERAL case (or the provider's margin), and that a
governor is, at bottom, a default-overriding machine with proof obligations.

STEP 0 — SEARCH PLAN. List the defaults you would re-verify per model/endpoint before
trusting this audit (defaults drift silently across model versions).

THE DEFAULTS LEDGER ({{FACT_TABLE}} — extend with any you find): service_tier defaults to
auto (ANT-10, OAI-13) · thinking retention defaults to KEEP on Opus 4.5+/Sonnet 4.6+
(ANT-12) · compaction trigger defaults to 150K (ANT-17) · clear_tool_uses defaults to
100K-trigger/keep-3 (ANT-15) · cache TTL defaults to 5m, retention to in-memory (ANT-1,
OAI-2/5) · reasoning_effort defaults vary BY MODEL (none on 5.1; medium classic) and
verbosity defaults medium (OAI-9) · effort defaults per Anthropic model (ANT-13) ·
predicted outputs default OFF (OAI-10) · batch/flex default OFF · prompt_cache_key
defaults unset (OAI-4) · inference_geo defaults to global routing (ANT-27).

TASK: For EVERY default in the ledger: (1) state whose interest the default serves and the
workload classes where it is provably wrong for cost; (2) design the deterministic
per-workload override policy — the condition under which the governor flips it, computed
from observable session/repo signals only; (3) state the override's risk and its
equivalence/quality obligation; (4) name the monitoring that detects when the default's
SEMANTICS drift (a default that changes meaning under you is the failure mode). The
aggregate deliverable concept: a per-repo "override manifest" — but propose the individual
flips as separable features.

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} (price-tag F14 flips ONE
decision under non-inferiority — your delta is the systematic parameter-space audit and
drift monitoring, or nothing).
OUTPUT: {{OUTPUT_SCHEMA}}, fact rows cited.
```

### N12 — The Usage-Field Forensic

```
PERSONA: You are a forensic accountant. Your axiom: EVERY UNREAD BILLING SIGNAL IS AN
UNBUILT FEATURE. The providers already ship, in every single response, metering data that
no tool reads — features built on these need ZERO new instrumentation, which makes them
the cheapest credible features in existence.

STEP 0 — SEARCH PLAN. Name the API-reference pages you would re-fetch to complete the
field inventory (streaming variants, batch result objects, error payloads included).

THE FIELD INVENTORY ({{FACT_TABLE}} rows ANT-30, OAI-18, ANT-17, OAI-19): Anthropic —
cache_creation.ephemeral_5m_input_tokens / ephemeral_1h_input_tokens (per-TTL write split),
output_tokens_details.thinking_tokens, service_tier, inference_geo,
server_tool_use.web_search_requests / web_fetch_requests, usage.iterations (compaction),
cache_read_input_tokens, the billing identity (total = input + writes + reads + output).
OpenAI — input_tokens_details.cached_tokens, output_tokens_details.reasoning_tokens,
accepted_prediction_tokens / rejected_prediction_tokens, total_tokens, response-level
service_tier.

TASK: Build the cross-product: for EVERY field, name the shipped feature ({{FORBIDDEN_
THEMES}}) that already reads it — and where none exists, design the cheapest feature for
which that field is the LOAD-BEARING signal. Candidate shapes: reconciliation (predicted
vs realized, e.g. cached_tokens vs the cache plan), calibration (thinking_tokens vs effort
setting — the feedback loop the effort dial lacks), profitability accounting (accepted vs
rejected prediction tokens decide whether predictions pay), fee metering (server_tool_use
× per-call rates), drift detection (inference_geo × 1.1 multiplier; per-TTL split exposes
whether your TTL choice matches actual reuse). EVERY candidate must work from response
fields alone — if it needs anything a hook payload doesn't carry, it belongs to a
different generator. State per candidate: field(s), the decision it powers, and the honest
no-op when the field is absent (older models/providers).

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} (cache-reconcile U3 and
billing-tier-drift L4-35 are PRIOR ART for two of these fields — exact deltas or kill).
OUTPUT: {{OUTPUT_SCHEMA}}, fact rows cited, plus the full field→feature coverage table as
an appendix (unread fields with no viable feature get a one-clause reason).
```

### N13 — The Session-Phase Planner

```
PERSONA: You are a process-control engineer. You believe a single static policy over a
dynamic process is always wrong, and that an agent session is a process with PHASES whose
optimal cost policies differ — sometimes oppositely.

STEP 0 — SEARCH PLAN. State which phase boundaries are observable from local signals
today (window fill, cache write/read mix per ANT-30, quota clock per ANT-29, TTL clocks)
and which are not (that list is a finding).

THE PHASES (derive detectors, then policies): COLD START — cache-write-dominated; every
block placement decision is still cheap to change (ANT-1/2: write multipliers, breakeven
arithmetic). STEADY STATE — read-dominated; stability is the asset; mutations are
expensive (ANT-5 invalidation tiers, OAI-2 prefix zeroing). PRE-COMPACTION — window
pressure rising (ANT-17 trigger at 150K; FLD-5); the clear-vs-compact-vs-mask decision
window. POST-COMPACTION — caches cold at the summary boundary; re-warm economics (ANT-17
cache_control on compaction blocks). IDLE — TTL decay clocks running (ANT-1, OAI-2/5);
keep-alive vs let-die. QUOTA CLIFF — approaching a 5-h/weekly reset (ANT-29); spend
deferral value spikes. HANDOFF — session ending; what's worth persisting for the NEXT
session's cold start (memory tool ANT-18, skill/knowledge surfaces).

TASK: (1) Define each phase by a deterministic detector over observable fields — no
classifier, thresholds only, hysteresis stated. (2) For each phase, name the policies that
INVERT vs the neighboring phase (e.g. a mutation cheap in cold start is expensive in
steady state). (3) Design features that are phase-TRANSITION actions — the value is
concentrated at boundaries (the moment before compaction, the minute before TTL expiry,
the turn before a quota window closes). A feature that behaves identically in all phases
belongs to Round 1, not here.

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} (context-health f6 DETECTS
fullness/inflection — your delta is phase-structured POLICY, not detection).
OUTPUT: {{OUTPUT_SCHEMA}}, fact rows cited, phase machine as an appendix.
```

### N14 — The Portfolio Composer

```
PERSONA: You are a logistics planner for token freight. Single-request optimization bores
you: your discipline is COMPOSITION — k requests, sessions, or developers arranged so that
total cost < k × individual cost.

STEP 0 — SEARCH PLAN. Name the sharing boundaries you would verify first (workspace cache
isolation ANT-6, org sharding OAI-6, privacy constraints on cross-developer reuse).

THE COMPOSITION SURFACES ({{FACT_TABLE}}): a cache write at 1.25–2× amortizes across every
subsequent read at 0.1× — by ANYONE inside the isolation boundary (ANT-1, ANT-6) · re-
applying a compaction block is free across requests (ANT-17) · batch assembles up to 100K
requests under one 1-h-TTL cache regime (ANT-9) · prompt_cache_key lets a FLEET place
requests on shards deliberately, and per-prefix throughput above ~15 rpm overflows (OAI-4)
· 24h retention turns a prefix into a day-long shared asset (OAI-5) · TTL clocks mean
request TIMING changes cost (idle gaps kill caches — ANT-1, FLD-6).

TASK: Find effects where coordination beats isolation. Shapes to consider (go beyond
them): bin-packing deferrable requests into an already-warm TTL window instead of
re-warming later; sequencing a team's sessions so shared prefixes amortize one write
(within ANT-6's workspace boundary — state the privacy line explicitly); shard-deliberate
fleet routing under the 15-rpm constraint; assembling batches so cache writes amortize
INSIDE the batch (ANT-9 stacking); timing-aware schedulers that treat TTL expiry as a
deadline. For each: the coordination mechanism (who decides, on what signal), the savings
formula vs the uncoordinated baseline, the privacy/isolation boundary respected, and the
failure when coordination misfires (a missed window must cost no more than the
uncoordinated baseline — prove it or kill it).

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} (fleet-cache F7 shares
ANSWERS; prefix-warm warms ONE session's prefix; batch-router routes ONE request — the
delta here is multi-party/multi-request composition).
OUTPUT: {{OUTPUT_SCHEMA}}, fact rows cited.
```

### N15 — The Optimal-Policy Theorist

```
PERSONA: You are a control theorist who suspects this entire product category is a pile of
ad-hoc approximations to ONE optimal policy nobody has written down. Your job is to write
it down, then harvest implementable features from its structure.

STEP 0 — SEARCH PLAN. State which model parameters you can instantiate from {{FACT_TABLE}}
today and which are unknown (unknowns become null-honest inputs, never assumptions).

THE PROBLEM (pose it formally, then mine it): State = window contents (per-block content
hashes, ages, masked/clear status) × cache entries (per-TTL clocks — observable per
ANT-30's ephemeral_5m/1h split) × quota meters (ANT-29) × phase signals. Actions per turn
= {read, re-read-deny, mask, clear (clear_at_least semantics), compact (server/client),
pre-warm (max_tokens:0), lane (standard/batch/flex/priority/fast), model tier, effort
level, defer}. Cost functional = the fact-table rate card (ANT-1..29, OAI-1..19) + quota
shadow price + a latency penalty term. Objective: minimize expected COST-OF-PASS (LIT-11)
— cost per accepted task, not cost per request.

TASK: (1) Derive the STRUCTURE of the optimal policy — where do threshold rules emerge
(clear only when reclaimable ≥ cache-rewrite cost), where index policies (evict the block
with lowest utility-per-token-per-TTL-remaining), where bang-bang switching (lane choice)?
(2) For each structural element, give the implementable deterministic approximation and an
honest statement of its gap from optimal (bound it or label the gap unbounded). (3) Map
which {{FORBIDDEN_THEMES}} features are special cases of which elements — and, more
important, name the elements with NO shipped counterpart: those are the candidates.
(4) State what the optimal policy says about ORDERING existing features (which actuator
should yield to which) — coordination findings are deliverables even when no new feature
results.

CONSTRAINTS: {{HARD_GATES}} — the deliverable is deterministic policy, not a learned one;
anything requiring estimation must degrade to null-honest insufficiency.
FORBIDDEN: {{FORBIDDEN_THEMES}} (clearing-price f18 PRICES actuator bids — your delta is
deriving the policy structure those bids should approximate).
OUTPUT: {{OUTPUT_SCHEMA}} for each unshipped structural element; the formal problem
statement and feature-to-element map as appendices.
```

### N16 — The Demand Archaeologist

```
PERSONA: You are a product archaeologist. You do not invent demand; you EXCAVATE it from
the complaint records of every tool adjacent to this one, then check whether the billing
mechanics explain the loss and a deterministic governor can end it.

STEP 0 — SEARCH PLAN (mandatory, this generator is research-first): name the corpora you
will mine — LiteLLM / Helicone / Langfuse issue trackers, the Cursor forum cost threads,
anthropics/claude-code issues (the TTL-regression issue FLD-6 is the archetype), OpenAI
community billing threads, MCP spec issues (FLD-2's #2808) — and your inclusion bar
(unresolved, cost-specific, ≥2 independent reporters).

TASK: (1) Mine and CLUSTER unresolved cost complaints by underlying billing mechanism —
not by product. (2) For each cluster: map it to the {{FACT_TABLE}} rows that explain the
loss (a complaint with no mechanic is folklore — park it); estimate the affected
population honestly (reporters ≠ users; say what you can't know). (3) Design the
deterministic feature that resolves the cluster, and state why the tools the complaints
were filed against CANNOT ship it (provider-conflicted, cloud-side, non-deterministic…) —
if they could and just haven't, the candidate is a race, not a moat; say so. (4) Each
candidate carries a DEMAND DOSSIER: ≥2 independent complaint citations with dates, the
fact rows, and the measurable that would prove the complaint extinguished.

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}}.
OUTPUT: {{OUTPUT_SCHEMA}} + demand dossier per candidate; the cluster map as an appendix.
```

---

## Part C3-R3 — Round-3 Generators (N17–N21)

> **Provenance.** Produced 2026-06-12 by a direct research pass (no skill harness) into the
> two territories Rounds 1–2 left untouched: failure-path billing semantics (FLD-9/10 —
> aborted streams bill but are unmeterable via SDKs; error billing undocumented) and
> serialization microstructure. **Round-3 rule:** `{{FORBIDDEN_THEMES}}` additionally
> includes Round-1+2 themes, T1–T15, AND the executed-run catalog P1–P13
> (`RESEARCH-FEATURE-PROPOSALS-V3R1.md`). N9 gates output unchanged.
> **Saturation note (binding judgment):** with 21 generators the instrument is at
> diminishing returns. Run Round 3 once; further capacity should go to building the gated
> catalog, not to a Round 4.

### N17 — The Failure-Path Actuary

```
PERSONA: You are a claims adjuster for the unhappy path. Agents fail constantly — aborts,
retries, refusals, overloads, malformed tool calls — and you know the billing semantics of
FAILURE are the least documented, least metered corner of both APIs.

STEP 0 — SEARCH PLAN (mandatory): list the failure modes whose billing you would pin down
first and where (docs, SDK source, controlled experiments): aborted/cancelled streams
(FLD-9: bills generated tokens, SDK loses the usage record), 4xx/5xx/529 (FLD-10:
undocumented; SDKs auto-retry with backoff), refusal stop_reasons, max_tokens truncation,
malformed tool_use loops, expired-batch non-billing (ANT-9), unbilled flex 429s (OAI-11).

TASK: For each failure mode, establish (or design the controlled experiment that
establishes) WHAT BILLS, then design the deterministic instrument that (a) METERS it —
e.g. reconstruct aborted-stream spend from streamed deltas so the FLD-9 hole closes; the
local meter must never show $0 for a request that billed; (b) PRICES the retry policy —
an auto-retry on a failure that re-bills full input is a spend multiplier: compute the
true cost-per-success including failed attempts (joins cost-of-pass, LIT-11) and advise
backoff/cache-write placement so retries re-read at 0.1× instead of re-billing cold;
(c) GATES where provable — e.g. deny a retry burst when the per-attempt bill is nonzero
and the failure is deterministic (same content-SHA in ⇒ same error out). Absent signal ⇒
insufficient_signal; undocumented billing ⇒ the instrument reports `unverified`, never a
guessed number.

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} (tool-error-rate breaker and
loop-breaker detect failure PATTERNS; the billing semantics and true-cost accounting of
failure are the open territory).
OUTPUT: {{OUTPUT_SCHEMA}}, fact rows cited; experiments listed where billing is unknown.
```

### N18 — The Serialization Economist

```
PERSONA: You are a market-microstructure researcher for tokens. The same semantic payload
costs differently depending on how it is ENCODED — and nobody audits encoding.

STEP 0 — SEARCH PLAN: name what you would measure with the local tokenizer + the free
count_tokens oracle (ANT-16/19) before claiming any number: role/message framing overhead
per turn, JSON-schema verbosity vs payload, tool-call arguments vs inline text, indentation
and whitespace cost in code blocks, OpenAI's 128-token cache increments (OAI-2), per-model
minimum prefixes (ANT-4), the +35% tokenizer drift (ANT-24).

TASK: Design features that re-encode WITHOUT transforming content (equivalence by
construction or by the repo's AST equivalence, never lossy): (a) measure-then-advise on
encoding choices — schema field-name length, enum-vs-string, message-splitting vs
concatenation, where the SAME bytes land cheaper; (b) boundary packing — content placement
that wastes cache increments (a prefix ending 1 token past a 128-boundary strands 127
tokens of cache eligibility, OAI-2) or falls below per-model minimum cacheable prefixes
(ANT-4: 512–4096 — a 1,000-token system prompt caches on Opus 4.8 and NOT on Haiku 4.5);
(c) tokenizer-drift-aware encoding — encodings whose token count is stable across the
ANT-24 drift vs encodings that amplify it. Every claim measured locally per repo, never a
universal constant; cite which measurements use the free oracle vs labeled estimates.

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} (prefix-align ships the
128·k alignment for ONE boundary; squeezer transforms content — re-encoding identical
content is the delta).
OUTPUT: {{OUTPUT_SCHEMA}}, fact rows cited.
```

### N19 — The Host-Gap Auditor

```
PERSONA: You are a gap analyst. The providers ship cost mechanics faster than the HOSTS
(Claude Code, Cursor, Codex CLI) adopt them — and every unadopted mechanic is money the
host leaves on the user's table that a local governor can recover or surface.

STEP 0 — SEARCH PLAN: name how you would establish, per host and per mechanic, ADOPTED /
NOT-ADOPTED / UNKNOWN (changelogs, settings surfaces, transcript evidence — e.g. does the
transcript show 1h-TTL cache writes? context_management config? effort parameters?
usage.iterations?). UNKNOWN is a reportable state, never assumed either way.

TASK: Build the host × mechanic adoption matrix over {{FACT_TABLE}} (cache TTL choice,
context editing, compaction config, effort dials, task budgets, tool search/defer_loading,
prompt_cache_key, 24h retention, batch/flex lanes, memory tool…). For every NOT-ADOPTED
cell, classify: (a) GOVERNOR-RECOVERABLE — a hook/MCP/extension surface can actuate or
emulate it today (design that feature); (b) ADVISORY-ONLY — only the host can wire it
(design the detector that PRICES what the gap costs the user per session, so the advisory
carries a number, and emit it as evidence the host should fix it); (c) NOT-WORTH-IT —
priced below noise (say so). The matrix itself, refreshed per host release, is a
product surface: "what your editor doesn't do for your bill yet."

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} — several shipped features
already compensate for specific host gaps (read-gate, cache-stabilize); your delta is the
SYSTEMATIC matrix + per-gap pricing, and any new per-cell feature must clear prior art
cell-by-cell.
OUTPUT: {{OUTPUT_SCHEMA}} for recoverable cells; the adoption matrix as an appendix.
```

### N20 — The Replay Counterfactual Miner (data-driven; uses the repo's own machinery)

```
PERSONA: You are an empiricist who distrusts every concept-driven generator in this
library. Ideas should come from RECORDED SESSIONS: replay them under alternative policies
and let realized counterfactual savings rank the policy space.

STEP 0 — SEARCH PLAN: name the recorded substrate you would mine (replay-vault
trajectories, telemetry events.sqlite, transcripts) and verify what each actually
contains before designing — absent data is a finding, not an obstacle to invent around.

TASK: Define a deterministic mining pipeline (this pipeline is itself the feature
candidate): (1) POLICY SPACE — enumerate parameterized policies from {{FACT_TABLE}}
mechanics (TTL choice thresholds, clearing thresholds × clear_at_least, effort downgrade
rules, lane assignment rules, mutation-release instants…), each policy a pure function of
recorded observables. (2) REPLAY — for each recorded session, compute the counterfactual
bill under each policy using fact-table rates and the repo's replay-cost machinery —
deterministic arithmetic, no model re-runs, with honest non-replayability marks where a
policy would have CHANGED model behavior (those sessions report bounds, not numbers).
(3) RANK — policies by realized net savings on THIS user's actual sessions, overhead
subtracted (WasteBench accounting). (4) EMIT — the top policies as per-repo configuration
recommendations with their measured-on-your-data savings attached. The output is the
first generator whose candidates arrive with evidence instead of estimates.

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} (replay-cost f11 prices ONE
what-if; waste-memo fingerprints recurring waste; the delta is the policy-space sweep
that turns recorded sessions into a feature-ranking instrument).
OUTPUT: {{OUTPUT_SCHEMA}} for the miner + its top-policy report format.
```

### N21 — The Cross-Provider Emulator

```
PERSONA: You are a bilingual systems engineer. Every mechanic that exists on ONE provider
and not the other is a feature spec: emulate the missing half locally, deterministically.

STEP 0 — SEARCH PLAN: list the asymmetries you would re-verify before building (both
directions), then build the asymmetry table from {{FACT_TABLE}}: Anthropic-only — free
count_tokens (ANT-19), explicit TTL choice + per-TTL usage split (ANT-1/30), context
editing + free preview (ANT-15/16), compaction blocks + free re-apply (ANT-17),
mid-conversation system messages (ANT-25), task budgets (ANT-14). OpenAI-only — 24h
retention (OAI-5), prompt_cache_key sharding (OAI-4), predicted outputs + accepted/
rejected accounting (OAI-10/18), encrypted reasoning items (OAI-8), flex lane with
unbilled 429s (OAI-11), Responses-state cache-utilization jump (OAI-7).

TASK: For each asymmetry, decide: (a) EMULABLE — a deterministic local construction
provides the missing mechanic's ECONOMIC effect on the other provider (e.g. emulate
24h retention on Anthropic via scheduled 1h-TTL re-warm chains iff the arithmetic beats
re-writes — state the exact breakeven; emulate count_tokens on OpenAI via calibrated
local counts with error bars, labeled estimates); (b) NOT EMULABLE — the mechanic is
server-side physics (say so; the honest table is itself a user-facing artifact:
"what your provider choice costs you in governance capability"); (c) PORTABILITY
LAYER — where both exist with different semantics, design the ONE policy interface that
compiles to both (the cross-provider effort dial precedent, T5). Every emulation states
its fidelity gap vs the native mechanic — an emulation sold as native is a lie.

CONSTRAINTS: {{HARD_GATES}}. FORBIDDEN: {{FORBIDDEN_THEMES}} incl. T3/T5 (their deltas
required by name).
OUTPUT: {{OUTPUT_SCHEMA}} per emulable/portability cell; the asymmetry table as appendix.
```

---

## Part C3-E — The Exponential Lens (E1–E5)

> **What this is.** A DIFFERENT objective function, not a fourth savings round (the
> saturation note above stands). N1–N21 select for savings-per-session (linear). E1–E5
> select for the VALUE GROWTH FUNCTION: candidates must state how value compounds — per
> turn, per use, per user, or per accumulated artifact — and anything linear is ROUTED to
> the N-generators, not scored here. Grounded in already-verified rows (no new research
> required): FLD-4 (input:output ≈100:1 — resident-set reductions compound per turn),
> ANT-6 (workspace cache boundary — shared-asset amortization), ANT-17 (vaulted compaction
> blocks re-apply free, forever), ANT-30/OAI-18 (every response feeds data loops at zero
> instrumentation cost), LIT-9 (context rot — early eviction buys compounding quality too).
> **Schema addition (binding for E-runs):** every candidate adds a `growth_function` field
> — the explicit recurrence or scaling law (V(n+1)=f(V(n)), V(T)∝T, V(N users)∝g(N), or
> V=Σ future exercises), its cold-start value at n=0, its saturation point, and its decay
> mode (staleness). A candidate that cannot write this field is linear by definition.

### E1 — The Flywheel Architect

```
PERSONA: You are a compounding-systems engineer. You only build loops: features where
USE produces DATA that automatically improves the NEXT use — deterministically, with no
model in the loop and no human curation on the path.

THE SUBSTRATE: every response already carries usage telemetry (ANT-30, OAI-18) at zero
instrumentation cost; the repo persists events locally. Existing loops are PRIOR ART with
their deltas required: context-utility F1 (per-atom utility from verdicts), effort-yield
calibration (P3), tokenizer error-band calibration (P10's ε̂), replay policy mining (N20).

TASK: Design closed loops where the recurrence is explicit and the loop CLOSES — the
accumulated data must change a DECISION automatically (a dashboard is an open loop and
fails this generator). For each candidate state: the growth_function (what improves per
observation, and its diminishing-returns curve); the cold-start behavior (the feature must
be honestly useful at n=0 or honestly silent — never wrong-with-confidence); the decay
mode (what staleness breaks, and the deterministic invalidation — content-SHA, model-id
change, rate-table change); and the loop-integrity guard (how a poisoned/outlier
observation is bounded — the repo's cache-poison and reward-integrity disciplines apply
to learning loops too).

CONSTRAINTS: {{HARD_GATES}} + growth_function mandatory. FORBIDDEN: {{FORBIDDEN_THEMES}}.
OUTPUT: {{OUTPUT_SCHEMA}} + growth_function, ranked by steepness × durability of the loop.
```

### E2 — The Turn-Multiplier Hunter

```
PERSONA: You are a compound-interest accountant for context. In an agent loop, input
re-bills EVERY turn (FLD-4: ≈100:1 input:output), so a token removed from the resident
set at turn t pays out on every one of the remaining T−t turns — and context rot (LIT-9)
pays a quality dividend on top. Savings here are not amounts; they are RATES.

THE ARITHMETIC (binding): value(intervention) = tokens_removed × (T − t) ×
effective_input_rate (0.1× if the region was cached, 1× cold) + the unpriceable-but-real
rot dividend (reported, never dollarized). Corollary: EARLINESS DOMINATES — the same
removal at turn 2 is worth an order of magnitude more than at turn 20, and the best
intervention happens BEFORE the content enters context at all.

TASK: Hunt interventions by multiplier, not by size: (a) pre-entry — decisions that keep
content from ever becoming resident (the upstream-of-billing frontier; P12 is prior art,
its delta required); (b) early-turn — what is decidable at turns 0–3 that the shipped
governors only decide later (they are largely reactive: thresholds fire at 80–100K — what
deterministic signal at 5K predicts the same decision?); (c) persistent-region targeting —
rank ALL shipped eviction/masking decisions by (T−t)-weighted value instead of size, and
design the re-prioritizer. Every candidate states its multiplier formula and why it
cannot be matched by acting later.

CONSTRAINTS: {{HARD_GATES}} + growth_function (must be ∝ remaining-turns or better).
FORBIDDEN: {{FORBIDDEN_THEMES}} — observation-mask/read-gate/program-slice act on
residency already; the delta is the (T−t)-weighted EARLINESS economics they ignore.
OUTPUT: {{OUTPUT_SCHEMA}} + growth_function, ranked by realized multiplier on a typical
40-turn session.
```

### E3 — The Shared-Asset Economist

```
PERSONA: You are a club-goods economist. You design assets whose value grows with the
number of parties sharing them — inside provable isolation boundaries, with provenance,
or not at all.

THE BOUNDARIES (verified): Anthropic prompt caches share per-WORKSPACE (ANT-6) — a cache
write by one developer serves every teammate's read at 0.1× inside it; vaulted compaction
blocks re-apply free to anyone holding the byte-identical lineage (ANT-17); OpenAI caches
shard per-org with prompt_cache_key placement (OAI-4/6); content-SHA addressing makes any
local artifact shareable with provenance (the f21/f22 discipline). PRIOR ART with deltas
required: fleet-cache F7 (shares resolved ANSWERS), knowledge compiler f21, prefix-warm.

TASK: Design assets where V(N) is superlinear-to-linear in participants and ZERO trust is
assumed: every shared artifact is content-addressed, provenance-carrying, and re-validated
on read (stale ⇒ self-demote — the f22 rule). Candidate shapes (go beyond): one
developer's paid 2× cache write amortized across a team's session schedule; a per-repo
compaction-lineage vault that every CI job and developer draws from; a shared TTL/effort
calibration corpus that converges with N×data; pooled shard-placement so a fleet stays
under the 15-rpm overflow PER KEY rather than per developer. For each: the V(N) curve,
the privacy line (what NEVER crosses it, stated as a type, not a promise), the free-rider
and poisoning analysis, and the cold-start at N=1 (must be the single-user feature's
value, not zero).

CONSTRAINTS: {{HARD_GATES}} + growth_function(N). FORBIDDEN: {{FORBIDDEN_THEMES}}.
OUTPUT: {{OUTPUT_SCHEMA}} + growth_function, ranked by V(5)/V(1) with the boundary named.
```

### E4 — The Leverage-Point Engineer

```
PERSONA: You are an Archimedean. You refuse to add another saving; you only build
features that MULTIPLY the value of every feature that already exists. Your test: delete
your feature and every other feature gets measurably worse.

THE CATALOG IS YOUR SUBSTRATE: {{FORBIDDEN_THEMES}} here is not a kill-list but the list
of things to be multiplied — your candidate must name ≥3 shipped features it multiplies
and the mechanism. Known leverage classes (find more): METER COMPLETENESS — spend the
catalog cannot see (usage.iterations exclusion, FLD-9 aborted-stream loss) silently
mis-ranks every governor's decisions; closing a meter hole re-prices the whole catalog.
CALIBRATION — every actuator that compares token counts inherits the local tokenizer's
error (ANT-24 +35% drift); one calibration asset (ε̂ per model×class) tightens all of
them at once. COORDINATION — actuator ORDERING (whose veto precedes whose) changes joint
yield; the N15 policy-structure findings are the spec. TRUST — one identity-bearing
attestation chain upgrades every savings number from claim to receipt.

TASK: For each leverage class, design the ONE feature whose multiplier is largest, with:
the list of multiplied features and the per-feature mechanism; the multiplier estimate as
a FORMULA over measurables (never an asserted percentage); the failure isolation (a
leverage feature that fails must degrade to no-op without dragging the catalog down — the
Golden Rule applies doubly here); and the proof design (how WasteBench shows catalog-wide
yield with-vs-without it).

CONSTRAINTS: {{HARD_GATES}} + growth_function (value ∝ size of the catalog it multiplies).
PRIOR-ART NOTE: clearing-price f18 already coordinates bids — a coordination candidate
must state its delta against f18 by name.
OUTPUT: {{OUTPUT_SCHEMA}} + growth_function + the multiplied-features list.
```

### E5 — The Option-Value Trader

```
PERSONA: You are an options trader on durable artifacts. A saving spent once is gone; an
ARTIFACT is an option exercised repeatedly. You buy artifacts cheap at creation time and
collect every future exercise.

THE VERIFIED OPTION INSTRUMENTS: a vaulted compaction block re-applies FREE forever on
byte-identical lineage (ANT-17; P1's vault is prior art — exceed it); encrypted reasoning
items replay reasoning statelessly across turns (OAI-8); a 2× 1-hour cache write is an
option on every read in the next hour (ANT-1), and 24h retention extends the expiry for
free on OpenAI (OAI-5); memory-tool entries and content-SHA-keyed knowledge assets
(ANT-18, f21/f22 prior art) persist across sessions; signed WasteBench manifests are
options on TRUST exercised at every future audit (f19 prior art).

TASK: Design features that CREATE, PRICE, and EXERCISE such options: for each, the option
contract (what is stored, its creation cost, its exercise payoff, its expiry/invalidation
— content-SHA, TTL, model-id, rate-change); the exercise-frequency model bounded by
MEASURED recurrence (content-SHA hit rates from local telemetry — never an assumed
probability; no measurement ⇒ the candidate reports insufficient_data and stays
advisory); the portfolio view — which options to write under a budget (creation costs
are real: 1.25–2× writes, storage, staleness risk) — and the WORTHLESS-EXPIRY accounting:
options that expired unexercised are reported as honestly as wins (waterbed discipline).

CONSTRAINTS: {{HARD_GATES}} + growth_function (V = Σ exercises, with the measured
exercise-rate basis named). FORBIDDEN: {{FORBIDDEN_THEMES}} incl. P1/f12/f19/f21 — their
deltas required by name.
OUTPUT: {{OUTPUT_SCHEMA}} + growth_function, ranked by measured-recurrence-backed Σ.
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

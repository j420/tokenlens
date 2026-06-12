# Research Meta-Prompt Library v2 — Token/Cost-Saving Feature Discovery

> The evidence-grounded successor to `docs/RESEARCH-META-PROMPTS.md` (v1, frozen as the
> instrument that produced List1–List3). v2 keeps v1's funnel and honesty bar, and upgrades
> every prompt with findings from an executed deep-research pass (June 2026): 5 parallel
> research agents (context-efficiency frontier, inference-cost mechanics, provider billing
> primary-docs, ideation methodologies, generator/evaluator architectures) + 2 independent
> adversarial verifiers over the 29 load-bearing claims. **27/29 SUPPORTED; 2 corrected**
> (both corrections are encoded below where they bite).
>
> Use v2 for all new discovery runs. v1 remains valid history; do not edit it.

---

## Part 0 — Provenance & Honesty Bar

**How this version was produced.** Each claim cited in this file was surfaced by a research
agent and then attacked by a separate adversarial verifier (vote: SUPPORTED / REFUTED /
UNVERIFIABLE; 2/3 refutes kills). Two corrections from the verification pass:

1. The "Artificial Hivemind" result (LLM idea diversity does NOT improve by scaling samples)
   is **arXiv 2510.22954** (Jiang et al., NeurIPS 2025 Best Paper) — an earlier draft of this
   research mis-attributed it to arXiv 2602.20408, which is a different (also real, also used)
   paper: Deng, Brucks & Toubia, *Barriers to Diversity in LLM-Generated Ideas* (2026).
2. The Anthropic **minimum-cacheable-prefix** per-model values returned conflicting snippets
   across official-domain sources. It is encoded below as **RE-VERIFY-AT-RUN-TIME**, never a
   constant.

**Standing fetch caveat.** During the research pass, direct fetches of docs.anthropic.com,
platform.openai.com, ai.google.dev and arxiv.org returned HTTP 403; every "verified-primary"
label below means *verbatim search-snippet of the official domain*, corroborated by ≥2
independent secondary sources. Quotes should be re-checked against the live page before any
number is hard-coded into a package.

**Single-model ensemble caveat (encoded, not hidden).** All generators in a run execute on
one model family. Per arXiv 2510.22954, independent samples from one model are *correlated
draws*: recurrence across generators RANKS candidates but never PROVES novelty or value. A
true cross-vendor ensemble remains a recorded follow-up, not something this library claims.

**Honesty discipline (unchanged from v1 / `CLAUDE.md`).** Deterministic decision core for any
buildable proposal — no model call, no regex classification in the decision; never fabricate a
token/cost number (unknown model ⇒ `null`); fail-safe; equivalence/quality-gated transforms;
PII-safe. Encoded as hard gates in Part E; M9v2 enforces them.

---

## How to use this library

Still a **fan-out → gate → rank funnel**, now with a mandatory run protocol (Part P):

```
deep-research refresh → Part A + Part F     (re-verify rates; they drift)
   → ROUND 1 (independent, no cross-talk): M1v2, M2v2/M11, M10, M7v2   (spanning + evidence-anchored)
   → ROUND 2 (NOVA loop, fed Round-1 themes as FORBIDDEN): M3v2, M4v2, M12, M13
   → targeted as needed: M5v2, M6v2, M8v2
   → M9v2 gates EVERYTHING (feasibility BEFORE novelty) → dedup → recurrence-rank → top-N
```

| Goal | Use |
|------|-----|
| Map the entire opportunity space from scratch | M1v2, M2v2 |
| Import verified outside knowledge | M10 (literature mechanisms), M7v2 (provider billing) |
| Break fixation / force design-space coverage | M11 (morphological), M12 (medium-distance analogy) |
| Fix observed, concrete waste | M4v2 |
| Find what a new host signal would unlock | M5v2 |
| Cut cost at fixed quality | M6v2 |
| Combine existing features / find anti-synergies | M8v2 |
| Iteratively deepen with planned evidence retrieval | M13 (wraps any generator) |
| Decide whether ANY candidate is real | M9v2 (run on all) |

---

## Part P — Run Protocol (NEW; mandatory, evidence-backed)

These are orchestration rules, not prompt text. Each carries the finding that forces it.

**P1 — Independent generation; no cross-talk during ideation.** Generators in the same round
never see each other's outputs. Nominal groups (independent ideation, then pooling) beat
interactive brainstorming on quantity AND quality — effect sizes r≈.57 (quantity), r≈.56
(quality) (Mullen, Johnson & Salas 1991 meta-analysis, 20 studies, 800+ teams;
https://www.tandfonline.com/doi/abs/10.1207/s15324834basp1201_1). Critique happens only in
the separate M9v2 stage.

**P2 — Diversity is structural, not sampled.** More samples / higher temperature does NOT
produce more idea diversity — single-model samples converge ("Artificial Hivemind",
arXiv 2510.22954, NeurIPS 2025 Best Paper). What measurably raises diversity: distinct
epistemic personas, distinct knowledge partitions, and an in-context list of forbidden themes
(arXiv 2602.20408; persona prompting also in Meincke et al., Wharton 2024). Therefore every
generator prompt carries a PERSONA header and a `{{FORBIDDEN_THEMES}}` slot.

**P3 — `{{FORBIDDEN_THEMES}}` =** the N0 baseline (Part B) for Round-1 agents; PLUS the
deduped theme list of all earlier rounds for Round-2+ agents. Between-round exclusion forces
new space; within-round independence preserves P1.

**P4 — About 8 roles; rotate ~half between rounds.** Multi-agent ideation novelty peaks near
8 agents / 5 turns, and ~50% fresh-agent turnover maximizes novelty (VirSci,
arXiv 2410.09403). A full run uses ≤8 generator roles per round and swaps ~half the personas
for the next round.

**P5 — Recurrence is the ranking signal — and only a ranking signal.** K independent runs +
dedup + recurrence count is the ideation analogue of self-consistency (+17.9pp GSM8K,
arXiv 2203.11171). Per P2's hivemind caveat, same-model recurrence is a WEAK signal: it
orders candidates, it never substitutes for M9v2 gating or for the codebase duplication grep.

**P6 — Feasibility gates BEFORE novelty.** LLM-generated ideas rate higher on novelty
pre-execution but drop significantly more than human ideas on ALL metrics after expert
execution — the Ideation–Execution Gap (43 experts × 100+ hours; arXiv 2506.20803, confirmed
arXiv 2409.04109 for the pre-execution novelty edge). The output schema (Part D) therefore
puts `feasibility_check` before novelty, and M9v2 runs the feasibility attack first.

**P7 — Plan knowledge retrieval each round.** Iteratively planning what external evidence to
fetch before generating (instead of generating from a fixed context) yields 3.4× more unique
novel ideas (NOVA, arXiv 2410.14255). M13 encodes this; every generator also carries a
SEARCH-PLAN preamble step.

**P8 — Few-shot examples define FORMAT only, never ideational content.** Few-shot examples
raise output similarity and lower novelty (Meincke et al. 2024, Wharton/Rotman). Generators
may show the output schema with ONE format-only example; never with example *ideas*.

---

## Part A — The Cost Equation & Lever Taxonomy

Injected as `{{COST_EQUATION}}`. The equation is rate-agnostic and stable; the rates drift.

**Per-request cost**

```
C_request = Σ_d (tokens_d × rate_d) + Σ_t (calls_t × fee_t)
            d ∈ {fresh_input, cache_read_input, cache_write, output, reasoning_tokens}
            t ∈ {server-side tools billed PER CALL (e.g. web search)}        ← NEW, verified
```

**Per-session cost** adds the structural terms per-request accounting misses:

```
C_session = Σ_requests C_request
          + (request_count effects)        // each extra round-trip re-pays the fixed prefix
          + (context-window pressure)      // fullness → compaction → cache bust + re-summary
          + (cache-TTL decay)              // idle > TTL ⇒ prefix rebuilt at the write multiplier
          + (service-tier selection)       // batch/flex/priority multiply ALL token rates  ← NEW
          + (mode-switch re-billing)       // some tier switches re-bill the whole context  ← NEW
```

**Verified rate mechanics (June 2026 — full table with confidence labels in Part F.1):**

- Anthropic cache: read `0.1×` input; write `1.25×` (5-min TTL) / `2.0×` (1-hour TTL);
  **each cache read refreshes the TTL at no charge** (refresh-on-hit) — verified-primary.
- **Batch × cache stack multiplicatively** (Anthropic): `0.5 × 0.1 = 0.05×` input on cached
  reads in batch — verified, documented stacking. The single largest verified lever.
- OpenAI cached input: **50%** off (GPT-4o class) but **90%** off (GPT-5.x class) — the cache
  discount is now model-dependent; automatic ≥1,024-token prefix, 128-token increments;
  default TTL 5–10 min (max ~1 h); `prompt_cache_retention='24h'` at no extra cost.
- **Flex tiers (OpenAI + Gemini): ≈ batch pricing (~50%) with SYNCHRONOUS semantics**,
  preemptible — fills the sequential-agent gap the async Batch API cannot serve.
- Priority tiers cost a premium (OpenAI ≈2×; Gemini +75–100%) — a *negative* lever to avoid
  by default.
- Thinking/reasoning tokens billed at OUTPUT rate everywhere; hiding them from the response
  (`display:"omitted"`, summarized thoughts) does NOT reduce cost. Gemini 2.5 Flash output is
  split-priced (~$0.60/M non-thinking vs ~$3.50/M thinking; `thinkingBudget: 0` disables) —
  still true as of June 2026, re-verified.
- **Per-CALL fees exist now**: e.g. web search ≈ $10 per 1,000 calls (Anthropic + OpenAI);
  some mini models bill a fixed ~8k-token block per search call. Cost is no longer purely
  token-denominated.
- **Mode/tier switches can re-bill the whole context** (e.g. Anthropic Fast Mode
  mid-conversation re-prices the entire accumulated context) — secondary-only, treat as
  advisory until primary-confirmed.
- Anthropic **minimum cacheable prefix**: per-model, **RE-VERIFY AT RUN TIME** — conflicting
  official-domain snippets (1,024 vs 4,096 for current-generation models). Never hard-code.

**The honesty rule, restated:** on a model not in the price table, **every rate is `null`** —
never a default. A proposal that assumes a default rate is rejected (Part E, M9v2 §3).

---

## Part B — Prior-Art Map (what NOT to re-propose)

Injected as `{{PRIOR_ART}}` and as the Round-1 content of `{{FORBIDDEN_THEMES}}`.
The N0 forbidden set is the UNION of:

1. **Shipped features** — the v1 table (f1–f13, P8(a–e), N2/N3/N5/N6, router, budget-gate,
   slo, squeezer, repo-map) PLUS the ROUND-16 set shipped since: **f14** reward-integrity,
   **f15** observation-mask, **f16** read-gate, **f17** program-slice, **f18** clearing-price,
   **f19** wastebench, **prefix-warm**, the **cost-security** hook suite (cost-guard,
   injection-cost, fanout-acceleration, edit-amplification, thrash-detector, preturn-forecast,
   navigation-ratio, tool-error-rate), and the value levers already packaged
   (task-ledger F11, waterbed F12, price-tag F14, churn-pin F9, waste-memo F13, lsp-graph F10,
   context-utility F1, allowance-market F15, futures-desk F16, bounty F17, cache-poison F21,
   anti-synergy G1–G3, cache-reconcile U3, batch-router, prefix-align, ttl-regression,
   retry-reframe F5, ci-validator F6, fleet-cache F7, marginal-value F8, known-knowledge F2,
   pull-context F3).
2. **The frozen research lists** — every entry of `docs/RESEARCH-LIST1.md`,
   `docs/RESEARCH-FEATURE-PROPOSALS.md`, `-L2.md` (F1–F21), `-L3.md`. An idea adjacent to any
   entry must name the entry + the precise delta or it fails N0.

*(Carry the case: lowercase f = shipped TCRP ids; uppercase F = List2/List3 research ids —
see the CLAUDE.md namespace note.)*

**Duplication is checked against the CODE, not just this list:** the v1 ensemble run found two
"novel" top-ranked ideas already shipped on disk (`agent-sdk-adapter/src/cache-planner.ts`,
`ttl-amortization.ts`). M9v2 §1 requires a grep of `packages/` + `apps/` before any
SURVIVES verdict.

---

## Part C — `{{CONSTRAINTS}}` — the seven non-negotiables (unchanged)

(1) deterministic decision core — no model call, no regex classification; (2) fail-safe —
never hang/throw/block the agent; (3) no fabricated numbers — caller-supplied, `null` on
unknown model; (4) equivalence-gated transforms (byte/AST/text/coverage); (5) PII-safe
telemetry — hashes/counts only; (6) vitest + adversarial tests; (7) caller-supplied numbers
only — never parse or guess.

---

## Part D — Canonical Feature-Proposal Output Schema (`{{OUTPUT_SCHEMA}}`)

v1's 12 fields, plus two new fields. **Field order is deliberate: `feasibility_check`
precedes `novelty_vs_prior_art`** (P6 — the Ideation–Execution Gap).

```
- id: kebab-name
- cost_lever: which term(s) of the cost equation it lowers (incl. per-call fees / tier terms)
- tier: 1 (buildable in TokenLens sidecar discipline) | 2 (frontier/model-side research)
- mechanism: 2–4 sentences attacking the causal chain, not the symptom
- feasibility_check:                                                    ← NEW (gates first)
    signal_available: which host/repo signal feeds the decision, and that it EXISTS today
    buildable_shape: package/hook/MCP-tool it would ship as, in this repo's discipline
    falsifiable_test: the vitest/adversarial case that would DISPROVE the saving
- evidence_anchor: the specific verified mechanism it derives from —                ← NEW
    a Part F.1 billing row, a Part F.2 paper mechanism, or "first-principles"
    (allowed, but ranked lowest per the Part E credibility ladder)
- novelty_vs_prior_art: nearest prior-art id + the precise delta
- decision_procedure: the DETERMINISTIC algorithm (inputs → decision); no model call
- equivalence_gate: byte | ast | text | coverage | n/a — and why
- cost_model: formula in caller-supplied tokens; null on unknown model; NET not gross
- measurement_plan: the vitest + adversarial cases that would prove/disprove the saving
- constraint_checklist: the 7 boxes, each ticked with one phrase of justification
- credibility: source URLs / "illustrative" / "caller-supplied" — never a bare number
- effort_risk: S/M/L + the main risk
```

---

## Part E — Credibility & Effectiveness Rubric

**`{{SELF_VERIFY}}`** — run on each proposal before emitting; drop any that fail.
(Feasibility first, per P6.)

```
[ ] FEASIBILITY: the decision signal exists today (or is labelled "needs host signal: X"),
    the buildable shape is named, and a falsifiable vitest case is stated.
[ ] Not a DUPLICATE of any prior-art id or frozen-list entry (name the nearest + the delta).
[ ] Decision core is deterministic — no model call, no regex classification.
[ ] Cost model uses only caller-supplied counts; unknown model ⇒ null, not a guess.
[ ] Names a concrete equivalence gate where it substitutes/compresses content.
[ ] Saving is NET and not double-counted against another term (waterbed check passes).
[ ] Every quantitative claim is caller-supplied, labelled illustrative, or cited.
[ ] evidence_anchor is present (a Part F row, or explicitly "first-principles").
```

**Hard reject rules (M9v2 enforces):** a proposal is `REJECT`, not `REVISE`, if it
(a) fabricates any token/cost/latency number or assumes a default rate on an unknown model;
(b) has a non-deterministic decision core; (c) claims a saving that reappears in another term
(phantom/waterbed); (d) cannot be measured by caller-supplied counts + a vitest/adversarial
suite (unfalsifiable).

**Ranking (survivors only).** Honest expected value:

```
EV = expected_net_saving × usage_frequency × confidence ÷ build_effort      (risk is a veto)
```

`confidence` ladder (strongest → weakest): verified provider mechanic > replicated literature
finding > single-paper finding > first-principles. Recurrence across independent generators
adds rank within a band (P5) — it never moves a candidate up a band (hivemind caveat).

---

## Part G — The Meta-Prompts (verbatim)

`{{...}}` tokens: `{{COST_EQUATION}}` = Part A · `{{PRIOR_ART}}` = Part B ·
`{{CONSTRAINTS}}` = Part C · `{{OUTPUT_SCHEMA}}` = Part D · `{{SELF_VERIFY}}` = Part E ·
`{{FORBIDDEN_THEMES}}` = per Part P3 (orchestrator-injected).

Every generator begins with the same two v2 preamble blocks:

**`{{V2_PREAMBLE}}`** (prepended to every generator):

```
INDEPENDENCE (P1): You are one of several independent generators. You have NOT seen and will
NOT see any other generator's output this round. Do not try to guess or cover for them.

FORBIDDEN THEMES (P2/P3): The following ideas/themes are already taken — proposing one, or a
reskin of one, is an automatic fail. For anything adjacent you must name the nearest item and
the precise delta:
{{FORBIDDEN_THEMES}}

SEARCH PLAN (P7): Before generating, write a 3–5 line plan of which evidence you will lean on
(specific Part F rows / named paper mechanisms / named billing mechanics). Generate only after
the plan. If a needed fact is not in Part F, mark it `unverified` — do not improvise it.

FORMAT (P8): The output schema below defines FORMAT only. No example ideas are provided, by
design — example ideas would anchor you (Meincke et al. 2024).
```

### M1v2 — First-Principles Cost-Equation Decomposition

```
{{V2_PREAMBLE}}

PERSONA (P2): You are a Sr Staff researcher in LLM inference ECONOMICS. Your knowledge
partition: the cost equation and billing structure — NOT the editor, NOT the literature.
You think exclusively in equation terms and causal chains.

GROUNDING (authoritative; do not contradict)
- Cost model: {{COST_EQUATION}}
- Already-built levers: {{PRIOR_ART}}
- Constraints every proposal MUST satisfy: {{CONSTRAINTS}}

DISCOVERY STRATEGY — exhaustive term-by-term decomposition
Walk the cost equation ONE term at a time — fresh_input, cache_read_input, cache_write,
output, reasoning_tokens, per-call tool fees, request_count, context-window pressure,
cache-TTL decay, service-tier selection, mode-switch re-billing. For each term:
  1. State the term and what physically drives it up in an agentic coding loop.
  2. Enumerate EVERY distinct mechanism that could lower it (breadth before judgement).
  3. Check each vs {{FORBIDDEN_THEMES}}: DUPLICATE → discard; adjacent → state the delta.
  4. Keep only mechanisms NOVEL and expressible as a deterministic procedure under
     {{CONSTRAINTS}}.
NOTE the three NEWEST terms (per-call fees, tier selection, mode-switch re-billing) are the
least-mined — spend disproportionate effort there.

REASONING SCAFFOLD
- Write the causal chain term → developer action. Attack the chain, not the symptom.
- A mechanism saves only if the tokens are not re-incurred elsewhere (no waterbed).
- Prefer mechanisms whose DECISION is deterministic even when the agent is not.

OUTPUT — {{OUTPUT_SCHEMA}} (feasibility_check BEFORE novelty). Nothing else.
SELF-VERIFICATION — {{SELF_VERIFY}}
STOP — mark a term "saturated" when it yields only duplicates/violations. 3 strong beat 12 weak.
```

### M2v2 — Whitespace / Lever × Surface Matrix

```
{{V2_PREAMBLE}}

PERSONA (P2): You are a systematic product architect for a local AI-cost sidecar. Your
knowledge partition: the DELIVERY SURFACES and what signal each exposes — not the literature,
not billing. You think in coverage matrices.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}

DISCOVERY STRATEGY — build and mine the CURRENT 2-D matrix
Rows = lever classes: input-reduction, output-reduction, cache-efficiency, model-tier,
reasoning-effort, request-elimination, service-tier/batching, per-call-fee management,
observability/enforcement.
Columns = the surfaces THIS repo actually ships today (audit them, do not assume v1's list):
  - extension command (full editor/workspace state) · status-bar HUD
  - hooks: UserPromptSubmit / PreToolUse / PostToolUse / Stop / PostCompact / SessionStart
    (~30 installed hooks — read apps/extension/hooks/ for the real set and what each consumes)
  - ~70 MCP tools (apps/mcp-server) · MCP proxy (tool catalog + routing)
  - Agent-SDK adapter (request assembly / cache planning) · flags/canary system (flags.mjs)
  - dashboard (historical telemetry) · persistence/exporters (OTel GenAI, FOCUS)
Fill each cell with the prior-art id(s) occupying it. EMPTY or thin cells = candidate
whitespace. For each: propose an honest deterministic feature, OR state why the cell is
empty for a good reason (the surface cannot see the required signal).

REASONING SCAFFOLD
- A feature is buildable in a cell ONLY if that surface exposes the signal it needs. Most
  ideas die here — name the required signal and confirm the surface provides it.
- The matrix is the fixation-breaker (P2): you MUST visit every cell, including boring ones.

OUTPUT {{OUTPUT_SCHEMA}} · SELF-VERIFICATION {{SELF_VERIFY}}
STOP — when every empty cell is either filled by a proposal or justified as intentionally empty.
```

### M3v2 — Cross-Domain Technique Transfer (literature → client-side)

```
{{V2_PREAMBLE}}

PERSONA (P2): You are fluent in the LLM inference/serving-efficiency LITERATURE (Part F.2) —
and in nothing else. Transfer its ideas into a DETERMINISTIC, client-side sidecar that cannot
change the model, weights, or serving stack.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}
- Verified technique catalog: Part F.2 (now includes the 2025–26 set: AgentDiet trajectory
  reduction, observation-masking parity result + its non-monotonicity caveat, ACON, CAT,
  TALE token-budget prompting, NoWait reflection suppression, SkillReducer, lost-in-the-middle
  positioning, StreamingLLM attention sinks, SGLang RadixAttention, semantic caching).

DISCOVERY STRATEGY — principle → client-side analogue → prior-art check
For each catalogued technique:
  1. Name the PRINCIPLE it exploits.
  2. The deterministic CLIENT-SIDE analogue, given we cannot touch attention internals, the
     KV cache, or decoding.
  3. Tier-1 (buildable here) or Tier-2 (model-side → research note only).
  4. Tier-1 analogues vs {{FORBIDDEN_THEMES}}: name the nearest id + delta.
  5. NAME WHERE THE ANALOGY BREAKS — the condition under which the client-side analogue does
     NOT inherit the paper's result (e.g. the masking inverted-U, arXiv 2606.00408).

REASONING SCAFFOLD
- "KV-cache eviction" does NOT transfer literally; its principle does. Always map
  principle → analogue → prior-art → break-condition.
- Cite the source technique (Part F.2 URL) in evidence_anchor for each row.

OUTPUT {{OUTPUT_SCHEMA}} (Tier-2 rows may leave decision_procedure = "model-side")
SELF-VERIFICATION {{SELF_VERIFY}}
STOP — when the catalogue is exhausted; techniques absent from Part F.2 arrive marked `unverified`.
```

### M4v2 — Adversarial Waste-Trace Mining

```
{{V2_PREAMBLE}}

PERSONA (P2): You are an incident investigator for token waste in agentic coding sessions.
Your knowledge partition: observed waste evidence (Part F.3) and host signals — not billing,
not the methods literature.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}
- Documented waste episodes: "simple edit eating 100,000 tokens"; agent loops re-running the
  same failing edit; MCP tool defs ≈22% of context; duplicate file-state/rule blocks;
  surprise bills from runaway sessions.
- External evidence (Part F.3 — cite source+date in `credibility`, never a bare number):
  reads = 76.1% of agent tokens (SWE-Pruner); 39.9–59.7% of input tokens removable at
  performance parity (AgentDiet); 30× same-task token variance, input-dominated cost (MSR);
  code review = 59.4% of multi-agent tokens (Tokenomics); 60% of skill bodies non-actionable
  (SkillReducer); failed trajectories 12–82% longer (Code Agent Behaviour).
- NOTE: failure-taxonomy modes needing an LLM judge (task-drift, reward-hacking, …) FAIL the
  determinism screen — drop them at step 2.

DISCOVERY STRATEGY — autopsy then intervene
For each documented episode AND further plausible episodes you enumerate:
  1. Token-flow autopsy: which equation term inflated, and the precise causal chain.
  2. Earliest deterministic detection point: which host signal (file-read hash, tool-call
     count, byte size, repetition counter, idle timer, billing line-item) reveals it — with
     NO model judgement.
  3. The intervention: a deterministic governor at that point. Check vs {{FORBIDDEN_THEMES}}.

OUTPUT {{OUTPUT_SCHEMA}} · SELF-VERIFICATION {{SELF_VERIFY}}
STOP — when each episode has either a deterministic intervention or an explicit "no honest detector".
```

### M5v2 — Constraint-Relaxation / Capability-Unlock

```
{{V2_PREAMBLE}}

PERSONA (P2): You map the capability frontier set by missing host signals and the seven
constraints. Your knowledge partition: the host integration boundary — hook payloads,
editor APIs, provider response fields.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}

DISCOVERY STRATEGY — two moves
(A) MISSING-SIGNAL unlock: enumerate signals NOT available today — the proposed-action diff,
    per-tool latency, real provider cache-hit telemetry, live system-prompt bytes, live model
    id, per-call tool fee line-items, service-tier of the live request. For each, list the
    honest deterministic features it would unlock; label "needs host signal: X".
(B) CONSTRAINT-PRESSURE redesign: for each constraint, name the most valuable feature it
    forbids, then design an honest variant delivering most of the value WITHOUT relaxing it.

REASONING SCAFFOLD
- Separate "needs a NEW host signal" (legitimate; label it) from "needs to BREAK a constraint"
  (forbidden — emit the honest redesign instead).
- NEVER propose relaxing fail-safe, no-fabrication, or PII-safety.

OUTPUT {{OUTPUT_SCHEMA}} (+ `required_host_signal` note where applicable)
SELF-VERIFICATION {{SELF_VERIFY}} + [ ] no constraint is actually relaxed.
STOP — when each missing signal and each constraint has been worked once.
```

### M6v2 — Pareto Quality–Cost Frontier Search

```
{{V2_PREAMBLE}}

PERSONA (P2): You optimize quality-per-dollar under a strict NON-INFERIORITY discipline.
Your knowledge partition: the quality gate (packages/quality) and configuration dimensions.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}
- Quality gate: acceptance rate, persistence-weighted edit distance, downstream test-pass
  rate; pre-registered non-inferiority tests at a frozen margin.

DISCOVERY STRATEGY — sweep an un-swept configuration dimension
f4/qpd-bench sweeps MODEL tier; P8d sweeps REASONING effort. Identify dimensions NOT yet
swept under the non-inferiority gate — context size, cache-TTL tier, tool-subset size,
batch/flex/interactive tier, retrieval depth, output-budget instruction (TALE-style prompt
budget + max_tokens cap as a JOINT dimension, arXiv 2412.18547: −67% output tokens at
competitive accuracy — illustrative target, never our measured result).

REASONING SCAFFOLD
- Every proposal names the quality metric held fixed and the non-inferiority margin. A cheaper
  config NOT proven non-inferior is a quality regression, not a saving.
- Check overlap with f4/P8d and state the dimensional delta.

OUTPUT {{OUTPUT_SCHEMA}} (cost_model references the held-fixed quality metric)
SELF-VERIFICATION {{SELF_VERIFY}} + [ ] non-inferiority test named; no superiority claim.
STOP — when the un-swept dimensions are enumerated and each worked once.
```

### M7v2 — Provider-Mechanic Arbitrage (June-2026 mechanics)

```
{{V2_PREAMBLE}}

PERSONA (P2): You read provider billing docs adversarially and design deterministic client
behavior that exploits them. Your knowledge partition: Part F.1 ONLY.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}
- VERIFIED catalog (Part F.1, June 2026), including the newly verified set:
  · batch × cache MULTIPLICATIVE stacking (0.05× input on Anthropic cached batch reads)
  · TTL refresh-on-hit (active sessions keep cache warm at write-once amortized cost)
  · model-dependent cache discount (OpenAI 50% on 4o-class vs 90% on GPT-5.x)
  · 24h cache retention at no extra cost (OpenAI prompt_cache_retention)
  · Flex tiers: ~50% off, SYNCHRONOUS, preemptible (OpenAI + Gemini)
  · priority-tier PREMIUMS to avoid (OpenAI ≈2×; Gemini +75–100%)
  · thinking billed at output rate; display-omission ≠ cheaper; Gemini split output pricing
    + thinkingBudget=0
  · per-CALL tool fees (web search ≈$10/1k; fixed ~8k-token blocks on some minis)
  · workspace-level cache isolation (Anthropic, Feb 2026) — fleet-cache implications
- SECONDARY-ONLY (advisory only, no claimed saving): Fast-Mode full-context re-billing on
  mid-session switch; geo multiplier (inference_geo us = 1.1×).
- RE-VERIFY AT RUN TIME: Anthropic per-model minimum cacheable prefix (conflicting snippets).

DISCOVERY STRATEGY — one mechanic at a time
For each VERIFIED mechanic: "what deterministic client-side behavior maximally exploits (or
defends against) this billing rule?" Check each vs {{FORBIDDEN_THEMES}} — especially
batch-router, prefix-align, ttl-regression, cache-habits CH-001..014, N2/N3/N5, replay-cost,
prefix-warm.

REASONING SCAFFOLD
- HARD RULE: every billing number carries a Part F.1 citation (URL + date + confidence label).
  A proposal depending on an unverified or RE-VERIFY mechanic may only be an ADVISORY.
- Negative levers count: a feature that prevents a premium (priority tier, mode-switch
  re-bill, per-call fee burn) is as real as one that earns a discount.

OUTPUT {{OUTPUT_SCHEMA}} · SELF-VERIFICATION {{SELF_VERIFY}} + [ ] every rate cited with date + label.
STOP — when the verified catalogue is exhausted.
```

### M8v2 — Composition / Synergy Search

```
{{V2_PREAMBLE}}

PERSONA (P2): You hunt for super-additive feature combinations AND dangerous anti-synergies.
Your knowledge partition: the SHIPPED fleet as it exists today — ~30 hooks, ~70 MCP tools,
the flags/canary system — not the literature, not billing.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}

DISCOVERY STRATEGY — pairwise (and selected triples) over the CURRENT fleet
For each interacting pair: (1) does one's output feed the other's input? (2) Is the combined
saving super-additive, additive, or a CONFLICT (cache-bust, double-count, advisory-storm)?
Surface (a) novel COMPOUND features worth shipping as one unit, (b) ANTI-SYNERGIES as
guardrails, and (c) FLEET-LEVEL waste: ordering effects, duplicate advice across hooks, the
reflexive token cost of the advisory text itself (check vs f19 wastebench + anti-synergy
G1–G3 before claiming novelty).

REASONING SCAFFOLD
- For every claimed synergy run the cache-bust/waterbed check: does A's transform invalidate
  B's cached prefix? Then it is an ANTI-synergy.
- NET the combined saving; never sum gross.

OUTPUT {{OUTPUT_SCHEMA}} (anti-synergies: cost_lever = "guardrail / avoided loss")
SELF-VERIFICATION {{SELF_VERIFY}} + [ ] combined saving is net; cache-bust interaction checked.
STOP — when notable pairs are covered; do not enumerate trivially-independent pairs.
```

### M10 — Literature-Anchored Mechanism Transfer  *(NEW)*

```
{{V2_PREAMBLE}}

PERSONA (P2): You are a research engineer whose ONLY admissible inputs are the VERIFIED
frontier results in Part F.2/F.3. Every proposal must descend from one named, verified
mechanism. "I think X would help" is inadmissible; "paper P verified mechanism M; its
deterministic client analogue is A; the analogy breaks under condition C" is the only move.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}
SEED MECHANISMS (each verified June 2026; citations in Part F):
  1. Read-op dominance: 76.1% of agent tokens are reads (SWE-Pruner, arXiv 2601.16746).
  2. Trajectory redundancy: 39.9–59.7% of input tokens removable at −1.0%..+2.0% performance
     (AgentDiet, arXiv 2509.23586).
  3. Deterministic observation masking ≥ LLM summarization at ~half cost (arXiv 2508.21433)
     — WITH the inverted-U regime caveat (arXiv 2606.00408): benefit collapses at capacity
     saturation.
  4. Attention sinks: the first ~4 blocks disproportionately stabilize the model
     (StreamingLLM, arXiv 2309.17453).
  5. Lost-in-the-middle: >30% accuracy drop for mid-context placement (arXiv 2307.03172).
  6. Output-budget prompting: −67% output tokens at competitive accuracy (TALE,
     arXiv 2412.18547).
  7. Reflection-filler suppression: −27–51% CoT length at parity (NoWait, arXiv 2506.08343).
  8. Skill bloat: 26.4% of skills lack routing descriptions; >60% of body non-actionable;
     26.8% end-to-end savings (SkillReducer, arXiv 2603.29919).
  9. Multi-agent review tax: code review = 59.4% of tokens; ~2:1 input:output
     (Tokenomics, arXiv 2601.14470).
 10. Same-task cost variance: 30×; input tokens dominate cost (arXiv 2604.22750 / MSR).

DISCOVERY STRATEGY — for each seed mechanism (then any further Part F.2 row):
  1. State the verified mechanism and its number (cited — never re-attributed to us).
  2. Derive the deterministic client-side analogue under {{CONSTRAINTS}}.
  3. State WHERE THE ANALOGY BREAKS (the paper's conditions we cannot reproduce client-side).
  4. N0 check vs {{FORBIDDEN_THEMES}} — several seeds are PARTIALLY covered by shipped
     features (f15 masking, f16 read-gate, f1 trajectory-diet, P8a/P8b, f2 tool-audit):
     the proposal is the DELTA or it is nothing.

OUTPUT {{OUTPUT_SCHEMA}} (evidence_anchor REQUIRED — "first-principles" is inadmissible here)
SELF-VERIFICATION {{SELF_VERIFY}}
STOP — when the seed list + Part F.2 are exhausted.
```

### M11 — Morphological Forced-Coverage  *(NEW)*

```
{{V2_PREAMBLE}}

PERSONA (P2): You are a design-space cartographer. Evidence: structured morphological
matrices measurably increase idea validity/relevance and reduce design fixation vs
unconstrained ideation (HCOMP 2021, arXiv 2110.04129; DRS 2024). Your job is COVERAGE, not
inspiration: visit every cell, including the boring ones — fixation hides in the cells
everyone skips.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}

DISCOVERY STRATEGY — enumerate the FULL 4-axis matrix, then mine it
Axis 1 (cost term): fresh_input / cache_read / cache_write / output / reasoning / per-call
  fees / request_count / window pressure / TTL decay / tier selection.
Axis 2 (session phase): session start / mid-turn / tool-call / turn end / idle gap /
  compaction / session end / BETWEEN sessions / across the fleet.
Axis 3 (decision signal): content hash / byte count / token count / repetition counter /
  timer / git state / billing line-item / flag state / window fullness.
Axis 4 (action class): deny / advise / reorder / substitute / defer / batch / pin / warm /
  meter.
Procedure:
  1. For each (cost term × session phase) pair, list the prior-art ids covering it.
  2. For every EMPTY pair: attempt ≥1 candidate by choosing a signal (axis 3) and an action
     (axis 4). If no honest candidate exists, write WHY (signal unavailable / action would
     violate a constraint) — a justified empty cell is a finding.
  3. N0-check every candidate vs {{FORBIDDEN_THEMES}}.

OUTPUT {{OUTPUT_SCHEMA}} + an appendix: the matrix with each cell marked
  COVERED(id) / PROPOSED(id) / EMPTY(reason).
SELF-VERIFICATION {{SELF_VERIFY}}
STOP — only when every cell is marked. Coverage is the deliverable.
```

### M12 — Medium-Distance Analogical Transfer  *(NEW)*

```
{{V2_PREAMBLE}}

PERSONA (P2): You are an analogist trained on structure-mapping theory. Evidence: analogical
transfer works best at INTERMEDIATE domain distance — enough shared relational structure to
map, enough distance to contribute novelty (Gentner, structure-mapping; cross-domain
retrieval "sweet spot", arXiv 2206.01328). "Find an idea from any far domain" is explicitly
the WRONG prompt — far domains lack the relational scaffolding.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}

DISCOVERY STRATEGY — constrained analogy, one source domain at a time
Admissible source domains MUST share a named mechanism with token economics (the shared
mechanism is stated first, then mapped):
  - CPU/memory cache hierarchies & eviction (shared: read/write asymmetry, TTL, prefetch)
  - CDN & edge caching (shared: prefix invalidation, warm-keeping, purge cost)
  - Compilers/incremental build systems (shared: dependency-closure recomputation, memoization)
  - Congestion pricing / peak-load tariffs (shared: tier premiums, demand shifting)
  - Insurance & deductibles (shared: per-event fees vs metered usage, moral hazard)
  - Inventory logistics / JIT (shared: carrying cost vs stock-out, reorder points)
  - Energy demand-response (shared: shedding, preemptible capacity = Flex tiers)
For each domain:
  1. Name the SHARED MECHANISM precisely (the structural alignment).
  2. Name the source domain's best-practice policy for it.
  3. Map the policy onto a deterministic client-side feature under {{CONSTRAINTS}}.
  4. Name where the mapping breaks (disanalogy), then N0-check vs {{FORBIDDEN_THEMES}}.

OUTPUT {{OUTPUT_SCHEMA}} (evidence_anchor = the named shared mechanism + source-domain policy)
SELF-VERIFICATION {{SELF_VERIFY}}
STOP — when the domain list is exhausted; do not add domains without naming the shared mechanism.
```

### M13 — Iterative Knowledge-Planning Loop  *(NEW — a wrapper, not a standalone generator)*

```
ORCHESTRATION WRAPPER (runs around any generator; encodes NOVA, arXiv 2410.14255: iterative
retrieval planning → 3.4× more unique novel ideas than static-context generation)

ROUND k (k ≥ 1):
  1. PLAN: the wrapped generator emits ONLY a retrieval plan — 3–5 specific questions whose
     answers would let it propose something it cannot propose from current context
     (e.g. "what does the current Anthropic doc say about cache-aware rate limits?",
     "does any Part F.2 paper measure repeated-read waste per FILE TYPE?").
  2. FETCH: the orchestrator answers each question with VERIFIED material only (deep-research
     pass, Part F refresh, repo greps). Unanswerable ⇒ recorded as `unverified — not fetched`.
  3. GENERATE: the generator runs with the fetched material appended to its grounding, and
     {{FORBIDDEN_THEMES}} extended with all themes from rounds < k (P3).
  4. GATE: M9v2 on the round's output; survivors freeze into the round ledger.
TERMINATION: stop when a round yields zero M9v2 survivors, or after 3 rounds, whichever first.
PERSONA ROTATION (P4): between rounds, swap ~half the generator personas for fresh ones.
```

### M9v2 — Falsification / Red-Team  *(evaluator, hardened)*

```
ROLE
You are an adversarial reviewer whose explicit goal is to KILL a proposed token-saving
feature. It survives only if you cannot. You are a designated dissenter, not an aggregator:
neutral "balanced assessment" is a failure mode here (homogeneous-agreement drift,
arXiv 2305.14325 follow-ups; arXiv 2505.22960).

STRUCTURAL RULES (evidence-backed; non-negotiable)
- INDEPENDENCE: You did not generate this proposal and must not have its generator's persona
  or chain-of-thought in context — same-model self-evaluation inflates scores via a
  perplexity-driven mechanism that cannot be prompted away (Panickssery et al., NeurIPS 2024).
  The orchestrator runs you as a SEPARATE pass; where available, a different model family.
- EXTERNAL ORACLE, NOT INTROSPECTION: free-form "reconsider" critique DEGRADES accuracy
  without external signals (Huang et al., ICLR 2024). Every objection you raise must be
  grounded in a checkable artifact: a grep of packages/ + apps/ (duplication), the cost
  equation (waterbed), a Part F row (rates/claims), a constructed adversarial input
  (fail-safety), or a named vitest case (falsifiability). No vibes.
- FIXED CHECKLIST, NOT HOLISTIC JUDGMENT: run ALL eight attacks below in order; report the
  strongest surviving objection per attack. (Structured rubrics out-correlate free-form
  judging; checklist also blocks verbosity bias.)
- LENGTH-BLIND: score substance only. Do not reward detail, fluency, or formality
  (verbosity bias). A long weak proposal is weak.
- PAIRWISE TIES: if asked to compare two proposals, evaluate BOTH orders (A-then-B and
  B-then-A); inconsistent verdicts ⇒ TIE (position bias shifts pairwise outcomes >10pp).

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}
INPUT — one Feature Proposal in {{OUTPUT_SCHEMA}} (pasted below this prompt).

ATTACK PLAN — attempt each; report the strongest surviving objection per line
0. FEASIBILITY-FIRST (the Ideation–Execution Gap gate, arXiv 2506.20803): does the claimed
   decision signal EXIST today on the named surface? Is the buildable shape real in this
   repo's discipline? Is the falsifiable vitest case actually constructible? A novel idea
   that fails here is REJECTED before novelty is even considered.
1. DUPLICATION: is it a prior-art id or frozen-list entry reskinned? GREP packages/ and
   apps/ for the mechanism before answering — the v1 run shipped two "novel" ideas that
   already existed on disk. Name the file if found.
2. PHANTOM SAVING: trace the tokens. Do the "saved" tokens reappear in another term
   (waterbed)? Gross-counted when the real figure is net of the cost to obtain it
   (cache-write multiplier, recompute, extra round-trip, the advisory text itself)?
3. FABRICATION: any number not caller-supplied, cited, or labelled illustrative? Any assumed
   default price/window on an unknown model? Any Part F number quoted without its confidence
   label (or quoted despite a RE-VERIFY mark)?
4. NON-DETERMINISM: does the DECISION secretly need a model call, regex classifier, or
   non-reproducible heuristic? Could two runs disagree?
5. EQUIVALENCE HOLE: where it substitutes/compresses, is there a real gate? Construct an
   input where the transform changes semantics but the gate passes.
6. FAIL-UNSAFE: construct a malformed/huge/empty input that makes it hang, throw, or block
   the agent.
7. MEASURABILITY: can the saving be measured with caller-supplied counts + a
   vitest/adversarial suite? If not → unfalsifiable → REJECT.

VERDICT (required)
- verdict: SURVIVES | REVISE | REJECT
- killing_objections: [ ... ]      // ones it could not answer, each tied to its artifact
- required_revisions: [ ... ]      // what would make it survive, if REVISE
- residual_risk: "..."             // what remains even if SURVIVES
Do not be charitable. An unfalsifiable or phantom saving is a REJECT, not a REVISE.
```

---

## Part W — Weak-Evidence Flags (do NOT encode as method)

Findings popular in practitioner lore that the research pass found contested or refuted.
Generators and evaluators must not lean on them.

| Folklore | Status | Evidence |
|----------|--------|----------|
| "TRIZ contradiction matrix reliably finds the best solution" | Heuristic only — no controlled trials; ~50% of analyzed patents don't comply with the matrix; the "30% dev-time reduction" figure has no peer-reviewed source | Altshuller's Contradiction Matrix: A Critical View (2018) |
| "Group brainstorming doubles idea output" (Osborn 1953) | REFUTED — nominal groups beat interactive groups on quantity AND quality | Mullen, Johnson & Salas 1991 meta-analysis |
| "SCAMPER increases viable ideas by 25%" | Effect sizes not established in professional innovation contexts; evidence is quasi-experimental/educational | (survey of SCAMPER studies) |
| "Multi-agent debate is universally better" | Inconsistent without genuine role diversity; homogeneous debate shows sycophantic convergence / majority tyranny | arXiv 2505.22960; arXiv 2509.05396; arXiv 2509.23055 |
| "High novelty ratings at ideation predict value" | REFUTED for LLM-generated ideas — scores collapse under execution | arXiv 2506.20803 |
| "More samples / higher temperature = more diverse ideas" | REFUTED — Artificial Hivemind | arXiv 2510.22954 |

Morphological matrices and persona partitioning, by contrast, carry positive evidence
(arXiv 2110.04129; DRS 2024; arXiv 2602.20408) — which is why M11 and the PERSONA headers
exist.

---

## Part F — Verified Sources Appendix (June 2026, adversarially re-verified)

Every row below survived the 2-verifier pass unless marked otherwise. Labels:
**verified-primary** = official-domain text (via search snippet; 403 fetch caveat, Part 0) ·
**secondary-only** = ≥2 independent secondary sources, no official-domain text ·
**RE-VERIFY** = conflicting sources; check live docs before use.

### F.1 — Provider billing & caching mechanics

| Mechanic | Verified value | Label | Source |
|----------|----------------|-------|--------|
| Anthropic cache read | `0.1 × input` | verified-primary | docs.anthropic.com /build-with-claude/prompt-caching |
| Anthropic cache write | `1.25 ×` (5-min TTL) / `2.0 ×` (1-hour TTL) | verified-primary | same |
| Anthropic TTL refresh-on-hit | every cache read resets the TTL, no extra charge | verified-primary | platform.claude.com prompt-caching |
| Anthropic breakpoints / lookback | max 4 `cache_control`; ~20-block lookback | verified-primary | same |
| **Batch × cache stacking** | multiplicative: `0.5 × 0.1 = 0.05×` input on cached batch reads | verified-primary | platform.claude.com; ai.moda batches-with-caching |
| Anthropic Message Batches | 50% off all usage; ≤24 h | verified-primary | docs.anthropic.com message-batches |
| Anthropic min cacheable prefix | per-model; **conflicting snippets** (1,024 vs 4,096 on current models) | **RE-VERIFY** | docs.anthropic.com (conflict logged Part 0) |
| Anthropic cache isolation | workspace-level since Feb 5, 2026 (was org-level) | verified-primary | docs.anthropic.com release notes |
| Anthropic extended thinking | billed at OUTPUT rate; `display:"omitted"` reduces latency NOT cost | verified-primary | platform.claude.com extended-thinking |
| Anthropic web-search tool | ≈$10 per 1,000 searches + token costs | verified-primary (existence) | docs.anthropic.com web-search-tool; TechCrunch 2025-05 |
| Anthropic Fast Mode re-billing | mid-session switch re-bills entire context at the new rate | secondary-only — advisory use only | multiple secondary |
| Anthropic geo multiplier | `inference_geo:"us"` ⇒ 1.1× all token categories (Opus 4.6+) | verified-primary | docs.anthropic.com service-tiers |
| OpenAI cached input (4o-class) | 50% off; automatic ≥1,024-token prefix, +128 increments | verified-primary | platform.openai.com prompt-caching |
| OpenAI cached input (GPT-5.x) | **90% off** | verified-primary | openai.com/api/pricing |
| OpenAI cache TTL | 5–10 min inactivity (max ~1 h); `prompt_cache_retention='24h'` at no extra cost | verified-primary | developers.openai.com prompt-caching |
| OpenAI Batch API | 50% off in/out; 24 h window | verified-primary | developers.openai.com batch |
| OpenAI **Flex processing** | ≈Batch pricing, SYNCHRONOUS endpoint, preemptible (beta) | verified-primary | developers.openai.com flex-processing; TechCrunch 2025-04 |
| OpenAI Priority processing | ≈2× standard rate | verified-primary (existence) | openai.com/api-priority-processing |
| OpenAI web-search tool | $10/1k calls standard; some minis bill a fixed ~8k-token block per call | secondary-only | platform.openai.com tools-web-search (snippets) |
| OpenAI reasoning | reasoning tokens billed as output; `reasoning_effort` low/medium/high (+none/xhigh on some) materially changes spend | verified-primary | developers.openai.com reasoning |
| Gemini implicit caching | default-on 2.5+; ~90% off on hit (raised from 75%); no storage fee; **no hit guarantee** | verified-primary | ai.google.dev caching; Logan Kilpatrick announcement |
| Gemini explicit caching | billed token-count × TTL storage; TTL default 1 h, unbounded | verified-primary | ai.google.dev caching |
| Gemini min cacheable | 2,048 (2.5 Flash/Pro); differs on 3.x — check per model | verified-primary | ai.google.dev caching |
| Gemini 2.5 Flash output split | ~$0.60/M non-thinking vs ~$3.50/M thinking; `thinkingBudget:0` disables; split CONFIRMED still live June 2026 | verified-primary | ai.google.dev pricing (page updated 2026-06-05) |
| Gemini thinking billing | full thought tokens billed even when only a summary is returned | verified-primary | ai.google.dev thinking |
| Gemini Batch | 50% of standard; 24 h | verified-primary | ai.google.dev batch-api |
| Gemini **Flex inference** | 50% off, synchronous, sheddable (`service_tier:'flex'`) | verified-primary | ai.google.dev flex-inference; Google blog |
| Gemini Priority inference | +75–100% premium; non-sheddable | secondary-only | ai.google.dev priority-inference (snippets) |
| Gemini 3 grounding | $14/1k search queries after 5k/mo free; retrieved context NOT billed as input | verified-primary | ai.google.dev google-search |
| TTL silent regression risk | 1h→5m TTL can regress silently, inflating cost | medium | anthropics/claude-code issue #46829 |

### F.2 — Efficiency-technique catalog (for M3v2 / M10)

v1 rows retained (LLMLingua 2310.05736 · LongLLMLingua 2310.06839 · FrugalGPT 2305.05176 ·
RouteLLM 2406.18665 · H2O 2306.14048 · StreamingLLM 2309.17453 · speculative decoding
2211.17192), PLUS the 2025–26 set, all adversarially verified:

| Technique | Verified result | arXiv | Client-side transfer note |
|-----------|-----------------|-------|---------------------------|
| SWE-Pruner | reads = **76.1%** of agent tokens; 23–54% reduction on SWE-bench Verified | 2601.16746 | the read-dominance number motivates every input-side lever; the 0.6B skimmer itself is model-based (Tier-2) — deterministic surrogates only |
| AgentDiet | **39.9–59.7%** input-token reduction at −1.0%..+2.0% performance | 2509.23586 | trajectory redundancy is structurally classifiable (repeated path, unchanged SHA, zero-diff) |
| Complexity Trap | deterministic observation masking ≈ LLM summarization solve rate at ~half cost | 2508.21433 | direct validation of f15's approach |
| Masking regime map | masking benefit is an **inverted-U** in model capacity; collapses at saturation | 2606.00408 | a WHEN-to-mask governor is the missing piece, not more masking |
| ACON | 26–54% peak-context reduction on long-horizon agents | 2510.00615 | the trigger arithmetic (ECF thresholds) is deterministic; the compressor is not |
| CAT / SWE-Compressor | compression-as-a-tool-call beats static compression; 57.6% solved under bounded context | 2512.22087 | zoned context (stable / condensed / high-fidelity-recent) with arithmetic triggers |
| TALE | prompt-injected token budget: **−67%** output tokens, −59% expense at competitive accuracy | 2412.18547 | prompt-side actuation pairs with the max_tokens cap (P8b) |
| NoWait | suppressing reflection fillers: **−27–51%** CoT length, no accuracy loss | 2506.08343 | server-side logit masking is Tier-2; stripping filler from RE-SENT history is client-side |
| SkillReducer | 26.4% of skills lack routing descriptions; >60% body non-actionable; 26.8% e2e savings | 2603.29919 | tool_audit's mechanism extended to the skills surface |
| Tokenomics | code review = **59.4%** of multi-agent tokens; ~2:1 input:output | 2601.14470 | the review phase is the un-dieted phase |
| Agent spend analysis | **30×** same-task token variance; input dominates cost | 2604.22750 (MSR) | variance itself is a detectable signal |
| Lost in the Middle | >30% accuracy drop for mid-context placement (U-curve) | 2307.03172 (TACL) | placement is free: reorder, don't just select |
| GPT Semantic Cache | 61.6–68.8% API-call reduction via embedding cache | 2411.05276 | f7 is the shipped deterministic cousin |
| Compression breakeven | LLMLingua end-to-end gains only inside an operating window; compression cost can cancel gains | 2604.02985 | every compressor needs an arithmetic pre-filter (skip below threshold) |

### F.3 — External waste evidence (unchanged rows from v1 remain valid)

v1's F.3 table stands (Code Agent Behaviour 2511.00197; How Do AI Agents Spend Your Money
2604.22750; Tokenomics 2601.14470; practitioner 60–80% waste estimates; stateful-transport
`unverified`), with SWE-Pruner/AgentDiet numbers now adversarially re-verified (see F.2).

### F.4 — Ideation-methodology evidence (NEW; grounds Part P)

| Finding | Number | Source | Verdict |
|---------|--------|--------|---------|
| Nominal > interactive brainstorming | r≈.57 quantity, r≈.56 quality | Mullen, Johnson & Salas 1991 (meta-analysis, 20 studies) | SUPPORTED |
| Artificial Hivemind: samples don't diversify | intra-model repetition + inter-model homogeneity across 70+ LLMs | arXiv **2510.22954** (NeurIPS 2025 Best Paper) | SUPPORTED (ID corrected) |
| Persona/CoT interventions raise diversity | fixation + aggregation barriers addressable in-prompt | arXiv 2602.20408 (Deng, Brucks & Toubia) | SUPPORTED |
| Self-consistency | +17.9pp GSM8K (greedy → 40-sample majority) | arXiv 2203.11171 (ICLR 2023) | SUPPORTED |
| 8 agents / 5 turns / 50% turnover optimum | peak novelty at those settings | arXiv 2410.09403 (VirSci) | SUPPORTED |
| Iterative knowledge planning | 3.4× more unique novel ideas | arXiv 2410.14255 (NOVA) | SUPPORTED |
| Ideation–Execution Gap | LLM ideas drop more than human ideas on ALL metrics after 100+ h expert execution | arXiv 2506.20803 (43 experts) | SUPPORTED |
| LLM novelty edge pre-execution | AI ideas 5.64 vs human 4.84 novelty (p<0.01) | arXiv 2409.04109 | SUPPORTED |
| Morphological matrix benefit | significantly more valid/relevant ideas; reduced fixation | arXiv 2110.04129 (HCOMP 2021); DRS 2024 | SUPPORTED (nuance: relevance is the tested metric) |
| Medium-distance analogy sweet spot | near/far trade-off; structure-mapping | Gentner (OECS 2025); arXiv 2206.01328 | SUPPORTED |
| Few-shot anchors similarity | few-shot ↑ similarity, persona ↑ diversity | Meincke et al. 2024 (Wharton/Rotman) | SUPPORTED |

### F.5 — Generator/evaluator architecture evidence (NEW; grounds M9v2)

| Finding | Source | Verdict |
|---------|--------|---------|
| Self-preference bias is mechanistic (perplexity-linked) and linear in self-recognition | Panickssery et al., NeurIPS 2024 (arXiv 2404.13076); arXiv 2410.21819 | SUPPORTED |
| Intrinsic self-correction DEGRADES reasoning (GPT-4: 95.5→91.5 GSM8K) | Huang et al., ICLR 2024 (arXiv 2310.01798) | SUPPORTED |
| Self-refinement amplifies self-bias monotonically | arXiv 2402.11436 | supported (single source) |
| Position bias: >10pp swing on order swap | OpenReview y3jJmrKWQ4 + judge-bias surveys | SUPPORTED |
| Verbosity bias: judges favor longer outputs | Saito et al. 2023 + surveys | SUPPORTED |
| Homogeneous debate → sycophantic convergence | arXiv 2305.14325 (+8–15pp when diverse) vs 2509.05396 / 2509.23055 / 2505.22960 (failure modes) | SUPPORTED both ways — diversity is the moderator |
| External feedback dominates intrinsic critique (Reflexion +22pp AlfWorld WITH oracle) | Shinn et al., NeurIPS 2023 (arXiv 2303.11366) | SUPPORTED |
| Score-trajectory feedback enables optimization (OPRO +8.4pp GSM8K) | arXiv 2309.03409; small-model collapse: ACL 2024 findings-acl.100 | SUPPORTED |

---

## Appendix S — Evidence-Seeded Candidates (Round-0 input to the next discovery run)

Nine candidates fall directly out of the verified evidence. **They are SEEDS, not survivors**
(P6: idea-stage screening is unreliable) — each must pass M9v2 (incl. the `packages/` grep)
before entering any list. Each is stated with its N0 anchor.

| # | id | evidence_anchor | nearest prior art | the delta |
|---|----|-----------------|-------------------|-----------|
| 1 | `masking-regime-gate` | inverted-U regime map (2606.00408) | f15 observation-mask | decides WHETHER masking helps this session (re-read rate × dedup rate × fullness), not what to mask |
| 2 | `attention-sink-protector` | StreamingLLM sinks (2309.17453) | compaction-recover, cache-stabilize | hard positional rule: never compact/evict blocks 1–N — protects model stability, not cache economics |
| 3 | `context-position-reorderer` | lost-in-the-middle (2307.03172) | prune-intelligence relevance | controls WHERE chunks go (head/tail vs middle), not what is included |
| 4 | `service-tier-router` | Flex tiers verified (F.1) | batch-router (List1) | synchronous Flex lane serves sequential agent chains async batch cannot; also avoids priority premiums |
| 5 | `mode-switch-rebill-guard` | Fast-Mode re-billing (F.1, secondary-only ⇒ advisory) | cache-habits CH rules | a tier/mode switch that re-bills the whole context is a new, un-covered cache-killer class |
| 6 | `reflection-token-compactor` | NoWait (2506.08343) | response-tuner P8(a) | strips reflection filler from PRIOR ASSISTANT TURNS re-sent as history (P8a prunes tool results) |
| 7 | `skill-bloat-auditor` | SkillReducer (2603.29919) | f2 tool_audit, f12 skill-library | audits the .claude/skills surface (routing descriptions, body bloat, reference-file injection caps) |
| 8 | `server-tool-call-cost-meter` | per-call fees verified (F.1) | budget-gate, attribution | per-CALL fees are a non-token billing dimension invisible to every shipped meter |
| 9 | `prompt-budget-injector` | TALE (2412.18547) | response-tuner P8(b) | prompt-side budget instruction as a lever PAIRED with the max_tokens cap |

Checked and **rejected as duplicates** during seeding (the N0 gate working): cache-threshold
padding (≈ prefix-align), thinking gate (≈ P8(d) + CH-009), output scaffold templates
(≈ List1 output-shape-constrainer), Gemini implicit/explicit selector (List1), AgentDiet-style
trajectory auditing as a whole (≈ f1/f15/f16 cover the mechanism; only deltas qualify).

---

*v2 generated June 2026 from an executed, adversarially verified deep-research pass. Rates
and paper claims drift: re-run the verification pass (Part 0 method) before trusting any
number; the equations, the protocol, and the prompts are stable — the numbers are not.*

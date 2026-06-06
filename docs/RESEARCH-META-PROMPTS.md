# Research Meta-Prompt Library — Token/Cost-Saving Feature Discovery

> A reusable, credibility-gated instrument for systematically discovering **new** token/cost-saving
> features for TokenLens/Prune. You feed these prompts to a frontier model; it returns falsifiable,
> comparable, honest feature proposals that obey the repo's engineering discipline.
>
> Companion artifact: **`docs/RESEARCH-FEATURE-PROPOSALS.md`** — a dated, vetted batch produced by
> running this library end-to-end.

---

## How to use this library

This is a **fan-out → gate → rank funnel**, not nine independent runs:

1. **Generators (M1–M8)** fan out many candidates, each from a different discovery mechanism.
2. **Evaluator (M9)** is the funnel — it tries to *kill* every candidate; only survivors advance.
3. **Dedup + rank** survivors by honest expected value; the top shortlist feeds the repo's existing
   `packages/quality` non-inferiority gate before anything is built.

**Recommended run order** (there is a hard dependency: M3/M7 need Part F first):

```
deep-research → Part A + Part F   (verify the cost rates + technique/billing catalog)
   → M1, M2        (spanning: map the whole lever space)
   → M3, M7        (inject outside knowledge: literature + provider billing)
   → M4, M5, M6, M8 (targeted; SEED with M1/M2 survivors)
   → M9 gates EVERYTHING → dedup/merge → rank → "top N to spec next"
```

**Which prompt for which goal**

| Goal | Use |
|------|-----|
| Map the entire opportunity space from scratch | M1, M2 |
| Import genuinely novel techniques | M3 (literature), M7 (provider billing) |
| Fix observed, concrete waste | M4 |
| Find what a new host signal would unlock | M5 |
| Cut cost at fixed quality | M6 |
| Combine existing features for compound savings | M8 |
| Decide whether ANY candidate is real | M9 (run on all) |

**Honesty discipline (inherited from `CLAUDE.md` and `pending_Action_03_Jun.md`).** Every proposal must
be deterministic in its decision core, fail-safe, equivalence-gated where it transforms content, and
free of fabricated numbers (caller-supplied; `null` on an unknown model). These are encoded as hard
gates in Part E; M9 enforces them.

---

## Part A — The Cost Equation & Lever Taxonomy

Every meta-prompt injects this as `{{COST_EQUATION}}`. It is the substrate the model decomposes.

**Per-request cost**

```
C_request = Σ_d (tokens_d × rate_d),   d ∈ {fresh_input, cache_read_input, cache_write,
                                            output, reasoning_tokens}
```

**Per-session cost** adds three structural terms that per-request accounting misses:

```
C_session = Σ_requests C_request
          + (request_count effects)            // each extra round-trip re-pays fixed prefix
          + (context-window pressure)           // fullness → compaction → cache bust + re-summary
          + (cache-TTL decay)                   // idle > TTL ⇒ prefix rebuilt at the write multiplier
```

**The dimensions the system already models** (`packages/shared/src/pricing.ts`): `input`, `output`,
`cached_input` (prompt-cache read tier), `contextWindow`. The cold-vs-replay split (shared prefix served
at the read tier vs. cold re-run at full rate) is modeled in
`packages/replay-cost/src/cost-model.ts`.

**Verified rate mechanics** (June 2026 — see Part F for sources; rates drift, the *equation* does not):

- **Cache read** ≈ `0.1 × input` (Anthropic); **0.5 × input** (OpenAI); up to **0.1 × input** (Gemini 2.5).
- **Cache write** = `1.25 × input` (5-min TTL) or `2 × input` (1-hour TTL) — Anthropic.
- **Reasoning/thinking tokens** are billed as output and consume the window before the visible answer.
- **Batch API** ≈ `0.5 ×` all token rates (Anthropic, OpenAI, Gemini) for async/non-interactive work.
- **Minimum cacheable prefix**: 1,024–4,096 tokens depending on model — below it, caching is a no-op.

**The honesty rule, restated:** on a model not in the price table, **every rate is `null`** — never a
default. A proposal that assumes a default rate is rejected (Part E, M9 §3).

---

## Part B — Prior-Art Map (what NOT to re-propose)

Injected as `{{PRIOR_ART}}`. Proposing any of these as "new" is an automatic fail; the closest id and
the exact delta must be named for any adjacent idea.
*(Canonical sources: `CLAUDE.md` TCRP Feature Map; `packages/shared/src/feature-flags.ts`;
`packages/cache-habits/src/rules.ts`; `pending_Action_03_Jun.md`.)*

| id | lever | one-line mechanism |
|----|-------|--------------------|
| f1 | input | advise skipping low-influence retrieval steps |
| f2 | input | flag bloated MCP tool definitions |
| f3 | cache | session-scoped file-content read cache |
| f4 | model-tier | pick a quality-equivalent cheaper model tier (QpD) |
| f5 | observability | status-bar token/cost HUD (honest pricing) |
| f6 | window | Effective Context Fullness + CUSUM inflection warnings |
| f7 | cache | similarity + freshness-gated semantic response cache |
| f8 | input | JSON-schema → typed TS API (smaller tool schemas) + vm sandbox |
| f9 / E3 | cache | cache-killer linter, rules CH-001..CH-012 |
| f10 / E1 | input | lazy-schema MCP proxy returns only intent-matching tools |
| f11 / E2 | cache | what-if deterministic replay-cost (shared-prefix re-serve vs cold) |
| f12 / E4 | request | capture + replay typed cross-session skills |
| f13 / E5 | output/latency | speculative READ-ONLY tool execution on a sandbox worktree |
| P8(a) | output | tool-result sub-token pruner |
| P8(b) | output | statistical `max_tokens` calibrator |
| P8(c) | output | diff-vs-rewrite enforcer (round-trip proven) |
| P8(d) | reasoning | reasoning-effort auto-router (actuates CH-009) |
| P8(e) | input | open-editor-tab relevance auditor |
| N2 | cache | delta cache-resend (salvage surviving prefix run) |
| N3 | cache | cross-turn input recompression planner (amortize 1 write over N reads) |
| N5 | cache | session-idle cache guard (EV-positive heartbeat vs rebuild) |
| N6 | request | pre-spawn subagent cost-predictor |
| router | model-tier | deterministic 3-tier (Haiku/Sonnet/Opus) routing |
| budget-gate | enforcement | spend envelopes + soft/hard caps |
| slo | enforcement | cost error-budget circuit breaker |
| squeezer | input | tree-sitter 3-tier code compression |
| repo-map | input | symbol-level PageRank context selection |

---

## Part C — The Meta-Prompts (verbatim)

The `{{...}}` tokens are the shared blocks: `{{COST_EQUATION}}` = Part A, `{{PRIOR_ART}}` = Part B,
`{{CONSTRAINTS}}` = the seven below, `{{OUTPUT_SCHEMA}}` = Part D, `{{SELF_VERIFY}}` = Part E checklist.

**`{{CONSTRAINTS}}` — the seven non-negotiables:** (1) deterministic decision core — no model call, no
regex classification; (2) fail-safe — never hang/throw/block the agent; (3) no fabricated numbers —
caller-supplied, `null` on unknown model; (4) equivalence-gated transforms (byte/AST/text/coverage);
(5) PII-safe telemetry — hashes/counts only; (6) vitest + adversarial tests; (7) caller-supplied numbers
only — never parse or guess.

### M1 — First-Principles Cost-Equation Decomposition

```
ROLE
You are a Sr Staff researcher in LLM inference economics. Discover NEW, buildable mechanisms
that reduce per-request and per-session cost of an agentic AI coding assistant — do not restate
known ones.

GROUNDING (authoritative; do not contradict)
- Cost model: {{COST_EQUATION}}
- Already-built levers (proposing any = failure): {{PRIOR_ART}}
- Constraints every proposal MUST satisfy: {{CONSTRAINTS}}

DISCOVERY STRATEGY — exhaustive term-by-term decomposition
Walk the cost equation ONE term at a time: fresh_input, cache_read_input, cache_write, output,
reasoning_tokens, request_count, context-window pressure, cache-TTL decay. For each term:
  1. State the term and what physically drives it up in an agentic coding loop.
  2. Enumerate EVERY distinct mechanism that could lower it (breadth before judgement).
  3. Check each vs PRIOR ART: DUPLICATE → discard; adjacent-but-distinct → state the exact delta
     from the closest id.
  4. Keep only mechanisms that are NOVEL and expressible as a deterministic procedure under
     {{CONSTRAINTS}}.

REASONING SCAFFOLD (think before emitting)
- Write the causal chain term → developer action (e.g. output ← model rewrites whole file ← agent
  lacks a cheap diff path). Attack the chain, not the symptom.
- A mechanism saves only if the tokens are not re-incurred elsewhere (no waterbed). State where the
  saving lands and what it costs to obtain.
- Prefer mechanisms whose DECISION is deterministic even when the underlying agent is not.

OUTPUT — emit proposals in {{OUTPUT_SCHEMA}}. Nothing else.
SELF-VERIFICATION — {{SELF_VERIFY}}
STOP CONDITIONS
- Stop a term when it yields only DUPLICATE/constraint-violating mechanisms; mark "TERM X: saturated."
- Do not pad. 3 strong novel proposals beat 12 weak ones.
```

### M2 — Whitespace / Lever × Surface Matrix

```
ROLE
You are a systematic product architect for a local AI-cost sidecar. Find UNOCCUPIED build cells.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}

DISCOVERY STRATEGY — build and mine a 2-D matrix
Rows = lever classes: input-reduction, output-reduction, cache-efficiency, model-tier,
reasoning-effort, request-elimination, observability/enforcement.
Columns = delivery surfaces and the signal each actually exposes:
  - extension command (full editor/workspace state)
  - hook @ UserPromptSubmit (the prompt) / PreToolUse (proposed tool call + args) /
    PostToolUse (tool result) / Stop (turn end) / PostCompact (compaction event)
  - MCP tool (only its typed inputs) · MCP proxy (tool catalog + call routing)
  - Agent-SDK adapter (request assembly / cache planning) · dashboard (historical telemetry)
Fill each cell with the prior-art id(s) occupying it. EMPTY or thin cells = candidate whitespace.
For each candidate: propose an honest deterministic feature, OR state why the cell is empty for a
good reason (e.g. the surface cannot see the required signal).

REASONING SCAFFOLD
- A feature is buildable in a cell ONLY if that surface exposes the signal it needs. Most ideas die
  here — name the required signal and confirm the surface provides it.
- Cross every survivor against {{PRIOR_ART}} for novelty.

OUTPUT {{OUTPUT_SCHEMA}} · SELF-VERIFICATION {{SELF_VERIFY}}
STOP — when every empty cell is either filled by a proposal or justified as intentionally empty.
```

### M3 — Cross-Domain Technique Transfer

```
ROLE
You are fluent in the LLM inference/serving-efficiency literature. Transfer its ideas into a
DETERMINISTIC, client-side sidecar that cannot change the model, its weights, or its serving stack.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}
- Verified technique catalog (Part F): KV-cache eviction (H2O, StreamingLLM), speculative decoding,
  prompt compression (LLMLingua/LongLLMLingua), model cascades/routing (FrugalGPT, RouteLLM),
  constrained/structured decoding, RAG/context pruning & reranking, distillation, quantization,
  continuous batching, prefix sharing/caching.

DISCOVERY STRATEGY — principle → client-side analogue → prior-art check
For each catalogued technique:
  1. Name the PRINCIPLE it exploits (e.g. "drop low-attention context", "verify-cheap/generate-cheap").
  2. Ask: what is the deterministic CLIENT-SIDE analogue, given we cannot touch attention internals,
     the KV cache, or decoding?
  3. Classify Tier-1 (client-side analogue buildable here) or Tier-2 (only realizable model-side →
     record as research, not a feature).
  4. Check Tier-1 analogues vs {{PRIOR_ART}}; state the delta from the nearest id.

REASONING SCAFFOLD
- Be explicit about the boundary. "KV-cache eviction" does NOT transfer literally; its principle
  (drop low-influence context before send) has a client analogue that must be checked vs
  f1/f6/tab-auditor. Always map principle → analogue → prior-art.
- Cite the source technique (Part F URL) for each row.

OUTPUT {{OUTPUT_SCHEMA}} (set `tier` honestly; Tier-2 rows may leave decision_procedure = "model-side")
SELF-VERIFICATION {{SELF_VERIFY}}
STOP — when the catalogue is exhausted; do not invent techniques absent from Part F without marking
them `unverified`.
```

### M4 — Adversarial Waste-Trace Mining

```
ROLE
You are an incident investigator for token waste in agentic coding sessions.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}
- Documented waste episodes (tokenlens.md): "simple edit eating 100,000 tokens"; agent loops
  re-running the same failing edit; MCP tool defs at ~22% of context; duplicate file-state/rule
  blocks; surprise bills from runaway sessions.
- External waste-evidence (2026 research, Part F.3 — cite source+date in `credibility`, never a bare
  number): reads = 76.1% of agent tokens (SWE-Pruner); repository navigation dominates patch-writing and
  failed trajectories run 12–82% longer (Code Agent Behaviour); accuracy peaks at intermediate cost
  (How Do AI Agents Spend Your Money?); input = 53.9% / verification = 59.4%, the "communication tax"
  (Tokenomics); 60–80% of agent tokens are waste — repeated reads, failed iterations, verbose output
  (practitioner). NOTE: the SWE-agent failure taxonomy (task-drift, reward-hacking, alignment-faking, …)
  is mostly LLM-judge-only — drop those at the determinism screen; only degeneration-loop and host-tagged
  tool-error-rate survive.

DISCOVERY STRATEGY — autopsy then intervene
For each documented episode AND additional plausible agentic-coding episodes you enumerate
(redundant re-reads, oversized grep/test output dumped into context, re-explaining unchanged code,
file thrashing, re-sending stable system blocks):
  1. Token-flow autopsy: which equation term inflated, and the precise causal chain.
  2. Earliest deterministic detection point: which host signal (file-read hash, tool-call count,
     byte size, repetition counter, idle timer) reveals it — with NO model judgement.
  3. The intervention: a deterministic governor that fires at that point. Check vs {{PRIOR_ART}}.

REASONING SCAFFOLD
- If detection requires a semantic/model judgement, it is OUT OF SCOPE — say so and drop it.
- Distinguish detection (cheap, deterministic) from remedy (must also pass {{CONSTRAINTS}}).

OUTPUT {{OUTPUT_SCHEMA}} · SELF-VERIFICATION {{SELF_VERIFY}}
STOP — when each episode has either a deterministic intervention or an explicit "no honest detector".
```

### M5 — Constraint-Relaxation / Capability-Unlock

```
ROLE
You map the capability frontier set by missing host signals and by the seven constraints.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}

DISCOVERY STRATEGY — two moves
(A) MISSING-SIGNAL unlock: enumerate signals NOT available to the host today — the proposed-action
    diff (absent from Claude Code hook payloads, which is exactly why 11/12 CH-rules and the
    diff-enforcer can't be hook-wired), per-tool latency, real provider cache-hit telemetry, the
    live system-prompt bytes, the live model id. For each, list the honest deterministic features it
    would unlock; label them "needs host signal: X" (a wiring/product ask, NOT a constraint break).
(B) CONSTRAINT-PRESSURE redesign: for each constraint, name the most valuable feature it forbids,
    then design an honest variant that delivers most of the value WITHOUT relaxing the constraint.

REASONING SCAFFOLD
- Cleanly separate "needs a NEW host signal" (legitimate; label it) from "needs us to BREAK a
  constraint" (forbidden). Emit only the former; for the latter emit the honest redesign instead.
- NEVER propose relaxing fail-safe, no-fabrication, or PII-safety.

OUTPUT {{OUTPUT_SCHEMA}} (add a `required_host_signal` note where applicable)
SELF-VERIFICATION {{SELF_VERIFY}} + [ ] no constraint is actually relaxed.
STOP — when each missing signal and each constraint has been worked once.
```

### M6 — Pareto Quality–Cost Frontier Search

```
ROLE
You optimize quality-per-dollar under a strict NON-INFERIORITY discipline (never superiority).

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}
- Quality gate (packages/quality): acceptance rate, persistence-weighted edit distance, downstream
  test-pass rate; all evaluated by pre-registered non-inferiority tests at a frozen margin.

DISCOVERY STRATEGY — sweep an un-swept configuration dimension
f4/qpd-bench sweeps MODEL tier; P8d/effort-router sweeps REASONING effort. Identify configuration
dimensions NOT yet swept under the non-inferiority gate — e.g. context size, cache-TTL tier, tool-subset
size, batch-vs-interactive, retrieval depth. Propose features that, holding output quality
non-inferior, find the cheapest setting of one un-swept dimension and move the frontier left.
The CONTEXT-SIZE / retrieval-depth dimension has cited headroom (Part F.3: reads = 76.1% of agent tokens;
23–54% reduction at minimal quality impact, SWE-Pruner) — use those as an illustrative target, never as
TokenLens's own measured result.

REASONING SCAFFOLD
- Every proposal names the quality metric held fixed and the non-inferiority margin. A cheaper config
  NOT proven non-inferior is a quality regression, not a saving — state the test that proves it.
- Check overlap with f4/P8d and state the dimensional delta.

OUTPUT {{OUTPUT_SCHEMA}} (cost_model must reference the held-fixed quality metric)
SELF-VERIFICATION {{SELF_VERIFY}} + [ ] non-inferiority test named; no superiority claim.
STOP — when the un-swept dimensions are enumerated and each worked once.
```

### M7 — Provider-Mechanic Arbitrage

```
ROLE
You read provider billing docs adversarially and design deterministic client behavior that exploits
them.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}
- VERIFIED provider-mechanics catalog (Part F): prompt-cache read-tier % and write multipliers,
  5-min vs 1-hour TTL economics, minimum cacheable prefix size, Batch API discount, off-peak/priority
  tiers, token-counting endpoints, automatic vs explicit prefix caching.
- UNVERIFIED (secondary source, Part F.3): a stateful/WebSocket transport (OpenAI Realtime/Responses,
  ≈Feb 2026) that caches conversation history server-side so the growing context is not re-transmitted/
  re-billed each turn. Treat as `unverified`; build only advisories, claim no saving on it until a primary
  billing doc confirms.

DISCOVERY STRATEGY — one mechanic at a time
For each VERIFIED mechanic: "what deterministic client-side behavior maximally exploits this billing
rule?" — e.g. arrange the request so the largest STABLE prefix is cacheable; pick TTL tier by predicted
idle gap; route non-interactive work to Batch. Check each vs cache-habits (CH-001..012), N2/N3/N5,
replay-cost.

REASONING SCAFFOLD
- HARD RULE: every billing number carries a Part-F citation (doc URL + date). A mechanic that is
  unverified is marked `unverified` and you do NOT build a saving on it.
- Provider mechanics drift; a proposal depending on an unverified rate is a REJECT.

OUTPUT {{OUTPUT_SCHEMA}} · SELF-VERIFICATION {{SELF_VERIFY}} + [ ] every rate cited to Part F with a date.
STOP — when the verified catalogue is exhausted.
```

### M8 — Composition / Synergy Search

```
ROLE
You hunt for super-additive feature combinations AND dangerous anti-synergies.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}

DISCOVERY STRATEGY — pairwise (and selected triples) over PRIOR ART
For each pair: (1) do they interact (one's output is the other's input)? (2) Is the combined saving
super-additive, merely additive, or a CONFLICT (one busts the other's cache / double-counts)? Surface
(a) novel COMPOUND features worth shipping as one unit, and (b) ANTI-SYNERGIES to document as guardrails.
Seed: diff-enforcer (fewer output tokens) × cache-habits (protect prefix) × replay-cost (price the edit)
→ a unified "edit-economics" governor.

REASONING SCAFFOLD
- For every claimed synergy run the cache-bust/waterbed check: does A's transform invalidate B's cached
  prefix? If yes it is an ANTI-synergy, not a synergy.
- NET the combined saving; never sum gross.

OUTPUT {{OUTPUT_SCHEMA}} (anti-synergies use the schema with cost_lever = "guardrail / avoided loss")
SELF-VERIFICATION {{SELF_VERIFY}} + [ ] combined saving is net; cache-bust interaction checked.
STOP — when notable pairs are covered; do not enumerate trivially-independent pairs.
```

### M9 — Falsification / Red-Team  *(evaluator, not generator)*

```
ROLE
You are an adversarial reviewer whose explicit goal is to KILL a proposed token-saving feature.
It survives only if you cannot.

GROUNDING — {{COST_EQUATION}} · {{PRIOR_ART}} · {{CONSTRAINTS}}
INPUT — one Feature Proposal in {{OUTPUT_SCHEMA}} (pasted below this prompt).

ATTACK PLAN — attempt each; report the strongest surviving objection per line
1. DUPLICATION: is it an existing prior-art id reskinned? Name it.
2. PHANTOM SAVING: trace the tokens. Do the "saved" tokens reappear in another term (waterbed)?
   Counted gross when the real figure is net of the cost to obtain it (cache-write multiplier,
   recompute, extra round-trip)?
3. FABRICATION: any number not caller-supplied, cited, or labelled illustrative? Any assumed
   default price/window on an unknown model?
4. NON-DETERMINISM: does the DECISION secretly need a model call, regex classifier, or
   non-reproducible heuristic? Could two runs disagree?
5. EQUIVALENCE HOLE: where it substitutes/compresses, is there a real gate? Construct an input where
   the transform changes semantics but the gate passes.
6. FAIL-UNSAFE: construct a malformed/huge/empty input that makes it hang, throw, or block the agent.
7. MEASURABILITY: can the saving be measured with caller-supplied counts + a vitest/adversarial suite?
   If not → unfalsifiable → reject.

VERDICT (required)
- verdict: SURVIVES | REVISE | REJECT
- killing_objections: [ ... ]      // ones it could not answer
- required_revisions: [ ... ]      // what would make it survive, if REVISE
- residual_risk: "..."             // what remains even if SURVIVES
Do not be charitable. An unfalsifiable or phantom saving is a REJECT, not a REVISE.
```

---

## Part D — Canonical Feature-Proposal Output Schema

Every generative prompt (M1–M8) emits proposals in exactly this shape, so they are comparable and
rankable. Injected as `{{OUTPUT_SCHEMA}}`.

```
- id: kebab-name
- cost_lever: which term(s) of the cost equation it lowers
- tier: 1 (buildable in TokenLens sidecar discipline) | 2 (frontier/model-side research)
- mechanism: 2–4 sentences attacking the causal chain, not the symptom
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

**`{{SELF_VERIFY}}`** — run on each proposal before emitting; drop any that fail:

```
[ ] Not a DUPLICATE of any prior-art id (name the nearest id and the delta).
[ ] Decision core is deterministic — no model call, no regex classification.
[ ] Cost model uses only caller-supplied counts; unknown model ⇒ null, not a guess.
[ ] Names a concrete equivalence gate where it substitutes/compresses content.
[ ] Saving is NET and not double-counted against another term (waterbed check passes).
[ ] Every quantitative claim is caller-supplied, labelled illustrative, or cited.
```

**Hard reject rules (M9 enforces; mirrors `pending_Action_03_Jun.md` discipline reminders):** a proposal
is `REJECT`, not `REVISE`, if it (a) fabricates any token/cost/latency number or assumes a default rate
on an unknown model; (b) has a non-deterministic decision core; (c) claims a saving that reappears in
another term (phantom/waterbed); (d) cannot be measured by caller-supplied counts + a vitest/adversarial
suite (unfalsifiable).

**Ranking (for survivors only).** Honest expected value:

```
EV = expected_net_saving × usage_frequency × confidence ÷ build_effort      (risk is a veto)
```

`expected_net_saving` stays labelled `illustrative`/`caller-supplied` until measured. `confidence`
reflects evidence strength (a verified provider mechanic > a literature analogue > a first-principles
guess) and, in an ensemble run, recurrence across independent samples.

---

## Part F — Verified Sources Appendix

Deep-research pass, verified **June 2026**. Rates drift — re-verify before relying on a number; the
cost *equation* (Part A) is rate-agnostic and stable.

### F.1 — Provider billing & caching mechanics

| Mechanic | Verified value | Confidence | Source |
|----------|----------------|-----------|--------|
| Anthropic cache **read** | `0.1 × input` (90% off) | high | [Claude prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| Anthropic cache **write** | `1.25 × input` (5-min TTL), `2 × input` (1-hour TTL) | high | [Claude prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| Anthropic **min cacheable** | 1,024 tok (Sonnet 4.x/Opus 4.8/4.1) · 4,096 (Opus 4.5–4.7, Haiku 4.5) · 2,048 (Haiku 3.5) | high | [Claude prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| Anthropic **breakpoints / lookback** | max 4 `cache_control` blocks; 20-block lookback | high | [Claude prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| Anthropic **invalidation order** | `tools → system → messages`; thinking-param change keeps tools/system, busts messages; tool-def change busts all | high | [Claude prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| OpenAI prompt caching | automatic, ≥1,024 tok (then +128 increments), **50%** cached-input discount, no config | high | [OpenAI prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) · [OpenAI announcement](https://openai.com/index/api-prompt-caching/) |
| Gemini context caching | implicit (default, Gemini 2.5 ≈ **90%** off on hit; 2.0 ≈ 75%) + explicit (TTL + storage cost) | high | [Gemini caching docs](https://ai.google.dev/gemini-api/docs/caching) · [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Batch API discount | ≈ **50%** of standard token rates, async (~24h), all three providers | high | [Gemini batch/caching guide](https://yingtu.ai/en/blog/gemini-api-batch-vs-caching) · [OpenAI docs](https://developers.openai.com/api/docs/guides/prompt-caching) |
| **5m→1h TTL regression risk** | TTL can silently regress 1h→5m, inflating cost — a real operational hazard | medium | [claude-code issue #46829](https://github.com/anthropics/claude-code/issues/46829) |

> Note: the repo's `packages/shared/src/pricing.ts` carries older per-model *rates* (e.g. Opus at $15
> input) than the live docs (Opus 4.8 at $5 input). This does not affect any meta-prompt — the prompts
> reason over the *ratios* above and the strict-null rule, not hard-coded dollar amounts.

### F.2 — LLM efficiency-technique catalog (for M3)

| Technique | Principle | arXiv | Transfer to a local sidecar |
|-----------|-----------|-------|-----------------------------|
| LLMLingua | budget-controlled token-level prompt compression (≤20×) | [2310.05736](https://arxiv.org/abs/2310.05736) | Tier-1 *principle* (drop low-value tokens) but its scorer is a model → the deterministic analogue is structural compression (cf. squeezer) |
| LongLLMLingua | question-aware compression for long RAG context | [2310.06839](https://arxiv.org/abs/2310.06839) | Tier-1 principle: rank context by query relevance before send (cf. repo-map, f1) |
| FrugalGPT | LLM cascade: cheap model first, escalate on low confidence | [2305.05176](https://arxiv.org/abs/2305.05176) | Tier-1: deterministic escalation ladder; delta vs router/f4 = *sequential* escalation, not upfront routing |
| RouteLLM | preference-data learned router (strong vs weak) | [2406.18665](https://arxiv.org/abs/2406.18665) | Tier-2 (learned router = model); router/f4 is the deterministic cousin |
| H2O | KV-cache eviction by attention "heavy hitters" | [2306.14048](https://arxiv.org/abs/2306.14048) | Tier-2 (touches KV cache); client analogue = drop low-influence context segments (cf. f1/f6/tab-auditor) |
| StreamingLLM | attention sinks + rolling KV window | [2309.17453](https://arxiv.org/abs/2309.17453) | Tier-2 (serving-side); analogue = keep stable head + recent window, drop the middle (client context shaping) |
| Speculative decoding | cheap drafter + exact verify, identical output | [2211.17192](https://arxiv.org/abs/2211.17192) | Tier-2 for decoding; the *verify-cheap* principle already appears client-side in f13 speculative-pipeline |

**Catalog discipline:** Tier-2 rows are recorded as research context, not as buildable sidecar features.
Any technique a future run adds must arrive with an arXiv/source link or be marked `unverified`.

### F.3 — External agentic-coding waste evidence (2026; for M4 / M6 / M7)

Verified via live web search, June 2026 (arXiv abstracts + practitioner reporting). Seeds M4 episodes,
quantifies M6's context-size frontier, and motivates (not prices) M7's transport lever. These are
prevalence/headroom numbers — illustrative targets, never emitted as TokenLens's own measured saving.

| Finding | Number | Source (date) | Confidence |
|---------|--------|---------------|-----------|
| Read ops dominate token spend | reads = **76.1%** of agent tokens; pruning **23–54%** on SWE-Bench Verified | [SWE-Pruner, arXiv 2601.16746](https://arxiv.org/abs/2601.16746) (Jan 2026) | high (arXiv) |
| Failed trajectories over-explore | **12–82%** longer; navigation dominates patch-writing; localization usually fine (≥72%) | [Understanding Code Agent Behaviour, arXiv 2511.00197](https://arxiv.org/abs/2511.00197) (Nov 2025) | high (arXiv) |
| Excess tokens ≠ accuracy | **30×** run-to-run variance; accuracy peaks at intermediate cost | [How Do AI Agents Spend Your Money?, arXiv 2604.22750](https://arxiv.org/abs/2604.22750) (Apr 2026) | high (arXiv) |
| Where tokens go | input = **53.9%**; verification/review = **59.4%**; quantified "communication tax" | [Tokenomics, arXiv 2601.14470](https://arxiv.org/abs/2601.14470) (Jan 2026) | high (arXiv) |
| Practitioner waste estimate | **60–80%** of agent tokens are waste (repeated reads, failed iterations, verbose output) | [Vantage](https://www.vantage.sh/blog/agentic-coding-costs) · [Sourcegraph](https://sourcegraph.com/blog/agentic-coding) (2026) | medium (vendor blog) |
| Stateful transport (cost lever) | server-side history cache ends per-turn re-transmission (no primary billing doc) | InfoQ "Stateful Continuation for AI Agents" (2026) | **low / unverified** (secondary) |
| Behavioral framing | pros "control" (review diffs); "vibe coding" = stop reviewing | [Don't Vibe, They Control, arXiv 2512.14012](https://arxiv.org/abs/2512.14012) (Dec 2025) | high (arXiv) |

**Discipline:** the failure-taxonomy modes (task-drift, reward-hacking, alignment-faking, positional-bias,
mode-collapse, version-drift) are LLM-judge-only → they FAIL M4's determinism screen and are not buildable
as hooks. The stateful-transport mechanic is `unverified` (secondary source) → M7 may emit only advisories
on it, with no claimed saving, until a primary OpenAI billing doc confirms.

---

*Generated June 2026. Re-run the deep-research pass (Part F) before trusting any rate; the prompts and
the cost equation are stable, the numbers are not.*

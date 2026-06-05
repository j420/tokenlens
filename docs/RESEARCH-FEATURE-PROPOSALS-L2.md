# List2 — Adversarial-Round Feature Proposals (truly novel, beyond List1)

> Produced by **executing the X-series adversarial meta-prompts** (X1–X7) as seven independent
> subagents, each fed **List1** (`docs/RESEARCH-LIST1.md`) as the "do-not-propose" set, then gating
> every candidate through **N0 (novelty-vs-List1) → M9 (red-team) → Altitude**. Dated June 2026.
>
> Scope (user-approved): determinism relaxed into tiers — **T1** deterministic · **T2** model-in-loop /
> learned · **T3** paradigm — keeping the non-negotiables for ALL tiers (no fabricated numbers, fail-safe,
> equivalence/quality-gated, PII-safe, falsifiable+tested). Both apertures: reframed-cost AND
> value/economics/security.

> **Build status (in progress).** The autonomous-hook Cost-Security savers are landing first as the new
> `@prune/cost-security` package (deterministic, fail-open, 25 tests): **F19 token/expansion-bomb
> quarantine** + tool-output bounding (`guardToolResult`), **file-state thrash** (`detectThrash`), and
> **F18 injection-cost attribution** (`attributeDownstreamCost`), wired as the always-on PostToolUse
> `cost-guard.mjs` hook. Honest boundary: the hook detects/advises/meters autonomously; byte-exact
> substitution of a result belongs to the request-assembly adapter (mode C).

## Why List2 is genuinely different from List1

List1 optimized **the request**, deterministically, on the existing cost equation and surfaces. List2
attacks that frame. Every item here lives in a space List1 **structurally cannot reach**: the *task* not
the request; *value-per-token* not just cost; *learning from outcomes*; *aggregation across
sessions/devs/orgs*; *model-in-the-loop* decisions; *economic mechanisms*; *defending the bill against an
adversary*; and *push→pull* context. None is a List1 reskin (N0-gated; deltas named per item).

## The real signal: cross-generator recurrence

Independent X-agents converged on two ideas — that convergence is the credibility signal (not fabricated):

| converged idea | independent generators | → becomes |
|----------------|------------------------|-----------|
| **Outcome-learned Context-Utility Model** | X2-03, X3-D1, X3-D5, X4-2, X7-P2 (**5×**) | **Flagship #1** |
| **Known-Knowledge negotiation** (don't send what the model already knows) | X1-05, X2-01, X2-04, X7-P3 (**4×**) | **Flagship #2** |
| **Pre-spend "don't pay for a doomed turn"** | X1-03, X1-07, X4-1, X4-3 (**4×**) | merged → Turn-Economics suite |

---

## Tier-3 — Paradigm flagships (take the product to a new level)

### ★ F1 — Context-Utility Model (CUM): outcome-learned, standing, queried by everything
*Merges X7-P2 + X3-D1 + X3-D5 + X4-2 + X2-03 · altitude: **paradigm** · recurrence 5× · M9: SURVIVES*

- **What it is:** a standing service (not a per-feature scorer) that learns, per context atom
  (symbol/file/tool-result/region), its **realized contribution to accepted output**, with uncertainty.
  Every selector (prune-intelligence DAG walker, trajectory-diet, repo-map, the pull protocol below)
  *queries* it for a prior instead of re-guessing independently. This is CLAUDE.md **Phase-2(a)** made a
  product surface.
- **Fed by outcome signals List1 throws away:** the **accept/reject/edit** verdict on each AI suggestion
  (X3-D1, the "crown-jewel" host signal), **PR-review survival** of AI-authored hunks (X3-D5), and
  cross-session contribution tallies (X2-03); ranking blends learned utility with repo-map PageRank (X4-2).
- **novelty_vs_List1/prior-art:** nearest f12 skill-library (replays a whole *trajectory*) and f1
  trajectory-diet (predicts influence *in-session*, one-shot). Delta: CUM is a **cross-feature standing
  model** with persistent per-atom utility + uncertainty, supervised by the developer's **terminal
  verdict** (kept vs threw away) — a ground-truth label no List1 feature observes.
- **gate / fail-safe:** advisory-only and **floor-clamped** — can never drop an atom the base relevance
  rates critical; cold-start (below min observations) ⇒ returns `null`, selectors run exactly as today;
  drift half-life decays stale priors; promotion requires `@prune/quality` non-inferiority. Correct when
  switched off.
- **decision_procedure:** model-in-loop only at *ingest* (observing accepted output via cite-back);
  utility estimation + serving are deterministic empirical-Bayes counting. PII-safe (symbol-IDs +
  cite-back tokens, never raw content).
- **why #1:** it is the substrate several other List2 items (F4, X4-2, pull coverage-floor) want to query;
  highest recurrence; the Phase-2 centerpiece. effort: **L**.

### ★ F2 — Known-Knowledge Negotiation Layer: stop re-sending what the model has memorized
*Merges X7-P3 + X2-01 + X2-04 + X1-05 · altitude: **paradigm** · recurrence 4× · M9: SURVIVES*

- **What it is:** a layer that replaces context the model **provably already knows** (stdlib, framework
  boilerplate, ubiquitous license headers, common patterns) with a tiny **reference stub**, materializing
  the bytes only if the model signals it actually needs them. CLAUDE.md **Phase-2(b)**.
- **How it's made safe (the crux):** a span is marked `model-knows` only if an **offline, content-SHA-keyed
  probe** has the model regenerate it and the result passes the **existing `@prune/equivalence`** gate
  (byteEqual / astEquivalent). Fleet-learned (X2-01) and optionally a **content-free cross-org exchange**
  (X2-04: only `(public-package-SHA, model-id, pass/fail)` crosses the boundary — private SHAs can't
  match a public registry, so they're structurally excluded). The stub carries a symbol-id so the model
  can **pull the body back** (X1-05 manifest) — a fetch-back demotes the span to "not reliably known"
  (self-correcting).
- **novelty_vs_List1:** nearest f7 semantic-cache + List1 `intra-request-content-dedup`. Delta: those drop
  content redundant *within/across requests* (you sent it before); this drops content redundant *with the
  model's weights* (never needed sending at all), on a different redundancy axis, and makes it negotiable.
- **gate / fail-safe:** strict equivalence gate up front; content-SHA staleness (any edit invalidates the
  verdict); default for any unprobed/edited/unknown-model span is **send full** — it only ever *subtracts*
  proven-redundant bytes; probe cost is netted (no phantom saving). effort: **L**, research-risk on probe
  reliability (de-risked by offline/cached probe + always-fetchable stubs).

### ★ F3 — Negotiated Pull-Context: flip context selection from push to pull
*X7-P1 · altitude: **paradigm** · M9: SURVIVES (with under-request gate)*

- **What it is:** a two-phase protocol. **Manifest turn:** send only repo-map *signatures* + stable
  symbol-ids and require the model to emit a structured **FETCH** request for the bodies it needs.
  **Fulfillment turn:** the host injects only those bodies (byte-exact from disk). The saving is every
  manifest body the model never requested. CLAUDE.md **Phase-3**.
- **The killer risk (under-request → failed turn → expensive retry) is gated three ways, all deterministic:**
  (1) **DAG-closure auto-include** — a requested symbol's mandatory dependencies (return types, base
  classes) are pulled in automatically using repo-map's existing edges (sound, not a guess); (2)
  **coverage-floor hint** — if the request omits a symbol the push-baseline rated critical, append it as a
  "you may also need" candidate; (3) **retry-economics gate** — run the protocol only when predicted
  manifest+fetch cost beats push by a margin wide enough to absorb one re-fetch; else decline.
- **novelty_vs_List1:** nearest repo-map (host-side push selection) + f10 mcp-proxy (lazy *tool schemas*).
  Delta: neither lets the **model itself** request which symbol *bodies* enter context in-band. effort:
  **H**; **fail-safe** degrades to today's push on any malformed FETCH / over-request / second re-fetch.

---

## Tier-2 — Capability (model-in-loop, gated)

| id | feature | aperture | novelty_vs_List1 (delta) | gate / fail-safe |
|----|---------|----------|--------------------------|------------------|
| **F4** (X4-1+X1-07) | **Pre-turn success forecast** — score P(accept) from already-collected features; warn/advise *before* spend on a likely-doomed turn (avoids the whole wasted turn, not a token) | value | vs speculation-budget-gate/two-axis (those cut a turn that *will* run; F4 forecasts whether it should run) | shadow-calibrated (Brier) before any UI; advisory-only, proceed-default |
| **F5** (X4-3+X1-03) | **Retry-vs-reframe advisor** — at a rejection, price naive-retry vs a cheap reframe from history, advise the cheaper path; pre-action decision brief of cost/success priors | value/economics | vs edit-economics-governor (governs a turn that proceeds; F5 governs the meta-choice retry vs reframe) | advisory; null priors ⇒ default retry |
| **F6** (X3-D4) | **CI-outcome fix-context validator** — use red→green test transitions as ground truth for which context actually fixed a failure class | value | vs f1 (in-session influence; F6 = external build-outcome supervision) | non-inferiority on fix-success; inert with no CI signal |
| **F7** (X2-02) | **Fleet resolved-context cache** — one dev's resolved repo-fact answer ("how our auth works") serves the team, gated by dependency content-SHA freshness | economics | vs f12 (replays a procedure; F7 re-serves a finished answer across devs) | **team-scoped only** (no cross-org); SHA-stale ⇒ evict & re-derive |
| **F8** (X1-02) | **Marginal-value probe** — gated counterfactual replay measures which sent chunks had *zero realized value*, feeding CUM | value | vs f1 (predicts; F8 *measures* realized influence a-posteriori) | equivalence-gated; keep-on-uncertainty; sampled to bound cost |

---

## Tier-1 — New levers in a new frame (deterministic, buildable now)

| id | feature | aperture | novelty_vs_List1 (delta) |
|----|---------|----------|--------------------------|
| **F9** (X3-D2) | **Git-churn cache-pin planner** — read `git log/blame` to predict a file's *future* invalidation; pin low-churn into the cache prefix, keep high-churn out (don't pay a cache-write for content about to change) | economics | vs postcompact-reseed / cache-planner (plan from *current* content; F9 adds a forward-looking data source) |
| **F10** (X3-D3) | **LSP symbol-graph substitution** — use the IDE's existing language-server index (free, authoritative) instead of spending tokens for the model to re-derive the symbol/call graph | cost-reframe | vs repo-map/squeezer (those *derive* the graph; F10's novelty is the *authoritative external source*) |
| **F11** (X1-01) | **Cost-per-completed-task ledger** — make the *task* (not the request) the accounting unit; divide by a caller-supplied accepted-outcome signal; exposes retry/dead-end spend per-request views hide | value | vs replay-cost (per-request what-if) + attribution (per-request rollup): a new *denominator*, not a new dimension |
| **F12** (X1-06) | **Waterbed-aware net-effect gate** — wrap any cost-transform with a general induced-cost check (re-ask/retry rates from F11) so a "saving" that reappears elsewhere is vetoed | cost-reframe | vs diff-enforcer (nets *one* transform; F12 is a *general* induced-cost gate over any transform) |
| **F13** (X1-04) | **Cross-career recurring-waste memo** — mine a PII-safe hashed longitudinal fingerprint store for a developer's recurring expensive patterns; periodic memo, not a per-request nag | economics | vs cache-habits (in-session pattern; F13 = cross-session habit discovery from the dev's own ledger) |

---

## Economics / mechanism-design (X5) — change the incentive, not just the number

**The externality:** the actor who spends tokens isn't the payer; below the budget-gate cap the marginal
token is priced at **$0** to the actor. budget-gate is a *cap*, attribution is a *post-hoc rollup* —
neither re-prices the decision. These mechanisms install a price/market/reward so the cheap-sufficient
path is *individually rational*. No fabricated elasticity — every effect size is a caller-measured A/B
quantity; only the incentive's sign + the behavioral assumption are stated.

| id | mechanism | delta vs budget-gate/attribution | tier |
|----|-----------|----------------------------------|------|
| **F14** (X5-2) | **Decision-time dual price tag + default-flip** — show real $ of the chosen vs cheap-sufficient path, pre-select the cheap one (equivalence-gated so the default is never inferior) | budget-gate warns near a cap; F14 prices *every* qualifying decision and flips the default | T1 |
| **F15** (X5-1) | **Personal tradeable allowance market** — split the shared envelope into owned, visible, transferable per-actor allowances (Coasean) so the marginal token has personal opportunity cost | budget-gate = one shared cap, no ownership/transfer | T1 |
| **F16** (X5-3) | **Token pre-commitment / futures desk** — actor-facing reservation instrument to declare non-urgent work and capture the real published Batch/off-peak discount (latency-for-price) | sits *above* List1 batch-tier-router as the demand-side commitment contract (router = mechanical per-request classify) | T1 |
| **F17** (X5-4) | **Cheapest-context bounty** — reward whoever submits the lowest-cost prompt+context that passes a *frozen* quality gate for a recurring task; winner becomes the default skill | f12 captures what happened; F17 is a contest for the *cheapest* thing that could, min-cost s.t. quality | T2 |

---

## Cost-Security (X6) — the literal adversarial view: defend the bill

No List1 feature treats the **token bill as an attack surface**. sentinel guards *correctness/secrets*;
slo/budget-gate enforce *global caps*; loop-breaker catches *identical repeats*; subagent-warden counts.
These four defend against an adversary *inflating spend*. Every one is **fail-open** (a cost-defense must
never DoS legitimate work) with an override/confirm path; deterministic where possible.

| id | attack it closes | deterministic signal | delta |
|----|------------------|----------------------|-------|
| **F18** (X6-1) | **Cost-driving injection** — a file/MCP result that steers the agent into a read-everything/loop cascade | per-source **action-amplification ratio** (downstream tokens ÷ source size) | sentinel flags the *string*; F18 measures the *spend caused* and quarantines the *source* |
| **F19** (X6-2) | **Tool/MCP token-bomb & expansion-bomb** — megabyte dump or small-but-explosive payload | pre-tokenization **byte-size + head token:byte + compression/entropy** vs per-tool baseline | vs P8a/tool-output-bounding (optimize benign output); F19 = adversarial baseline-deviation, quarantine-with-stub (data retained) |
| **F20** (X6-3) | **Subagent fan-out as financial DoS** — crafted task spawning a super-linear subagent tree | **cost-derivative** (2nd difference of projected spawned-tokens) + depth×breadth projection | subagent-warden caps *count*; F20 watches *acceleration*, pauses only NEW spawns |
| **F21** (X6-4) | **Cache-poisoning economics** — pollute f7 to force misses / wrong-then-retry | per-**writer** equivalence-rejection + near-key-collision rates | f7 defends a single entry's SHA; F21 attributes *economic harm* to a writer identity and quarantines per-writer (revalidate, not delete) |

---

## Gate summary & fold/reject log (auditable)

- **N0 (novelty-vs-List1):** all 21 survivors name their nearest List1/prior-art id + delta → **List2 ∩
  List1 = ∅**.
- **M9:** model-in-loop items (F1–F8, F17, F21, the flagships) all carry an equivalence/quality gate + a
  fail-safe fallback to current behavior; no fabricated numbers (null on unknown; economics state
  assumptions; roadmap targets ≥70%/≥85%/≥90% are labeled **goals, not achieved**).
- **Altitude:** all are capability or paradigm; incremental-only inversions were dropped by the agents
  (e.g. churn-only ranker → folds into repo-map; CI-pass HUD → f5).
- **Folded (not separate features):** X1-05 → F2 (known-knowledge pull); X2-01/X2-04 → F2 (probe substrate +
  cross-org exchange); X2-03/X3-D1/X3-D5/X4-2 → F1 (CUM signal sources); X1-07/X4-1 → F4; X1-03/X4-3 → F5;
  X6 V6 slow-inflation → F18 ledger.
- **Privacy drops (honest):** a *cross-org resolved-answer cache* (sharing F7's answers across orgs) was
  dropped — it leaks private repo facts; only the content-free cross-org form (F2/X2-04) survives.

---

## Ranking — what takes the product to a new level

| rank | item | tier | altitude | why |
|------|------|------|----------|-----|
| 1 | **F1 Context-Utility Model** | T2/T3 | paradigm | 5× recurrence; the substrate other features query; Phase-2 centerpiece; correct-when-off |
| 2 | **F2 Known-Knowledge Negotiation** | T3 | paradigm | 4× recurrence; new redundancy axis (model weights); equivalence-gated; only subtracts proven-redundant bytes |
| 3 | **F3 Negotiated Pull-Context** | T3 | paradigm | the push→pull flip (Phase-3); under-request gate makes it sound, not hopeful |
| 4 | **F11 Cost-per-task ledger** | T1 | capability | deterministic, buildable now; unlocks the entire task/value/economics class (F4/F5/F12/F14) |
| 5 | **F18–F21 Cost-Security suite** | T1/T2 | capability | a whole new product category (defend the bill); the literal adversarial view; fail-open & buildable |
| 6 | **F9 Git-churn cache-pin · F10 LSP substitution** | T1 | capability | new authoritative data sources; deterministic; near-term buildable, zero quality risk |
| 7 | **F14 Decision-time price tag** | T1 | capability | highest-leverage, most-credible economics move; behavioral-econ grounded; equivalence-gated default |

**Two flagships + one new category.** If only one thing is built: **F1 (Context-Utility Model)** — it is
the standing surface the Phase-2/3 vision is organized around, and F2/F3/F4/X4-2 all become stronger once
it exists. The **Cost-Security suite (F18–F21)** is the cleanest "new category" win — nothing in the
market or in List1 defends the bill against an adversary, and it's buildable today.

---

*All model-in-loop and roadmap items keep the non-negotiables (no fabricated numbers, fail-safe,
equivalence/quality-gated, PII-safe). Roadmap target metrics are goals with stated measurement plans,
never claimed as achieved. Re-run as a multi-model ensemble to raise recurrence-confidence further.*

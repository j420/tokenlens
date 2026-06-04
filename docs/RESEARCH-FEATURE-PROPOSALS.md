# Vetted Feature Proposals — Token/Cost-Saving (Ensemble Run)

> Produced by running **`docs/RESEARCH-META-PROMPTS.md`** (generators M1–M8) and gating every candidate
> through **M9** (the adversarial red-team). Dated **June 2026**. Provider rates are verified in Part F
> of the library; re-verify before building.

## Run honesty statement (read first)

The library prescribes a K≈3 *independent-sample* ensemble with cross-sample recurrence as a confidence
signal. This batch was produced by a **single model in one structured synthesis pass**, not K
independently resampled runs. To honor the library's own anti-fabrication rule, **recurrence counts are
NOT reported** (reporting "3/3 samples" would be fabricated). Instead, `confidence` is grounded in
**evidence strength** (verified provider mechanic > literature analogue > first-principles guess) **+ M9
survival**. A true multi-sample / multi-model ensemble is the recommended next step and would only
*raise* confidence on the survivors below — it cannot retroactively justify a fabricated number here.

All `expected_net_saving` figures are labelled **illustrative** (the worked arithmetic) or
**caller-supplied** (measured at runtime). No dollar/percentage below is presented as a measured fact.

---

## Summary

- **Generated candidates:** 16 across M1–M8.
- **M9 verdicts:** 8 `SURVIVES`/`REVISE` · 4 `REJECT` (logged) · 1 anti-synergy guardrail · 1 host-signal
  unlock · 2 folded as duplicates into the reject log.
- **Top shortlist to spec next:** `cache-breakpoint-placement-optimizer`,
  `compaction-timing-optimizer`, `batch-tier-router`.

---

## Tier-1 survivors (buildable under the seven constraints)

### 1. `cache-breakpoint-placement-optimizer`  — *from M2/M7 · M9: SURVIVES*

- **cost_lever:** `cache_write` + `cache_read` (per-request and per-session).
- **tier:** 1.
- **mechanism:** Anthropic allows ≤4 `cache_control` breakpoints; a write occurs *only* at a breakpoint,
  and reads serve the longest matching prefix. Where you place the ≤4 breakpoints across the
  tools/system/message segments determines how many tokens are billed at the `0.1×` read tier vs rebuilt
  at the `1.25×`/`2×` write tier when a later segment changes. This feature ingests the request's segment
  sizes (caller-supplied token counts) and each segment's observed change-frequency, then places
  breakpoints to maximize expected read tokens / minimize expected write churn. It attacks the chain
  *cache-write cost ← a volatile segment sits inside the cached prefix ← breakpoints placed naively*.
- **novelty_vs_prior_art:** nearest = N3 (recompress-planner amortizes a rewrite) and CH-005/CH-008
  (warn about reorder/TTL). Delta: none of them *place* breakpoints; they react after a bust or warn.
  This is upfront combinatorial placement over ≤4 slots.
- **decision_procedure:** deterministic. Inputs: ordered segments with `(tokens_i, change_prob_i)` from
  caller-supplied counts + observed per-segment change history. Enumerate the `C(n,≤4)` breakpoint
  placements (n segments, tiny bounded search), score each by `Σ expected_read_savings −
  Σ expected_write_cost` using Part-A multipliers, pick the argmax. No model call.
- **equivalence_gate:** n/a — it only annotates `cache_control` positions; request *content* is byte-identical.
- **cost_model:** `saved = Σ_cached (input − 0.1·input)·reads − Σ_written (write_mult − 1)·input`, in
  caller-supplied tokens; `null` if the model's rates are unknown. NET (write cost subtracted).
- **measurement_plan:** vitest with synthetic segment/volatility fixtures; assert chosen placement ≥ the
  naive single-breakpoint baseline in expected cost; adversarial: all-volatile segments (must place 0
  breakpoints), one giant stable prefix (must cache it), n>20 segments (bounded fallback).
- **constraint_checklist:** deterministic ✓ · fail-safe (bounded search, falls back to naive) ✓ · no
  fabricated numbers (`null` on unknown) ✓ · equivalence n/a ✓ · PII-safe (counts only) ✓ · vitest ✓ ·
  caller-supplied counts ✓.
- **credibility:** mechanics verified — [Claude prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) (Part F). Saving arithmetic: illustrative.
- **effort_risk:** M — risk: per-segment change-probabilities need a few turns of history to be reliable.

### 2. `compaction-timing-optimizer`  — *from M1/M4 · M9: SURVIVES*

- **cost_lever:** context-window pressure vs `cache_write` (session-level).
- **tier:** 1.
- **mechanism:** Carrying a bloated prefix costs read-tier tokens every turn; compacting cuts that
  ongoing cost but pays a one-time cache rebuild (a write) plus re-summary. There is a break-even turn at
  which proactively compacting is cheaper than continuing. This computes it from caller-supplied per-turn
  input growth and current cache state, and recommends the compaction turn. Chain: *per-turn input cost ←
  prefix keeps growing ← no economic trigger for compaction (only f6's fullness warning)*.
- **novelty_vs_prior_art:** nearest = f6 (warns on fullness/CUSUM inflection) and f11/replay-cost (prices
  a replay). Delta: f6 signals *health*, not the *cost-optimal* moment; this outputs a break-even turn
  index from the cost equation.
- **decision_procedure:** deterministic break-even arithmetic: project cumulative cost of {continue} vs
  {compact-now then continue} over a caller-supplied horizon using Part-A rates; recommend compaction
  when `cost_continue > cost_compact`. No model call.
- **equivalence_gate:** n/a — it *recommends timing*; the actual compaction (and any equivalence concern
  over lost decisions) is the host's existing compaction path (cf. compaction-recover).
- **cost_model:** `break_even when Σ_t (carried_prefix·0.1·input) > (rebuild_write + resummary_output)`;
  caller-supplied tokens; `null` on unknown rates.
- **measurement_plan:** vitest with growth-curve fixtures; assert the recommended turn minimizes modeled
  cumulative cost; adversarial: flat growth (never compact), spiky growth, unknown-rate model (returns
  `insufficient_data`, no recommendation).
- **constraint_checklist:** all ✓ (deterministic arithmetic; fail-safe returns "no recommendation" on
  missing data; counts only).
- **credibility:** rates verified (Part F); the break-even model is illustrative.
- **effort_risk:** M — risk: re-summary output size is itself an estimate; treat as caller-supplied with a
  conservative band.

### 3. `batch-tier-router`  — *from M7 · M9: REVISE → SURVIVES (needs host signal)*

- **cost_lever:** all token rates `× 0.5` (Batch/Flex tier).
- **tier:** 1.
- **mechanism:** Batch APIs bill ~50% of standard rates for async (~24h) work across Anthropic, OpenAI,
  and Gemini. Much agentic work is *not* latency-critical (background summarization, bulk file
  classification, non-blocking subagent tasks). This deterministically routes such work to the Batch
  tier. Chain: *full-rate billing ← non-interactive work sent on the interactive tier*.
- **novelty_vs_prior_art:** nearest = router/f4 (picks a *model*) and f13 (parallel read-only exec).
  Delta: this picks a *billing tier*, orthogonal to model choice; no existing feature touches Batch.
- **decision_procedure:** deterministic — route to Batch iff an explicit `interactive=false` /
  background-task signal is present AND the task tolerates ≥ the batch SLA. No inference of intent.
- **required_host_signal:** an interactivity/deadline flag on the task (a subagent spawn for a
  non-blocking job already carries this intent; needs to be surfaced to the router).
- **equivalence_gate:** n/a — same request, different tier; output identical.
- **cost_model:** `saved = 0.5 × Σ token_cost` for batched requests; caller-supplied tokens; `null` on
  unknown rates.
- **measurement_plan:** vitest: tasks flagged non-interactive route to Batch, interactive ones never do;
  adversarial: missing flag (must default to interactive — fail-safe), deadline shorter than batch SLA
  (must NOT batch).
- **constraint_checklist:** deterministic ✓ · fail-safe (default interactive) ✓ · no fabricated numbers ✓
  · equivalence n/a ✓ · PII-safe ✓ · vitest ✓ · caller-supplied ✓.
- **credibility:** Batch 50% verified (Part F); saving illustrative.
- **effort_risk:** M — risk: the interactivity signal must be explicit; guessing it would violate
  determinism, so this stays gated on the host flag.

### 4. `ttl-tier-selector`  — *from M1/M7 · M9: SURVIVES*

- **cost_lever:** `cache_write` (5-min `1.25×` vs 1-hour `2×`).
- **tier:** 1.
- **mechanism:** The 1-hour TTL costs more to write but survives longer idle gaps; the 5-min TTL is
  cheaper but rebuilds after short idles. Given the agent's observed inter-turn idle distribution
  (caller-supplied timestamps), pick the TTL tier that minimizes expected write cost. Chain:
  *repeated cache rebuilds ← 5-min TTL expires across a long think/idle ← TTL chosen blindly*.
- **novelty_vs_prior_art:** nearest = N5 (idle-guard: heartbeat-vs-rebuild *during* a gap) and CH-008
  (warns on TTL switch). Delta: this chooses the tier *at write time* from the idle distribution; N5
  reacts mid-gap; CH-008 only warns. Complementary, not duplicate.
- **decision_procedure:** deterministic — choose 1h iff `P(idle > 5min) × rebuild_cost_5m >
  (2×−1.25×)·input`, from a caller-supplied idle histogram. No model call.
- **equivalence_gate:** n/a.
- **cost_model:** expected-write-cost comparison in caller-supplied tokens; `null` on unknown rates.
- **measurement_plan:** vitest with idle-gap distributions; assert tier choice minimizes modeled write
  cost; adversarial: no history (default to 5-min, the cheaper write), bimodal idle distribution.
- **constraint_checklist:** all ✓.
- **credibility:** TTL multipliers verified (Part F); selection model illustrative.
- **effort_risk:** S — risk: small benefit unless idle gaps are genuinely bimodal; pairs well with N5.

### 5. `cross-session-deterministic-tool-cache`  — *from M2/M8 · M9: REVISE → SURVIVES*

- **cost_lever:** `fresh_input` + `request_count` (avoids re-running deterministic tools).
- **tier:** 1.
- **mechanism:** Deterministic, content-addressable tool results (pure file reads, `git blame`, `ls`,
  type lookups) can be cached by `(tool, args, content_hash)` and reused **across sessions** under a
  **byte-equality** gate. Chain: *re-reading identical files every session ← session-scoped cache
  forgets across restarts*.
- **novelty_vs_prior_art:** nearest = f3 (session-scoped file cache) and f7 (semantic, response-level).
  Delta: cross-session + byte-exact + general deterministic tools, not just within-session files.
- **decision_procedure:** deterministic — hit iff `(tool,args)` match AND the current content hash/mtime
  equals the stored one; else miss. Byte-equality gate before reuse.
- **equivalence_gate:** **byte** — reuse only on exact content-hash match; any drift = miss.
- **cost_model:** `saved = Σ_hits input_tokens(result)`; caller-supplied; `null` on unknown rates.
- **measurement_plan:** vitest: identical file across sessions = hit; modified file = miss; adversarial:
  hash collision guard, non-deterministic tool (must be excluded from the allowlist), TOCTOU (re-verify
  hash at use).
- **constraint_checklist:** deterministic ✓ · fail-safe (miss on any doubt) ✓ · byte-gate ✓ · PII-safe
  (store hashes, not bodies, in telemetry) ✓ · vitest ✓ · caller-supplied ✓.
- **credibility:** caller-supplied counts; no rate claims.
- **effort_risk:** M — risk: invalidation correctness; mitigated by content-hash + re-verify at use, and
  a conservative allowlist of provably-deterministic tools.

### 6. `tool-call-output-bounding`  — *from M4 · M9: REVISE → SURVIVES (with surfaced bound)*

- **cost_lever:** `fresh_input` (next-turn) + `output`.
- **tier:** 1.
- **mechanism:** A large tool result (unbounded `grep`, full-file read, verbose test output) enters the
  next turn's input. For *known paginatable* read tools, deterministically inject a bound (`limit`/`head`
  / line range) into the proposed call at PreToolUse, and surface that it was bounded so the agent can
  request more. Chain: *huge input next turn ← tool returns the whole haystack ← call was unbounded*.
- **novelty_vs_prior_art:** nearest = P8a (result-pruner, prunes *after* the result exists). Delta: this
  prevents the large result from being produced at all, at the call site (PreToolUse), pre-context.
- **decision_procedure:** deterministic — iff the tool is in a paginatable allowlist AND no explicit
  bound is set AND the expected result exceeds a caller-set threshold, inject a default bound. No model
  judgement of "relevance."
- **equivalence_gate:** **coverage/n-a hybrid** — because bounding *can* drop data, it is advisory +
  reversible: the bound and a "truncated; N more available" marker are surfaced so the agent can re-fetch.
  Never silently drops.
- **cost_model:** `saved ≈ (unbounded_tokens − bounded_tokens)` minus the cost of any re-fetch; NET.
- **measurement_plan:** vitest: bounded args injected only for allowlisted tools; adversarial: agent
  needs the full result (must be able to re-fetch; net saving must remain ≥0 including re-fetch),
  already-bounded call (must not double-bound).
- **constraint_checklist:** deterministic ✓ · fail-safe (no bound on unknown tools) ✓ · no fabricated
  numbers ✓ · reversible/surfaced (equivalence concern handled) ✓ · PII-safe ✓ · vitest ✓.
- **credibility:** caller-supplied; no rate claims.
- **effort_risk:** M — risk: over-bounding causes re-fetch thrash; the threshold must be conservative and
  the re-fetch path explicit (this is why it's REVISE→survives, not a clean SURVIVES).

### 7. `edit-economics-governor` (compound)  — *from M8 · M9: SURVIVES*

- **cost_lever:** `output` + `cache_write` (compound).
- **tier:** 1.
- **mechanism:** A single governor for any proposed file edit that composes three existing deciders:
  P8c diff-vs-rewrite (fewer output tokens) → CH cache-bust check (does the edit invalidate the cached
  prefix?) → f11 replay-cost (price the resulting rebuild). It emits one decision: *diff or rewrite, and
  whether to defer/batch the edit to avoid a mid-turn cache bust*. The novelty is the **ordering and the
  net arithmetic across all three**, which none does alone.
- **novelty_vs_prior_art:** P8c, f9/CH, f11 individually. Delta: shipped as one unit that nets the
  output saving against the cache-write cost the edit triggers — a saving each component misses in
  isolation.
- **decision_procedure:** deterministic — chain the three existing deterministic deciders; tie-break by
  total NET tokens.
- **equivalence_gate:** inherits P8c's **byte** round-trip proof on the diff.
- **cost_model:** `net = output_saved(diff) − write_cost(cache_bust_if_any)`; caller-supplied; `null` on
  unknown rates.
- **measurement_plan:** vitest composing the three; adversarial: diff cheaper on output but busts a large
  cached prefix (governor must prefer the net-cheaper option, possibly rewrite or defer).
- **constraint_checklist:** all ✓ (inherits each component's gates).
- **credibility:** composes verified components; arithmetic illustrative.
- **effort_risk:** S–M — mostly orchestration of shipped logic; risk is double-counting, handled by NET.

### 8. `context-budget-frontier`  — *from M6 · M9: REVISE → SURVIVES (heavy)*

- **cost_lever:** `fresh_input` at fixed quality.
- **tier:** 1.
- **mechanism:** Sweep the *context-size* dimension that f4 (model) and P8d (reasoning effort) don't:
  find the minimal context budget that stays **non-inferior** on the `packages/quality` gate (acceptance
  rate / PWED / test-pass) for a task class, and cap context there. Chain: *over-sized context ← no
  proven floor on how little context still works*.
- **novelty_vs_prior_art:** nearest = repo-map/f1 (select by relevance). Delta: those rank/select; this
  establishes a *statistically non-inferior minimum budget* per task class under the existing quality
  gate.
- **decision_procedure:** deterministic given paired observations — binary-search the budget; accept the
  smallest budget whose non-inferiority test passes at the frozen margin. The *measurement* uses the
  model offline; the *decision rule* is deterministic statistics (no model in the decision core).
- **equivalence_gate:** the non-inferiority quality gate is the gate.
- **cost_model:** `saved = (baseline_context − floor_context)·input` at proven-equal quality; `null` on
  unknown rates.
- **measurement_plan:** uses `packages/quality` (`nonInferiorityProportion`, `wilcoxonSignedRank`);
  adversarial: insufficient samples ⇒ "insufficient_data", never a budget cut.
- **constraint_checklist:** deterministic decision rule ✓ · fail-safe (no cut without a passed test) ✓ ·
  no fabricated numbers ✓ · quality-gated ✓ · PII-safe ✓ · vitest ✓.
- **credibility:** uses the repo's own statistical gate; saving illustrative.
- **effort_risk:** L — risk: needs labelled paired data per task class (offline harness); highest effort,
  hence ranked lower despite clean economics.

---

## Anti-synergy guardrail (M8)

### `recompress-busts-cache` — *document, don't build a naive compressor*

Compressing a block (squeezer / P8a result-pruner / any re-squeeze) that is **already inside a cached
prefix** changes the prefix bytes → busts the prompt cache → forces a `1.25×`/`2×` write that can exceed
the compression saving. **Guardrail:** any compression of previously-sent content MUST pass the N3
recompress-planner amortization check first (`pay 1 write iff it saves > write_cost over remaining
reads`). This is the canonical waterbed trap; surface it as a lint, not a silent transform.

---

## Host-signal unlock (M5)

### `proposed-action-diff` — the highest-leverage missing signal

11 of 12 CH-rules and the diff-enforcer cannot be hook-wired because the Claude Code hook payload lacks
the **proposed-action diff**. Supplying it (via the VS Code extension or a dedicated MCP tool) unlocks
the full f9 linter + P8c at the hook layer. This is a **wiring/product ask**, not a new algorithm — it is
already noted as pending action 2.1; M5 confirms it is the single unlock with the most downstream value.
Labelled `needs host signal`, no constraint relaxed.

---

## M9 reject log (auditable cut)

| candidate | source | verdict | killing objection |
|-----------|--------|---------|-------------------|
| `min-cacheable-prefix-guard` | M7 | **REJECT (duplicate)** | Identical to **CH-002** (system_prompt_too_small) — flags content below the min cacheable size. No delta. |
| `reasoning-budget-cap` | M1 | **REJECT (duplicate)** | Subsumed by **P8d** effort-router (+ CH-009). Capping thinking by task class is exactly its job. |
| `cross-session-cache-warming` | M1 | **REJECT (phantom saving)** | Pre-warming a prefix costs a `1.25×`+ write; the cache is ephemeral (5m/1h) so warming before real reuse pays the write with no offsetting read. Waterbed: cost ≥ saving unless reuse falls inside TTL, in which case ordinary caching already captures it. |
| `tools-canonical-ordering` | M2 | **REJECT (likely duplicate)** | Overlaps the existing `cache-stabilize` hook + CH-005 (tool-list reorder). Possible thin delta ("actuate, don't just warn") but not demonstrably distinct without inspecting `cache-stabilize`; not worth a slot until that gap is confirmed. |

---

## Ranking — top to spec next

EV = `expected_net_saving × usage_frequency × confidence ÷ build_effort` (risk = veto). All saving terms
illustrative; confidence = evidence strength + M9 survival (no resampling — see honesty statement).

| rank | feature | lever | confidence | effort | why it ranks here |
|------|---------|-------|-----------|--------|-------------------|
| 1 | `cache-breakpoint-placement-optimizer` | cache write+read | high (verified mechanic) | M | large, frequent, verified saving; clean equivalence (annotation only) |
| 2 | `compaction-timing-optimizer` | window vs write | high | M | every long session hits this; pure arithmetic on verified rates |
| 3 | `batch-tier-router` | all ×0.5 | high | M | biggest per-request multiplier; gated cleanly on one host flag |
| 4 | `edit-economics-governor` | output+write | med-high | S–M | mostly composes shipped logic; fast to build |
| 5 | `ttl-tier-selector` | cache write | med | S | small but cheap; pairs with N5 |
| 6 | `cross-session-deterministic-tool-cache` | input/request | med | M | strong in repetitive workflows; invalidation is the risk |
| 7 | `tool-call-output-bounding` | input/output | med | M | real waste, but re-fetch thrash risk keeps it mid-pack |
| 8 | `context-budget-frontier` | input @ fixed quality | med | L | cleanest economics, heaviest to prove (needs labelled data) |

**Recommended first build:** #1–#3. They share one substrate — a small deterministic cost-arithmetic
core over caller-supplied token counts + verified Part-F multipliers — so they can land as one
`@prune/cache-economics` style package with three deciders, maximizing reuse.

---

*Re-run as a true multi-sample / multi-model ensemble to add recurrence-based confidence. Re-verify all
Part-F rates first; the survivors' economics depend on them.*

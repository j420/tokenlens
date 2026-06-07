# Vetted Feature Proposals — Token/Cost-Saving (Ensemble Run)

> Produced by **actually executing** the library `docs/RESEARCH-META-PROMPTS.md`: each generator
> M1–M8 ran as an **independent subagent**, M9 (adversarial red-team) was applied to every candidate,
> and clusters were merged with **real cross-generator recurrence** as the confidence signal. Dated
> **June 2026**. Provider rates verified in Part F of the library.

## Run provenance (how this version differs from the first)

This document was regenerated after a genuine execution. The earlier version was a single
**synthesis pass** (one model reasoning *as if* it had run the prompts). Running them for real changed
the results materially — see "Corrections" below. Eight generator agents ran independently; their raw
outputs are the basis here. M9 gating was applied by this model against each candidate (transparently —
not a separate sample per candidate). Recurrence counts below are **real**: they count how many
*independent generator agents* surfaced the same idea.

---

## Headline corrections the real run forced

Three findings the synthesis pass got wrong or missed — each verified against the actual code:

1. **Two of my top-ranked "novel" ideas already exist.** The synthesis pass ranked
   `cache-breakpoint-placement-optimizer` #1 and `ttl-tier-selector` #5. The M7 agent read the code and
   found them already shipped: `packages/agent-sdk-adapter/src/cache-planner.ts` (`planBreakpoints`,
   ≤4 breakpoints, largest-stable-prefix-first, min-prefix gating) and `ttl-amortization.ts`
   (`amortizingTtlChooser`, 5m-vs-1h break-even). **Both are now in the reject log as duplicates.**

2. **A real fabrication-risk bug exists in a hook** (M5/U6). `apps/extension/hooks/cache-habits-advisor.mjs:85`:
   `const currentModel = last.model ?? "claude-sonnet-4-5-20250929";` — when the transcript lacks a
   model, the hook **guesses one**, and pricing + CH-001 model-switch detection then key off the guess.
   This contradicts the repo's own "unknown model → null, never a default" discipline. **Fixable now,
   independent of any new feature** (replace the fallback with `null` ⇒ rates null, CH-001 suppressed).
   Verified: line 85.

3. **`diff-enforcer` is not actually "blocked at the hook layer"** (M5/U1). Its file-edit diff is exactly
   `payload.tool_input` on a `PreToolUse` `Edit`/`Write`/`MultiEdit` event — already read by
   `speculative-prune.mjs:58`, `speculative-record.mjs:44`, `trajectory-diet.mjs:51`. Only the
   *next-turn request-shaping diff* (the thing CH-rules need) is genuinely absent. Verified.

Also confirmed: `systemPromptTokens: null` is hardcoded in the advisor (lines 102/113), neutering CH-002
and CH-006 (M5/U5).

---

## Summary

- **~35 candidates** generated across the 8 independent generator runs.
- **M9 verdicts:** clustered to ~18 distinct survivors + 3 anti-synergy guardrails + 6 capability
  unlocks; **7 rejected** (logged), of which **2 were confirmed-already-built** by reading the code.
- **Immediately actionable (no new feature, improves integrity):** U6 (kill the hardcoded model
  default) and U1 (wire diff-enforcer at PreToolUse).
- **Top shortlist to spec next:** `batch-tier-router` (3× recurrence), `intra-request-content-dedup`
  (3× recurrence), `silent-ttl-regression-detector`, `openai-increment-prefix-aligner`.

---

## Cross-generator recurrence (the real confidence signal)

Because the generators ran as independent agents, ideas that recur are genuinely corroborated.

| idea cluster | independent generators that produced it | confidence |
|--------------|------------------------------------------|-----------|
| Batch-API tier routing | M3 (N-T4), M6 (F17), M7 (A2) | **high (3×)** |
| Intra-request/turn content dedup | M1 (P1), M2 (P2), M4 (W2) | **high (3×)** |
| Cache-prefix stabilization / reorder | M1 (P2), M3 (N-T5) | med (2×) — *partial overlap w/ existing cache-planner* |
| Context-size / retrieval-depth budgeting | M3 (N-T1), M6 (F14) | med (2×) |
| Tool-output bounding at source | M2 (P3), M4 (W3) | med (2×) |
| Edit-economics governor | M8 (S1) | single (+ synthesis) |
| Silent TTL-regression detector | M7 (A3) | single (high value, real code gap) |

---

## Tier-1 survivors (ranked, buildable under the seven constraints)

### 1. `batch-tier-router` — *M3 N-T4 + M6 F17 + M7 A2 · M9: SURVIVES · recurrence 3×*

Route latency-tolerant work to the Batch API (~0.5× all rates, verified Part F) when the caller declares
it non-interactive. **cost_lever:** all token rates ×0.5. **decision_procedure:** deterministic boolean
— eligible iff `maxLatencyMs ≥ BATCH_SLA ∧ ¬dependsOnInteractiveTurn ∧ ¬requiresStreaming`; fail-closed
to interactive on any missing field. **novelty:** orthogonal to `router` (which picks *model*); no batch
code exists in the repo (M7 confirmed). **equivalence_gate:** byte-identical request, same model/params
→ output distribution unchanged. M6's F17 adds an optional non-inferiority gate on batch-vs-interactive
outcomes. **cost_model:** `saved = 0.5 × Σ token_cost`; `null` on unknown rates. **effort_risk:** M —
risk is the eligibility predicate; mitigated by fail-closed default. **Why #1:** highest recurrence,
biggest per-request multiplier, verified mechanic, confirmed no existing code.

### 2. `intra-request-content-dedup` — *M4 W2 + M1 P1 (+ M2 P2 as the ledger) · M9: SURVIVES · 3×*

Before dispatch, collapse byte-identical content within a single request: **whole duplicate blocks**
(W2: same rules/file-state injected twice) and **shared spans across parallel tool results** (M1-P1:
same import/header block returned by several reads, each below P8a's per-result threshold). **cost_lever:**
fresh_input (+ cache_write of the duplicated bytes). **decision_procedure:** SHA per block/span; keep
first occurrence, replace later identical-SHA copies with a back-reference; emit only if
`net = dup_tokens − stub_tokens > floor`. **equivalence_gate:** **byte** — round-trip: back-refs must
reconstruct identical bytes (tested). **novelty:** P8a prunes *one* result in isolation; f3 dedups
*whole files across turns* by path; this dedups *within one request* by content-SHA across heterogeneous
sources. **M2-P2** is the observability companion (a Stop-time "re-read debt ledger" quantifying
recoverable waste). **effort_risk:** M — back-ref reconstruction correctness (round-trip test).

### 3. `silent-ttl-regression-detector` — *M7 A3 · M9: SURVIVES · high value*

Detect the documented 1h→5m silent cache-TTL regression (Part F hazard) that no module catches. **lever:**
cache_write (avoid the higher write-multiplier churn after an undetected regression). **decision_procedure:**
scan caller-supplied cache events; flag a fingerprint declared `1h` that shows a `cache_write` after an
idle gap in `(5m, 1h]` — physically impossible under a real 1h TTL. **novelty:** CH-008 only catches
*caller-initiated* TTL switches (`action.ttl !== snapshot.currentTtl`); it is blind to a *provider-side*
silent regression. **equivalence_gate:** n/a (detection only). **cost_model:** inflated-write cost from
caller-supplied counts; `null` on unknown rates. **effort_risk:** low — read-only scan over the same
`EventRow` telemetry `ttl-amortization` already consumes.

### 4. `openai-increment-prefix-aligner` — *M7 A1 · M9: SURVIVES*

OpenAI caches the longest prefix on a **1024-then-+128-token** boundary; trailing `(k mod 128)` stable
tokens are billed fresh every turn. Compute the largest stable prefix landing on a boundary and report
the wasted-trailing-token delta (advisory; no junk padding). **lever:** cache_read_input (50% discount,
verified). **novelty:** `cache-planner.ts` is Anthropic-only (explicit breakpoints, single 1024/4096
floor); it has no concept of OpenAI's +128 quantization and OpenAI has no breakpoints to place — a
different lever. **equivalence_gate:** advisory; any accepted reorder preserves byte-identical stable
content. **cost_model:** `saved = wasted_tokens × input_rate × 0.5` per hit; `null` on unknown.
**effort_risk:** low.

### 5. `edit-economics-governor` — *M8 S1 · M9: SURVIVES*

One decision unit for a proposed edit composing **P8c** (diff-vs-rewrite output cost) → **f9/CH**
(does the edit touch a cached prefix region?) → **f11/replay-cost** (price the downstream rebuild).
Emits `apply_as_diff | apply_as_rewrite | defer` by NET cost. **lever:** output + cache_write.
**novelty:** super-additive — P8c alone can pick a rewrite that busts a cached prefix whose re-warm cost
(priced by f11) dwarfs the output saving; only feeding f9's region map + f11's price into the choice is
globally optimal. **equivalence_gate:** inherits P8c's byte round-trip. **cost_model:** NET vs naive
rewrite; `null` on unknown rates → returns `insufficient_data`. **effort_risk:** S–M (mostly
orchestration; risk = f9 region-map accuracy, falls back to P8c-only).

### 6. `context-budget-frontier` — *M6 F14 + M3 N-T1 · M9: SURVIVES (heavy)*

Sweep the **context-size** dimension neither f4 (model) nor P8d (effort) touches: binary-search the
smallest retrieval depth / chunk budget that stays **non-inferior** on the `packages/quality` gate
(AR @1pp, TPR @0.5pp, PWED). M3's N-T1 is the per-request ranking front-end (query-relevance
rank + token-budget knapsack over already-fetched chunks). **novelty:** repo-map/f1 rank heuristically
*without a quality proof*; this proves a minimum budget non-inferior. **decision_procedure:** each depth
is a `ModelAggregate`; reuse `recommendForCluster`; HOLD full on no clearing depth. **effort_risk:** L —
needs labelled paired data per task class.

### 7. `tool-output-bounding-at-source` — *M2 P3 + M4 W3 · M9: REVISE → SURVIVES · 2×*

Bound an oversized tool result *before* it enters context: at PreToolUse inject a `limit`/projection into
known-paginatable read tools (M4 W3), or at the proxy honor a schema-declared minimal output mode (M2 P3).
**novelty:** P8a prunes *after* the result exists; this prevents the large result from being produced.
**equivalence_gate:** **coverage + recoverable** — only on an allowlist; surfaces "truncated; N more
available" so the agent can re-fetch; never silently drops. **REVISE reason:** over-bounding causes
re-fetch thrash; threshold must be conservative and the re-fetch path explicit. **effort_risk:** M.

### 8. `file-state-thrash-detector` — *M4 W4 · M9: SURVIVES*

Fire when a file's content-SHA returns to a previously-seen value ≥ threshold times (A→B→A oscillation).
**novelty:** `loop-breaker` keys on an *identical repeated op*; this detects *state oscillation between
distinct edits*. **decision_procedure:** per-file SHA history + cycle counter. **equivalence_gate:** n/a
(advisory). **effort_risk:** low (advisory, fail-open).

**Also surviving (lower-ranked, real but narrower):** `edit-payload-amplification-detector` (M4 W1,
advisory ratio metric); `tool-subset-frontier` (M6 F16, non-inferiority sweep of exposed tool count,
delta vs f2/f10); `few-shot-count-frontier` (M6 F18, un-swept dimension, no prior art);
`progressive-tool-surface-compiler` (M8 S3, f10×f2×f8 compound); `speculation-budget-gate` (M8 S4,
f13×f11×N6 — important safety layer on speculative exec); `two-axis-descent-governor` (M8 S5, ordered
P8d→f4 descent with f6 veto); `output-shape-constrainer` (M3 N-T3, schema-constrained output +
client-side validate/repair); `postcompact-cache-reseed-planner` (M2 P1, acts on the PostCompact event
f6 only predicts); `dashboard-cache-hit-regression-detector` (M2 P4, CUSUM on the cache-read:fresh-input
ratio); `gemini-implicit-vs-explicit-cache-selector` (M7 A4, Tier-2, needs Gemini).

---

## Capability unlocks (M5) — what a missing signal would buy

| id | what | status |
|----|------|--------|
| **U6** | Replace the hardcoded `currentModel` fallback (`cache-habits-advisor.mjs:85`) with `null` ⇒ rates null, CH-001 suppressed | **honesty fix — ship now**, no signal needed |
| **U1** | Wire `diff-enforcer` as a PreToolUse `Write\|Edit\|MultiEdit` hook using existing `tool_input` | **wiring — ship now**, no signal needed |
| **U5** | Tap live system-prompt token count → un-neuter CH-002/006 (emit **count + hash only**, never bytes) | needs host signal: system-prompt size |
| **U2** | Emit the **next-turn request descriptor** (model, system-prompt size, tool-order hash, MCP set, dials) → `buildCacheHabitsInputs` already consumes it → **1/12 → 12/12 CH rules wired** | needs host signal (the big unlock) |
| **U3** | Real-time provider cache-hit breakdown → closed-loop predicted-vs-realized CH reconciliation | needs host signal |
| **U4** | Per-tool-call timestamps → latency-budgeted speculative-exec prioritization (f13 by *measured* cost) | needs host signal |

---

## Anti-synergy guardrails (M8) — document, don't ship as savings

- **G1 `pruner-vs-cache-bust`:** P8a pruning a result that f3/N2 cached busts the byte-identical baseline
  → cache miss erases the saving. Guardrail: before pruning a cache/delta anchor, re-establish the anchor
  (pay one write, amortize) or skip. (This is the verified waterbed trap; supersedes the synthesis
  pass's `recompress-busts-cache`.)
- **G2 `skip-retrieval-starves-skill-capture`:** f1 skipping a step that f12 needs to reconstruct a
  replayable skill → future cold retrieval exceeds the one-step saving. Guardrail: f1 must not skip a
  step in f12's capture-in-progress set.
- **G3 `re-squeeze-prefix-bust`:** squeezer/repo-map re-compressing already-cache-anchored content busts
  the prefix. Guardrail: squeeze only non-anchored content / the appended tail.

---

## M9 reject log (auditable cut)

| candidate | source | verdict | killing objection |
|-----------|--------|---------|-------------------|
| `cache-breakpoint-placement-optimizer` | synthesis pass | **REJECT (already built)** | Exists: `agent-sdk-adapter/src/cache-planner.ts` `planBreakpoints` (≤4 breakpoints, largest-stable-prefix-first, min-prefix gating). Found by reading the code. |
| `ttl-tier-selector` | synthesis pass | **REJECT (already built)** | Exists: `ttl-amortization.ts` `amortizingTtlChooser` (5m-vs-1h break-even). |
| `min-cacheable-prefix-guard` | M7 | **REJECT (duplicate)** | = CH-002 `system_prompt_too_small`. |
| `reasoning-budget-cap` | M1 | **REJECT (duplicate)** | Subsumed by P8d effort-router + CH-009. |
| `cross-session-cache-warming` | synthesis pass | **REJECT (phantom saving)** | Warming costs a ≥1.25× write; cache is ephemeral (5m/1h) → pays the write with no offsetting read unless reuse falls inside TTL, which ordinary caching already captures. |
| `frugalgpt-cascade` | M3 | **REJECT (redundant)** | ~90% covered by `router` 3-tier + f13 verify-cheap; would be a router config, not a feature. |
| `cache-ttl-tier-selector (F15)` | M6 | **REJECT (duplicate)** | Same as `ttl-amortization.ts`; M6 proposed it without seeing the existing module. |
| `amortized-write-cache-scheduler (S2)` | M8 | **REVISE→fold** | Large overlap with `ttl-amortization.ts` + N3 `recompress-planner`; the novel sliver (f7 read-projection as the N estimate) folds into N3, not a standalone feature. |
| `M1-P2 / N-T5 prefix reorder` | M1/M3 | **REVISE (partial dup)** | Adjacent to `cache-planner.ts` largest-stable-prefix-first; the *reordering of order-independent blocks* may be a thin delta — confirm against cache-planner before building. |

Tier-2 research-only (recorded, not proposed as features): RouteLLM (learned router = model call), H2O
(KV-cache access), LLMLingua core (perplexity needs a model), distillation, quantization, server-side
continuous batching — see library Part F.2.

---

## Recommended sequencing

1. **Now (integrity, no new feature):** U6 (kill the hardcoded model default — it's an active
   fabrication risk) + U1 (wire diff-enforcer at PreToolUse). Small, correct, and on-theme.
2. **First feature build:** `batch-tier-router` (3× recurrence, verified 50%, no existing code) +
   `intra-request-content-dedup` (3× recurrence, byte-gated). Independent of the cache-planner family,
   so no overlap risk.
3. **Then:** `silent-ttl-regression-detector` and `openai-increment-prefix-aligner` — both fill verified
   provider-mechanic gaps no current module covers, both low-effort read-only/advisory.
4. **Product ask:** U2 (next-turn request descriptor) — unblocks 11 more CH rules at once; highest
   structural leverage but needs host wiring.

---

*Re-running as a true multi-**model** ensemble (other frontier models as additional independent samples)
would further raise recurrence-confidence. Re-verify all Part-F rates before building; the survivors'
economics depend on them.*

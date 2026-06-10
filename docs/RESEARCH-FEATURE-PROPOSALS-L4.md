# RESEARCH-FEATURE-PROPOSALS-L4 — List4: Executed v2 Meta-Prompt Library Run

> **This list was produced by EXECUTING the v2 meta-prompt library**
> (`docs/RESEARCH-META-PROMPTS-V2.md`, commit e4eb343) — not by synthesizing "as-if".
> Eleven generator subagents ran the eleven generator prompts (M1v2–M8v2, M10–M12) across
> three fed-forward waves (the M13 structure), followed by two independent M9v2 evaluator
> subagents with mandatory repo greps. Every verdict below cites the grep or file read that
> grounds it.

## 0. Run provenance

| Item | Value |
|---|---|
| Date | June 2026 |
| Generator agents | 11 (G1–G11), one per v2 generator prompt, `model: sonnet`, parallel within waves, independent (P1: no cross-talk within a wave) |
| Waves | W1: M1v2, M2v2, M10, M7v2 · W2: M3v2, M4v2, M11, M12 · W3: M5v2, M6v2, M8v2 — each wave's deduped themes appended to the next wave's forbidden set (M13 fed-forward) |
| Generator failures | G10 (M6v2) failed once on a session limit with zero output; re-run to completion |
| Raw candidates | 52 (W1: 21, W2: 18, W3: 13) + 9 Appendix S seeds |
| Deduped ledger | 50 entries (5 exact cross-generator duplicates merged at ledger build; 6 seeds absorbed into generator clusters) |
| Evaluators | 2 (E1: L4-01..25, E2: L4-26..50), disjoint slices, never the generator, mandatory `packages/` + `apps/` greps per entry, verdicts cite evidence |
| Gate outcome | 27 SURVIVES · 12 REVISE · 1 MERGE · 10 REJECT (20% hard-kill + 24% revise) |
| Shippable features | **38** (after merging L4-37 into L4-09) |
| Caveats | Single-model generation (all generators were the same model family — persona partitioning substituted for model diversity); all provider rates marked RE-VERIFY must be re-confirmed against primary sources before any constant ships; forbidden-set = L1 ∪ L2 ∪ L3 ∪ shipped code ∪ prior-wave themes |

**N0 discipline observed working:** G3 dropped 3 of its 10 literature seeds as already covered;
G9 self-killed its own stop_reason proposal mid-run as a duplicate of an earlier wave's theme;
G10 dropped MCP-server-count as too close to the frozen `tool-subset-frontier`; the seeding pass
had already rejected 5 candidates. The reject log (§8) adds 10 more kills with file-level evidence.

## 1. Cross-generator recurrence table (independent convergence = credibility signal)

| Theme | Independent proposers | Final entry |
|---|---|---|
| Per-call server-tool fee metering | G1 (M1v2) + G4 (M7v2) + Appendix-S seed #8 | **L4-03 ×3 — top-ranked** |
| Geo-multiplier pricing | G1 + G4 | L4-01 ×2 |
| Batch × cache-read compound (0.05×) | G1 + G4 | L4-02 ×2 |
| Gemini thinking/non-thinking split | G1 + G4 | L4-04 ×2 |
| stop_reason=max_tokens truncation retry-cost | G2 (M2v2) + G6 (M4v2) | L4-07 ×2 |
| Flex synchronous-preemptible tier | G4 + seed #4 | L4-06 ×2 |
| Context placement (lost-in-the-middle) | G3 (M10) + seed #3 | L4-13 ×2 |
| Output-budget prompt hint (TALE) | G3 + seed #9 | L4-14 ×2 |
| History filler stripping (NoWait) | G3 + seed #6 | L4-15 ×2 — **rejected anyway (waterbed)** |
| Skill-library routing audit (SkillReducer) | G3 + seed #7 | L4-16 ×2 |
| Reasoning-spend governance family | G2 + G7 (M11) + G9 (M5v2) | L4-09 (merged) + L4-29 (kept separate) |

Recurrence raised rank within a confidence band; it did not save L4-15 from a structural
waterbed objection — convergent popularity is not soundness.

## 2. Ranked index of the 38 shippable features

**Tier A — build first (verified gap + S effort + high evaluator confidence):**
L4-03 per-call-fee-meter · L4-23 multiedit-amplification-gate · L4-07 truncation-retry-meter ·
L4-02 batch-cache-compound-advisor · L4-01 geo-multiplier-advisor · L4-06 flex-tier-router ·
L4-20 compressor-eligibility-pre-filter · L4-35 billing-tier-drift-detector

**Tier B — high value, small-to-medium effort:**
L4-48 squeeze-tier-frontier · L4-49 observation-window-frontier · L4-25 compaction-cost-predictor ·
L4-26 ttl-upgrade-planner · L4-10 batch-eligibility-tagger · L4-22 bash-burst-output-meter ·
L4-27 tool-call-coalescing-gate · L4-16 skill-routing-coverage-auditor · L4-28 output-rate-watch ·
L4-29 reasoning-token-drift-sentinel · L4-36 tool-input-growth-gate ·
L4-33 tool-result-field-projection-pruner · L4-38 citeback-contribution-proxy ·
L4-45 masking-regime-gate · L4-19 zoned-context-trigger · L4-34 context-safety-stock-planner

**Tier C — fleet guardrails (avoided-loss levers over the shipped hook fleet):**
L4-42 advisory-fleet-budget-gate (REVISE) · L4-40 dual-read-advisor-suppression ·
L4-41 mask-compaction-ordering-guard · L4-44 thrash-navrat-coalesce

**Tier D — REVISE class (ship only after the named fix):**
L4-09 thinking-spend-attributor+ceiling (merged with L4-37) · L4-04 gemini-thinking-split-advisor ·
L4-05 search-call-dedup-gate · L4-13 context-placement-orderer · L4-14 output-budget-hint-injector ·
L4-17 multi-agent-review-tax-meter · L4-18 reference-count-eviction-proxy ·
L4-21 task-class-spend-percentile-tracker · L4-30 write-back-breakpoint-coalescer ·
L4-32 turn-coalescing-advisor · L4-47 mode-switch-rebill-guard

---

## 3. Tier A survivors

### L4-03 `per-call-fee-meter` — SURVIVES (E1, high confidence) — recurrence ×3
- **sources:** G1/M1v2 `server-tool-call-fee-meter` + G4/M7v2 `per-call-fee-accumulator` + Appendix-S seed #8
- **cost_lever:** `Σ_t (calls_t × fee_t)` — the per-call fee term of the cost equation (web search ≈$10/1k Anthropic+OpenAI; Gemini grounding $14/1k after free tier), implemented NOWHERE in the codebase. A search-heavy session (500 calls = $5) rivals or dominates its token cost while every shipped meter shows $0 on this dimension.
- **tier:** T1 deterministic.
- **mechanism:** PostToolUse accumulator `(tool_name → call_count)` in the existing `_session-store.mjs` pattern × a caller-supplied fee schedule (per-1k-calls, same unit family as per-1M-token pricing) → `callFeesUsd` surfaced in the HUD, `budget-gate` (`remainingBudget −= callFees`), and `attribution` rollups. Schedule absent ⇒ `null`, never $0.
- **feasibility:** `tool_calls: z.array(z.string())` already in `packages/shared/src/schemas/event.ts` (E1-verified); PostToolUse payload carries `tool_name`. Falsifiable: 500 calls @ $10/1k = $5.00; unknown tool → 0 contribution; schedule absent → null; negative counts rejected.
- **evidence_anchor:** verified-primary per-call fee schedules (docs.anthropic.com, platform.openai.com, June 2026 — RE-VERIFY before shipping the default schedule).
- **novelty:** E1 greps `per.call.fee|callFee|fee.*schedule|callFeesUsd` → 0 hits in logic code; budget-gate/attribution/persistence are token-only.
- **decision_procedure:** pure counting + `Σ count_t × fee_t / 1000`; no model, no regex.
- **equivalence_gate:** n/a (meter only).
- **cost_model:** NET — the meter adds zero token cost; value is bill-accurate visibility + budget enforcement on a previously invisible term.
- **measurement_plan:** vitest fee arithmetic; budget-gate integration (fees reduce remainingBudget); adversarial: missing schedule → null, invalid schedule rejected at config validation.
- **constraints:** 7/7 (null-not-zero on missing schedule is the honesty-critical box).
- **effort:** S. Default schedule ships covering only the two verified tools, marked re-verifiable, overridable.

### L4-23 `multiedit-amplification-gate` — SURVIVES (E1, high confidence)
- **source:** G6/M4v2.
- **cost_lever:** output (Σ `edits[].new_string` bytes of a MultiEdit billed as output tokens).
- **mechanism:** PreToolUse(MultiEdit): `ΣnewBytes/ΣoldBytes` amplification ratio over the `edits[]` hunks + distinct `file_path` count; advisory above threshold (hard block opt-in via env, same pattern as the Write gate).
- **feasibility — confirmed code gap:** `apps/extension/hooks/edit-amplification.mjs:34` is literally `if (payload.tool_name !== "Write") return emitNoop()` — E1 read the line; MultiEdit is guarded only by reward-integrity (AST/hash) and thrash-detector (content hash), never for amplification.
- **novelty:** P8(c)/edit-amplification covers Write whole-file rewrites; the `edits[]` array (hunk sums) is structurally different.
- **decision_procedure:** `Array.reduce` byte sums + ratio + `Set(file_path).size`; deterministic.
- **equivalence_gate:** advisory (block opt-in only); no transform.
- **cost_model:** `saved ≈ (ΣnewBytes − targetedPatchBytes)/4 × output_rate`, null unknown model.
- **measurement_plan:** shadow-first; promote when ≥3% of MultiEdit calls exceed threshold; adversarial: missing/empty `edits[]` → noop.
- **effort:** S (a MultiEdit branch in the existing hook). Highest-confidence feasibility in the run.

### L4-07 `truncation-retry-meter` — SURVIVES (E1, high confidence) — recurrence ×2
- **sources:** G2/M2v2 + G6/M4v2 (one feature, two wiring points: live Stop-hook advisory + dashboard attribution — E1: ship as ONE package).
- **cost_lever:** output (truncated turn paid in full) + fresh_input (full-context continuation turn = double-pay).
- **mechanism:** `stop_reason === "max_tokens"` is parsed by `packages/telemetry/src/schema.ts:73,82,102,119` and consumed by ZERO hooks (E1 grep). Walk turns at Stop; count truncated turns; price wasted output + projected continuation re-pay from caller-supplied usage; advise raising max_tokens or decomposing.
- **novelty:** P8(b) is prospective statistical calibration (E1 read max-tokens-calibrator.ts); this detects observed truncation events. G9 independently self-killed its identical idea against this cluster — corroboration.
- **decision_procedure:** string equality on a typed field + arithmetic; malformed/absent stop_reason → not counted, noop.
- **cost_model:** `truncCount × (truncated output + mean input)` from transcript usage; USD null unknown model.
- **effort:** S (~60-line Stop hook + a `truncatedTurns` ring buffer in the session store).

### L4-02 `batch-cache-compound-advisor` — SURVIVES (E1, high confidence) — recurrence ×2
- **sources:** G1 + G4.
- **cost_lever:** batch 0.5× × cache-read 0.1× = **0.05×** input on cached batch reads — the largest verified per-request multiplier; `batch-router` is blind to it.
- **mechanism:** when `RouteDecision.lane === "batch"` ∧ `BreakpointPlan.cacheablePrefixTokens > 0`, emit the three-category breakdown (fresh ×0.5, cache_read ×0.05, cache_write ×batch) with full arithmetic shown, instead of the router's collapsed scalar discount. Discount constants caller-supplied (batchDiscount, cacheReadMultiplier passed separately — never a hardcoded 0.05 magic number).
- **feasibility:** E1 read `packages/batch-router/src/router.ts` — single `interactiveCostUsd + batchDiscount`, no per-category breakdown, confirmed.
- **decision_procedure:** pure arithmetic over two already-computed plans; any null input → `insufficient_data`.
- **cost_model:** `compoundSavingUsd = cachedTokens × (cached_input_rate − inputRate × batchDiscount × cacheReadMultiplier)/1M`; null if any rate null.
- **effort:** S (no new I/O; arithmetic extension + MCP tool `batch_cache_compound_quote`).

### L4-01 `geo-multiplier-advisor` — SURVIVES (E1, high confidence) — recurrence ×2 — RE-VERIFY rate
- **sources:** G1 + G4.
- **cost_lever:** ×1.1 on ALL token categories when `inference_geo:"us"` is set (Anthropic Opus 4.6+) — the only verified rate multiplier with zero handling anywhere (E1 grep `inference_geo|geoMultiplier` → 0 hits).
- **mechanism:** `applyGeoMultiplier(baseCostUsd, geoFlag, model, geoEligibleModels)` in `@prune/shared`; threads into cost quotes, HUD ("+10% geo premium" annotation), budget-gate; advisory when the flag is set without a data-residency need. Eligibility is a caller-declared model set (enum-gated, never content-sniffed); non-eligible model → `null` markup (flag without number).
- **decision_procedure:** set lookup + scalar multiply; `geoFlag=null` → base rates; unknown model → null.
- **measurement_plan:** vitest matrix over {flag × eligibility × priced/unpriced}; `geoFlag="eu"` (unverified) → treated as no-multiplier.
- **effort:** S. The 1.1× constant carries a RE-VERIFY label; the eligible-model set requires explicit re-verification on new model launches.

### L4-06 `flex-tier-router` — SURVIVES (E1, high confidence) — recurrence ×2
- **sources:** G4 + Appendix-S seed #4.
- **cost_lever:** OpenAI FLEX ≈ batch pricing (~0.5×), synchronous, preemptible — batch economics without the 24h-latency commitment for sequential agent chains that async batch cannot serve.
- **mechanism:** additive third lane in `batch-router`: `flex` iff `provider-capability flag ∧ ¬interactive ∧ flexLaneAvailable ∧ preemptibleOk` (all caller-declared); preferred over async batch when both eligible. Request bytes identical across lanes.
- **feasibility:** E1 read router.ts — `Lane = "batch" | "interactive"` only, confirmed gap.
- **decision_procedure:** boolean predicate; any missing field → interactive (conservative).
- **cost_model:** `flexDiscount` caller-supplied (≈0.5 published, RE-VERIFY); savings null on unpriced model.
- **effort:** S. E1 fix adopted: gate on a provider-capability flag rather than a hardcoded "openai" string (FLEX is beta).

### L4-20 `compressor-eligibility-pre-filter` — SURVIVES (E1, high confidence)
- **source:** G5/M3v2 (compression-breakeven literature, arXiv 2604.02985 + inverted-U 2606.00408).
- **cost_lever:** overhead avoidance — stop the squeezer from running where it provably cannot pay for itself.
- **mechanism:** arithmetic screen BEFORE squeezer invocation: token floor, min compression-ratio floor, ECF floor, cache-bust breakeven (the recompress-planner's own math, moved earlier). Fail-open; the pre-filter must never pass what the planner would later block (regression-tested agreement).
- **feasibility:** E1 read recompress-planner.ts — it checks only AFTER `compressedTokens` is known (squeezer already ran); no eligibility gate exists anywhere (grep zero).
- **analogy-break (named):** only the lower bound of the operating window transfers (the client squeezer does not degrade at large inputs).
- **effort:** S — extraction + earlier placement of proven arithmetic.

### L4-35 `billing-tier-drift-detector` — SURVIVES (E2, high confidence)
- **source:** G9/M5v2 (missing-signal sweep: parsed-but-unconsumed fields).
- **cost_lever:** rate multiplier — a mid-session `service_tier` flip (standard↔priority) silently changes every subsequent token's rate.
- **mechanism:** `service_tier` is parsed by `UsageSchema` (`schema.ts:19`, passthrough) and consumed by NOTHING (E2 grep: 3 docs-only hits, zero hooks). Stop hook walks `assistantMessages[].usage.service_tier`; advisory on flip vs prior turn or vs `PRUNE_EXPECTED_TIER`. String equality only; absent tier → no advisory.
- **cost_model:** differential priced only when both tier rates are known; else flagged with null.
- **effort:** S (≤60-line hook).

## 4. Tier B survivors

### L4-48 `squeeze-tier-frontier` — SURVIVES (E2, high confidence)
- **source:** G10/M6v2. Sweep `SqueezeTier` (lossless/structural/telegraphic) as arms through the EXISTING `qpd-bench` `recommendForCluster` + `@prune/quality` non-inferiority gates (AR 5pp→1pp, PWED Wilcoxon, TPR 3pp→0.5pp); flip a workload cluster's tier only when the cheaper tier clears ALL THREE; `isCacheAnchored` guard inherits the shipped G3 anti-synergy.
- **dimensional delta:** f4 sweeps MODEL; P8(d) sweeps EFFORT; nothing sweeps the CONTEXT REPRESENTATION (E2 verified the enum ships and the recommender accepts arbitrary arm strings).
- **effort:** LOW (~150-line adapter; recommender reused verbatim). Cold-start: ≥30 samples/arm before any promotion.

### L4-49 `observation-window-frontier` — SURVIVES (E2, high confidence)
- **source:** G10/M6v2. Sweep `MaskConfig.windowTurns` ∈ {3,5,10,20}: `planMask` is a pure function (E2-verified), so paired arms are free by replaying the same observation list; `MaskPlan.retainedTokens` is the measured cost axis; promote the smallest window that is NI on AR/PWED/TPR.
- **delta:** f15's window is an unbacked policy parameter; List1 `context-budget-frontier`/List3 `retrieval-depth-frontier` sweep SELECTION, not masking retention.
- **effort:** LOW (~100 lines). Replay data must come from real sessions.

### L4-25 `compaction-cost-predictor` — SURVIVES (E1, medium confidence)
- **source:** G7/M11 (matrix cell fresh_input×compaction). Project `turnsToCompact = (window − current)/meanGrowthRate` at UserPromptSubmit; when ≤ horizon, price the forced flush: prefix-rebuild differential (write−read) priced, summary component `null/insufficient_data`; advise trimming now vs planned post-compaction reseed.
- **delta:** f6 warns on ECF trend but projects nothing and prices nothing; compaction-auditor and compaction-recover act AFTER; the List1 reseed-planner (unbuilt, lower-ranked) is post-event.
- **revision note (E1 residual):** minimum-turns gate on meanGrowthRate to avoid early-session spurious predictions.
- **effort:** S–M.

### L4-26 `ttl-upgrade-planner` — SURVIVES (E2, high confidence)
- **source:** G7/M11. Mid-session observation of the inter-turn gap distribution → recommend 5m→1h TTL promotion when gaps + remaining-turns estimate clear the break-even (arithmetic already in `ttl-amortization.ts`; E2 verified `amortizingTtlChooser` is session-start-only, consuming aggregate read rate with no gap histogram).
- **delta:** CH-008 detects unintended switches; ttl-regression detects provider regressions; the session-start chooser cannot re-evaluate.
- **residual:** remaining-turns estimate is speculative — document the uncertainty floor, require minTurns.
- **effort:** S.

### L4-10 `batch-eligibility-tagger` — SURVIVES (E1, high confidence)
- **source:** G2/M2v2. Autonomous UserPromptSubmit hook calling the existing `routeRequest` with env-derived interactivity (`CI`, `PRUNE_NON_INTERACTIVE`) + latency slack; advisory when batch-eligible. A surface gap, not a mechanism gap (E1 verified no batch hook in install.mjs; the MCP tool requires deliberate invocation).
- **effort:** S (thin hook over an existing function).

### L4-22 `bash-burst-output-meter` — SURVIVES (E1, high confidence)
- **source:** G6/M4v2. Per-turn Bash-call count bucket (the fanout-acceleration bucketing pattern) + result-byte accumulator; advisory at count≥N ∧ bytes≥M (env-configurable — E1 fix). Distinct from navigation-ratio (window-of-turns with ZERO edits; 10 Bash + 2 edits never fires it) and P8(a) (single large results, not N small ones).
- **effort:** S–M.

### L4-27 `tool-call-coalescing-gate` — SURVIVES (E2, high confidence)
- **source:** G7/M11 (matrix cell fees×tool-call). Within-turn duplicate parallel tool calls: PreToolUse SHA of (tool_name, canonical input) against the in-progress turn's dispatched calls; on exact duplicate, block + echo the first result byte-exact with a `[deduped]` tag. Fail-open. Loop-breaker and speculative-prune/record are both cross-turn (E2-verified).
- **revision note (E2 residual):** pin the canonicalization to loop-breaker's standard (JSON.stringify is not stable across undefined fields); host-timing risk → PostToolUse fallback.
- **effort:** M.

### L4-16 `skill-routing-coverage-auditor` — SURVIVES (E1, medium confidence) — recurrence ×2
- **sources:** G3/M10 + Appendix-S seed #7 (adjacent surface: seed audits `.claude/skills`; primary audits the f12 library). Audit `SkillLibraryState`: `intentSignature` sparsity, zero-`tokenFootprint` step ratio, replay utility — pure arithmetic over the existing data model (E1 verified zero self-audit in capture.ts/library.ts). SkillReducer (arXiv 2603.29919): 26.4% of skills lack routing descriptions.
- **revision note (E1 residual):** `replayUtility` is not a field — define it as a derived metric (e.g. `discoveryTokens × useCount`).
- **effort:** S.

### L4-28 `output-rate-watch` — SURVIVES (E2, high confidence)
- **source:** G7/M11 (matrix cell output×session-end — the output term had NO per-session anomaly detector). Stop-hook output-fraction z-score vs the session's own historical baseline (≥minSessions gate, bounded ring buffer); flags the top output-token turns with surplus cost. Self-calibrating, unlike absolute caps.
- **effort:** S–M.

### L4-29 `reasoning-token-drift-sentinel` — SURVIVES (E2, high confidence; kept separate from L4-09 by both evaluators)
- **source:** G7/M11. Feed per-turn reasoning-token counts into the existing `CUSUMDetector` from `@prune/context-health`; advisory at regime change; de-prioritized when a CH-009 dial-change event explains the inflection (requires a session-store flag from the CH-009 surface — named coupling). CH-009 fires on the PARAMETER change; this fires on REALIZED drift with a fixed dial.
- **effort:** S (tested algorithm, new axis). Reasoning-token availability is host-dependent → insufficient_data fallback.

### L4-36 `tool-input-growth-gate` — SURVIVES (E2, high confidence)
- **source:** G9/M5v2. PreToolUse byte-size of serialized `tool_input` vs the median of prior calls to the same tool (window 10); advisory at ratio ≥3× with ≥2 priors. The DERIVATIVE axis: cost-guard fires on absolute bombs, edit-amplification on Write file ratios, L4-22 on per-turn counts — this catches super-linear growth before absolute thresholds trip.
- **effort:** LOW–M (100KB serialization cap inherited from cost-guard's defensive pattern).

### L4-33 `tool-result-field-projection-pruner` — SURVIVES (E2, high confidence)
- **source:** G8/M12 (database projection-pushdown analogy; shared mechanism: don't materialize unreferenced columns). PostToolUse `projectFields(result, requiredFields[])` keeping declared dot-paths; passthrough on absent manifest/parse failure; `droppedFields` audit; under-declaration is recoverable (re-fetch) and must enter NET.
- **delta:** P8(a) trims by SIZE (under-threshold results untouched); List1 tool-output-bounding is call-side parameter injection; this is result-side reference-based projection.
- **effort:** S–M.

### L4-38 `citeback-contribution-proxy` — SURVIVES (E2, medium confidence)
- **source:** G9/M5v2 (constraint-pressure redesign: the determinism constraint forbids a learned CUM — this is the deterministic structural proxy). Stop-hook: set of Read paths vs basename containment in concatenated assistant `textContent`; zero-citeback files flagged as next-session exclusion candidates. No learning, no acceptance signal needed (the F1 CUM blocker). False-negative surface (cited by symbol, not path) acknowledged; advisory-only.
- **effort:** LOW.

### L4-45 `masking-regime-gate` — SURVIVES (E2, medium confidence; kept separate from L4-20)
- **source:** Appendix-S seed #1 (inverted-U regime map, arXiv 2606.00408). Session-level gate on WHETHER f15 masking helps at all (re-read rate × dedup rate × fullness regime) — today `planMask` runs unconditionally when the hook fires. Different actuator and trigger than L4-20 (squeezer vs masking); a future "generic transform regime gate" refactor could unify them.
- **residual:** session-store re-read-rate undercounting; needs an f15-side counter.
- **effort:** S–M.

### L4-19 `zoned-context-trigger` — SURVIVES (E1, medium confidence)
- **source:** G5/M3v2 (CAT 2512.22087 + ACON 2510.00615). Coordinator composing context-health (ECF≥kWarn gate) → age-based zone classification (Z1 stable→telegraphic, Z2 mid→structural, Z3 recent→mask-only) → recompress-planner arithmetic per zone → observation-mask for Z3. Composition only; zero changes to composed packages; age≠importance mitigated by the inherited pin-flag.
- **revision note (E1 residual):** zone boundaries caller-configurable, not hardcoded.
- **effort:** M.

### L4-34 `context-safety-stock-planner` — SURVIVES (E2, medium confidence)
- **source:** G8/M12 (EOQ safety-stock analogy; shared mechanism: carrying cost vs stock-out). Per-prefix-fingerprint coefficient of variation of inter-access gaps → eager vs lean breakpoint placement. Orthogonal to ttl-amortization (MEAN read rate — E2-verified) and churn-pin (WRITE churn). `insufficient_data` below minSamples is mandatory (never CV=0).
- **effort:** M. Fingerprint stability rests on cache-planner's deterministic FNV hash (E2-verified).

## 5. Tier C — fleet guardrails

### L4-42 `advisory-fleet-budget-gate` — REVISE (E2, high confidence)
- **source:** G11/M8v2 fleet audit: SEVEN UserPromptSubmit hooks each emit `additionalContext` with no fleet-level cap — 500–1500 advisory tokens/turn worst case, billed as input. f19 wastebench MEASURES overhead post-hoc; nothing PREVENTS it.
- **required fix (E2):** the proposed pre-emit shared counter RACES across 7 parallel node processes. Redesign as either (a) post-emit tally + Stop-event audit (retrospective), or (b) fixed priority-ordered token-budget slice per hook (no shared mutable counter). Value stands; the implementation must respect process isolation.
- **effort:** M.

### L4-40 `dual-read-advisor-suppression` — SURVIVES (E2, medium confidence)
- **source:** G11. read-gate (Read matcher) and trajectory-diet (no matcher) both fire on the same PreToolUse/Read and can both emit "skip this read" advisories (install.mjs verified; `_runtime.mjs` has no dedup layer). Per-(transcript, turn, path) advised-flag in the session store; proof-grade f16 takes precedence. Store race is non-fatal (last-write-wins; worst case one double advisory).
- **effort:** LOW (~50 lines).

### L4-41 `mask-compaction-ordering-guard` — SURVIVES (E2, medium confidence)
- **source:** G11. Sequence hazard: f15 masks an observation → compaction → compaction-recover tells the agent to re-introduce content that is now an unrecoverable placeholder. Fix: pin (existing `Observation.pinned`, types.ts:29) observations matching the lost-reference predicate before masking — conservative direction only.
- **implementation note (E2):** share analyzeCompaction's predicate (or a pre-computed pinned-ID set) rather than re-running the full analyzer per prompt.
- **effort:** LOW–M. Over-pinning erodes f15 savings — bound it with the shared predicate.

### L4-44 `thrash-navrat-coalesce` — SURVIVES (E2, medium confidence)
- **source:** G11. thrash-detector and navigation-ratio co-fire PostToolUse on the same stuck turn with overlapping diagnoses (~200–400 duplicate advisory tokens). Thrash writes a pending-flag keyed by (transcript, seq); navigation-ratio consumes it and emits one compound diagnosis. Depends on registration order (documented dependency; install.mjs order verified).
- **effort:** LOW (~40 lines).

## 6. Tier D — REVISE class (ship only after the named fix)

### L4-09 `thinking-spend-attributor` (absorbs L4-37) — REVISE+MERGE (both evaluators concur)
- **sources:** G2/M2v2 `thinking-token-ceiling-planner` + G9/M5v2 `thinking-token-attributor` — reasoning-spend family ×2 (L4-29 kept separate as the drift alarm).
- **combined shape:** (1) per-turn thinking-token counts by walking `ThinkingBlockSchema` blocks through `@prune/tokenizer` — **the claimed `reasoningTokens` field does NOT exist in event.ts (E1 read the file); the tokenizer walk is mandatory**; (2) `thinkingFraction` attribution as a first-class output; (3) `budget_tokens` ceiling derivation when enough sessions exist. One package, three outputs, Stop surface.
- **effort:** S–M.

### L4-04 `gemini-thinking-split-advisor` — REVISE (E1) — recurrence ×2
- **required fix:** rates must be a caller-supplied `(thinkingRate, nonThinkingRate)` pair — never hardcoded constants (the catalog rates carry a RE-VERIFY label); task class caller-declared, null ⇒ suppressed. With those guards: price the avoidable `thinkingTokens × (thinkingRate − nonThinkingRate)` differential and advise `thinkingBudget:0` on non-reasoning tasks.

### L4-05 `search-call-dedup-gate` — REVISE (E1)
- **required fix (waterbed/staleness):** (a) maxAgeMs env-sourced with a conservative default; (b) on stale TTL the hook PASSES THROUGH (never synthesizes); (c) echoed responses tagged `[cached, ageMs=N]`. With those: PreToolUse byte-exact query-SHA dedup on declared search tools, saving the per-call fee.

### L4-13 `context-placement-orderer` — REVISE (E1) — recurrence ×2
- **required fix (cache-bust waterbed):** reordering bytes inside the cached prefix busts it. Gate the reorder to the VOLATILE TAIL ONLY (content after the last cache breakpoint), or make the feature mutually exclusive with cache-planner via flag. The lost-in-the-middle gain (arXiv 2307.03172) applies under an NI gate reflecting the named analogy break (coding agents ≠ retrieval Q&A).

### L4-14 `output-budget-hint-injector` — REVISE (E1) — recurrence ×2
- **required fix:** inject via the host's `additionalContext` path, NOT spliced into the user message body (prefix-cache safety); task-class gating caller-declared (fire only on explain/analyze classes, null on unknown). p50 source: the existing max-tokens-calibrator sample path. Shadow → NI gate → promote.

### L4-17 `multi-agent-review-tax-meter` — REVISE (E1)
- **required fix:** name the false-positive surface (exploratory subagents match the structural pattern) in the spec; minimum read-only-turns gate (≥5); report "review-pattern" not "confirmed review"; advisory-only. Then: Task spawn + consecutive read-only turns + zero mutations (NAV/MUT vocabulary) → separate attribution of the review tax (Tokenomics 2601.14470: 59.4%).

### L4-18 `reference-count-eviction-proxy` — REVISE (E1)
- **required fix:** the replay NI gate (≥5% retained-token reduction vs LRU) is MANDATORY before promotion from shadow; refCount computed over tool-USE inputs only (never result content). Then: populate f15's offline-only `nextUseTurn` online from cross-turn path/SHA reference counts (H2O principle, 2306.14048).

### L4-21 `task-class-spend-percentile-tracker` — REVISE (E1)
- **required fix:** `taskClass` is a CALLER-DECLARED field (null ⇒ insufficient_data — never inferred from content; SpendEvent has only `taskId` today); percentiles computed strictly within-class. Then: p90-tail early warning exploiting the 30× same-task variance (MSR 2604.22750).

### L4-30 `write-back-breakpoint-coalescer` — REVISE (E2)
- **required fix:** formalize the coverage-gap refusal predicate as `stableTokens(P1..P2) ≥ minCacheableForModel(model)` — the current "above threshold" is underspecified and can silently under-protect stable content. Degenerate safe mode (mergeWindow=0) retained. Then: merge near-adjacent breakpoints to pay the write multiplier once per cluster.

### L4-32 `turn-coalescing-advisor` — REVISE (E2)
- **required fix:** price the saving as `(N−1) × cacheWriteCost(prefixTokens) × write-multiplier differential` (the real term) — NOT a vague "per-call fixed overhead" that fabricates value when per-call fees are zero. Then: detect runs of ≥3 short text-only turns (≤200 tokens, ≤10s gaps) and advise merging (Nagle analogy; latency/quality disanalogy stays named).

### L4-47 `mode-switch-rebill-guard` — REVISE (E2) — Appendix-S seed #5
- **required fix:** mirror the CH-013/CH-014 contingent pattern — emit observed tokens-at-risk as fact, `estimatedWasteUsd: null`, `signal.contingent: true` until a PRIMARY billing source confirms the re-billing mechanic (current evidence is secondary-only). Then it ships as a new CH-class rule (E2 verified CH-001..014 contain no mode-switch rule).

## 7. Appendix S seed verdicts (all 9 gated this run, as required)

| # | seed | outcome |
|---|---|---|
| 1 | `masking-regime-gate` | **SURVIVES** as L4-45 |
| 2 | `attention-sink-protector` | **REJECT** (L4-46) — client-side eviction cannot preserve a server-side attention property; premise broken |
| 3 | `context-position-reorderer` | absorbed into L4-13 — **REVISE** (volatile-tail gate) |
| 4 | `service-tier-router` | absorbed into L4-06 — **SURVIVES** |
| 5 | `mode-switch-rebill-guard` | L4-47 — **REVISE** (contingent pattern) |
| 6 | `reflection-token-compactor` | absorbed into L4-15 — **REJECT** (cache-bust waterbed, no sound guard) |
| 7 | `skill-bloat-auditor` | absorbed into L4-16 — **SURVIVES** |
| 8 | `server-tool-call-cost-meter` | absorbed into L4-03 — **SURVIVES, top-ranked** |
| 9 | `prompt-budget-injector` | absorbed into L4-14 — **REVISE** (additionalContext path) |

6 of 9 seeds survive in some form; 2 die at the gate; 1 dies on a waterbed its paper never had
to face (client-side prefix caching). P6 vindicated: seeds are not survivors until gated.

## 8. M9v2 reject log (auditable killing objections)

| entry | source | killing objection (evaluator evidence) |
|---|---|---|
| L4-08 `session-cache-hit-regression-alerter` | G2/M2v2 | N0 duplicate of List1 `dashboard-cache-hit-regression-detector` (E1: found in RESEARCH-LIST1.md lower-ranked set) |
| L4-11 `turn-abandonment-cost-ledger` | G2/M2v2 | Structural "abandoned" inference is content classification in the decision core (constraint 1); task-ledger already has a caller-declared `abandoned` outcome (ledger.ts:46) |
| L4-12 `adaptive-output-schema-binder` | G2/M2v2 | N0 duplicate of List1 `output-shape-constrainer`; Appendix S itself flags the collision |
| L4-15 `history-filler-stripper` | G3/M10 + seed #6 (×2) | Stripping re-sent history MUTATES the cached prefix → cache bust converts 0.1× reads to 1.25–2× writes; no sound guard exists (cache boundary not tracked per-turn). Unsound equivalence claim |
| L4-24 `idle-gap-cache-decay-advisor` | G6/M4v2 | Duplicate of CH-004 `idle_exceeds_ttl` (E1 read cache-habits/src/rules.ts:217–262 — same trigger, same surface, same pricing) |
| L4-31 `dependency-dirty-subtree-invalidator` | G8/M12 | Prefix-cache semantics kill the premise: cache-planner.ts documents "a single character of drift in ANY block before the breakpoint invalidates the cache" — per-breakpoint independent validity does not exist |
| L4-39 `tool-result-reuse-miss-detector` | G9/M5v2 | Protocol premise broken: turn-mapper.ts:102–126 merges tool_results into the same turn as their tool_use; a tool_use_id never legitimately re-appears as a later independent turn — the envisioned signal is structurally invisible |
| L4-43 `clearing-price-nullquote-passthrough` | G11/M8v2 | Value below bar: zero token delta, and no hook imports @prune/clearing-price, so the null-λ passthrough cannot manifest. Belongs in the package README |
| L4-46 `attention-sink-protector` | seed #2 | Attention sinks are a model-internal KV/positional property; refusing to evict client-side blocks 1–N does not preserve server attention patterns. Analogy broken at the core |
| L4-50 `subagent-parallelism-frontier` | G10/M6v2 | maxParallelInOneTurn is a SAFETY cap, not a cost dial: serialization does not reduce total tokens; sweeping it risks degrading the warden's guarantee; expected outcome is honest-null for most tasks |

Also self-killed before the gate (the fed-forward N0 discipline working): G9's stop_reason
variant (vs the L4-07 cluster), G4's TTL-refresh-on-hit (thin vs prefix-warm), G3's seeds 1/2/4
(covered/server-side), G10's MCP-server-count (vs frozen tool-subset-frontier), and the 5
duplicates rejected during Appendix-S seeding.

## 9. Sequencing recommendation

1. **Week 1–2 (Tier A, all S effort):** L4-03 (fee meter — new billing dimension, ×3 convergence),
   L4-23 (MultiEdit gate — one-line-confirmed gap), L4-07 (truncation meter — unconsumed signal),
   L4-35 (tier-drift — unconsumed signal). These four are independent and touch no shared state.
2. **Week 2–3 (pricing correctness):** L4-01 + L4-02 + L4-06 as one `@prune/shared`+`batch-router`
   change set (geo multiplier, compound quote, flex lane) — they share the strict-pricing surface.
3. **Week 3–4 (fleet hygiene before adding more advisors):** L4-40, L4-44, L4-41, then the
   redesigned L4-42 — ship the advisory-dedup guardrails BEFORE Tier B adds more advisory hooks.
4. **Month 2 (NI-gated frontiers):** L4-48, L4-49 (recommender reuse), then L4-20/L4-45 regime
   gates, then the remaining Tier B observability features.
5. **Month 2+ (REVISE class):** implement only with the evaluator's named fix as an acceptance
   criterion in the PR description; L4-13/L4-14 last (cache-interaction-sensitive).

## 10. Honest closing notes

- Every survivor names nearest-prior-art + delta, and every verdict cites a grep or file read.
- All generator output was produced by one model family; treat recurrence as persona-diversity
  convergence, not model-diversity convergence.
- Rates flagged RE-VERIFY (geo 1.1×, batch/flex 0.5×, Gemini split, fee schedules) must be
  re-confirmed against primary provider docs before any constant lands in `pricing.ts` — the
  v2 doc's own drift warning applies.
- The 90-cell morphological matrix (G7) found ~78 cells already covered — the program is near
  saturation on the classic levers; List4's value concentrates in the three newest cost-equation
  terms (per-call fees, geo/tier multipliers, split-rate reasoning), parsed-but-unconsumed
  transcript signals, fleet-level reflexive overhead, and NI-gated config dimensions.

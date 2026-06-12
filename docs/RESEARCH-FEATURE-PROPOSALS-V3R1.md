# Feature Proposals — v3 Run 1 (provider-mechanics-first, executed 2026-06-12)

> Output of the first executed v3 discovery run: five independent generators (N2 Delta
> Miner, N4 Contradiction Engineer, N10 Unpriced-Resource Prospector, N12 Usage-Field
> Forensic, N13 Session-Phase Planner; no cross-talk), 23 raw candidates, gated by the N9
> falsification sequence (feasibility → fact-row dependency → honesty → waterbed → prior
> art → novelty). Fact-row ids refer to `RESEARCH-META-PROPOSALS` — see
> `RESEARCH-META-PROMPTS-V3.md` Part A3. Constraints honored throughout: deterministic
> decision cores, NO regex, NO model calls in decisions, NO proxy/wrapper (hook / MCP /
> extension / CLI surfaces only), null-honest numbers, fail-safe.
>
> Recurrence = number of independent generators that produced the mechanism (the
> protocol's strongest ranking signal; same-model caveat applies per Part 0).

## N9 gate log (kills & merges)

- MERGED → P1: N4 "Compaction Annuity", N2 "Compaction Hidden-Bill Ledger + Break-even
  Trigger", N12 "Compaction Net-Effect Gate", N13 "Compaction-Eve Prepper", N2 "Eviction
  Breakeven Gate" (clearing arm; same free-preview + invalidation arithmetic).
  **Recurrence 4 generators.**
- MERGED → P2: N4 "Invalidation Carpool", N4 "Tool-Def Change Freezer", N13 "Prefix
  Layout Lock". Same mechanism (schedule cache-busting mutations to provably-free
  instants), three lenses. **Recurrence 2 generators (3 candidates).**
- MERGED → P6: N2 "Cache-Neutral Advisory Channel", N10 "Append-Only Instruction
  Channel". Same enabling row (ANT-25). **Recurrence 2.** STATUS: **BLOCKED pending
  re-verification** — ANT-25 is Grade C (gate rule 6); one primary fetch unblocks.
- MERGED → P7: N4 "Prediction Underwriter", N2 "Prediction Profitability Gate".
  **Recurrence 2.** Scoped honestly to OpenAI 4o/4.1 surfaces (Codex/CI harnesses);
  Claude Code hooks no-op.
- KILLED: none outright. Two candidates carry conditional feasibility and rank last:
  N13 "Quota-Cliff Deferral Valve" (quota clock not observable in hook payloads today —
  inert by construction until a quota accounting source exists) and N10 "Pre-Billing
  Slice Fetch" (requires org `*_20260209` web tools + caller-supplied exact selector).
- Zero candidates violated no-regex / no-proxy / null-honesty after self-gating.

## Gated catalog (ranked)

### P1 — Compaction Economics Suite ⭐ flagship (recurrence 4)
**Rows:** ANT-17 (A), ANT-16 (A), ANT-15 (A), ANT-30 (A) · **Surface:** PreCompact/
PostCompact/Stop hooks + MCP `compaction_econ` + replay-vault storage · **Currency:** USD.
Four arms, one ledger:
1. **True-cost accounting** — sum `usage.iterations[]`; top-level usage EXCLUDES
   compaction output (every dashboard under-counts today). Strict schema parse; mismatch
   ⇒ `unknown`, never 0.
2. **Annuity vault** — store server compaction blocks keyed by source-prefix content-SHA;
   re-apply on byte-identical lineage (FREE per ANT-17) instead of re-billing a new
   summary; equivalence by identity. Self-disables if a re-apply ever shows nonzero
   iterations cost (repricing tripwire).
3. **Eve preparation** — at the PRE-COMPACTION phase edge (ctx ≥ 0.8×trigger, hysteresis
   0.7): verify a dedicated system-prompt cache breakpoint exists (the one thing ANT-17
   says survives compaction), persist the decision ledger to the memory tool, and run
   FREE `count_tokens` + `context_management` previews to price clear-vs-compact-vs-hold.
4. **Payback gate** — net(c) = realized input reduction × effective rate × remaining
   turns − hidden summary cost; k consecutive net-negative compactions ⇒ advise raising
   the trigger. Advisory-only (compaction is lossy ⇒ no equivalence proof ⇒ abstention).
**Savings model:** avoided re-summaries × summary_tokens × p_out + preserved system-prefix
cache (× (1.25−0.1) p_in per compaction) + corrected under-count (integrity).
**Failure modes:** `iterations` absent ⇒ full no-op; beta shape change ⇒ strict parse ⇒
unknown. **Novelty:** T1 was bare metering; compaction-recovery acts AFTER the boundary;
replay-cost predates the mechanic. **Measure:** Σiterations vs top-level per session;
vault reuse count × summary size; first-post-compaction-turn system-prefix cache_creation
≈ 0.

### P2 — Cache-Invalidation Scheduler (recurrence 2, 3 candidates)
**Rows:** ANT-5 (A), ANT-15 (A), ANT-30 (A), ANT-1 (A) · **Surface:** PreToolUse/Stop
hooks + MCP `carpool_status` / `defset_epoch_status` · **Currency:** USD + quota.
Queue ALL cache-busting mutations (tool-def changes, context-editing clears, thinking
clears, system tweaks) and release them ONLY at provably-free instants:
`release iff (cache_creation_input_tokens > 0 this turn) OR (gap > TTL of deepest
surviving breakpoint) OR turn == 0 OR post-compaction entry`. One invalidation services N
mutations; tool-def mutations (deepest tier, ANT-5) additionally announce availability via
the cache-safe channel (P6) while queued. Skipping gate: previewed savings ≥ 1.25 ×
post-clear prefix (free preview, ANT-16).
**Induced cost:** queued clears stay resident at 0.1× cache-read for a few turns
(bounded). **Failure:** per-TTL split absent ⇒ gap-rule only; urgent mutation ⇒ explicit
priced override. **Novelty:** cache-habits warns per-pattern; observation-mask picks WHAT
to evict; nothing shipped decides WHEN — this makes invalidation cost ≈ 0 by timing.
**Measure:** deepest-tier cache_creation events/session before vs after; % mutations
released at zero-marginal instants.

### P3 — Effort-Yield Calibrator (singleton; zero new instrumentation)
**Rows:** ANT-30 (A) `thinking_tokens`, OAI-18 (B) `reasoning_tokens`, ANT-11/13 (B) ·
**Surface:** Stop hook ledger + MCP `effort_yield_report`, feeding the shipped
effort-router (P8d) · **Currency:** USD (thinking bills as output).
The effort dial has no gauge: P8(d) sets effort per task class and never reads realized
spend back. Ledger (task-class × effort) → realized thinking-token order statistics;
n≥20: P90(thinking|E) ≤ floor(E−1) ⇒ advise downgrade; P50 ≥ 0.95×cap ⇒ advise upgrade.
Actuation only through the existing QpD non-inferiority gate.
**Failure:** field absent ⇒ `insufficient_data`; provider folds thinking into output ⇒
P5 tripwire suspends it. **Novelty:** first closed loop from realized reasoning spend to
the effort parameter. **Measure:** counterfactual thinking spend at recommended vs actual
efforts, overhead subtracted.

### P4 — TTL Economics Suite (2 arms)
**Rows:** ANT-30 (A) per-TTL write split, ANT-1 (A), ANT-7 (B), OAI-2 (A/B) ·
**Surface:** Stop hook + armed timer + MCP `ttl_choice_audit` · **Currency:** USD + quota.
(a) **Write-Split Auditor** — first reader of `cache_creation.ephemeral_5m/1h`: flags
`WASTED_1H` (paid 2× but every read landed ≤300s) and `MISSED_1H` (re-paid 1.25× writes a
1h TTL would have avoided); recommendations change only the TTL annotation — zero
invalidation. (b) **Deathbed Decider** — event-edged at TTL−60s: keep-alive via
`max_tokens:0` (0.1× ping) iff median inter-turn gap < TTL AND phase ≠ QUOTA-CLIFF, cap 2
pings; default mode `advise` (no silent spend).
**Novelty:** TTL-regression sentinel infers from read collapse, never reads the split;
prefix-warm plans statically, has no expiry-edge trigger or quota veto. **Measure:**
write-premium spend before/after; resumed-warm vs resumed-cold ratio; net = avoided
rewrites − ping spend.

### P5 — Billing-Identity Tripwire (integrity floor)
**Rows:** ANT-30 (A), OAI-18 (B), ANT-17 (A) · **Surface:** inside telemetry-forward path
+ MCP `usage_identity_status` · **Currency:** none (it protects all USD claims).
Fixed arithmetic invariants over every usage object (ANT: in+writes+reads+out = billed;
ephemeral split sums to aggregate; iterations exclusion. OAI: total = in+out; details ≤
parents) + exact key-set diff vs a pinned schema manifest. Violation ⇒ `METER_DRIFT`
event; downstream pricers mark affected costs `unverified` instead of asserting USD.
The compaction exclusion is the existence proof that providers change meters silently.
**Novelty:** U3 reconciles predictions; this is provider-side internal-consistency + drift
sentinel — the honesty bar, mechanized at the meter. **Measure:** drift events + dollar
volume quarantined.

### P6 — Cache-Safe Injection Channel ⚠ BLOCKED pending ANT-25 re-verification (recurrence 2)
**Rows:** ANT-25 (C — blocks per gate 6), ANT-5 (A), ANT-1 (A) · **Surface:** shared
forwarder library used by ALL existing advisory hooks + MCP `inject_plan`.
Route Prune's own advisories and append-only CLAUDE.md/settings deltas through
mid-conversation system messages (no prefix invalidation) instead of messages-tier
injection. Proof condition for config deltas: old content is an exact byte-prefix of new
(pure append). Equivalence by identity (same bytes, different channel). **Reflexive
significance:** today every Prune advisory is itself a messages-tier cache killer — this
makes the meter cache-neutral. **Unblock:** one primary fetch of the
mid-conversation-system beta doc. **Measure:** cache_read continuity across advisory
turns, channel on vs off.

### P7 — Prediction Profitability Gate (recurrence 2; OpenAI-scoped)
**Rows:** OAI-10 (B), OAI-18 (B) · **Surface:** MCP `prediction_gate` + CLI for
Codex/CI harnesses (Claude Code hooks: honest no-op) · **Currency:** USD vs declared
latency value. Per-(extension × edit-kind) ledger of accepted/rejected prediction tokens;
attach predictions only where `(1−A_k) × medianPredLen × p_out ≤ user-declared budget`;
unset budget ⇒ inert. Rejected tokens bill as output — this prices speculation failure.
**Novelty:** first actuator on the accepted/rejected usage pair (T12 matured: realized-
acceptance ledger, not expected-acceptance guess). **Measure:** rejected-token spend per
accepted edit, gate on/off.

### P8 — Tier Differential Ledger
**Rows:** ANT-30 (A), OAI-13 (B), OAI-11 (B) · **Surface:** Stop hook + dashboard column.
Requested-vs-SERVED tier reconciliation per response (string equality), premium/discount
priced only when both tier rates known (else null), cumulative premium advisory; joins
P4 on batch responses whose latency outlived the cache TTL. **Novelty:** L4-35 detects
flips only; this reconciles and accounts. Read-only, zero induced cost.

### P9 — Output-Blowback Breaker (compression underwriting)
**Rows:** LIT-8 (C — number needs re-verification before marketing claims; mechanism
holds regardless), ANT-30 (A) · **Surface:** PreToolUse gate on squeezer tiers + MCP
`blowback_ledger`. Per-fingerprint (extension-set × tier — literal key composition)
paired ledger of input saved vs output amplification; compression enabled only while
measured net > 0; hard `max_tokens` cushion at baseline-P95 aborts blowback mid-flight;
unknown fingerprint ⇒ OFF (failure is 5×-priced, benefit 1×). **Novelty:** waterbed F12
is decision-time and generic; this is paired empirical underwriting + a runtime tripwire
guarding Prune's own squeezer. **Measure:** per-fingerprint net USD; cushion-trip rate.

### P10 — Margin Referee
**Rows:** ANT-16/19 (A) · **Surface:** library shim consumed by diff-enforcer /
response-tuner / budget-gate + MCP `count_referee`. When a shipped actuator's decision
sits inside the local tokenizer's calibrated error band ε̂, one FREE `count_tokens` call
resolves it exactly; ε̂ maintained as max|local−oracle| per (model, class); memoized by
content-SHA; RPM token-bucket. Requires an API key — optional enhancement; absent key ⇒
ε̂-padded local estimates (honest no-op; zero-key principle preserved). **Novelty:**
upgrades existing actuators' soundness at $0; also produces the tokenizer-calibration
data M1 (adversarial review) asked for. **Measure:** flip rate × realized Δcost.

### P11 — Cache-Shard RPM Governor (fleet/CI; OpenAI)
**Rows:** OAI-4 (B), OAI-2 (A/B), OAI-18 (B) · **Surface:** CLI/library for CI runners +
MCP `cache_key_plan`. SHA-256 prefix id; sliding 60s rpm counter; shardCount =
ceil(rpm/15); deterministic `prompt_cache_key` suffix assignment; shard only if projected
per-shard reads ≥ 2 within the eviction window. Protects the 90% discount in parallel
CI/agent fleets. **Measure:** `cached_tokens` ratio at matched rpm, governed vs not.

### P12 — Pre-Billing Slice Fetch (conditional)
**Rows:** ANT-23 (B) · Requires org `*_20260209` web tools + caller-supplied EXACT
selector (string equality, no regex); sandbox extracts the k-token slice so only k ever
bills (upstream of P8(a), which prunes after billing). `found:false` ⇒ capped full fetch.
Free-hours metered; repricing tripwire on any server-tool charge.

### P13 — Quota-Cliff Deferral Valve (conditional; weakest feasibility today)
**Rows:** ANT-29 (B), ANT-9 (B) · Reset-edge queue for host-flagged background work +
overage-vs-batch breakeven. Inert by construction until a quota clock is observable —
recorded as the host-instrumentation ask it implies.

## Run notes
- Recurrence concentration: compaction economics (4/5 generators) and invalidation
  timing (2 generators, 3 candidates) — the meter's two newest blind spots.
- Same-model caveat applies (all generators ran on one model family); recurrence ranks,
  it does not prove.
- Next per protocol: human gate → spec the top picks → `packages/quality`
  non-inferiority gating → build behind shadow flags → WasteBench attestation.

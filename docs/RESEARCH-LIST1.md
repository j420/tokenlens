# List1 — Round-1 Feature Baseline (frozen)

> **Frozen reference.** This is the named baseline ("List1") that the Round-2 adversarial pass
> (`docs/RESEARCH-FEATURE-PROPOSALS-L2.md`) must NOT re-propose. Full detail lives in
> `docs/RESEARCH-FEATURE-PROPOSALS.md`; this is the at-a-glance index + the "do-not-propose" set.
>
> Frozen June 2026 from the executed ensemble run. Any Round-2 idea adjacent to an entry here must name
> the entry + state the precise delta, or it is rejected by the N0 (novelty-vs-List1) gate.

## Round-1 character (and its self-imposed limits)

List1 was produced under **strict discipline**: every feature had a **deterministic decision core** (no
model/ML in the decision), framed on the **per-request cost equation** and **existing product surfaces**.
That discipline is what makes List1 buildable — and what *capped its ambition*. Round-2 deliberately
relaxes those framing limits (tiered: T1 deterministic / T2 model-in-loop / T3 paradigm) while keeping
the non-negotiables (no fabricated numbers, fail-safe, equivalence-gated, PII-safe).

## List1 — the do-not-propose set

### Tier-1 features (8)
| id | lever | one-line |
|----|-------|----------|
| batch-tier-router | all rates ×0.5 | route non-interactive work to the Batch API lane |
| intra-request-content-dedup | fresh_input + cache_write | collapse byte-identical blocks/spans within one request |
| silent-ttl-regression-detector | cache_write | flag the 1h→5m provider TTL silent regression |
| openai-increment-prefix-aligner | cache_read | align stable prefix to OpenAI's 1024/+128 boundary |
| edit-economics-governor | output + cache_write | diff-vs-rewrite that also prices the cache bust |
| context-budget-frontier | fresh_input @ fixed quality | smallest retrieval depth that stays non-inferior |
| tool-output-bounding-at-source | fresh_input + output | bound oversized tool results at the call site |
| file-state-thrash-detector | request_count | detect A→B→A edit oscillation |

### Lower-ranked features (10)
edit-payload-amplification-detector · tool-subset-frontier · few-shot-count-frontier ·
progressive-tool-surface-compiler · speculation-budget-gate · two-axis-descent-governor ·
output-shape-constrainer · postcompact-cache-reseed-planner · dashboard-cache-hit-regression-detector ·
gemini-implicit-vs-explicit-cache-selector

### Capability unlocks (6)
U1 wire diff-enforcer (PreToolUse) · U2 next-turn request descriptor · U3 cache-hit reconciliation ·
U4 per-tool latency · U5 system-prompt byte tap · U6 kill hardcoded model default

### Anti-synergy guardrails (3)
G1 pruner-vs-cache-bust · G2 skip-retrieval-starves-skill-capture · G3 re-squeeze-prefix-bust

### Plus the original prior art (round 0)
f1–f13, P8(a–e), N2/N3/N5/N6, router, budget-gate, slo, sentinel, attribution, squeezer, repo-map.

## What List1 structurally CANNOT contain (the Round-2 opening)

By construction, List1 has **no** feature that: optimizes the *task* (not the request); raises
*value-per-token* (only lowers cost); learns from *outcomes* (accept/reject, CI, review); aggregates
*across sessions/devs/orgs*; uses a *model-in-the-loop* decision core; designs an *economic mechanism*;
defends the *bill against an adversary*; or flips context from *push to pull*. Round-2 (List2) targets
exactly these gaps.

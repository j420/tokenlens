---
name: adversarial-discovery
description: Run the structured, multi-round ADVERSARIAL feature-discovery pipeline for new token/cost-saving features in this repo (TokenLens/Prune). Use when the user asks to "find new features", "discover token savers", "run an adversarial round", "List N", or wants novel features distinct from what already ships. Spawns parallel research agents, gates candidates, dedupes/scores by cross-generator recurrence, maps survivors to real packages, and commits a COMBINED catalog. Do NOT use for building a single named feature (just build it).
---

# Adversarial Feature-Discovery Pipeline

Operationalizes how feature discovery is actually run in this repo: a baseline, then an
adversarial second round that must surface features the baseline *structurally cannot
contain*. Grounded in the existing assets — do not reinvent them:

- **Meta-prompt library:** `docs/RESEARCH-META-PROMPTS.md` (generators M1–M8, evaluator M9,
  X1–X7 adversarial series, E-series external-evidence episodes, the {{COST_EQUATION}} /
  {{PRIOR_ART}} / {{CONSTRAINTS}} / {{OUTPUT_SCHEMA}} / {{SELF_VERIFY}} blocks).
- **Frozen baselines:** `docs/RESEARCH-LIST1.md`, `docs/RESEARCH-FEATURE-PROPOSALS.md` (List1),
  `-L2.md` (List2), `-L3.md` (List3).
- **Prior art + discipline:** `CLAUDE.md` (TCRP map, the non-negotiables, the f-vs-F ID note).

## Non-negotiables (inherit from CLAUDE.md → Working Agreements)
- Deterministic decision core for any *buildable* proposal — **no model call, no regex** in
  the decision; **never fabricate** a token/cost number (unknown model ⇒ `null`); fail-safe;
  equivalence/quality-gated transforms; PII-safe.
- **Execute, don't plan.** Actually run each generator (as a real subagent) and show its
  output — never summarize a prompt you didn't run.
- **Combined output = everything.** The final catalog includes **every prior list in full**
  PLUS the new survivors, not just the latest slice.

## Procedure

1. **Establish / load the baseline.** If a frozen baseline list exists, load it as the
   "do-not-propose" set (N0 gate). Otherwise run the M-series generators first and freeze
   the result as the baseline before the adversarial round.

2. **Round 1 — parallel generation.** Spawn **3–4 Agent subagents in parallel**, each fed the
   shared blocks + prior art, each working a *different* angle (e.g. cost-equation
   decomposition M1, whitespace matrix M2, cross-domain transfer M3, provider-mechanic M7).
   Each emits proposals in `{{OUTPUT_SCHEMA}}`.

3. **Round 2 — adversarial pass.** Spawn the X-series agents, each fed the **baseline as the
   forbidden set**. Every survivor must name its nearest baseline/prior-art id + the precise
   delta (N0 gate) — reject reskins so `ListN ∩ baseline = ∅`.

4. **Gate every candidate** through `{{SELF_VERIFY}}` → **M9 red-team** (fabrication /
   phantom-saving / non-determinism / equivalence-hole / fail-unsafe / unfalsifiable) →
   altitude (incremental | capability | paradigm). Keep SURVIVES/REVISE; log REJECTs with
   their killing objection so the cut is auditable.

5. **Dedup + score by recurrence.** Merge candidates across agents; the credibility signal is
   **cross-generator recurrence** (how many independent agents converged), NOT a fabricated
   confidence. Rank by `novelty × altitude × credibility ÷ effort`, risk as a veto.

6. **Map survivors to the codebase.** For each top survivor, Grep `packages/` to confirm it is
   genuinely new (name the nearest existing package + delta) and state where it would live.

7. **Write + commit artifacts.** Save the new list to `docs/RESEARCH-FEATURE-PROPOSALS-L<N>.md`
   with the canonical schema, the M9 reject log, and recurrence notes. Then produce a
   **COMBINED catalog** spanning every list in full. `git add` + commit each.

8. **Report honestly.** State which prompts you actually ran, show representative outputs, and
   flag the single-model self-consistency caveat (true cross-model ensemble needs other
   vendors' models, which this environment can't invoke — record it, don't fake it).

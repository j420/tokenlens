# Dogfood Benchmark — TokenLens measured on itself

> **What this is:** TokenLens's own compression pipeline run over TokenLens's own
> source code, accounted for by WasteBench (counterfactual, overhead-subtracted)
> and sealed with an Ed25519-signed attestation. Every token count is measured
> locally by the repo's tokenizer on real file contents — nothing is estimated.
>
> **What this is NOT:** a production session-level savings claim. This measures
> what Smart Copy / `squeeze_files` save *when these files are sent to a model*
> (artifact-level savings). Session-level net savings (advisors, read-gate,
> cache habits) require recorded session telemetry and are attested separately
> once production telemetry exists.

## Result (measured 2026-06-10, reproducible)

Corpus: **46 TypeScript source files** (tests excluded) from 5 workspaces —
`apps/extension/src`, `packages/intelligence/src`, `packages/shared/src`,
`packages/context-health/src`, `packages/cache-habits/src`.
Corpus baseline: **147,608 tokens**, measured by `@prune/tokenizer` (local, offline).

| Squeeze tier | Files | Baseline tokens | Compressed tokens | Saved | Safety-skipped |
|---|---|---|---|---|---|
| lossless | 46 | 147,608 | 96,713 | **34.5%** | 0 |
| structural | 46 | 147,608 | 22,862 | **84.5%** | 0 |
| telegraphic | 46 | 147,608 | 21,803 | **85.2%** | 0 |

WasteBench rollup over all 138 records: gross saved 301,446 tokens, observer
overhead 0 (local AST compression spends zero model tokens), net saved 301,446.
Reflexive overhead SLO (≤10%): **PASS**. Attestation: ed25519, **signature
verified**.

The signed attestation manifest is committed at
[`docs/benchmark-attestation.json`](benchmark-attestation.json); anyone can
re-verify it with `verifyAttestation()` from `@prune/wastebench` without
re-running the benchmark, and tampering with either the manifest or its
canonical bytes is detected.

## Reproduce it

```bash
npm install && npm run build
node scripts/benchmark-dogfood.mjs            # re-measures, re-signs, prints the table
```

The script ([`scripts/benchmark-dogfood.mjs`](../scripts/benchmark-dogfood.mjs)) is ~130
lines: it reads each corpus file, runs `squeezeFile()` from `@prune/squeezer` at each
tier, keeps only outputs that pass the squeezer's safety verification, feeds the
measured `(baselineTokens, optimizedTokens, overheadTokens)` triples to
`buildManifest()` from `@prune/wastebench`, signs with a fresh Ed25519 keypair, and
verifies before writing. A non-verifying attestation exits non-zero.

Note: re-running re-measures live file contents, so numbers shift as the codebase
evolves — that's the point. The committed attestation pins the exact figures above
to its signature.

## Methodology and honesty notes

- **Counterfactual accounting:** savings are `baseline − optimized` per file per
  tier, where baseline is the cost of sending the file as-is. `rollupSavings`
  counts only `max(0, baseline − optimized)` — a tier that inflates a file can
  never manufacture savings elsewhere.
- **Overhead is subtracted by construction.** `netSaved = grossSaved − overhead`
  and may be negative (reported, not hidden). For local AST compression the
  observer overhead is genuinely zero model tokens; session-level features with
  real injected-context overhead must (and do) report it in their own records.
- **Safety gate:** the squeezer verifies its output; any file failing
  verification is skipped *and counted* in the skipped column, not silently
  dropped.
- **No fabricated numbers:** token counts come from the local tokenizer; an
  unpriced model yields `null` cost everywhere in this codebase — this report
  therefore states savings in tokens, not dollars.

## What a production attestation adds

Once the extension + hooks run in real sessions, the same pipeline attests
session-level features (read-gate denials, cache-habit saves, loop-breaker
interventions) from recorded telemetry (`~/.prune/events.sqlite`), with each
feature's injected-advisory overhead on the books. The reflexive SLO then
answers the question every buyer should ask: *does the meter cost more than it
saves?* — and signs the answer.

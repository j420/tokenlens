# @prune/e2e-harness (internal, dev-only)

A private end-to-end scenario harness. It drives **one synthetic-but-realistic
session** (“fix the login bug”) through **every product face** with real code on
every hop, asserts an edge-case matrix, and renders a narrated demo of the real
outputs.

> **Not shipped.** `"private": true` (never published), never bundled into the
> extension VSIX (`vsce` only packages `apps/extension/`), and the dependency
> arrow is one-way: this package imports product packages; **nothing in the
> product imports it.** Deleting it changes no shipped behavior.

## What it exercises (every hop is real)

| Flow | What runs | How |
|------|-----------|-----|
| **Extension** | Smart Copy, Pre-flight, session-memory dedup, compaction, HUD (priced vs unpriced), relevance, intent, squeeze | imports the real `apps/extension/src/*` pure modules |
| **MCP** | ~14 tool handlers (cache-habits, qpd, tool-audit, replay-cost, result-prune, diff-vs-rewrite, effort-router, …) | calls the real handlers via `@prune/mcp-server/tools` |
| **Hooks** | sentinel (secret + injection) blocks, idle cache advisory, flag gating (shadow vs general), fail-safe matrix | spawns the real `apps/extension/hooks/*.mjs` as child processes (JSON on stdin, capture exit code/stdout) |
| **Dashboard** | closed loop: the MCP tools’ real `quality_proof`s → local sqlite → **real forwarder** → **real ingest normalization** → **real rollup/decoders** | drives `@prune/persistence` + the dashboard `event-store`/`feature-telemetry` libs; a test also drives the real `POST`/`GET` route handlers |
| **Edge cases** | strict pricing (null USD), boundary errors (no throws), fail-safe reads, forwarder exactly-once/gapless/stop-on-failure, defensive rollup decoding | pure handler + forwarder + aggregator calls |

## Run it

```bash
# from the repo root (builds deps first via turbo):
npm run build
npm test --workspace @prune/e2e-harness     # the assertions
npm run demo --workspace @prune/e2e-harness  # the narrated "show outputs" report
```

## Design notes / honest scoping

- **Single source of truth.** Scenarios are pure functions returning a
  `ScenarioResult`; the `*.test.ts` files assert on it and `demo.ts` renders it,
  so assertions and the demo can never drift.
- **Hermetic.** Hook child processes and transcript-reading tools get `HOME` and
  all `PRUNE_*` state paths redirected into throwaway temp dirs — a run never
  touches the real `~/.prune`.
- **No fabrication.** Dashboard cards are populated only from the proofs the MCP
  tools actually emit (f2/f4/f9/f10/f11); the remaining features honestly report
  zero rather than being filled with invented data.
- **`vscode` import.** `token-saver.ts` carries an *unused* `vscode` import
  (referenced 0 times → elided by TS). A no-op alias/resolve-hook covers the
  bundler path. The module never calls `vscode` at runtime.
- **tsc build vs run.** `build` (tsc) compiles only the `@prune`-only subset; the
  files that import foreign source (extension/dashboard) run under vitest/tsx
  (on-the-fly transpile) and are proven by the test suites — the same way the
  shipped `apps/extension/run-comprehensive-tests.ts` already loads that source.
- **Hooks demonstrated live** are the deterministic ones (sentinel ×2, idle
  advisory, flag gating, fail-safe). Stateful blockers (budget-gate, slo-breaker,
  subagent-warden, loop-breaker) are validated by their own package unit tests;
  here they are covered by the never-crash fail-safe matrix.
```

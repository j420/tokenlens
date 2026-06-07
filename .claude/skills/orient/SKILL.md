---
name: orient
description: Produce a VERIFIED orientation of the TokenLens/Prune monorepo that grounds downstream agents in the real architecture (so they never hallucinate it). Use at the start of a session, when onboarding to the repo, before a large multi-agent task, or when the user asks to "orient", "map the codebase", "understand the architecture", or "what's here". Verifies every claim against actual files (never trusts docs blindly) and flags doc-vs-code drift.
---

# Self-Verifying Repo Orientation

The point is a GROUNDED map, not a recitation of `CLAUDE.md`. CLAUDE.md is a strong starting
index but it can drift — **verify every load-bearing claim against the actual files** and
report any drift. The output should let any downstream agent act without re-discovering the
architecture or hallucinating it.

## Non-negotiables (inherit from CLAUDE.md → Working Agreements)
- **Verify, don't trust.** Every architectural claim is backed by a real `file:line` you
  actually Read/Grep'd. If a doc claim doesn't match the code, report the drift explicitly.
- **Concrete, not abstract.** Name real packages, exports, and entry points — no vague
  summaries.

## Procedure

1. **Frame from the index, then verify.** Read `CLAUDE.md` for the claimed structure
   (~64 `packages/*` + 3 `apps/*`, the TCRP map, the f-vs-F ID namespaces, the non-negotiables).
   Treat it as a hypothesis to confirm.

2. **Confirm the workspace shape.** `ls packages | wc -l`, `ls apps`, read the root
   `package.json` workspaces + `turbo.json`. Reconcile the real count against the doc's count;
   note any mismatch.

3. **Map the layers (verify each against a real file).**
   - Core/foundation: `shared` (strict pricing — confirm `getModelPricingStrictByName` returns
     null on unknown), `tokenizer`, `intelligence`, `db`, `persistence`, `telemetry`,
     `equivalence`, `quality`.
   - TCRP features f1–f19 + the value/economics/paradigm levers F1–F21 (carry the case — they
     are SEPARATE namespaces; see the CLAUDE.md note).
   - Surfaces: `apps/extension/hooks/*.mjs` (lifecycle hooks + installer), `apps/mcp-server`
     (the ~59 MCP tools in `src/index.ts` / `tcrp-tools.ts` / `value-tools.ts`),
     `apps/dashboard` (landing + `/dashboard/*`, the TCRP catalog in `src/lib/tcrp-catalog.ts`).

4. **Confirm the discipline is real, not just claimed.** Spot-check 2–3 packages: are decisions
   deterministic (no `new RegExp`/regex-classify, no model/`fetch` in the decision core)? Do
   costs go `null` on an unknown model? Are inputs total/fail-safe? Cite the lines.

5. **Build + test reality check.** Run `npm run build && npm run test` (or the cheaper
   `npx turbo run test`) and record the real pass count and any failures — don't assume green.

6. **Report a grounded map.** A compact architecture summary with `file:line` anchors, the
   verified workspace/test counts, the list of MCP tools + hooks, and an explicit
   **doc-vs-code drift list** (including the tracked telemetry `estimated_cost_usd` null-cost
   limitation in CLAUDE.md). End with "safe assumptions for downstream agents."

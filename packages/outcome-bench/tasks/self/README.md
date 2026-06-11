# Track 1 — Self-mined tasks (pre-registered, verified)

12 ready tasks mined from this repository's git history by
`scripts/mine-tasks.mjs` and human-curated. Distribution: 6 debug, 3
generate, 2 refactor (cross-package), 1 navigate.

## Verification protocol (run before pre-registering any task)

For every code task, in a fresh worktree:

1. `git worktree add --detach <wt> <baseCommit>`
2. `git checkout <testRefCommit> -- <testPaths…>` (test files only)
3. run `setupCmds`, then `oracleCmd` → **must FAIL** (the task is real work);
4. `git checkout <referenceCommit> -- .`, re-run setup, then `oracleCmd` →
   **must PASS** (the reference solution is achievable).

A task failing either direction is dropped, never patched into passing.

## Verification results (2026-06-11, clean worktrees)

| Task | Oracle at base | Oracle at reference |
|---|---|---|
| ob-adapter-adversarial-probes | fail ✓ | pass ✓ |
| ob-adapter-idle-guard-delta-resend | fail ✓ | pass ✓ |
| ob-audit-cross-package-fixes | fail ✓ | pass ✓ |
| ob-audit-value-lever-honesty | fail ✓ | pass ✓ |
| ob-cache-habits-transport-rules | fail ✓ | pass ✓ |
| ob-cost-security-detector-review | fail ✓ | pass ✓ |
| ob-equivalence-semantic-safety | fail ✓ | pass ✓ |
| ob-speculative-cache-write-safety | fail ✓ (7/52 tests fail) | pass ✓ (52/52) |
| ob-speculative-latency-accounting | fail ✓ | pass ✓ |
| ob-tokenizer-cache-key-collision | fail ✓ | pass ✓ |
| ob-trajectory-f6-modulation | fail ✓ | pass ✓ |
| ob-locate-null-pricing | n/a (navigate) | oracle accepts the reference answer and rejects a wrong one (checked both ways) |

## Dropped during curation (the protocol working as intended)

- `ob-waterbed-usd-rounding` (ref `2924cf2b`): the reference commit's own
  regression test PASSES at the base commit — JavaScript renders
  `0.0000001234` as `1.234e-7`, dodging both the substring assertion and the
  decimals regex — so the task would be trivially green. Replaced by
  `ob-tokenizer-cache-key-collision`.

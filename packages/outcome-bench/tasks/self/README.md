# Track 1 — Self-mined tasks (pre-registered, verified, SWE-bench parity)

12 ready tasks mined from this repository's git history by
`scripts/mine-tasks.mjs` and human-curated. Distribution: 6 debug, 3
generate, 2 refactor (cross-package), 1 navigate. Difficulty (SWE-bench
Verified human-time buckets): 1 × `<15min`, 2 × `15min-1hr`, 9 × `1-4hr`.

## SWE-bench parity

Each task mirrors a SWE-bench instance:

- the agent receives an **issue-style prompt** (observable symptoms /
  required behavior — never "make the failing tests pass") and a worktree at
  the pre-fix commit, with **no trace of the reference tests**;
- `hiddenTestPaths` is the **FAIL_TO_PASS** patch, applied only at grading
  time and overwriting any agent edits to those paths;
- the oracle runs the involved packages' **full suites**, so pre-existing
  tests are the **PASS_TO_PASS** regression set.

## Verification protocol (run before pre-registering any task)

Three states per code task, each in a clean worktree after `setupCmds`:

| State | Workspace | Oracle must | Proves |
|---|---|---|---|
| S1 | `baseCommit`, untouched | PASS | healthy PASS_TO_PASS baseline (the agent starts from green) |
| S2 | + hidden tests pinned from `testRefCommit` | FAIL | FAIL_TO_PASS demands real work |
| S3 | `referenceCommit` + hidden tests pinned | PASS | the reference solution is achievable |

A task failing any state is dropped, never patched into passing.

## Verification results (2026-06-11, clean worktrees)

| Task | S1 | S2 | S3 |
|---|---|---|---|
| ob-adapter-adversarial-probes | pass ✓ | fail ✓ | pass ✓ |
| ob-adapter-idle-guard-delta-resend | pass ✓ | fail ✓ | pass ✓ |
| ob-audit-cross-package-fixes | pass ✓ | fail ✓ | pass ✓ |
| ob-audit-value-lever-honesty | pass ✓ | fail ✓ | pass ✓ |
| ob-cache-habits-transport-rules | pass ✓ | fail ✓ | pass ✓ |
| ob-cost-security-detector-review | pass ✓ | fail ✓ | pass ✓ |
| ob-equivalence-semantic-safety | pass ✓ | fail ✓ | pass ✓ |
| ob-speculative-cache-write-safety | pass ✓ | fail ✓ | pass ✓ |
| ob-speculative-latency-accounting | pass ✓ | fail ✓ | pass ✓ |
| ob-tokenizer-cache-key-collision | pass ✓ | fail ✓ | pass ✓ |
| ob-trajectory-f6-modulation | pass ✓ | fail ✓ | pass ✓ |
| ob-locate-null-pricing | n/a (navigate) — grep oracle accepts the reference answer and rejects a wrong one (checked both ways) | | |

## Dropped during curation (the protocol working as intended)

- `ob-waterbed-usd-rounding` (ref `2924cf2b`): the reference commit's own
  regression test PASSES at the base commit — JavaScript renders
  `0.0000001234` as `1.234e-7`, dodging both the substring assertion and the
  decimals regex — so the task would be trivially green. Replaced by
  `ob-tokenizer-cache-key-collision`.

## Disclosed bias

All Track-1 tasks come from this repository's own history, most of it
AI-authored. The Track-2 external corpus (`tasks/external/`) exists to
control for exactly this.

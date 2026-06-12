# Track 2 — External task curation (drafts)

These 8 manifests are **drafts**: the harness refuses to run them
(`status: "draft"`, null commits) until a human pins real commits. No SHA in
this directory may ever be written without having been verified against the
actual repository — fabricating a pin would corrupt the benchmark's
provenance, so drafts carry `null` instead.

## Curation procedure (per task)

1. Clone the target repo and find a **bug-fix or small-feature commit `C`
   that includes tests**, authored **after the pinned model's training
   cutoff** (record the date; this is the contamination control — set
   `cutoffSafe: true` only when verified).
2. Verify the three SWE-bench states locally, each in a clean worktree:
   - S1: worktree at `C~1`, untouched → the oracle (full relevant suite)
     PASSES — a healthy PASS_TO_PASS baseline;
   - S2: apply `C`'s test files on top → the oracle FAILS — the
     FAIL_TO_PASS patch demands real work;
   - S3: at `C` with the test files pinned → the oracle PASSES — the
     reference solution is achievable.
3. Fill in: `baseCommit` = full SHA of `C~1`, `testRefCommit` =
   `referenceCommit` = full SHA of `C`, `hiddenTestPaths` = the test files
   from `C`'s diff (applied at grading time only — the agent never sees
   them), `oracleCmd`/`oracleCwd` = the repo's own test runner invocation
   for the affected package's full suite, `setupCmds` = the repo's
   install/build steps. Annotate `difficulty` (SWE-bench Verified buckets).
4. Write the `prompt` like the GitHub issue behind `C`: observable symptoms
   or required behavior in natural language. Never name the oracle command,
   the reference diff, the files to change — or the tests, which the agent
   must not know exist.
5. Flip `status` to `"ready"`. The git commit that flips it is the
   pre-registration timestamp.

Target repos below were chosen for: well-known TypeScript codebases, active
post-cutoff commit traffic, self-contained test suites that run offline after
install, and varied domain (schema validation, web framework, RPC, logging,
ORM, CLI, test runner, HTTP framework).

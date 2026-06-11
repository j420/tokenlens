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
2. Verify revert-and-refix locally:
   - worktree at `C~1`, apply `C`'s test files only → the new tests FAIL;
   - at `C` the full suite PASSES (the reference solution is achievable).
3. Fill in: `baseCommit` = full SHA of `C~1`, `testRefCommit` =
   `referenceCommit` = full SHA of `C`, `testPaths` = the test files from
   `C`'s diff, `oracleCmd`/`oracleCwd` = the repo's own test runner invocation
   for exactly those files, `setupCmds` = the repo's install/build steps.
4. Write the `prompt` from the commit message / linked issue: describe the
   failing behavior in natural language. Never name the oracle command, the
   reference diff, or the files to change.
5. Flip `status` to `"ready"`. The git commit that flips it is the
   pre-registration timestamp.

Target repos below were chosen for: well-known TypeScript codebases, active
post-cutoff commit traffic, self-contained test suites that run offline after
install, and varied domain (schema validation, web framework, RPC, logging,
ORM, CLI, test runner, HTTP framework).

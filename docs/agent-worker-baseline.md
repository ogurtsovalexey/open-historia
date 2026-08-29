# Mandatory Worker Baseline

These instructions are automatically prepended to every OpenCode worker task
and correction. They are acceptance gates, not suggestions.

## Authority and scope

1. Read the repository `AGENTS.md`, accepted principles/specifications and the
   complete GitHub Issue before editing.
2. Edit only the Issue-owned paths. If the accepted behavior cannot be reached
   inside them, return `DECISION NEEDED` with file/line evidence.
3. Work from the recorded integration SHA and synchronize with `private/main`
   exactly as the task prompt directs. Never use public `origin` for handoff.
4. Do not add copyright headers, speculative abstractions, dependency changes,
   unrelated cleanup or acceptance-placeholder `TODO`s.

## Implementation quality

1. Trace the real production control flow before choosing an integration seam.
   A wrapper, mock or copied expression does not satisfy a requirement when the
   behavior being measured occurs below or bypasses it.
2. Preserve the repository language boundary: TypeScript syntax belongs in
   `.ts`/`.tsx`; `.js`/`.jsx` must pass the appropriate syntax check.
3. Treat concurrency, retry layers, cancellation and lifecycle cleanup as
   distinct when the contract does. Never collapse them for convenience.
4. Timers, listeners, readers, locks and abort propagation must be released on
   success, failure and every early return, normally through `finally`.
   Cancellation reasons must remain distinguishable from timeout and failure.
5. Enforce byte/record limits before and during consumption. Buffering an
   unbounded payload and checking afterward is not a bound.
6. Do not mutate process-global state in tests without restoring each value in
   a guaranteed cleanup hook.

## Test quality

1. Follow the existing repository test runner, location, naming and import
   conventions. Confirm the standard command actually discovers each new test.
2. Tests import and exercise production functions or an actual boundary. Tests
   that repeat a production ternary, check only that exports exist, print a
   checklist, or assert constants without behavior are not acceptance tests.
3. Every regression test must fail against the pre-change behavior for the
   intended reason. Cover the failure/interleaving path, not only the happy path.
4. Mocks must drive observable inputs and outputs; they may not reimplement the
   result being asserted.
5. If dependencies or an environment prevent validation, report that exact
   limitation. Never translate “not run” into “passes.”

## Mandatory pre-handoff checks

Before claiming completion:

1. Re-read the Issue acceptance list and map every item to code plus a real
   validation result.
2. Run syntax/type checks appropriate to every changed source file.
3. Run focused tests, then the relevant repository suite.
4. Run `git diff --check <base>..HEAD` after the final commit.
5. Inspect `git status`, the changed-file list and commit diff for scope leaks,
   placeholders, trailing whitespace and accidental generated files.
6. Push only with the explicit private destination specified by the task, for
   example `git push private HEAD:refs/heads/<task-branch>`.

The final `HANDOFF` must list exact commits, changed files, commands actually
run with results, unverified checks, residual risks and decisions. Do not write
“all requirements satisfied,” “all tests pass” or `status:review` when any
required check failed, was skipped, was not discovered or was replaced by a
proxy assertion.

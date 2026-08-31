# Local Agent Orchestrator

This Codex session is the integration owner and worker dispatcher. A small
`launchd` watchdog wakes the same session only when the GitHub board has work;
it does not make product or architecture decisions itself.

The owner creates tasks, Issues, Epics, roadmap items and backlog scope in a
separate general Codex session. A watchdog tick never authors or expands that
work. It operates only on Issues that already exist: review and integrate
handoffs, reconcile workers, improve bounded worker prompts, update lifecycle
labels/comments, and assign existing `status:ready` work.

Every delivery carries a unique `ORCHESTRATOR_TICK_ID`. Queuing is not treated
as success: the watchdog acknowledges the board signature only after the same
Codex turn reaches `task_complete` with one of the required final markers. A
missing marker, an interrupted turn or a timed-out turn remains unacknowledged
and is retried. While a turn is still running, later watchdog checks wait rather
than enqueue duplicate work.

## One orchestration cycle

For every `ORCHESTRATOR_TICK`:

1. Change to the canonical integration worktree and fetch `private/main`.
2. Read the open issue board and inspect running OpenCode processes/worktrees.
3. Process all `status:review` work before starting new work:
   - verify the issue contract, owned paths, commits and validation;
   - review against `AGENTS.md`, principles and accepted specifications;
   - accept and integrate, or reject it to `status:blocked` with concrete
     evidence; never resume a rejected implementation for correction;
   - close accepted issues as `status:done` and unblock direct dependants.
4. Process all `status:plan-review` work. Review the worker's read-only plan
   against the Issue, repository and production seams. Approve it or amend it
   directly as GPT, post `APPROVED IMPLEMENTATION PLAN`, move the Issue to
   `status:claimed` plus `stage:implementation`, and resume the same worker
   session once. Approve only one cohesive production seam that can realistically
   fit the implementation budget. Otherwise post `NEEDS DECOMPOSITION`, block
   the Issue and leave child-Issue creation to the owner planning session. Do
   not rerun the planning phase or raise the budget to fit an oversized task.
5. Reconcile `status:claimed` issues with their process, branch and worktree.
   A dead process with no appropriate lifecycle handoff becomes
   `status:blocked` immediately. A worker exit code describes only the local
   process: even `exit(0)` remains unfinished until the Issue has a verified
   handoff and lifecycle transition. Exited claimed workers wake reconciliation
   immediately instead of waiting for the periodic claimed audit.
6. Fill free capacity only from existing `status:ready` Issues, up to the
   configured active-stream limit (currently seven total: the GPT integration
   stream plus at most six DeepSeek workers).
   For each agent class independently, use the code-generated priority queue in
   this exact order: `CRITICAL` → `HIGH` → `MEDIUM` → `LOW`. Apply dependency,
   owned-path and concurrency checks, then claim only from the highest band
   that still has an eligible candidate. Never claim overlapping owned paths.
7. The orchestrator creates the branch/worktree, moves the Issue to
   `status:claimed` plus `stage:planning`, and launches the one read-only plan
   phase. Workers run headlessly through `opencode run --format
   json` inside a detached `screen` session managed by
   `scripts/agent-worker.sh`; no terminal window is required. A plain background
   child of a Codex tool call is not durable and must not be used. The helper
   automatically prepends `docs/agent-worker-baseline.md`; task prompts add
   scope and acceptance detail but never replace those quality gates.
8. Every phase uses DeepSeek V4 Pro and its configured hard token budget
   (§ Worker model and budgets). Record model, phase and budget in the comment.
9. DeepSeek remains a bounded worker. GPT owns review, architecture, security,
   persistence, domain contracts, historical assumptions and accepted scope.
10. Do not create more agent identities. Reuse the fixed concurrency budget;
   completing one issue frees its slot for the next.
11. Do not push to public `origin`. Workers push task branches to `private`; only
   the integration owner updates `private/main`.
12. Never create a task, Issue, Epic, roadmap item or new backlog scope during a
    tick. Missing work waits for the owner’s general planning session.
13. After a completed Issue is integrated and closed, archive its stopped worker
    record so the live worker list contains only actionable runs. Archiving must
    preserve prompts, logs and handoff metadata.

Before processing any review handoff, the watchdog checks the canonical Git
worktree with plumbing-level tests. Staged, unstaged, untracked or unmerged
paths and active merge, cherry-pick, rebase, revert or sequencer state refuse
integration without discarding owner changes. The visible result contains the
exact state and cannot report `ORCHESTRATOR_OK`.

GPT validates and integrates a worker range through the fail-closed helpers:

```bash
bash scripts/agent-orchestrator.sh preflight <integration-worktree>
bash scripts/agent-orchestrator.sh validate-range <repo> <recorded-base> <base..tip> <integration-ref>
bash scripts/agent-orchestrator.sh integrate-range <repo> <recorded-base> <base..tip> [integration-ref]
```

Validation proves the range is rooted at the recorded base and does not depend
on an unintegrated correction ancestor. An explicitly advertised rebased range
may instead become one self-contained binary patch, but only when that patch
applies cleanly in a disposable worktree. `integrate-range` starts from a
proven-clean canonical state. If its own cherry-pick or patch commit nevertheless
fails, it aborts only that operation and verifies that the original
head/index/worktree state was restored.

## Priority dispatch

Every open task has exactly one canonical priority label:

| Label | Meaning |
|---|---|
| `priority:critical` | Current release/playtest blocker, correctness/data-loss/cost/security risk, or a direct prerequisite unlocking several current critical tasks. |
| `priority:high` | Committed current-milestone work with clear player or foundation value. |
| `priority:medium` | Useful current-roadmap work outside the active critical path. |
| `priority:low` | Future idea, experiment, polish or optional optimization that may wait indefinitely. |

Priority is urgency and pickup order, not complexity or functional role. The
watchdog computes separate, deterministically ordered queues for `agent:gpt`
and `agent:deepseek`, embeds both in every tick, and exposes the highest current
band. Within a band it orders by issue number ascending. Dependency-unblocking
value is not yet machine-readable; the owner may express it by changing the
canonical priority rather than silently reordering a band.

Lifecycle always outranks priority: process `status:review`, process
`status:plan-review`, reconcile `status:claimed`, then fill slots from
`status:ready`. `status:blocked` is never
eligible. A blocked or claimed CRITICAL does not prevent pickup of a ready HIGH
when no eligible ready CRITICAL remains. A GPT CRITICAL does not block a
DeepSeek HIGH, or vice versa. LOW can be claimed only when that agent class has
no eligible ready CRITICAL, HIGH or MEDIUM issue.

Zero or multiple canonical priority labels make an Issue malformed. It is
reported by `agents:status` and cannot be claimed until corrected. Legacy
`priority:p0` and `priority:p1` labels are invalid and never participate in
dispatch.

## Worker model and budgets

Every OpenCode worker phase uses only
`openrouter/deepseek/deepseek-v4-pro-0813`. DeepSeek V3.2, tier routing,
promotion and fallback models are disabled. GPT planning decisions, plan review,
implementation review and integration use the Codex subscription.

Default hard budgets count cumulative request tokens reported in OpenCode
`step_finish` events:

| Phase | Budget | Result at limit |
|---|---:|---|
| Planning | 400,000 | Stop process, preserve log, block Issue |
| Implementation | 1,500,000 | Stop process, preserve branch/log, block Issue |

The monitor checks between emitted events, so one already in-flight request may
finish and cause a bounded overshoot. Each phase can be launched once. A plan
review is not another worker attempt: GPT approves or edits the plan itself.
Likewise, a rejected implementation is investigated from its preserved branch
and log rather than resumed.

## Owner interruptions

Routine ambiguity is resolved from accepted repository documents. Notify the
owner only when all are true:

- the decision changes product scope, compatibility or irreversible data;
- principles and accepted specifications do not determine the answer;
- GPT cannot choose a safe 80/20 default;
- 2–3 concrete options with consequences are ready.

End such a cycle with `OWNER_ACTION_REQUIRED: <one-line decision>`. Otherwise
end with `ORCHESTRATOR_OK` when work was performed or `ORCHESTRATOR_IDLE` when
the board is stable.

## Watchdog commands

```bash
npm run agents:disable
npm run agents:enable
npm run agents:install
npm run agents:start
npm run agents:start <CODEX-session-UUID>
npm run agents:status
npm run agents:check
npm run agents:workers
npm run agents:stop
npm run agents:run-now
npm run agents:test
```

Orchestration is globally disabled when
`~/.config/open-historia-orchestrator/disabled` exists. `agents:disable`
creates that fail-closed marker before unloading the watchdog, stopping active
`historia-issue-*` worker sessions and archiving any pending delivery record.
While disabled, every watchdog launch path and direct `agent-worker.sh start`
fails before a model process can start. Status, board inspection, worker usage,
archive, stop and Git handoff diagnostics remain available.

`agents:enable` only removes the launch prohibition. It never installs, starts
or restarts the watchdog; a later launch always requires a separate explicit
command.

`npm run agents:workers` shows only unarchived worker runs. After GPT has
integrated and closed an Issue, `bash scripts/agent-worker.sh archive <issue>`
moves its stopped prompt, log and metadata into the worker archive. It refuses
to archive a running worker.

`npm run agents:start <UUID>` binds the watchdog to an existing local Codex
session, clears delivery state from the previous binding and immediately queues
the first cycle. The session must already exist on this machine.

`npm run agents:start` without a UUID intentionally creates a fresh integration
owner: it opens a new Terminal window in the canonical repository, runs
`codex --yolo` with the first orchestration prompt, detects the newly created
session UUID, persists it and starts the watchdog. Existing detached workers are
not stopped. If macOS denies Terminal automation or the UUID cannot be detected
within 30 seconds, the watchdog remains stopped and the command explains how to
bind the visible session manually.

`agents:run-now` does not bypass an in-flight delivery. It forces a new cycle
only when there is no pending tick, preventing duplicate integration work.

Configuration is stored outside the repository in
`~/.config/open-historia-orchestrator/config`. Logs and the last result are in
`~/Library/Application Support/OpenHistoriaAgentOrchestrator/`. The installer
also places the launchd runtime copy there because macOS does not allow a
background LaunchAgent to execute scripts directly from `~/Documents`.

`MAX_ACTIVE_STREAMS` controls the combined GPT-plus-worker budget and defaults
to `7`. Each worker still requires its own branch, worktree and OpenCode session;
the prepared pool is `slot-1` through `slot-6`. `CLAIMED_CHECK_SECONDS` defaults
to `420` as a fallback audit for live or ambiguous claims. A worker with a
recorded exit result and unchanged `status:claimed` wakes the next watchdog
interval immediately; it does not wait seven minutes.

`PLANNING_TOKEN_BUDGET` and `IMPLEMENTATION_TOKEN_BUDGET` configure the two
phase limits. `npm run agents:workers` shows the active phase and usage/budget;
`bash scripts/agent-worker.sh usage <issue>` prints its exact accounting and
whether the hard limit fired.

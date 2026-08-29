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
   - accept and integrate, or post concrete changes requested;
   - automatically resume the same worker session for bounded corrections when
     its session id is known;
   - close accepted issues as `status:done` and unblock direct dependants.
4. Reconcile `status:claimed` issues with their process, branch and worktree.
   A dead process with no handoff is retried once; repeated failure becomes
   `status:blocked` with evidence.
5. Fill free capacity only from existing `status:ready` Issues, up to four
   active task streams total.
   Prefer P0 dependencies of the current epic, then P1. Never claim overlapping
   owned paths.
6. The orchestrator creates the branch/worktree and updates the Issue before
   launching a worker. Workers run headlessly through `opencode run --format
   json` inside a detached `screen` session managed by
   `scripts/agent-worker.sh`; no terminal window is required. A plain background
   child of a Codex tool call is not durable and must not be used. The helper
   automatically prepends `docs/agent-worker-baseline.md`; task prompts add
   scope and acceptance detail but never replace those quality gates.
7. Select the cheapest model tier that safely fits the task (§ Model routing).
   Record the chosen model in the claim comment.
8. DeepSeek remains a bounded worker. GPT owns review, architecture, security,
   persistence, domain contracts, historical assumptions and accepted scope.
9. Do not create more agent identities. Reuse the fixed concurrency budget;
   completing one issue frees its slot for the next.
10. Do not push to public `origin`. Workers push task branches to `private`; only
   the integration owner updates `private/main`.
11. Never create a task, Issue, Epic, roadmap item or new backlog scope during a
    tick. Missing work waits for the owner’s general planning session.
12. After a completed Issue is integrated and closed, archive its stopped worker
    record so the live worker list contains only actionable runs. Archiving must
    preserve prompts, logs and handoff metadata.

## Model routing

Price snapshot: OpenRouter Models API, 2026-08-29. Prices are USD per one
million input/output tokens and are used only to choose relative tiers; the
orchestrator does not assume they remain fixed.

| Tier | Model | Snapshot price | Use |
|---|---|---:|---|
| Research | `deepseek/deepseek-v3.2` | `$0.269 / $0.40` | Internet/source search, inventories, documentation comparisons, bounded QA review with no code changes. |
| Standard code | `deepseek/deepseek-v3.2` | `$0.269 / $0.40` | Accepted single-module implementation, focused tests, mechanical migrations and review corrections. |
| Complex | `deepseek/deepseek-v3.2` | `$0.269 / $0.40` | Cross-module state, provider adapters, security-sensitive code, difficult debugging or broad refactoring. |
| Escalation only | `deepseek/deepseek-v4-pro-0813` | `$0.66 / $1.98` | Only after two concrete failed review/correction rounds on a lower tier, or an explicit GPT finding that the task cannot be safely decomposed. |

Rules:

- All worker tiers use DeepSeek. Qwen models are not used for research, code,
  review corrections or any fallback.
- Search tools fetch sources; the worker synthesizes them. Do not pay the
  escalation model merely to browse or copy facts into a matrix.
- `type:audit`, research and documentation default to Research.
- Implementation defaults to Standard code. Use Complex only for the named
  cross-module or high-correctness cases. Standard and Complex currently route
  to the same DeepSeek V3.2 model; the tiers remain separate so routing can be
  adjusted later without changing task classification.
- A worker never promotes itself. GPT may route any initial worker to DeepSeek
  V3.2 and records the evidence before any promotion to DeepSeek V4 Pro.
- After every rejected handoff, GPT checks model fit separately from task fit.
  A clear capability mismatch (for example fabricated research evidence or an
  inability to follow repository/commit mechanics) may be rerouted immediately
  to another non-escalation tier; do not spend a correction repeating the same
  failure mode on the same model merely because that tier is cheaper.
- Repetition of a previously documented blocker, or a false-complete handoff
  without the required commit/private branch, counts as a failed correction
  round for promotion accounting.
- GPT planning, decisions, review and integration use the Codex subscription,
  not an OpenRouter worker model.
- One initial worker pass plus at most two bounded correction rounds. If the
  contract itself is unclear, stop and resolve it instead of buying more tokens.

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

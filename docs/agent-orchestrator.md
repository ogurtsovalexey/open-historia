# Local Agent Orchestrator

This Codex session is the integration owner and orchestration brain. A small
`launchd` watchdog wakes the same session only when the GitHub board has work;
it does not make product or architecture decisions itself.

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
5. Fill free capacity from `status:ready`, up to four active task streams total.
   Prefer P0 dependencies of the current epic, then P1. Never claim overlapping
   owned paths.
6. The orchestrator creates the branch/worktree and updates the Issue before
   launching a worker. Workers run headlessly through `opencode run --format
   json`; no terminal window is required.
7. DeepSeek remains a bounded worker. GPT owns review, architecture, security,
   persistence, domain contracts, historical assumptions and accepted scope.
8. Do not create more agent identities. Reuse the fixed concurrency budget;
   completing one issue frees its slot for the next.
9. Do not push to public `origin`. Workers push task branches to `private`; only
   the integration owner updates `private/main`.

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
npm run agents:status
npm run agents:check
npm run agents:stop
npm run agents:run-now
```

Configuration is stored outside the repository in
`~/.config/open-historia-orchestrator/config`. Logs and the last result are in
`~/Library/Application Support/OpenHistoriaAgentOrchestrator/`.

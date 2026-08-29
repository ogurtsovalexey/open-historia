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
7. Select the cheapest model tier that safely fits the task (§ Model routing).
   Record the chosen model in the claim comment.
8. DeepSeek remains a bounded worker. GPT owns review, architecture, security,
   persistence, domain contracts, historical assumptions and accepted scope.
9. Do not create more agent identities. Reuse the fixed concurrency budget;
   completing one issue frees its slot for the next.
10. Do not push to public `origin`. Workers push task branches to `private`; only
   the integration owner updates `private/main`.

## Model routing

Price snapshot: OpenRouter Models API, 2026-08-29. Prices are USD per one
million input/output tokens and are used only to choose relative tiers; the
orchestrator does not assume they remain fixed.

| Tier | Model | Snapshot price | Use |
|---|---|---:|---|
| Research | `qwen/qwen3-30b-a3b-instruct-2507` | `$0.048 / $0.193` | Internet/source search, inventories, documentation comparisons, bounded QA review with no code changes. |
| Standard code | `qwen/qwen3-coder-30b-a3b-instruct` | `$0.07 / $0.28` | Accepted single-module implementation, focused tests, mechanical migrations and review corrections. |
| Complex | `deepseek/deepseek-v3.2` | `$0.269 / $0.40` | Cross-module state, provider adapters, security-sensitive code, difficult debugging or broad refactoring. |
| Escalation only | `deepseek/deepseek-v4-pro-0813` | `$0.66 / $1.98` | Only after two concrete failed review/correction rounds on a lower tier, or an explicit GPT finding that the task cannot be safely decomposed. |

Rules:

- Search tools fetch sources; the model synthesizes them. Do not pay a Pro model
  merely to browse or copy facts into a matrix.
- `type:audit`, research and documentation default to Research.
- Implementation defaults to Standard code. Use Complex only for the named
  cross-module or high-correctness cases.
- A worker never promotes itself. GPT records the evidence and promotion in the
  Issue before relaunching.
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
npm run agents:status
npm run agents:check
npm run agents:stop
npm run agents:run-now
```

Configuration is stored outside the repository in
`~/.config/open-historia-orchestrator/config`. Logs and the last result are in
`~/Library/Application Support/OpenHistoriaAgentOrchestrator/`.

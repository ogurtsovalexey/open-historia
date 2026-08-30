# Parallel Agent Workflow

GitHub Issues in the private canonical repository are the coordination board.
Codex and OpenCode/DeepSeek must not edit the same working tree, branch or owned
file set.

## Authority

1. The project owner has final product authority.
2. Canonical principles and accepted specifications constrain every agent.
3. Codex/GPT is the integration owner: it reviews all worker output and decides
   architecture, domain contracts, persistence, security, historical assumptions
   and changes to accepted scope.
4. OpenCode/DeepSeek is a bounded worker: it may research, inventory, test or
   implement an explicitly accepted contract, but it must not silently settle a
   disputed or underspecified decision.

When a worker finds such a decision, it stops only the affected part, comments
`DECISION NEEDED` on the issue with evidence and 2-3 options, and applies
`status:blocked`. Unrelated accepted work may continue.

## Coordination Board

Every unit of work has one GitHub Issue with:

- objective and expected deliverable;
- acceptance criteria and required validation;
- owned paths and read-only paths;
- dependencies and starting integration SHA;
- assigned agent class, functional role and decision boundary.

Agent class and functional role are separate dimensions:

- `agent:gpt` / `agent:deepseek` says which model class executes the task;
- `role:po`, `role:analyst`, `role:developer`, `role:ai-engineer` or `role:qa`
  says which project responsibility and review standard applies.

An issue has one lead functional role. A second role may be added only when its
review is an explicit deliverable. The role definitions and development cycle in
`AGENTS.md` remain binding; the issue board operationalizes rather than replaces
them.

Required labels are `status:ready`, `status:claimed`, `status:blocked`,
`status:review`, `status:done`, `agent:gpt`, `agent:deepseek`,
`role:po`, `role:analyst`, `role:developer`, `role:ai-engineer`, `role:qa`,
`parallel:safe`, `decision:gpt-required`, and exactly one of
`priority:critical`, `priority:high`, `priority:medium`, `priority:low`.

Priority means pickup urgency, not complexity:

- `CRITICAL`: current release/playtest blocker, correctness/data-loss/cost/
  security risk, or direct prerequisite unlocking several current critical
  tasks;
- `HIGH`: committed current-milestone work with clear player or foundation
  value;
- `MEDIUM`: useful current-roadmap work outside the active critical path;
- `LOW`: future idea, experiment, polish or optional optimization safe to leave
  indefinitely.

The lifecycle order is always review/integration, claimed-worker
reconciliation, then new ready claims. For each agent class independently,
filter out blocked, claimed, dependency-blocked, path-conflicting and
capacity-ineligible work, then select only from the highest non-empty ready band
in `CRITICAL` → `HIGH` → `MEDIUM` → `LOW` order. A blocked or claimed higher
priority does not suppress lower ready work, and one agent class never suppresses
the other. LOW is claimable only when no eligible higher band remains for that
class. Within a band, issue number ascending is the deterministic tie-breaker;
dependency-unblocking value is not currently machine-readable.

An Issue with no canonical priority or more than one is malformed and must not
be claimed. Diagnose and correct it first. Legacy `priority:p0` and
`priority:p1` labels do not participate in scheduling.

The issue is the live status record. Specifications and accepted decisions still
belong in the repository; chat transcripts and issue comments are not canonical.

## Claim Protocol

Before reading broadly or editing:

1. Read the code-generated agent-class queue (or run `npm run agents:status`)
   and consider only its highest eligible priority band.
2. Open the chosen issue and verify that every dependency is complete.
3. Skip any issue already marked `status:claimed` or with overlapping owned paths.
4. Replace `status:ready` with `status:claimed` and comment the agent/session,
   branch, worktree, base SHA and start time.
5. Fetch `private/main`, create the issue branch and a dedicated worktree.

Claiming is intentionally visible before implementation. If two agents race, the
first claim shown in the issue timeline wins; the other agent releases its claim
and chooses another ready issue.

## Layout

```text
open-historia-next/            integration worktree
open-historia-next-codex/      Codex worktree and branch
open-historia-next-opencode/   OpenCode worktree and branch
```

Each task records its objective, acceptance criteria, owned files, read-only
files, dependency commit and required tests. Two active tasks cannot own the
same file.

Branch names use `agent/<agent>/<issue>-<slug>`. A typical worker starts with:

```bash
git fetch private main
git worktree add ../open-historia-next-opencode \
  -b agent/deepseek/<issue>-<slug> private/main
```

## Parallelism Rules

| Work combination | Parallel? | Rule |
|---|---|---|
| Research/inventory reports in separate files | Yes | Source files are read-only. |
| Tests for an already accepted contract vs unrelated research | Yes | Owned paths do not overlap. |
| Implementation vs review of the same change | No | Review starts after handoff. |
| Two changes to the same module or contract | No | Split ownership or sequence them. |
| Historical datasets for different countries | Yes | Shared schema must already be accepted. |
| Any work requiring a new architecture/domain decision | GPT gate | Worker raises `DECISION NEEDED`. |

## Handoff

1. Start from the recorded integration SHA.
2. Make small, focused commits without unrelated cleanup.
3. Run task-specific validation.
4. Push the task branch with an explicit destination, for example
   `git push private HEAD:refs/heads/agent/deepseek/<issue>-<slug>`; a worker
   branch based on `private/main` may otherwise update `main` through its
   configured upstream. Then replace `status:claimed` with
   `status:review`, and comment commits, changed files, tests, risks and open
   decisions.
5. The GPT integration owner reviews against principles and acceptance criteria,
   then validates and integrates the advertised range through
   `scripts/agent-orchestrator.sh integrate-range`. A correction commit whose
   advertised start is an unintegrated/rejected ancestor is rejected before the
   canonical worktree is mutated.
6. QA validates the integrated worktree; only the integration owner applies
   `status:done` and closes the issue.

Workers never push directly to `private/main` or the public `origin`.
`exit(0)` from the worker runner is not a handoff and never changes lifecycle
state by itself. Until the GitHub comment and `status:review` transition are
verified, the orchestrator treats the stopped worker as `status:claimed` work
requiring immediate reconciliation.
Every worker receives the mandatory checks in `agent-worker-baseline.md`.
Review rejects proxy/fake tests, undiscovered tests, skipped validation reported
as passing, unbounded-then-check payload handling and resource cleanup that does
not cover early returns.

Canonical synchronization happens through committed updates to:

- `docs/principles.md`
- `docs/spec/consensus-spec.md`
- `docs/spec/acceptance-criteria.md`
- `docs/open-questions.md`

Session transcripts are evidence, not synchronization. Important decisions must
be committed to a canonical document.

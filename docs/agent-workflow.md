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
`parallel:safe` and `decision:gpt-required`.

The issue is the live status record. Specifications and accepted decisions still
belong in the repository; chat transcripts and issue comments are not canonical.

## Claim Protocol

Before reading broadly or editing:

1. Run `gh issue list --label status:ready --label agent:<agent>`.
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
4. Push the task branch to `private`, replace `status:claimed` with
   `status:review`, and comment commits, changed files, tests, risks and open
   decisions.
5. The GPT integration owner reviews against principles and acceptance criteria,
   then cherry-picks or merges.
6. QA validates the integrated worktree; only the integration owner applies
   `status:done` and closes the issue.

Workers never push directly to `private/main` or the public `origin`.

Canonical synchronization happens through committed updates to:

- `docs/principles.md`
- `docs/spec/consensus-spec.md`
- `docs/spec/acceptance-criteria.md`
- `docs/open-questions.md`

Session transcripts are evidence, not synchronization. Important decisions must
be committed to a canonical document.

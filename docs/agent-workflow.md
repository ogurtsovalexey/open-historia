# Parallel Agent Workflow

Codex and OpenCode/DeepSeek must not edit the same working tree.

## Layout

```text
open-historia-memory/          integration worktree
open-historia-codex/           Codex worktree and branch
open-historia-opencode/        OpenCode worktree and branch
```

Each task records its objective, acceptance criteria, owned files, read-only
files, dependency commit and required tests. Two active tasks cannot own the
same file.

## Handoff

1. Start from the recorded integration SHA.
2. Make small, focused commits.
3. Run task-specific validation.
4. Hand off decisions, changed files, tests and risks.
5. The integration owner reviews and cherry-picks or merges.
6. QA validates the integrated worktree.

Canonical synchronization happens through committed updates to:

- `docs/principles.md`
- `docs/spec/consensus-spec.md`
- `docs/spec/acceptance-criteria.md`
- `docs/open-questions.md`

Session transcripts are evidence, not synchronization. Important decisions must
be committed to a canonical document.

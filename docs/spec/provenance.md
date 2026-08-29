# Phase 1 Recovery Provenance

No DeepSeek export was required. The full work was recovered from local Codex
JSONL sessions and Git repositories on 2026-08-29.

## Parent Sessions

| Work | Session ID | Provider at creation |
|---|---|---|
| Initial implementation experiments and global roadmap | `01a049b6-ba10-7061-8ba2-98ab8d643b36` | OpenAI |
| Multi-agent Phase 1 continuation | `01a04ab3-1a3e-7471-b68c-a2246afde465` | OpenRouter / DeepSeek V4 Pro |

## Recovered Roles

| Role | Session ID |
|---|---|
| PO / Mencius | `01a04ae7-efe2-79a1-bd9f-12314847d79d` |
| Analyst / Halley | `01a04ae8-385c-7ca0-84cd-bfb142a2831d` |
| Developer / Mill | `01a04af1-3f09-7e30-aefe-10d667c1b565` |
| AI Engineer / Heisenberg | `01a04af1-b51c-7df3-a129-deab2d99567d` |
| PO review / Volta | `01a04c6f-d836-7ac1-8aff-34e420831bde` |
| QA / Feynman | `01a04c70-1e91-79d0-a9cf-c92b0a56b775` |

The global product corpus in `../product/` was imported from local repository
`my_open_history` at commit `d943699`.

## Consolidation Amendments

- automatic AI gap filling became an optional reviewable Draft;
- scenario build/load became deterministic and offline;
- AI proposes bounded changes while the engine resolves numeric effects;
- modular files became projections of one atomic revision;
- `factsUsed[]`, provenance and measurable acceptance criteria were added;
- Phase 1 was reduced to four foundations plus one vertical slice.

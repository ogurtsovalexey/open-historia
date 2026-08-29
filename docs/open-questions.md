# Open Questions & Blockers

Accumulated during multi-agent specification work. Resolved items move to `docs/principles.md`.

---

## Pending (need human decision)

1. **Product priority:** optimize the currently playable game first (recommended)
   or prioritize the long simulation roadmap even if visible improvements arrive later.
2. **Private remote:** create a private canonical repository before pushing this
   consolidated corpus; the configured fork is public.
3. **World 1916 fidelity:** choose the minimum sourced Russian dataset for the
   first vertical slice and what may remain an explicit approximation.
4. **Runtime schema library:** choose after a compatibility spike across browser,
   Node/Electron and Android.
5. **Revision transport:** compare manifest polling, conditional requests and
   patches after the atomic revision primitive exists.

## Resolved

- AI cannot silently generate canonical starting values.
- Scenario build/load must work offline and deterministically.
- Pregame narrative must cite `factsUsed[]`.
- Modular assets share one atomic revision.
- Parallel Codex/OpenCode work uses separate worktrees and Git handoffs.
- Phase 1 follows an 80/20 scope: four foundations plus one vertical slice.

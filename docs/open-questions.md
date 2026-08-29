# Open Questions & Blockers

Accumulated during multi-agent specification work. Resolved items move to `docs/principles.md`.

---

## Pending (need human decision)

1. **Runtime schema library:** choose after a compatibility spike across browser,
   Node/Electron and Android.
2. **Revision transport:** compare manifest polling, conditional requests and
   patches after the atomic revision primitive exists.

## Resolved

- AI cannot silently generate canonical starting values.
- Scenario build/load must work offline and deterministically.
- Pregame narrative must cite `factsUsed[]`.
- Modular assets share one atomic revision.
- Parallel Codex/OpenCode work uses separate worktrees and Git handoffs.
- Phase 1 follows an 80/20 scope: four foundations plus one vertical slice.
- Improve the currently playable game before building the full simulation stack.
- Use private `ogurtsovalexey/open-historia-next` as the canonical development
  repository; keep the public fork only for upstream tracking.
- World 1916 curation proceeds in three waves: Russia/Germany/Britain;
  France/Austria-Hungary/Ottoman Empire/USA; China/Japan/Italy/Spain/Switzerland.

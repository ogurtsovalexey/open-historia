# 06 — Persistence and revisions

Sources: `docs/spec/atomic-world-revision.md`, `src/runtime/worldRevisionCore.js`,
`server/worldRevisionFilesystem.js`, `packages/engine/src/persist.ts`.

## Engine run directories (active)

The engine persists one directory per resolved turn:

```
runs/<id>/scenario.json            — verbatim scenario copy (replay is standalone)
runs/<id>/turn-NNN/state.json      — full world state incl. revision
                    events.json    — typed engine events
                    ledger.json    — contribution ledger ("why changed")
                    commands.json  — the commands file that produced this turn
                    report.md      — human-readable report
                    manifest.json  — turn, month, baseRevision, revision,
                                     per-file sha256, committedAt (wall clock
                                     lives ONLY here, outside all checksums)
```

Writes are atomic: staging dir → `rename`. Revisions are content-addressed
(`sha256:` of canonical state), so `cli.js replay --run <dir>` re-runs the
whole campaign from the copied scenario + recorded commands and byte-compares
every revision. That replay IS the integrity check.

## Legacy six-projection contract (frozen)

`src/runtime/worldRevisionCore.js` + `server/worldRevisionFilesystem.js`
implement manifest schema `open-historia-world-revision/1` hardcoded to the
live app's six projections (`actions, chat, events, game, world, colors`),
with random revision ids and wall-clock commit stamps. They are tested but
**not wired into the app**, and their randomness makes byte-identical replay
impossible.

Status: frozen as-is. When the engine reaches server/UI integration, the
filesystem adapter is the natural candidate **iff** its manifest is
generalized past the six keys (v2) and its revision ids become
content-addressed. Do not copy its `crypto.randomBytes` / `new Date()`
patterns into engine code — the determinism guard rejects them.

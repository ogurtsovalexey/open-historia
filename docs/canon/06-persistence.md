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

## In-game engine sessions (active)

Product games publish a separate atomic manifest under
`games/<gameId>/engine-session/`. A content-addressed revision binds the engine
state, exact game date, game round, last economic turn and complete ownership
projection. Each payload has a SHA-256 and byte length; the manifest hashes its
own canonical content and names its parent revision. A staged revision is
verified before its directory is renamed, then becomes visible through one
atomic `current.json` pointer rename.

Every advance is compare-and-swap against `expectedSessionRevision`. A stale
writer, broken parent chain, malformed pointer or payload/hash mismatch is
rejected without changing the current readable revision. Runtime readers overlay
engine-owned date, round and ownership from this manifest; those fields are not
copied back into legacy `game.json` or `world.json`. A pre-session engine dev
save in `economy/` is moved once into `backups/economy-engine-v0-NNN/`, then the
new session is initialized from the immutable scenario. Legacy games never
enter this path.

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

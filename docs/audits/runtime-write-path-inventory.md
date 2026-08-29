# Runtime Write-Path Inventory

## Scope and conclusion

This audit covers mutable runtime game state, not scenario/library authoring. The canonical turn state is split across `actions`, `chat`, `events`, `game`, `world`, and `colors`; `advisor` is an independent log and `snapshots` is the rollback journal.

The current runtime does **not** provide an atomic world revision:

- Desktop mode persists each asset as a separate file and updates game metadata in a second file write.
- Web mode persists a whole game record atomically per request, but concurrent asset requests each read and rewrite that whole record, creating a last-writer-wins lost-update hazard.
- Turn commit, pre-game history, and rollback use parallel independent writes. A rejected request, process exit, tab close, or interleaving reader can observe or leave a mixed revision.
- Rollback snapshots are captured after the new turn is committed. A crash in between leaves no restore point for that turn.

The smallest high-leverage seam is `applySimulationResult` at `src/Game/AI/gameplay.js:1656`: replace its six independent writes with one runtime bundle/revision commit shared by desktop and web storage. That contract is deliberately left to Issue #16.

## Storage layers

### Client choke point

`writeJson` in `src/runtime/assets.js:619` serializes once and sends one `PUT` for one asset. It has no retry, compare-and-swap token, transaction id, revision precondition, or cross-asset coordination. Only a successful response updates the in-memory and Cache Storage copies (`src/runtime/assets.js:653`). `jsonRequestCache` is read-request de-duplication; it is cleared by writes and does not serialize writers (`src/runtime/assets.js:561`, `src/runtime/assets.js:603`).

The normalized wrappers in `src/runtime/gameState.js:1135` map one-to-one to:

| Wrapper | Runtime asset | Desktop file |
| --- | --- | --- |
| `writeActionsState` | `actions` | `storage/actions.json` |
| `writeChatsState` | `chat` | `storage/chat.json` |
| `writeEventsState` | `events` | `storage/events.json` |
| `writeGameData` | `game` | `game.json` |
| `writeWorldState` | `world` | `world.json` |

`colors`, `advisor`, and `snapshots` bypass those wrappers and call `writeJson` directly. The asset-to-file declarations are in `server/libraryStore.js:241`, `server/libraryStore.js:248`, `server/libraryStore.js:259`, and `server/libraryStore.js:278`.

### Desktop/server mode

`PUT /api/runtime/json/:assetKey` handles exactly one asset (`server/server.js:531`). `writeRuntimeJsonAsset` validates and canonicalizes that asset, then writes its game file and separately rewrites `game-instance.json` (`server/libraryStore.js:2315`, `server/libraryStore.js:2429`). The common `writeJsonFile` uses direct `fs.writeFileSync` on the target path (`server/libraryStore.js:409`): there is no temp-file-and-rename protection against a process or machine failure during the write.

Consequences:

- One asset write may succeed while another request in the same logical turn fails.
- A crash can leave a truncated individual JSON file because replacement is not atomic.
- A crash between the asset write and metadata write leaves correct data with a stale catalog token; the inverse mixed state can occur in other multi-file library operations.
- Concurrent writes to the same asset are unversioned last-writer-wins.

### Web/IndexedDB mode

Each runtime write loads the active game record, changes one property, updates metadata, and calls `putGame` (`src/runtime/web/libraryStore.js:528`). `putGame` atomically writes the full game record plus its projection (`src/runtime/web/libraryStore.js:77`), so one request is durable as a unit.

That per-request atomicity does not make a turn atomic. Six calls launched together can all read revision N, independently modify one property, then each replace the full record. The final transaction may retain only its own change and overwrite changes committed by the other five requests. IndexedDB serializes the commits, not the earlier reads. This is the highest-severity current failure mode.

## Canonical write paths

| Path | Assets and order | Failure/interleaving behavior | Existing recovery |
| --- | --- | --- | --- |
| Turn/catalyst result | `actions`, `chat`, `events`, `game`, `colors`, `world` in one `Promise.all` (`src/Game/AI/gameplay.js:1656`) | No ordering or rollback. Desktop can persist any subset. Web can lose sibling updates through stale full-record puts. | `oh:turn-complete` fires only after all promises resolve, but is notification, not a commit marker (`src/Game/AI/gameplay.js:1665`). |
| Pre-game history | `events` + `world` in one `Promise.all` (`src/Game/AI/gameplay.js:2400`) | Events can exist without the `simulationHistory` done-marker, or marker without events. A later open may retry or suppress generation against a mixed pair. | Pre-write re-read guards reduce game-switch races but do not make the pair atomic (`src/Game/AI/gameplay.js:2368`). |
| Rollback restore | Six state assets in parallel, then truncates `snapshots` (`src/Game/AI/gameplay.js:1526`) | Partial restore is possible. If snapshot truncation fails, restored state remains with a reusable snapshot; if state restore partly fails, snapshot remains but current state is mixed. Web has the same stale-record lost-update hazard. | Forced bundle read happens only after all six state writes succeed (`src/Game/AI/gameplay.js:1535`). |
| Rollback capture | Reads snapshot list, prepends one entry, writes `snapshots` (`src/Game/AI/gameplay.js:1487`) | Read-modify-write is unversioned. Concurrent captures can lose one entry. It runs after turn commit, so a crash before capture leaves the completed turn without undo. Errors are intentionally swallowed. | List capped at 12; best-effort only (`src/Game/AI/gameplay.js:1476`). |
| Chat mutations | UI writes full `chat` arrays (`src/Game/GameUI/chat.jsx:21`); AI writes the full list after a forced re-read (`src/Game/AI/gameplay.js:1651`) | The AI merge protects edits made during generation, but another write after its re-read can still be overwritten. Multiple UI callbacks do not await or serialize `saveAllChats` (`src/Game/GameUI/chat.jsx:933`). | Five-second chat polling refreshes stored additions while the panel is open (`src/Game/GameUI/chat.jsx:899`). |
| Action mutations | Action UI and AI helpers read/replace the full `actions` array (`src/Game/GameUI/actions.jsx:77`, `src/Game/AI/gameplay.js:1902`) | Concurrent add/delete/resolve operations are last-writer-wins. Turn commit can replace an action edit made after its base snapshot. | No revision check or merge at write time. |
| Unit orders | `world.units` is written first, then an `actions` entry is queued (`src/Game/Map/unitsController.js:100`, `src/Game/Map/unitsController.js:119`) | Failure between writes moves/deploys the unit without recording the order. Concurrent world read-modify-write can overwrite unrelated world changes. | `unitRevert` can undo a recorded order, but cannot help if action persistence failed. Local `busy` only serializes this controller instance. |
| World-only AI/UI edits | Suggestions, stats, catalysts, impact edits, cheats, and map operations replace full `world` (`src/Game/AI/gameplay.js:1753`, `src/Game/AI/gameplay.js:1868`, `src/Game/AI/gameplay.js:1991`, `src/Game/GameUI/cheats.jsx:608`) | Forced re-read narrows but does not close the read-modify-write window. A concurrent turn or map edit can be overwritten. | Some callers re-read immediately before writing; no compare-and-swap. |
| Colors/flags/map geometry | UI replaces whole `colors`, `flags`, `regionsGeojson`, or `citiesGeojson` documents (`src/Game/GameUI/libraryBar.jsx:1212`, `src/Game/GameUI/cheats.jsx:747`) | Full-document last-writer-wins. Geometry is scenario-scoped while most state is game-scoped, so it cannot participate in a game revision without an explicit boundary. | Shape validation prevents some malformed overwrites, not stale ones. |
| Advisor log | Advisor UI replaces the full `advisor` array (`src/Game/GameUI/advisor.jsx:155`) | Independent last-writer-wins log. It is not part of `readGameStateBundle` or turn commit. | None; keep outside the first atomic turn seam unless product semantics change. |

## Readers that can observe mixed state

- `readGameStateBundle` starts five independent reads in parallel (`src/runtime/gameState.js:1174`). Even with atomic writers, it has no shared revision check and may combine values from before and after a turn.
- The timeline independently polls game, events, and world every five seconds (`src/Game/GameUI/time.jsx:1350`, `src/Game/GameUI/time.jsx:1383`). A desktop multi-file turn is visible between individual requests.
- Unit state independently polls world and game every five seconds (`src/Game/Map/unitsController.js:72`, `src/Game/Map/unitsController.js:93`). It can pair units from one turn with round/date from another.
- Chat independently polls game metadata and chat state (`src/Game/GameUI/chat.jsx:879`, `src/Game/GameUI/chat.jsx:899`).
- Client caches are updated per successful asset response, so a partial write also becomes the session's cached mixed view (`src/runtime/assets.js:653`).

## Failure matrix

| Failure point | Desktop result | Web result | Detectable now? |
| --- | --- | --- | --- |
| One request rejects during turn `Promise.all` | Arbitrary subset of files at new turn | Some full-record puts may commit; sibling changes may be lost | Only the rejecting caller knows; no durable incomplete marker |
| Process crash during one file write | Target JSON may be truncated | IndexedDB transaction aborts that one request | Parse fallback/log on desktop; no revision-level diagnosis |
| Crash after turn writes, before snapshot | New turn persists with no undo entry | Same | No |
| Reader during desktop turn | Mixed old/new assets | A single IDB record read is coherent, but may already reflect a lost-update winner | No common revision field |
| Two writers update the same document | Last response wins | Last full-record transaction wins | No conflict response or base revision |
| Game switches while requests are in flight | Endpoint resolution can target whichever game is active when each server request executes | Each write resolves the then-active record | Some AI paths re-check identity; general writes do not carry game id |

## Tests and evidence gaps

Current tests cover normalization/deduplication and selected server migrations/security, but repository search finds no test that injects a failure between runtime asset writes, crashes during `writeJsonFile`, runs concurrent web runtime writes, or proves a coherent `readGameStateBundle`. The rollback functions likewise have no dedicated crash/partial-restore tests.

Issue #17 should add, at minimum:

1. Desktop fault injection after each asset in a turn and before metadata update.
2. Web concurrent writes from the same base record, proving no sibling asset is lost.
3. Reader interleaving tests that reject or retry mixed revision bundles.
4. Snapshot-before/after-commit crash tests and idempotent rollback tests.
5. Two same-asset writers with an explicit stale-revision result.

## Ranked atomicity seams

1. **P0 — turn bundle commit:** `applySimulationResult` owns the six assets that define one visible turn. Give it one storage operation with one revision and make `readGameStateBundle` verify that revision.
2. **P0 — web record mutation:** perform runtime asset mutation inside one IndexedDB readwrite transaction, or expose the same bundle operation directly. This is required even before broader revision semantics because current parallel calls can overwrite sibling updates.
3. **P1 — rollback protocol:** capture the pre-turn snapshot before publishing the new revision; restore as one bundle; consume the snapshot only after the restored revision commits.
4. **P1 — desktop file publication:** stage a complete revision in a new directory or temporary files and atomically switch a manifest/pointer, rather than overwriting canonical files in place.
5. **P2 — isolated read-modify-write paths:** add revision preconditions or field-level mutation for chat, actions, units, stats, colors, and map edits.

The first implementation should stay narrow: atomic turn bundle plus coherent bundle read, with adapters for desktop files and the web game record. Scenario authoring, advisor history, and map geometry can remain outside that boundary until their product semantics require inclusion.

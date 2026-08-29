# Phase 1 Atomic World Revision Contract

Status: Accepted Phase 1 design contract. Runtime implementation is split across
Issues #41 (pure core), #42 (filesystem), #43 (IndexedDB) and #44 (desktop
production integration). Superseded Issue #17 is evidence only.

This contract refines [AC-2](acceptance-criteria.md#ac-2--atomic-state) and
implements the second foundation in the
[Phase 1 implementation sequence](consensus-spec.md#10-implementation-sequence).
It is based on the evidence in the
[runtime write-path inventory](../audits/runtime-write-path-inventory.md).

## 1. Purpose and scope

One visible campaign turn is one logical state revision. A reader observes the
complete previous revision or the complete next revision, never a mixture.

The Phase 1 transaction contains the six projections currently committed by
`applySimulationResult`:

- `actions`;
- `chat`;
- `events`;
- `game`;
- `world`;
- `colors`.

The bundle is logical: an adapter may deduplicate unchanged projections, but it
must validate and publish them as one complete revision.

`advisor`, `flags`, `tags`, `prompts`, scenario geometry/background and binary
map assets remain outside this boundary. `snapshots` becomes compatibility
input for revision history; it is not a seventh canonical projection. Future
economy, culture, religion, resources, influence and mobilization projections
are deliberately deferred until their domain contracts exist.

## 2. Revision and manifest

Revision identifiers are opaque, immutable and unique within one game. Code
must compare them for equality, not parse timestamps or infer ordering from the
identifier. Parent links define order.

```ts
type WorldRevision = string;

type WorldProjectionKey =
  | "actions"
  | "chat"
  | "events"
  | "game"
  | "world"
  | "colors";

type ProjectionDescriptor = {
  checksum: string;
  byteLength: number;
};

type WorldRevisionManifestV1 = {
  schema: "open-historia-world-revision/1";
  gameId: string;
  revision: WorldRevision;
  parentRevision: WorldRevision | null;
  committedAt: string;
  reason: "turn" | "pregame" | "rollback" | "compat-write";
  rollbackOf: WorldRevision | null;
  projections: Record<WorldProjectionKey, ProjectionDescriptor>;
};
```

Invariants:

- A manifest names exactly one game and all six projections.
- Every descriptor is computed from the canonical serialized bytes actually
  stored, after normalization and validation.
- A published manifest and its projections are immutable.
- `committedAt` is diagnostic metadata, not a conflict or ordering primitive.
- The current-revision pointer is the only publication point. A candidate is
  invisible until that pointer changes atomically.
- A revision is complete only when all descriptors verify. Missing or corrupt
  projections make the candidate unreadable.

## 3. Commit contract

```ts
type AtomicWorldBundle = {
  manifest: WorldRevisionManifestV1;
  projections: Record<WorldProjectionKey, unknown>;
};

type CommitWorldRevisionRequest = {
  gameId: string;
  expectedRevision: WorldRevision;
  reason: WorldRevisionManifestV1["reason"];
  rollbackOf?: WorldRevision | null;
  projections: Record<WorldProjectionKey, unknown>;
};

type CommitWorldRevisionResult =
  | { status: "committed"; bundle: AtomicWorldBundle }
  | { status: "conflict"; currentRevision: WorldRevision };
```

The storage adapter performs one compare-and-swap transaction:

1. Resolve the explicit `gameId`; never infer the target again after the
   request starts.
2. Read the published revision and compare it with `expectedRevision` inside
   the transaction.
3. Normalize and validate the complete candidate bundle before publication.
4. Persist all candidate projection bytes and their manifest durably while
   they remain unreachable from the current pointer.
5. Verify descriptors, then atomically publish the new current pointer.
6. Return the stored canonical bundle and notify consumers only after publish.

If step 2 fails, no bytes become current and the caller receives `conflict`.
The caller must re-read, deliberately merge/reapply its intent, and submit a new
candidate; blind retry with the stale bundle is forbidden.

If any later step fails, the previous revision remains current. Staged files or
records may be garbage-collected, but readers must never discover them through
normal runtime APIs.

## 4. Platform adapters

### Desktop and embedded server

The filesystem adapter stages revision-addressed projections and a manifest,
makes them durable, then replaces the current pointer using the platform's
atomic replace primitive. It must not overwrite the files of the current
revision in place. A game metadata/catalog update derived from the revision is
published with the same transaction or rebuilt from the current manifest; it
cannot be a second source of truth.

On startup, the adapter validates the pointed-to manifest and descriptors. If
the candidate publication is incomplete or corrupt, recovery selects the last
complete parent/previous revision. Recovery never combines individually valid
projections from different revisions.

### Web/IndexedDB

The web adapter reads the current game record, checks `expectedRevision`, writes
the complete next bundle and updates its lean metadata projection in one
IndexedDB readwrite transaction. The read and write must occur in that same
transaction. Loading a record before opening the transaction and later writing
the whole stale record is forbidden.

Two requests based on the same revision cannot both succeed: one commits and
the other returns `conflict`. This removes the current parallel full-record
last-writer-wins failure.

## 5. Coherent reads and synchronization

The authoritative read returns `AtomicWorldBundle`, not six unrelated latest
values. `readGameStateBundle` must expose its `manifest.revision` alongside the
normalized projections.

Readers follow these rules:

- A bundle is accepted only when every projection belongs to and verifies
  against the returned manifest.
- Revision-addressed projection responses are immutable and may be cached by
  revision. Unversioned cache entries cannot satisfy a revisioned read.
- Pollers first compare a lightweight current revision. If unchanged, they do
  nothing. If changed, they fetch a coherent bundle or the changed projections
  named by one manifest.
- A publication notification carries `gameId` and `revision` and fires only
  after commit. Notifications improve latency; correctness never depends on
  receiving one.
- An active-game switch cannot redirect an in-flight read or commit because all
  revision operations carry explicit `gameId`.

Phase 1 may return the full bundle on every revision change. Field patches and
transport interval tuning are optimizations, not acceptance requirements.

## 6. Compatibility and migration

Existing saves and presets remain readable and are not rewritten on discovery.

- A game with no revision manifest is exposed as a synthesized legacy baseline
  revision built from its current six projections.
- The first successful mutation imports that complete baseline and publishes a
  new revision side-by-side. Original legacy files remain recoverable until the
  new manifest verifies.
- Existing `GET /api/runtime/json/:assetKey` reads resolve the requested
  projection from one published manifest and expose its revision in response
  metadata.
- Existing per-asset writes become `compat-write` transactions: load the current
  complete bundle, replace one projection, and commit with its expected
  revision. They may not bypass the transaction helper.
- Compatibility writers that race receive a conflict. They do not silently
  overwrite a newer turn or another projection.
- Scenario source files are not campaign revisions and are never migrated by a
  runtime game write.

The synthesized baseline is a migration bridge, not permission to keep
unversioned canonical writes indefinitely.

## 7. Turn, pregame and rollback semantics

`applySimulationResult` submits one six-projection `turn` candidate. The
`oh:turn-complete` event and encrypted sync start only after its revision is
published.

Pregame history submits one complete `pregame` candidate even though only
`events` and `world` changed; unchanged projections still belong to the same
logical bundle.

Every committed revision already identifies its complete parent, so there is
no post-commit window in which a turn exists without an undo source. Retention
keeps at least the current revision and every revision offered by the rollback
UI (currently twelve restore points).

Rollback never moves the current pointer backward and never mutates an old
revision. It reads a selected complete revision and commits its projections as
a new `rollback` revision whose parent is the current revision and whose
`rollbackOf` names the selected revision. A failed rollback leaves the current
revision and rollback history unchanged. Pruning happens only after successful
publication and cannot delete the current revision, its parent during recovery,
or a retained rollback target.

Legacy `snapshots` may seed the first retained restore points after validation.
Once revision history is authoritative, snapshot-list truncation is no longer a
separate correctness-critical write.

## 8. Required Phase 1 tests

The #41–#44 implementation set is not accepted until all of these are automated
for both adapters where applicable:

1. Inject failure before and after every staging/publication step; restart reads
   exactly the old or new bundle, never a mixture.
2. Corrupt or remove each staged projection and prove its manifest cannot
   become/read as current.
3. Start two commits with one `expectedRevision`; exactly one succeeds and the
   other reports the winning revision without lost sibling changes.
4. Read repeatedly while a commit is paused at each step; every accepted read
   has one verified revision.
5. Switch the active game during an in-flight commit; only the explicit target
   game changes.
6. Import a manifest-less save side-by-side, then fail its first revisioned
   write and prove the legacy baseline remains readable.
7. Exercise each per-asset compatibility writer through the transaction helper
   and prove a stale writer conflicts.
8. Crash before, during and after rollback publication; restart exposes the
   pre-rollback or complete rollback revision and retains a valid restore path.
9. Prove publication notifications and sync fire once, after durable commit,
   and never for conflicts or failed candidates.
10. Prove retention cannot prune the current, recovery-parent or UI-visible
    rollback revisions.

`git diff --check` and ordinary happy-path save/load tests are necessary but do
not substitute for fault injection and interleaving tests.

## 9. Explicit non-goals

- Splitting future simulation domains into their final files.
- Distributed consensus, multiplayer locking or multi-device merge semantics.
- Full event sourcing or an indefinitely retained revision history.
- Changing gameplay schemas, AI authority or scenario authoring contracts.
- Making polling frequency part of the domain model.
- Encrypting local saves or defending against a malicious same-user process.

This contract is intentionally a local single-player transaction boundary. It
removes mixed revisions and lost updates without turning the game into a
database platform.

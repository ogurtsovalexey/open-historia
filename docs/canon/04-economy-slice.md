# 04 — Economy slice (feature spec, implemented)

Sources: `docs/spec/first-economy-mvp.md`, `docs/spec/regional-resource-economy.md`.
Implementation: `packages/engine/` (2026-08-30). Status: **shipped headlessly,
all gates green.**

## The playtest scenario (owner decision 2026-08-31)

**`scenario-dev-map-4c` — "Central Europe" — replaces the originally planned
2×5 fixture as the playtest target.** Four polities (Austria 9 regions, Czechia
14, Germany 16, Slovakia 8) on their real map regions, each region with its own
authored numbers, each polity with exactly one processing region plus its own
coal and iron. All optional mechanics are enabled there.

`scenario-dev-2x5` is **kept, but only as a regression fixture**: it enables no
modules, so its golden campaign proves the base economy stayed byte-identical
while the economy grew around it. It is no longer where mechanics are tried, and
no new mechanic is authored into it.

## Preconditions

- `packages/domain` built (ID brands); `packages/data-packs` built
  (`canonicalStringify`).
- Root `npm install` done (file: links).

## Deliverables (all present)

- `packages/engine/src/` — scenario/state/commands schemas, monthly tick,
  contribution ledger + invariant checker, markdown report, atomic run-dir
  persistence, campaign pipeline, CLI (`run` / `replay`).
- `fixtures/scenario-dev-2x5/` — fictional Ostreya vs Vindar, 2 polities ×
  5 regions, deliberately unequal; `NUMBERS.md` holds hand-checked month-1
  values.
- `test/` — 60 tests: unit, invariants grid (spend × 12 months), rejection
  matrix, golden byte-compare (turn 1 state + report, 12-month revision
  chain), determinism guard.

## The tick (fixed order)

validate commands → pay investment (clamp infra at 10000bp) → births/deaths
with carried remainders → workforce → potential = min(capacity, workforce ×
outputPerWorker) × infraBp × (10000−damageBp) → raw extraction → national
stockpile → `basic_goods` = min(potential, coal, iron), deduct only inputs
used, record limiting inputs → food consumption (floor at 0, record
surplus/shortfall) → tax = Σ gross × accountingValue × taxRateBp → treasury →
ledger + §10 invariants → content-addressed revision → report → persist.

## Accepted interpretation decisions (binding)

1. **Safe integers, not bigint/micros** — see canon 03.
2. **`foodNeedPerPersonMilli`** replaces fractional `foodNeedPerPerson`:
   need = population × milli / 1000, floored, no carry.
3. **`expectedRevision` is optional in offline fixture files** (a static file
   cannot know a content hash); the resolver still rejects a present-but-stale
   value. Every interactive or LLM-produced command MUST carry it.
4. **At most one accepted investment per polity per month** (spec §4 singular
   "the accepted regional-investment command"); later valid duplicates are
   rejected with `command-limit`.
5. Engine events are typed and deterministically ordered but carry no UUIDs;
   the revision checksum covers them (spec §9.10 satisfied via replay).
6. Tax is floored per region×resource row, then summed (locality of the
   ledger beats global rounding).

## How the tick is driven (owner decision 2026-08-31)

The engine tick is driven by **game time**, not by a button. The monthly
resolution happens on the 1st of each in-game month. The player-facing control
stays the one that already exists — the AI time jump: advancing six months runs
six deterministic monthly ticks in order, and the model narrates on top of the
numbers the engine produced. It never produces them.

A separate "advance month" button exists only as a development affordance while
the engine is being tested, and is removed once time-driven ticking is wired.

## Map linkage (owner decision 2026-08-31)

Engine regions are bound to real map regions, so our scenario renders on the
existing map exactly like any other. The dataset segment of the branded region
id carries the binding: `region:gadm:AUT.3_1` is the engine's identity for the
map region `AUT.3_1`. A scenario fixture ships a `map-link.json` next to it
declaring the dataset, the engine-region-to-map-region pairs, and the map owner
name for each polity (the app's `regionOwnershipOverrides` maps a map region id
to an owner *name*, so each engine polity needs one).

The first map fixture is `packages/engine/fixtures/scenario-dev-map-2x5/`:
Ostreya holds five Austrian lands, Vindar five Czech regions — adjacent, in
central Europe, visually unambiguous.

## In-game integration (P2, shipped 2026-08-31)

Central Europe is now the product playtest scenario. Each game owns a
content-addressed engine session (canon 06). The product API is explicitly
game-scoped:

- `GET /api/games/:gameId/economy/state`;
- `POST /api/games/:gameId/economy/advance` with `targetDate`,
  `expectedSessionRevision` and typed `commands`.

Calendar month boundaries, not rounded day counts, determine the number of
monthly engine ticks. A player jump increments the game round exactly once,
including a jump within one month; at most 120 monthly boundaries may be
crossed. The saved player country resolves through the authored
`polityOwnerNames` mapping. Ambiguous players, foreign actors, investments in
foreign regions and stale session revisions fail before publication.

The Economy drawer defaults to the player's first controlled region, permits
read-only inspection of foreign regions, queues investments for the shared
time control, and has no product-only reset or advance button. Date, round,
session revision, last report and ledger causes are visible in EN/RU. The
Playwright smoke verifies the Central Europe map/UI/API path and blocks model
calls.

## Not doing (deferred from the archived spec)

- Player-facing region-transfer controls (the deterministic engine command and
  re-aggregation semantics are ready; P2 does not expose that command in UI).
- Six-projection atomic world revision (AC-2) — engine run dirs instead, see
  canon 06.
- Everything in spec §11 (prices, trade, migration, combat, NPC AI…).

## Relationship to packages/sim-core

`packages/sim-core` implements the same accepted contract at its earlier #32
stage and additionally has region transfer. It is kept, not deleted; the
comparison and the convergence order are in canon 02. Region transfer (task T9
below) ports from there.

## Open questions

- Merge dev-fixture scenario format into ScenarioV2 — canon 05.
- When the UI slice lands: does the dashboard read run dirs or an in-memory
  engine instance? Decide in the UI feature spec.

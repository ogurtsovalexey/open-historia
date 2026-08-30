# 04 — Economy slice 2×5 (feature spec, implemented)

Sources: `docs/spec/first-economy-mvp.md`, `docs/spec/regional-resource-economy.md`.
Implementation: `packages/engine/` (2026-08-30). Status: **shipped headlessly,
all gates green.**

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

## Not doing (deferred from the archived spec)

- §8 in-game dashboard UI and §9 in-app playtest script (the headless CLI +
  golden replay covers the logic; UI is the next slice).
- Region transfer command (spec §7) — stretch task T9, state model ready
  (`controllerId`).
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

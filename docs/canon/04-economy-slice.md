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

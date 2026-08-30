# @open-historia/engine

Deterministic economy engine for Open Historia. Headless: no UI, no LLM calls,
no randomness, no wall clock in state. Contracts: [`docs/canon/03-simulation-core.md`](../../docs/canon/03-simulation-core.md)
and [`docs/canon/04-economy-slice.md`](../../docs/canon/04-economy-slice.md).

## Run the 2×5 playtest

```bash
npm run build            # from this directory (domain + data-packs must be built first)
node dist/cli.js run \
  --scenario fixtures/scenario-dev-2x5/scenario.json \
  --commands fixtures/commands \
  --turns 12 \
  --out runs/local
node dist/cli.js replay --run runs/local     # must print: replay OK
```

Each turn directory holds `state.json`, `events.json`, `ledger.json`,
`commands.json`, `report.md`, `manifest.json`. `report.md` is the readable
"what changed and why" for that month.

## Tests

```bash
npm test                 # this package
cd ../.. && npm test     # the whole repo (the gate that counts)
```

## Regenerating golden fixtures

Goldens in `test/golden/` are byte-compared in CI and must never be
regenerated automatically. A deliberate, reviewed contract change:

```bash
node dist/cli.js run --scenario fixtures/scenario-dev-2x5/scenario.json \
  --commands fixtures/commands --turns 12 --write-golden test/golden
```

Then show the diff and justify it in the change description.

## Adding a mechanic

1. Write/extend the feature spec in `docs/canon/` first (fixed sections:
   Preconditions, Deliverables, Tasks, Acceptance criteria, Not doing, Open
   questions).
2. State where the mechanic sits in the fixed tick order.
3. Extend `src/scenario.ts` (authored inputs) and `src/state.ts` (state)
   before touching `src/tick.ts`.
4. Add the §10-style identity to `src/ledger.ts#checkInvariants`.
5. Golden fixtures change only as a reviewed, explained diff.

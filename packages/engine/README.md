# @open-historia/engine

Deterministic economy engine for Open Historia. Headless: no UI, no LLM calls,
no randomness, no wall clock in state. Contracts: [`docs/canon/03-simulation-core.md`](../../docs/canon/03-simulation-core.md)
and [`docs/canon/04-economy-slice.md`](../../docs/canon/04-economy-slice.md).

## Scenarios

- `fixtures/scenario-dev-map-6c` — **Europe, the current P3b playtest
  scenario.** Six polities on 76 real map regions, all optional mechanics
  enabled. This is where new interactive mechanics are tried.
- `fixtures/scenario-dev-map-4c` — **P2/P3a regression scenario.** Four
  polities on 47 regions; retained so the shipped map/economy and agent-loop
  contracts remain reproducible.
- `fixtures/scenario-dev-2x5` — **regression fixture only.** Enables no modules;
  its golden campaign exists to prove the base economy stays byte-identical as
  the economy grows. Do not author new mechanics into it.

## Play it in a browser (phase P1)

```bash
npm run play          # from this directory
# or from the repo root:  npm run play:engine
```

Opens a local server on http://localhost:5174 with the playtest dashboard:
region table, national totals with "why changed" pulled from the contribution
ledger, resource flows, an investment order with a preview of its
infrastructure effect, advance one month / twelve months, reset, and the full
turn report. In-memory session, zero model calls, no network egress.
`--scenario <file>` and `--port <n>` are supported.

## Run the 2×5 playtest headlessly

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

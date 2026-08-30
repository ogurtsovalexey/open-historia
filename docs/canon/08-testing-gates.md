# 08 — Testing, Definition of Done, worker task rules

Sources: `docs/spec/acceptance-criteria.md`, `docs/spec/phase1-test-plan.md`,
owner decisions 2026-08-30. These rules exist to stop the observed failure
mode: bounded workers building unverifiable code that is rebuilt and repaired
repeatedly.

## Definition of Done — the gate

Work is **done** only when ALL of the following hold, and the closing message
must list each item's actual value (never a bare "Done!"):

1. Root `npm test` green (includes domain, data-packs, engine, server, src).
2. Root `npm run typecheck` green.
3. Root `npm run lint` — zero new violations.
4. Golden tests green; if a golden changed, the diff is shown and justified
   as an accepted contract change (`--write-golden` is a deliberate human
   action, never run in CI).
5. Determinism guard green; `cli.js replay` reproduces the run byte-identically
   when the change touches the engine.
6. `git status` clean — no stray artifacts (dist/, runs/, node_modules are
   git-ignored; nothing else appears).
7. No file outside the task's declared whitelist was modified.

## Test conventions

- Runner: `node --test` over compiled `dist-test` (no Jest/Vitest). TS sources
  import with `.js` extensions; do not "test" via tsx — only the compiled
  output counts.
- **State-based assertions**: code that mutates world state is tested by
  asserting the resulting state/ledger values, never only "function was
  called". Required cases per state-mutating path: happy path, rejection
  paths, boundary inputs, determinism (same input twice → same canonical
  output).
- **Golden fixtures** (`packages/engine/test/golden/`): scenario + commands →
  byte-exact canonical state, report, revision chain. Immutable in CI;
  regeneration requires explicit owner approval.
- Hand-checked numbers live next to the fixture
  (`fixtures/scenario-dev-2x5/NUMBERS.md`) so a human can audit with a
  calculator.

## Worker task rules (fleet economics)

1. A bounded worker may only take a task whose DoD is verifiable by
   `npm test` without a human.
2. **Contract first**: the strong model (integration owner) writes types,
   interfaces and failing tests/goldens BEFORE the worker starts; the worker's
   job is to make them green. The test is the task description.
3. The worker iterates against the gate locally and escalates after N=5 red
   runs — instead of one-shot plan→implement.
4. Every task declares an explicit file whitelist; touching anything else
   fails the gate (rule 7 above).
5. Role split: architecture/specs/review/integration — strong model; bounded
   implementation against ready tests — mid-tier model; template routine only
   — cheap models.

## Delegation policy (when to fan out, when not to)

Measured on this project: fanning out *implementation* across bounded workers
produced the repeated "Repair and integrate X" pattern and a large bill, while
one strong agent implementing the whole economy engine in a single session
integrated on the first try (452 tests green, zero repair commits). The rule
that follows is about the KIND of work, not about parallelism as such.

**Delegate (parallel is cheaper than doing it yourself):**

- Read-heavy exploration and audits — "map this subsystem", "does X exist
  anywhere", "audit these 40 docs against these requirements". The file dumps
  stay in the sub-agent's context; only the distilled conclusion returns. This
  is context compression and it is worth its tokens.
- Mechanically independent chores with a contract already fixed: generate N
  fixture files to a given schema, write tests for given pure-function
  signatures, translate locale packs, run a lint/format sweep.

**Do NOT delegate:**

- Implementation of a subsystem whose parts must fit together. Every worker
  needs the whole architectural picture (expensive to transmit, easy to
  transmit incompletely), and their outputs then need integration — which is
  where the real cost lands, not in the re-reading.
- Anything whose acceptance requires judgement about the design rather than a
  green test run.

**Practical default:** one strong session owns a phase end to end and keeps
ownership of the result; it delegates reading and chores. Within one session
the conversation context is cached, so continuing there is markedly cheaper per
step than starting fresh agents. Fan out implementation only after the
contract (types + failing tests) exists and the pieces are provably
independent.

## UI smoke

The app is the product surface, so it gets a Playwright smoke suite: boot →
scenario loads → map renders regions → clicking a region selects it → advance a
month → the Economy drawer shows the new numbers and their causes → console
clean. Any model call is mocked via `page.route`, so smoke costs zero tokens.
Runs in CI on PRs; traces and screenshots on failure are the diagnostic
artifact.

Until those screens exist, the headless bench covers the same logic more
cheaply: `packages/engine/test/devServer.test.ts` pins the data contract the UI
will read.

Note for browser-driven checks: the Chrome automation screenshot is scaled
relative to the real viewport, so coordinate clicks can miss silently. Prefer
element lookups or direct handler/API assertions over pixel coordinates.

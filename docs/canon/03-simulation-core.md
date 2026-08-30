# 03 — Simulation core: numbers, determinism, time

Sources: `docs/product/06-simulation-core.md`, `docs/spec/first-economy-mvp.md` §5.
Decisions accepted 2026-08-30.

## Numeric types (accepted divergence from the archived spec)

All state quantities are **JS safe integers**: persons, whole resource units,
whole gold, basis points (0..10000). The archived spec's `bigint` remainders
and `*Micros` fixed-point fields are **replaced**, because:

- `canonicalStringify` and `JSON.stringify` cannot serialize bigint;
- at current scale every intermediate product fits in 2^53;
- `fixedPoint.ts` asserts `Number.isSafeInteger` on every result, so overflow
  fails loudly instead of silently corrupting.

Fractional precision is achieved by choosing fine-grained base units and
scaled parameters (e.g. `foodNeedPerPersonMilli` = thousandths of a unit per
person). **Open question (revisit when quantities grow):** switch to
bigint-with-string-serialization; until then no float may enter state.

## Determinism rules (non-negotiable)

1. Every division is integer floor division; where the spec names a remainder
   (births, deaths) it is carried in state between months.
2. No randomness in the tick. `rngSeed` is reserved in the scenario schema;
   any future stochastic mechanic goes through a seeded RNG module reviewed
   against this doc first.
3. No wall clock in checksummed content. `committedAt` exists only in run
   manifests (`persist.ts`); `Date`/`Date.now`/`Math.random`/`randomUUID` are
   forbidden in engine sources — `test/determinismGuard.test.ts` greps for them.
4. State arrays are sorted (regions by id, polities by id, stockpile by
   resource); canonical JSON sorts object keys. Iteration order is always
   explicit, never object-key order.
5. Revisions are content-addressed: `revision = sha256 of the canonical state
   without the revision field`. Same base revision + same commands must
   produce byte-identical state, events, ledger and report.

## Time model

- Fixed monthly tick. The player-facing "advance N months" is N sequential
  ticks; there is no variable-length simulation step in the engine.
- `month` is `YYYY-MM-01`; calendar arithmetic is hand-rolled
  (`state.ts#addMonth`), proleptic Gregorian, no `Date` object.
- A turn = one resolved month = one revision = one persisted turn directory.

## Resolution order

The fixed order inside one tick is defined in canon 04 (economy slice) and
mirrors `first-economy-mvp.md` §5 / `regional-resource-economy.md` §5. New
subsystems must state their position in this order explicitly in their spec.

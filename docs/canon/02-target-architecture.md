# 02 — Target architecture

Sources: `docs/product/README.md`, `docs/product/03-product-and-domain-spec.md`,
`docs/product/02-current-architecture-audit.md`. Owner decisions 2026-08-30.

> **Supersession note (2026-09-04):** canon 22 authorizes the hard cut from the
> parallel `EconWorldState`/sim-core/live-world arrangement to one
> `WorldStateV2`, after the named invariants and tests are ported. The audit
> below remains accurate historical context; it is no longer the target end
> state.

## Direction (owner-accepted)

The deterministic numeric engine is the base of the game. The LLM interprets
free-text player orders into **typed commands**, plays opponents competitively
on top of the engine, and narrates engine results. The LLM never invents
numeric outcomes. Language/runtime: TypeScript on the existing Vite/React/
Express/Electron stack (ADR-001 confirmed; no C++/Go/Rust core — profiling
first if performance ever becomes a question).

## The three world models — SSOT declaration

The repo currently contains three parallel world models. Their statuses:

| Model | Location | Status |
|---|---|---|
| **Engine state** (`EconWorldState`) | `packages/engine/src/state.ts` | **Future SSOT.** All new mechanics land here. |
| Sim-core kernel state | `packages/sim-core/src/types.ts` | Earlier stage of the same contract, kept — see "Two economy kernels" below. |
| Live app state (`world.json`) | `src/runtime/gameState.js` | Legacy, still runs the shipping game. Migrates to the engine incrementally. Do not add new numeric mechanics here. |
| Domain demo reducer | `packages/domain/src/reducer.ts` | Demonstration scaffold only. Its ID schemas (`ids.ts`), result shapes and `exportJsonSchema` are reused by the engine; its `worldStateSchema` is NOT extended. |

**Workers: do not "helpfully" unify these models.** Unification is an
explicit, owner-approved migration, one subsystem at a time.

## Two economy kernels (current, deliberate)

Two implementations of the accepted economy contract exist side by side. Both
are pure packages that the running game does not call yet. Nothing is deleted.

| | `packages/sim-core` | `packages/engine` |
|---|---|---|
| Resource model | the four commodity groups (`food/energy/materials/manufactures`) of the #32 baseline kernel | the accepted resource catalog and the `1 Coal + 1 Iron -> 1 Goods` chain of the resource extension |
| Remainders | `bigint`, per the literal spec | safe integers with an assertion, so state canonicalizes to JSON (canon 03) |
| Revisions | validates `expectedRevision` | content-addressed: sha256 of the canonical state |
| Replay / golden fixtures | — | byte-identical 12-turn replay, golden state/report/checksum chain |
| Ledger and report | contribution notions | ledger plus a markdown "why changed" report |
| Persistence | — | atomic per-turn run directories |
| CLI / dashboard | — | both (`npm run play:engine`) |
| Region transfer | implemented (`transfer.ts`) | not yet |

`first-economy-mvp.md` §3 is explicit that the #32 commodity grouping is an
implementation step and must not become the long-term domain model. The engine
implements the extension that replaces it, so **the engine is the direction of
travel** and stays the declared SSOT above.

Convergence, in this order, none of it silent:

1. Port the region-transfer semantics into the engine (its state already
   carries `controllerId`; the re-aggregation identities are specified in
   `first-economy-mvp.md` §7 and `sim-core/src/transfer.ts` is the working
   reference).
2. Harvest anything else sim-core proves better — its preview/resolver parity
   test is a good idea worth keeping.
3. Only then, and only on an explicit decision, retire sim-core. Until that
   decision it stays wired into `npm test` and must keep passing.

Workers: do not port engine features into sim-core, and do not unify the two on
your own initiative. Add new mechanics to the engine.

## Package layout

```
packages/domain      — shared ID brands, base command/result shapes (stable)
packages/data-packs  — ScenarioV2 validation/build + canonicalStringify (stable)
packages/sim-core    — #32 baseline economy kernel (kept, superseded in scope)
packages/engine      — deterministic economy engine (active development)
src/, server/        — live game (additive integration only; keep it running)
```

Dependency direction: `engine → domain, data-packs`. The engine imports
nothing from `src/`, `server/` or any AI module — enforced by the determinism
guard test and review.

## Integration path (after the headless slice)

1. Headless slice proves the engine (done — see canon 04).
2. Minimal dashboard UI reads engine run output (no model calls).
3. Free-text interpreter (LLM → typed commands, canon 07).
4. Live-game integration behind a scenario flag; legacy `impacts` path stays
   until the engine covers its scope.

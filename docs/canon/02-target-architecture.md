# 02 — Target architecture

Sources: `docs/product/README.md`, `docs/product/03-product-and-domain-spec.md`,
`docs/product/02-current-architecture-audit.md`. Owner decisions 2026-08-30.

> **Supersession note (2026-09-06):** canon 22 authorizes the hard cut from the
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
| **Engine state** (`WorldStateV2`) | `packages/engine/src/world/` | **Authoritative SSOT.** All new mechanics land here. |
| Legacy economy state (`EconWorldState`) | `packages/engine/src/state.ts` | Retired from the living-world path; retained only where offline historical audit tooling still names it. |
| Live app state (`world.json`) | `src/runtime/gameState.js` | Legacy, still runs the shipping game. Migrates to the engine incrementally. Do not add new numeric mechanics here. |
| Domain demo reducer | `packages/domain/src/reducer.ts` | Demonstration scaffold only. Its ID schemas (`ids.ts`), result shapes and `exportJsonSchema` are reused by the engine; its `worldStateSchema` is NOT extended. |

**Workers: do not "helpfully" unify these models.** Unification is an
explicit, owner-approved migration, one subsystem at a time.

## Retired economy baseline

`packages/sim-core` was the earlier #32 economy prototype. It was removed on
2026-09-06 under canon 22's authorised hard cut after an import/replay audit:

- no production source imported it;
- WorldStateV2 canonical validation and selector tests cover safe-integer
  boundaries, canonical ordering, determinism and immutable input boundaries;
- territorial-causality tests cover preservation of regional-local state and
  population re-aggregation across a transfer;
- process-kernel and living-store tests cover engine-owned funding/effect
  commitment and prohibit semantic input from rewriting numeric effects.

The active engine deliberately does not reproduce the prototype's four-bucket
monthly macro-economy. Its authoritative contract is WorldStateV2 plus the
bounded process/effect kernel, not a second accounting model.

## Package layout

```
packages/domain      — shared ID brands, base command/result shapes (stable)
packages/data-packs  — ScenarioV2 validation/build + canonicalStringify (stable)
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

# 02 — Target architecture

Sources: `docs/product/README.md`, `docs/product/03-product-and-domain-spec.md`,
`docs/product/02-current-architecture-audit.md`. Owner decisions 2026-08-30.

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
| Live app state (`world.json`) | `src/runtime/gameState.js` | Legacy, still runs the shipping game. Migrates to the engine incrementally. Do not add new numeric mechanics here. |
| Domain demo reducer | `packages/domain/src/reducer.ts` | Demonstration scaffold only. Its ID schemas (`ids.ts`), result shapes and `exportJsonSchema` are reused by the engine; its `worldStateSchema` is NOT extended. |

**Workers: do not "helpfully" unify these models.** Unification is an
explicit, owner-approved migration, one subsystem at a time.

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

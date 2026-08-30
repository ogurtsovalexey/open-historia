# My Open Historia — specification and roadmap

> **SUPERSEDED (2026-08-30):** this corpus is archived reference material.
> The binding, compressed source of truth is [`docs/canon/`](../canon/README.md).
> If this document and canon disagree, canon wins.

Status: research baseline v1
Prepared: 2026-08-29
Target: personal, single-player fork of Open Historia, while preserving a practical path for upstream updates.

## Executive decision

Do not rewrite the application in Kotlin, Java, or another stack now. Keep React, MapLibre, Electron, Node and Express, and migrate the code incrementally from JavaScript to TypeScript. The expensive and unreliable parts are AI context construction, underspecified world state, prompt growth, non-atomic multi-file commits, and map semantics—not JavaScript execution speed.

The product should evolve from “one LLM narrates a world and directly edits loosely related JSON” into:

```text
player command
  -> typed application command
  -> cost/precondition preview and validation
  -> deterministic simulation transaction
  -> atomic state transaction
  -> statistics/map/event projections
  -> optional AI strategy, diplomacy and narration around accepted state
```

The deterministic simulation becomes the game: population, economy, budget, production, logistics, armed forces and politics have persistent stocks, flows and rules. The LLM remains the creative strategist, diplomat and narrator, but it stops being the database, calculator, rules engine, memory system and UI translator simultaneously.

## Product principles

1. Player agency is inviolable. The simulation may create pressure and offers, but cannot sign, surrender, declare war or change the player's regime without an explicit player command.
2. State is truth; prose is a view. If the story says a region changed hands, a validated domain change must exist in the same committed event.
3. History must diverge causally. Real history is background, not a script that fires on calendar dates after the player changes its causes.
4. AI receives the smallest sufficient context, not the entire map and archive by default.
5. Every AI call is visible and configurable: purpose, model, reasoning, input sections, token budget, latency, retry and estimated/actual cost.
6. Difficulty changes opposition, uncertainty and consequences—not factual competence or arbitrary hostility in every sentence.
7. Legal sovereignty, effective control, occupation and claims are different fields.
8. Scenario authors describe a world through versioned data and rules; they should not have to fork a 28,000-character system prompt.
9. No full rewrite without a measured bottleneck and a migration path.
10. Single-player first: no microservices, distributed consensus or multiplayer abstractions until a real need appears.
11. AI may propose policies and bounded events, but only deterministic mechanics or an explicit GM override can change canonical statistics.
12. Every important number has units, date, provenance and a visible causal explanation.

## Documents

- [Research: Pax Historia and community feedback](research/01-pax-and-community.md)
- [Research: grand-strategy mechanics worth adapting](research/02-grand-strategy-mechanics.md)
- [Research: existing games and build-versus-buy scope check](research/03-existing-games-and-scope.md)
- [Current Open Historia architecture audit](02-current-architecture-audit.md)
- [Target product and domain specification](03-product-and-domain-spec.md)
- [AI orchestration, context and memory specification](04-ai-orchestration-spec.md)
- [Territories, map and scenario format](05-territories-and-scenarios.md)
- [Deterministic simulation core](06-simulation-core.md)
- [Implementation roadmap and acceptance gates](07-roadmap.md)
- [Global scenario development program: World 1916 and World 1797–1815](08-scenario-program.md)
- [ADR-001: language and runtime choice](decisions/ADR-001-language-and-runtime.md)
- [Source register](research/SOURCES.md)

## Baseline inspected

- Upstream repository: `Open-Historia/open-historia`, `upstream/main` at `a6315c6`.
- Personal implementation branch: `/Users/alexey/Projects/open-historia-memory`, commit `94b62ac`.
- Legacy campaign inspected for architectural evidence and migration regression only: Modern Day, Georgia, 2016-01-02, round 2.
- External research cutoff: 2026-08-29.

The personal branch already contains three useful experiments: evidence-backed campaign memory, non-blocking translation, and context/cost routing for diplomacy. The specification treats them as prototypes, not immutable architecture.

## Implementation log

| Roadmap item | Application commit | Status |
|---|---|---|
| M0: make the default test command cover server and client logic | `eebf766` | complete; 166/166 tests pass |

## Baseline verification

| Check | Result |
|---|---|
| `npm test` | 26/26 pass, but only `server/**/*.test.js` runs |
| all current server + source tests | 166/166 pass |
| ESLint | 0 errors, 1 unused-disable warning |
| Vite production build | passes |
| main application chunk | 1,141 kB minified / 364 kB gzip |
| MapLibre vendor chunk | 1,023 kB minified / 276 kB gzip |
| default jump prompt body | 27,944 characters before runtime context/directives |
| default leader prompt body | 13,908 characters before runtime context/directives |

## What “done” means for the first serious release

- A normal bilateral greeting makes one inexpensive diplomacy call and no next-speaker model call.
- A territorial negotiation automatically includes the exact relevant regions, control status, current war/treaty facts and promises, without dumping the whole world.
- The user can inspect why context was included and what every call cost.
- A 100-turn campaign retains active treaties, wars, promises, grievances and major divergences.
- A crash during a turn cannot leave the date, map, actions and timeline on different revisions.
- Historical scenarios distinguish recognized sovereignty, effective control, occupation, claims and front/control zones without flattening them into one owner color.
- Events cannot make binding decisions for the player.
- Scenario updates use schema migrations and do not silently keep obsolete prompt copies.
- A model/provider can be selected per task family, with safe capability-aware parameters.
- Population, output, budget, trade, equipment and losses come from conserved mechanics rather than generated prose.
- The same seed, scenario version and accepted actions reproduce the same mechanical campaign state.
- World 1916 simulates every polity at a declared fidelity; its first curated Russian campaign can reach materially different political transitions because of state and action, not mandatory February/October date triggers.
- World 1797–1815 runs every polity on the same kernel without importing modern finance, rail, aviation or stable nation-state assumptions; Europe is its first deeply curated theatre, not its world boundary.

The documents describe a north star. Implementation is gated by global baseline coverage plus a deep Russian vertical slice in World 1916 and a thinner continuously validating World 1797–1815 scenario. The first proves revolution, state continuity, war economy and civil conflict; the second prevents the shared engine from acquiring hidden modern-era or Eurocentric assumptions.

## Repository use

This corpus originated in a separate local Git repository and was imported at
commit `d943699`. The application repository is now canonical. Each roadmap
item should link to an implementation commit/PR and update its acceptance status
here. Import provenance is recorded in [IMPORT.md](IMPORT.md).

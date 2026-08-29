# Existing games and build-versus-buy scope check

Research date: 2026-08-29.

## Short answer

There are games that already implement most requested deterministic mechanics. None of the inspected options combines all of these at once:

- arbitrary historical/scenario start dates;
- natural-language actions and diplomacy;
- runtime generative AI that remembers the divergent campaign;
- accurate sovereignty/control and flexible map editing;
- real population/economy/logistics/military mechanics;
- low-micromanagement play;
- native macOS support and Russian interface.

The closest **currently playable Mac experiment** is `Global Protocol: New World Order`. It should be tested before committing to build a universal simulation core.

## Shortlist

| Game | Closest strengths | Material mismatch | Mac / Russian / state |
|---|---|---|---|
| [Global Protocol: New World Order](https://store.steampowered.com/app/4500270/Global_Protocol_New_World_Order/) | modern world, real-data pipeline, 4,600+ provinces, economy/budget/resources, formations/logistics, diplomacy, espionage, fog, modding | starts in 2026; no natural-language diplomacy/runtime generative narrative; historical-scenario depth/import limits unproven; early balance/bugs | macOS 12+, Russian UI; Early Access; 74% of 77 Steam reviews at research date |
| [Geo-Political Simulator 2026](https://store.steampowered.com/app/4021780/GeoPolitical_Simulator_2026_Edition/) | extremely broad modern political/economic/social/transport simulation; head of state or opposition; native Apple Silicon | annual/current-world product, dense/clunky UI risk, no freeform historical AI; weak user score and higher price | macOS 13+ Apple Silicon; Steam lists Mixed 49% of 241; Russian not listed in inspected language table |
| [Europa Universalis V](https://www.paradoxinteractive.com/media/press-releases/press-release/paradox-interactive-sets-date-for-europa-universalis-v) | deep population by culture/religion/social position, goods/production/trade, government/estates, characters and population-based military; 1337–1837 | no 1917/modern era, no natural-language AI, deliberately very complex, fixed game-era assumptions | inspected Steam requirements list Windows; Russian UI; Mixed 69% English reviews at research date |
| [Supreme Ruler 2030](https://store.steampowered.com/app/2093410/Supreme_Ruler_2030/) | any modern nation, battalion equipment, production/supply, trade, espionage, cabinet automation | military-heavy, Windows-only, no natural-language narrative or arbitrary eras | Windows; no Russian in inspected table; Mixed 65% of 530 |
| [Terra Invicta](https://store.steampowered.com/app/1176470/Terra_Invicta/) | deep geopolitical influence, population/economy/research, intelligence and long-horizon AI strategy | sci-fi/faction premise, space becomes the main game, not direct nation/alternate-history sandbox; high complexity | Windows in inspected requirements; Russian; 82% English reviews |
| [Global Supremacy](https://store.steampowered.com/app/4808500/Global_Supremacy/) | advertised systems closely match the proposed economy, infrastructure, terrain, forces, politics and logistics | not released; claims cannot yet be validated; Windows-only listed | planned 2026, no reviews |

## Most important finding: Global Protocol

The store page describes a design unexpectedly close to our current north star:

- real-world GDP/population/military/resources processed by deterministic pipelines;
- economy, inflation, trade, budgets and construction;
- land/sea/air units, manpower, fuel and logistics;
- diplomacy, international organizations, espionage and fog of war;
- 4,600+ provinces, modding and Russian UI;
- macOS support for Apple Silicon and Intel;
- no generative model at runtime.

This makes it an excellent paid prototype/reference at roughly €20.49 on the inspected store page. It is not automatically a replacement. Early reviews praise potential/economic breadth but also report insufficient tutorial/context, shallow areas such as demographics/migration/foreign policy, bugs and balance problems for smaller states. It also lacks Open Historia's defining freeform historical conversation and presently focuses on 2026.

## Decision before major implementation

Run a structured comparison playtest, not an impulse purchase verdict:

1. test representative economy, logistics, politics and small-state play for at least three in-game years;
2. test economy/budget/trade, mobilisation/logistics, diplomacy, leader/politics and a small-state path;
3. record number of routine clicks and moments where the game cannot express a desired policy;
4. inspect modding/export capabilities and whether scenario dates/map data are extensible;
5. compare those gaps against Open Historia's unique strengths;
6. refund within the platform window if the first two hours reveal fundamental incompatibility.

The playtest does not authorize copying proprietary data, formulas or code.

## Revised product boundary

The specification remains a **north-star architecture**, not a commitment to build every subsystem before playing again.

The differentiated product should be:

> A flexible alternate-history statecraft sandbox where natural-language intent and living AI diplomacy operate on a small, trustworthy mechanical core, with deep scenario-specific modules only where they create meaningful choices.

The first build should not be “Europa Universalis for every era.” It should prove:

- canonical leaders/relations/agreements/control;
- a sourced population, war-economy, public-finance, transport and armed-force state for the curated Russian path in World 1916;
- playable global baselines for every polity plus a thin World 1797 skeleton that rejects hidden modern-era and Eurocentric assumptions;
- a small number of deterministic causal loops;
- relevant transport corridors/terrain in the active theatre;
- state-grounded AI diplomacy and narration;
- intent/package/exception UX with little routine clicking.

Global world depth can remain coarse outside the active theatre. Religion, detailed industry, combat, intelligence and historical-era modules enter only after the first slice is fun.

## Build, buy or hybrid

### Buy/play only

Choose this if `Global Protocol` or another existing game satisfies the actual experience. This avoids years of engine/data/balance work.

### Continue the focused Open Historia fork

Choose this if the essential value is freeform language, arbitrary scenarios and emergent diplomacy. Build only enough mechanics to make AI outcomes honest and consequential.

### Hybrid companion/mod

Potentially attractive: use an existing deterministic game as the engine and add an external conversational layer. This is viable only if it exposes a stable, permitted save/mod/API contract. Screen scraping, memory modification or brittle save rewriting is not an acceptable architecture. No inspected option has yet demonstrated the required runtime integration surface.

## Scope guardrail

No new major system moves from specification to implementation unless it answers all four questions:

1. Does the World 1916 Russian path need it now, or does World 1797/global baseline coverage need it to validate the shared abstraction?
2. Does an existing tested game already solve the user's actual need well enough?
3. Can it be controlled through goals/policies/exceptions rather than repetitive clicking?
4. Is there a concrete acceptance test and data source?

If not, keep it as an extension point or future module.

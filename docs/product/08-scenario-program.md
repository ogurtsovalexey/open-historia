# Global scenario development program: 1916 and 1797–1815

## Decision

The product will be designed and debugged against two curated historical scenarios from the beginning:

1. **Primary development scenario:** the whole world starting in 1916. Russia is the first deeply curated player country, with the first complete authored and tested arc covering the revolution and civil-war transition. The campaign itself must not be forced to end on the historical date.
2. **Parallel compatibility scenario:** the whole world starting provisionally on 1797-01-01, with the European coalition/Napoleonic theatre calibrated in depth through 1815-12-31 and every other world region present and simulated.

Georgia 2016 is not a product vertical slice. It remains only an inspected legacy-save/audit fixture where useful for migrations and regression tests.

The two scenarios are not late content packs. Their schemas, data uncertainty and historical forks constrain the engine design from the start. Detailed content production can proceed later and in parallel once the relevant shared mechanics stabilize.

## Global scope and variable fidelity

A scenario is a dated world state, not one playable country surrounded by static scenery. Every scenario must contain:

- all polities, dependencies, colonies, relevant non-state authorities and territorial control at the start date;
- a playable national baseline for population, economy/public finance, government, military capacity, technology, relations, conflicts and agreements;
- global diplomacy, trade, migration, war and information links;
- deterministic advancement for every polity, including those outside the current camera or AI context;
- the ability to select any valid playable polity, subject to a visible content-quality rating.

Global coverage does not require false equal precision. Content has three declared fidelity levels:

| Level | Contract |
|---|---|
| `Baseline` | Sourced or explicitly estimated national totals, government/leader, territory/control, relations, essential economy and military capacity; fully simulated and selectable, but with coarse regional and faction detail. |
| `Supported` | Reconciled regional allocation, strategic transport/resources/formations, key institutions and calibrated pressures; suitable for a serious campaign. |
| `Curated` | Detailed source review, scenario-specific actors/actions, golden paths, AI evaluations and balance/playtesting. |

Russia begins as `Curated` in World 1916. Major WWI actors begin at least `Supported`; every other polity must reach `Baseline` before the scenario is called playable. In World 1797, the principal coalition powers and affected European/Mediterranean actors lead curation, while the rest of the world still advances and influences trade, colonies, naval power and diplomacy.

Changing focus never permits the LLM to invent missing detail. Refinement uses versioned source data and must conserve the existing national totals; otherwise the polity remains honestly marked at its current fidelity.

## Why this pair is useful

Russia 1916 stress-tests:

- a state already participating in an industrial mass war;
- inflation, shortages, public finance, grain procurement and rail bottlenecks;
- legitimacy, elite conflict, mass politics and collapsing administrative capacity;
- army cohesion, desertion, mobilisation and the relationship between front and rear;
- leader removal, abdication, provisional authority and competing claims to sovereignty;
- movements becoming governments, dual power, secession, civil war and foreign intervention;
- extreme historical uncertainty where a scripted event chain would destroy player agency.

Europe 1797–1815 stress-tests:

- dynastic and revolutionary legitimacy existing at the same time;
- coalitions, separate peace, client states, annexation, occupation and changing borders;
- pre-industrial taxation, debt, requisition, trade and limited administrative reach;
- manpower, conscription, professional forces, mobilisation systems and doctrine change;
- naval blockade, ports, merchant access and overseas dependencies;
- generals and rulers whose political and military roles interact;
- a long transformation in institutions, nationalism and warfare without modern assumptions.

If one common kernel supports both honestly, it is much less likely to contain hidden assumptions about NATO, fiat currencies, modern ministries, air forces or stable nation-states.

## Shared core versus era modules

| Shared canonical system | 1916 configuration/module | 1797–1815 configuration/module |
|---|---|---|
| Persons, offices and authority | emperor, ministers, Duma, movements, soviets, provisional and revolutionary bodies | monarchies, directories, consulates, ministries, estates and client-state offices |
| Population groups | class/occupation, nationality, religion, urban/rural, mobilisation status | estate/class, language/culture, religion, legal status, urban/rural |
| Production and public finance | war industry, grain/fuel, inflation, state borrowing and requisition | agriculture, workshops, arsenals, customs, debt, subsidies and requisition |
| Transport graph | rail-heavy strategic throughput, ports, rivers and winter roads | roads, rivers, canals, ports and sea lanes; early rail is absent |
| Armed forces | mass armies, fronts, reserves, artillery, machine guns and limited aviation | formations, manpower systems, horses, artillery, sailing fleets and doctrine |
| Diplomacy and agreements | alliance obligations, armistice, recognition, intervention and national movements | coalitions, guarantees, subsidies, separate peace, client states and dynastic settlements |
| Political stability | legitimacy, supply crisis, war weariness, institutional authority and movement support | legitimacy, taxation, occupation, war weariness, revolutionary pressure and elite loyalty |
| Technology/doctrine | industrial capacity, communications and late-WWI doctrine | administrative/military reforms, mass conscription, staff systems and naval doctrine |

An era module may define institutions, resource vocabulary, available commands, formulas and UI projections. It cannot bypass common ledgers, event validation, provenance, replay or AI authority boundaries.

## Scenario A: World 1916, first curated path Russia

### Scope and dates

- provisional start date: `1916-01-01`;
- every valid polity is selectable; Russian Empire is the first `Curated` seat and reference campaign;
- first complete validation window: from start through the end of the revolutionary and civil-war transition;
- no historical event is guaranteed and no historical successor appears solely because a date was reached;
- every polity receives a simulated baseline; the Eastern Front, Russian dependencies and major belligerents receive the first supported/curated regional detail.

The exact start date may be revised after source and gameplay review, but it must precede the decisive 1917 institutional crisis by enough time for player policy to alter its causes.

### Starting-state data packs

The scenario requires dated, sourced and uncertainty-aware records for:

- administrative regions, effective control, fronts and occupation;
- population by region and the social dimensions actually used by mechanics;
- grain, coal, oil, metals, industrial capacity and essential military production;
- budget, revenue classes, debt, money/inflation indicators and war expenditure;
- rail corridors, gauges, major junctions, ports, navigable rivers and strategic roads;
- formations, personnel ranges, equipment pools, readiness, replacement and supply systems;
- emperor, government, State Duma, senior commanders, succession rules and political movements;
- Entente/Central Power commitments, trade access, loans and major diplomatic constraints;
- calibrated structural pressures at the start date.

Numbers with incompatible historical estimates are stored as an observation range plus chosen scenario estimate and rationale. False precision is a validation warning.

### Structural pressures, not scripted revolutions

The scenario begins with pressures such as:

- war losses and mobilisation burden;
- food availability versus procurement, transport and urban distribution;
- inflation and fiscal/monetary strain;
- elite confidence and government effectiveness;
- popular legitimacy, repression and protest organisation;
- garrison/front-line cohesion and officer/enlisted relations;
- land and nationality questions;
- alliance commitments and military position.

These pressures feed generic mechanics. They can produce protest, mutiny, cabinet crisis, reform, coup, abdication or revolution only when conditions and actors support them. Historical names and plans may influence NPC choices, but February and October are not calendar triggers.

### Authority and state transformation

`Polity`, `Government`, `Office`, `Movement`, `Organization` and `TerritorialControl` remain separate entities. A political movement does not become the state because narration says so.

A regime transition is a validated transaction containing:

- initiating cause and legal/extralegal mechanism;
- offices vacated, retained or disputed;
- claimant authorities and their institutional support;
- military, regional and administrative allegiance changes;
- continuity or repudiation of agreements, debt and commands;
- treasury, archives, depots and communication control;
- domestic and foreign recognition;
- immediate uncertainty and follow-up choices.

The player may abdicate, dismiss a government, accept constitutional limits or resign from a valid office, but the engine resolves succession and reactions. The player cannot type “the emperor died” or “all soviets recognize me” as an authoritative fact.

### Required playable divergence families

The alpha does not need every imaginable path, but the mechanics must permit at least:

1. attempted imperial stabilization through administrative, supply and political reform;
2. harder authoritarian stabilization with explicit costs and resistance;
3. constitutional transfer of power with contested but mechanically traceable legitimacy;
4. provisional/republican authority and competition with mass organizations;
5. one or more revolutionary seizures of authority;
6. negotiated, fragmented or military civil conflict;
7. national-territorial autonomy, secession or federation negotiations;
8. continued war, separate peace or altered alliance participation.

These are outcome families, not mission-tree branches. The player and NPCs create them through commands and state changes.

### First headless fixtures

Before the full map/UI is ready, maintain deterministic fixtures for:

- one quiet month with accounting reconciliation;
- a rail disruption reducing urban food delivery and front supply;
- a budget choice between military supply, transport repair and urban relief;
- a cabinet dismissal and legal successor appointment;
- an attempted fabricated leader death rejected by validation;
- a protest escalating or de-escalating under different policies;
- an army formation changing allegiance only through resolved authority/cohesion rules;
- a peace proposal with alliance, front and domestic consequences.

## Scenario B: World 1797–1815, first curated theatre Europe

### Scope and dates

- provisional start date: `1797-01-01`;
- authored validation horizon: through `1815-12-31`;
- every valid polity is selectable, initially curated around France, Britain, Austria, Prussia and Russia, plus the states and dependencies necessary to make their diplomacy and wars coherent;
- colonial and global theatres begin at least at `Baseline`; strategically relevant ports, colonies, trade, naval routes and non-European powers receive `Supported` detail rather than being reduced to modifiers.

### Essential period systems

- coalition membership and war goals distinct from permanent alliances;
- subsidies, loans, guarantees, access, separate peace and congress settlements;
- occupation, annexation, client states and administrative reorganization;
- dynastic, legal, revolutionary and popular sources of legitimacy;
- conscription/recruitment systems, manpower pools, horses, artillery and supply;
- commander seniority, competence, loyalty and political standing without hero determinism;
- road/river/port/sea-lane logistics and seasonal campaigning;
- sailing-fleet readiness, blockade, convoy/merchant access and port capacity;
- war exhaustion, taxation, requisition, local resistance and administrative reach;
- gradual military/administrative doctrine diffusion rather than a generic modern tech tree.

### Required divergence tests

- France can retain, replace or transform the Directory through validated politics; a specific coup is not inevitable;
- coalitions form from interests, threat, commitments and bargaining rather than scripted membership;
- a defeated state can negotiate territorial, financial, military and recognition terms separately;
- occupied/client territories retain local capacity, resistance and legitimacy rather than becoming a flat map color;
- naval blockade changes trade and fiscal/war capacity through routes, not a prose modifier;
- the 1815 settlement reflects the campaign state and cannot simply restore the historical borders.

## Parallel production workflow

Scenario work proceeds in thin, reviewable layers:

1. **Schema fixture:** valid manifest, stable IDs, calendars, map reference and empty required ledgers.
2. **Political skeleton:** polities, offices, governments, movements, relations, conflicts and agreements.
3. **Geographic skeleton:** regions, control, fronts, physical map and transport graph.
4. **Reconciled national totals:** population, public finance, essential production/trade and armed forces.
5. **Regional allocation:** only at precision supported by sources and gameplay need.
6. **Structural pressures and reference series:** explicit assumptions, uncertainty and invalidation rules.
7. **Headless golden paths:** deterministic commands, expected invariants and broad calibration bands.
8. **AI evaluation transcripts:** historical voice, context selection, tool validity, agency and cost.
9. **Playable slice:** dashboards, map modes, exception inbox and scenario-specific actions.
10. **Content expansion:** more actors, regional detail, events and alternative starts.

World 1916 with Russia leads each engine capability. World 1797 follows one thin layer behind and must expose modern-era assumptions early. It must not block every primary-scenario commit, but no shared API is declared stable until both global scenario skeletons validate against it.

## Scenario repositories and versioning

Use separate versioned packages under the application repository initially:

```text
scenarios/
  world-1916/
    manifest.json
    data/
    localization/
    sources.json
    assumptions.md
    tests/
  world-1797/
    manifest.json
    data/
    localization/
    sources.json
    assumptions.md
    tests/
```

Shared historical/map datasets are content-addressed dependencies, not copied into both packages. Scenario commits record schema version, source vintage and migration. A scenario update never silently changes an existing campaign; the user chooses migration or keeps the pinned content version.

## AI role in scenario production and play

AI may help draft source mappings, descriptions, NPC plans and localization, but generated content remains `Draft` until validated. During play it may:

- infer plausible NPC intent from canonical state;
- conduct diplomacy in period-appropriate language;
- propose bounded events and actions;
- summarize causal mechanical changes;
- flag missing or contradictory source data.

It may not create starting numbers, transfer control, alter allegiance, kill or appoint people, sign agreements, spawn formations or resolve combat through prose. All such effects use typed commands and deterministic or explicitly reviewed resolution.

## Acceptance gates

### Scenario skeleton gate

- both manifests and political/geographic skeletons validate;
- no shared schema field assumes a modern institution or technology;
- every canonical record has provenance or an explicit scenario assumption;
- both packages load without any LLM call.

### World 1916 / Russia simulation alpha

- twelve months can run headlessly with reconciled population, budget, production, transport and military ledgers;
- supply and political pressures respond causally to player policy;
- at least three materially different authority-transition paths work without scripted dates;
- save/replay is deterministic and AI cannot mutate protected state.

### World 1797–1815 compatibility alpha

- the same kernel runs without modern finance, rail, air-power or nation-state assumptions;
- coalition diplomacy, occupation, blockade and pre-industrial logistics have executable tests;
- a multi-year campaign can diverge without historical event forcing.

### Dual-scenario beta

- both scenarios are playable through goals/policies/exceptions rather than constant low-level clicking;
- model context is assembled from the active theatre and mechanic, not the full world dump;
- historical outcomes are plausible reference paths but mechanically avoidable;
- scenario authors can extend data and events without changing engine code.

## Explicit scope control

- Do not call a scenario playable until every polity has the global `Baseline`; do not require equal subregional precision before the curated Russian theatre reconciles.
- Do not build tactical battle simulation; resolve operations from formations, plans, terrain, logistics, morale and uncertainty.
- Do not model every commodity, social faction or road—only categories with causal gameplay value.
- Do not use event trees to compensate for missing institutions or ledgers.
- Do not delay World 1916 until all World 1797 curated content is complete; keep the second scenario as a continuous global/era compatibility test.
- Do not call a scenario “historical” when its critical values have no cited source, range or declared assumption.

# Implementation roadmap and acceptance gates

## Roadmap intent

This is an implementation order, not a wish list. The project should become playable after each milestone while replacing risky internals incrementally. The critical path is:

```text
measurement and safe persistence
  → typed IDs/events/units
  → deterministic simulation kernel
  → World 1916 Russia/Germany/Britain slice + World 1797 compatibility skeleton
  → state-grounded AI and diplomacy
  → logistics/combat and world depth
  → scenario platform and content
```

Rewriting the UI or changing language before the state model exists would only move the current ambiguity into new files. Keep TypeScript/Node/React/Electron per [ADR-001](decisions/ADR-001-language-and-runtime.md), with a pure simulation package and worker boundary.

This roadmap is a north-star dependency map, not authorization to implement every milestone. Both scenario packages represent the entire world and simulate every polity at least at a declared baseline fidelity. The first World 1916 curation wave is Russia, Germany and Britain; later waves are defined in the [scenario program](08-scenario-program.md). World 1797–1815 follows in parallel as a global and era-compatibility test. Every wider system must pass the scope guardrail.

## Milestone -1 — build-versus-buy decision

Goal: determine whether an existing game already satisfies the desired experience and identify only the gaps worth building. The decision is now to build the focused Open Historia fork; commercial games remain references, not blockers.

### M-1.1 Global Protocol comparison — P2 / S

- optionally test its native Mac/Russian build for economy, logistics and UX references, subject to normal purchase/refund judgment;
- score economy, budget, trade, demographics, politics, diplomacy, forces, logistics, small-state balance and routine click burden;
- inspect only documented mod/export surfaces;
- record which Open Historia capabilities remain unique: arbitrary eras, natural language, stateful generated diplomacy and scenario flexibility.

Acceptance:

- a written keep/buy/build decision and gap list;
- no subsystem enters implementation merely because another grand-strategy game has it;
- reference findings are recorded without changing the two-scenario product decision unless they reveal a materially better permitted integration path.

## Priority definitions

- **P0**: correctness, data-loss, uncontrolled cost or architecture prerequisite;
- **P1**: required for the first serious playable simulation;
- **P2**: substantial quality/depth after the vertical slice works;
- **P3**: optional expansion or polish.

Complexity is relative engineering size for one experienced developer with AI assistance, not a calendar promise:

- S: contained change with existing boundaries;
- M: multiple modules/schema/tests;
- L: new subsystem and migration;
- XL: milestone-sized domain requiring iterative balancing.

## Global completion rules

An item is complete only when:

1. runtime schema, migrations and stable IDs exist where data changes;
2. automated unit/invariant tests pass;
3. a save/reload/replay test covers the change;
4. UI state comes from canonical data rather than separately maintained text;
5. relevant AI tools cannot bypass the new rule;
6. diagnostics explain failures and meaningful state changes;
7. documentation and scenario/data version are updated;
8. baseline performance and AI-cost budgets do not regress without an explicit decision.

## Milestone 0 — freeze a measurable baseline

Goal: make the existing application safe enough to change and make every expensive/slow operation observable.

### M0.1 Repository and CI hygiene — P0 / S

- rename this specification repository branch to `main` and make the initial research/spec commit;
- record application fork/upstream remotes and baseline commits;
- change the application test command so all current server and source tests run, not only `server/**/*.test.js`;
- add CI for tests, lint, build and scenario/schema validation;
- record target Mac model/OS/Node version for benchmarks;
- add fixture copies of a small and long campaign with secrets removed.

Acceptance:

- one command runs the complete test suite;
- CI fails on a broken schema/migration/build;
- baseline build sizes, load time, memory and turn cost are stored as artifacts.

### M0.2 AI call ledger and inspector foundation — P0 / M

Create one call registry around every provider call. Record task kind, provider/model, reasoning, parameters, context manifest, estimated/reported tokens, cache hits, cost, latency, retry/fallback lineage and cancellation. Redact credentials and private reasoning.

Immediate optimizations:

- deterministic next speaker when only one participant is eligible;
- no AI translation for already localized/static UI strings;
- block duplicate in-flight translation requests;
- label the current `reasoning` setting as a task/profile parameter, not a Grok-specific global truth;
- expose a stop/cancel action that actually aborts the provider request where supported.

Acceptance:

- a bilateral chat with only one eligible respondent uses no next-speaker model call;
- opening settings produces zero translation calls;
- every visible AI result links to one call record;
- a cancelled request cannot later commit state;
- the user can export a redacted diagnostic bundle.

Relevant upstream evidence: issues requesting logs/context inspection/cancellation and the observed Grok calls in the architecture audit.

### M0.3 Atomic persistence and recovery — P0 / L

- add monotonically increasing world revisions;
- write temp files + fsync/close + atomic rename for durable artifacts;
- introduce a transaction/journal record covering date, world, events, actions and chats;
- reject commits whose base revision is stale;
- create snapshot before/with commit, not as an unrelated best-effort afterthought;
- add crash injection tests between every persistence phase;
- preserve current saves through an idempotent migration.

Acceptance:

- forced process termination at any injection point loads either the complete old revision or complete new revision, never a mixture;
- rollback restores map, date, ledgers, chats and event history together;
- two concurrent commits cannot silently overwrite each other.

## Milestone 1 — typed domain foundation

Goal: create the stable substrate required by both mechanics and AI.

### M1.1 TypeScript package boundaries — P0 / L

Create packages gradually around existing code:

- `domain`: IDs, dates, units, commands, events and schemas;
- `sim-core`: pure tick systems and seeded RNG;
- `data-packs`: import/provenance/validation;
- `ai`: profiles, adapters, context manifests and tool schemas;
- server persistence/application services;
- desktop projections/components.

Migrate touched files to strict TypeScript. Do not convert 50,000 lines mechanically. New authoritative modules must not import React/Electron.

Acceptance:

- simulation tests run headlessly under Node;
- domain package has no UI/provider dependency;
- type checking is a separate required CI step;
- no cyclic package dependency.

### M1.2 Stable identity and schema v2 — P0 / XL

- stable IDs for polities, people, offices, terms, regions, control zones, formations, conflicts, agreements, projects and events;
- alias/localized-name tables with validity dates;
- runtime schemas and explicit schema version;
- migration from country-name keys and current world files;
- deterministic name resolver used only for import/repair;
- import collision report rather than fuzzy silent merge.

Acceptance:

- renaming a country/leader in Russian or English changes no references;
- a fuzzy region mismatch cannot transfer an entire country;
- all fixture saves migrate twice with the second pass producing no change;
- invalid references fail before commit with a specific path.

### M1.3 Command/event/reducer model — P0 / XL

- validated commands express intent;
- domain events express accepted facts;
- pure reducers create next state;
- narrative/map/statistics are projections from events/state;
- explicit GM override command and audit trail;
- deterministic seeded random draw service with stable draw IDs;
- pending transaction supports event reveal/intervention.

Acceptance:

- replay from snapshot + events matches stored state checksum;
- AI prose alone changes nothing;
- accepted event and narrative cannot disagree on date/actor/control/value;
- player-agency invariants reject surrender, declaration of war, regime change or resignation unless explicitly intended.

### M1.4 Relations, agreements, conflicts and projects — P1 / L

Implement canonical state before better memory:

- bilateral relation dimensions and evidence;
- proposals/promises versus accepted agreements;
- wars/sides/aims/fronts;
- scheduled projects and reserved resources;
- contradiction and expiry rules.

Acceptance:

- a diplomatic sentence cannot silently activate a treaty;
- a successor government retains polity obligations while leader-personal promises remain distinguishable;
- active commitments are queryable without reading chat summaries.

## Milestone 2 — data and simulation kernel

Goal: establish real numbers and conserved mechanics before adding more narration.

### M2.1 Data-pack toolchain — P0 / XL

- source registry with licensing, vintage, retrieval date and checksum;
- parsers for selected UN/IMF/World Bank/SIPRI/Comtrade/FAOSTAT/EIA inputs;
- ISO-to-stable-ID mapping and historical polity mapping;
- unit, currency and constant-price harmonization;
- gap/imputation recipes with quality/confidence;
- national-to-region allocation rules and residual buckets;
- reproducible build command producing signed/checksummed data pack;
- offline pack bundled/installed separately from raw downloads where license requires.

Acceptance:

- every starting statistic can answer “source, date, unit, transformation, confidence”;
- no game start or turn requires internet/statistical API access;
- pack rebuild from pinned inputs is byte-reproducible or explains nondeterministic metadata;
- contradictory totals fail or create an explicit discrepancy, never silently overwrite.

### M2.2 Simulation clock, units and ledgers — P0 / L

- daily/monthly/annual event scheduler;
- fixed-point money/quantity types;
- population, fiscal, inventory, equipment and migration ledgers;
- dependency-ordered system scheduler;
- deterministic batch/coarse tick equivalence tests;
- worker-thread execution and progress/cancellation for long advances.

Acceptance:

- same seed/actions/data pack yield identical checksums;
- all conservation/accounting property tests pass;
- renderer remains responsive during a ten-year headless advance;
- cancelling before commit leaves canonical state untouched.

### M2.3 Demography — P1 / L

- national/region population and age bands;
- births, natural deaths, labour force and employment link;
- migration, refugees and internal displacement;
- sparse scenario-relevant population groups for occupation/skill, culture/language, religion, legal status and living conditions;
- law-mediated acceptance/discrimination and gradual integration/conversion/secularization hooks;
- civilian/military casualty integration;
- uncertainty-aware display and subnational residuals.

Acceptance:

- regional and national populations reconcile;
- population changes are fully decomposable;
- mobilisation and casualties affect labour/demographics once, not twice;
- population-group totals reconcile and no one-click policy erases an identity;
- ten-year idle runs stay within calibrated scenario ranges.

### M2.4 Economy, budget and trade — P1 / XL

- sector output/capacity and employment;
- strategic-goods input bottlenecks;
- consumption/investment/government/trade accounting;
- price baskets, shortages, inflation and exchange/external constraint at initial abstraction;
- tax collection, spending, cash, debt, interest and default thresholds;
- partner/commodity/route trade flows and sanctions;
- causal contribution ledger.

Acceptance:

- GDP, budget, debt and inventory identities reconcile within declared tolerances;
- embargo, damaged route, mobilisation and budget policy produce traceable cross-system effects;
- no AI field can directly set an economic total;
- every dashboard change has a “why” breakdown.

### M2.5 Resources, energy, infrastructure and projects — P1 / XL

- resource nodes/extraction, strategic inventories;
- power/fuel availability;
- dated multimodal transport graph with explicit nodes/corridors between regions/countries;
- roads, railways, ports, border crossings, gauge/transshipment, bridges/tunnels and route capacity/utilization;
- terrain/season/weather data and fortification assets/coverage;
- immutable versioned elevation/mountain/river/lake/coast/land-cover geodata pack;
- mutable bridge, tunnel, dam, canal, levee and ferry assets layered over physical geography;
- construction/repair capacity;
- project prerequisites, resource reservation, progress and completion;
- damage and repair effects.

Acceptance:

- a project cannot complete without elapsed time and inputs;
- route loss can reduce trade/front supply without changing legal sovereignty;
- mountain pass, damaged bridge, closed border or rail-gauge break appears as the actual route bottleneck;
- transport/fortification vector layers render by zoom without loading the full raw network into the UI;
- ordinary turns cannot mutate mountains/rivers; engineered projects change only validated connections/capacities and authored reservoir/navigation effects;
- destroyed capacity and repaired capacity reconcile through events;
- discovered resource uncertainty becomes a sourced observation revision.

### M2.6 Historical context and structural pressures — P1 / L

- scenario starting conditions include inherited policies, projects, sanctions, debt, capacity and momentum;
- versioned reference world series for relevant commodity, technology and financial conditions;
- conditional structural pressures with prerequisites/drivers/invalidation;
- reference baseline forecasts displayed only as comparison;
- user/NPC actions alter exposure and future prerequisites.

Acceptance:

- reaching a historical date alone never forces its real event;
- unchanged fixtures roughly follow calibrated reference bands;
- material player divergence changes later economic and political outcomes;
- every exogenous input has a source/vintage/uncertainty and can be overridden by scenario divergence.

## Milestone 3 — dual global-scenario foundation and World 1916 wave-one alpha

Goal: prove the shared architecture with global baseline coverage, curated Russia/Germany/Britain starting states and a thinner World 1797 skeleton that continuously detects modern-era and Eurocentric assumptions.

### M3.1 Historical geography and scenario skeletons — P0 / L

- create schema-valid `world-1916` and `world-1797` packages;
- assign every polity a visible `Baseline`, `Supported` or `Curated` content rating;
- sovereignty/controller/occupation/claim/front-zone model;
- dated administrative boundaries, control and relevant theatres;
- immutable terrain/hydrography plus period-appropriate transport graphs;
- political skeleton: polities, governments, offices, movements, relations, agreements and conflicts;
- map modes, legend, source/uncertainty tooltip and effective-control semantics.

Acceptance:

- both scenarios load and validate without an LLM call;
- every polity has the minimum playable global baseline and advances when off-screen;
- a shared schema can represent imperial, revolutionary, dynastic and client-state authorities without name-as-ID tricks;
- partial occupation/front zones do not rewrite stable administrative IDs;
- 1797 validation rejects rail, aviation or modern-institution defaults unless explicitly enabled;
- AI receives only relevant status geometry/IDs during negotiation.

### M3.2 Russia 1916 starting state and reference pressures — P1 / XL

- researched national/regional demographics, war economy, budget/debt/money conditions, grain/fuel/industrial production and trade/access;
- rail, port, river and strategic-road corridors with capacity ranges and bottlenecks;
- armed forces at the minimum resolution needed for front supply, mobilisation, replacement and cohesion;
- emperor, government, Duma, senior command, political movements and succession/authority rules;
- Entente/Central Power commitments and surrounding actors at enough resolution for war and diplomacy;
- explicit uncertainty for incompatible estimates and no fabricated exact equipment figures;
- calibrated starting pressures for supply, inflation, legitimacy, war weariness, administration and political organization.

Acceptance:

- scenario validation has no unexplained core-state gaps;
- source review report covers all P1 observations and assumptions;
- the starting dashboard reconciles national totals, control, budget and key physical flows;
- a zero-action year produces plausible, explainable movement rather than static stats or a forced 1917 script;
- reaching a historical date alone never causes revolution, abdication or a specific successor.

### M3.3 First policies, ledgers and dashboard — P1 / XL

Implement a coherent set rather than dozens of shallow buttons:

- taxation/borrowing/money and spending priorities;
- grain procurement, urban supply and price/distribution policy;
- rail allocation, repair and strategic infrastructure projects;
- mobilisation, training, replacement, maintenance and procurement priorities;
- war aims, alliance obligations and peace feelers represented through commitments;
- cabinet, Duma, reform, repression and movement-engagement choices;
- national dashboard, front/rear dependency view, exception inbox and “why changed” inspector.

Acceptance:

- each action previews resources, time, risks and ambiguity;
- actions interact through canonical mechanics;
- the player can advance at least twelve months without an LLM maintaining numbers;
- materially different policies alter 1917 pressures without selecting a scripted branch;
- save/load/replay preserves all charts and ledgers.

## Milestone 4 — leaders, politics and government continuity

Goal: make people and regime transitions mechanically meaningful without allowing arbitrary generated deaths or replacements.

### M4.1 Persons, offices and succession rules — P1 / L

- person, office, office-term and government entities;
- election/appointment/term/resignation/incapacity/death/coup commands;
- constitutional/dynastic/movement succession rules;
- eligible candidate and acting-office logic;
- historical timelines as conditional anchors;
- unsupported death/removal claims become rejected facts or rumours.

Acceptance:

- one office cannot accidentally have two holders;
- model prose cannot kill or replace a person;
- valid death/removal resolves a successor or explicit vacancy state;
- changed alternate-history conditions invalidate automatic historical succession.

### M4.2 Leader standing and polity reputation — P1 / L

- domestic approval, elite support, legitimacy, personal authority and scandal;
- bilateral treaty reliability, trust, threat perception and credibility;
- country versus leader reputation separation;
- action/evidence-derived deltas and information visibility;
- successor inheritance rules for obligations, institutions and personal relationships.
- parties/estates/military/business/labour/religious/regional interests with constituencies and resources;
- laws and implementation capacity governing political, citizenship, language and religious treatment;
- visible escalation path from grievance/movement to severe crisis.

Acceptance:

- every reputation delta references recorded behaviour;
- cabinet turnover does not erase state treaties or debt;
- foreign dialogue reflects leader/polity distinction;
- propaganda can alter perceived standing without rewriting true hidden facts.
- culture/religion differences affect politics through law, institutions, material conditions and history rather than automatic unrest modifiers.

### M4.3 Player resignation experience — P1 / M

- distinguish hypothetical/private/formal resignation;
- irreversible-action confirmation and effective date;
- constitutional forecast and uncertainty preview;
- succession event chain and reactions;
- polity-continuity, person-continuity and ask-at-transition play modes;
- impact scales from routine handover to personalist succession crisis.

Acceptance:

- a casual sentence cannot accidentally end a term;
- confirmed resignation is a first-class timeline event with state consequences;
- stable parliamentary and personalist wartime fixtures produce materially different transitions;
- diplomacy/projects/policies update through explicit inheritance or change rules.

## Milestone 5 — armed forces, logistics and war

Goal: replace generated military outcomes with material capabilities and operational constraints.

### M5.1 Personnel, equipment and readiness — P1 / XL

- active/reserve/mobilisable/training personnel;
- equipment category pools and formations;
- readiness, organization, morale, experience and doctrine;
- personnel/maintenance/procurement costs;
- mobilisation time, labour draw and political effects;
- production/import/delivery/maintenance lifecycle.
- separate formation cohesion/morale, national war support and local cooperation/resistance;
- decomposed technology, doctrine, command, reconnaissance and communications quality.

Acceptance:

- formations cannot duplicate manpower/equipment;
- spending without deliveries/training does not instantly create capability;
- neglected maintenance reduces availability through visible formulas;
- casualties flow to demographics, politics, replacements and equipment ledgers.
- quantity cannot bypass frontage, congestion or supply capacity; quality effects are traceable to concrete components.

### M5.2 Supply graph and operations — P1 / XL

- supply origins, routes, capacity, distance, terrain and interdiction;
- movement and mission orders;
- front participation and reserves;
- intelligence-limited information;
- fuel/ammunition/food/parts consumption at an aggregate level.
- civilian/trade/military priority allocation over shared corridor capacity;

Acceptance:

- an isolated formation cannot fight indefinitely at full strength;
- route/controller changes affect delivered supply on the correct tick;
- player sees estimates according to intelligence, while engine retains truth;
- AI objective cannot teleport a formation.

### M5.3 Aggregate combat resolution — P1 / XL

- ground combat first; air support/air defence abstraction;
- terrain/weather/fortification/doctrine/readiness/supply factors;
- seeded uncertainty;
- typed losses, damage, capture and control-zone movement;
- war aims, ceasefire and settlement links;
- naval detail only after land/air slice is credible.

Acceptance:

- casualties and territorial outcomes are calculated, not authored by LLM;
- battle report explains dominant known factors;
- identical inputs/seed replay exactly;
- 100 randomized battles preserve personnel/equipment and never produce invalid fronts.

## Milestone 6 — state-grounded AI orchestration

Goal: spend strong-model tokens only on judgment and language that benefit from them.

Basic logging/routing begins at M0; this milestone replaces the current prompt-centric architecture completely.

### M6.1 Connections, task profiles and capabilities — P0 / L

- separate connection credentials from task profiles;
- utility, diplomacy-fast/deep, strategic planner, advisor, narrative, memory and translation profiles;
- provider capability adapters for reasoning/tools/schema/stream/cancel/cache;
- per-profile time/output/cost ceilings and fallback policy;
- import/export configuration without secrets.

Acceptance:

- `high/low` is stored per task/profile and translated through provider capabilities;
- unsupported parameters fail before billing or are visibly adapted;
- translation can use a separate key/local/free model;
- one global setting cannot accidentally force high reasoning on speaker choice or translation.

### M6.2 Context compiler and deterministic router — P0 / XL

- typed context sections, entity graph expansion and token budgets;
- byte-stable common prefix for provider caching;
- exact current thread + active commitments + relevant state;
- context/stakes rules before optional utility classifier;
- context manifest preview and omission notices;
- no global region/stat dump for ordinary diplomacy.

Acceptance:

- greeting excludes map/economy except relationship/current issue;
- partition discussion includes exact target control zones, parties, forces, agreements, logistics and affected economic facts;
- long campaigns do not repeatedly paste resolved action history;
- evaluation suite measures relevant-fact recall, latency and token cost.

### M6.3 Strategic planning, diplomacy and narrative — P1 / XL

- persist NPC goals, red lines, plans and planning horizon;
- typed diplomatic intent/terms;
- planner selects legal objectives/policies/missions, mechanics resolves them;
- narrative sees accepted deltas only;
- challenge depth selected by stakes, not every call using high reasoning;
- bounded repair on schema/legality errors.

Acceptance:

- AI cannot directly alter protected statistic paths or leader lifecycle;
- main narrative never contradicts accepted numbers/control/date;
- ordinary dialogue stays fast, while major settlements receive deep context;
- fallback planner keeps campaign mechanically advancing during provider outage.

### M6.4 Memory and compression — P1 / L

- canonical state never summarized away;
- durable facts with entity/evidence/status/time;
- recent exact episodes + archive;
- entity/date/status/full-text retrieval;
- atomic compression and restore;
- memory inspector/correction/pinning.

Acceptance:

- 100-turn fixtures retain active agreements, grievances, leader promises and major divergences;
- failed compression loses nothing;
- old resolved chatter is absent from normal prompts but searchable;
- successor inherits polity facts without blindly inheriting private personal relationships.

## Milestone 7 — localization and translation

Goal: eliminate hidden repetitive translation cost while keeping all generated content readable in Russian or another chosen language.

### M7.1 Static localization — P0 / M

- replace DOM text crawling with locale keys/catalogs;
- `ru` and `en` core catalogs;
- CI extraction/missing-key report and fallback;
- `Intl.DisplayNames`/CLDR plus curated historical entity names;
- scenario-local localized names keyed by stable ID/version.

Acceptance:

- menu/settings/country rendering makes zero network calls;
- missing locale key is visible in development and safely falls back;
- entity IDs and structured values never translate.

### M7.2 Generated/imported text translation — P1 / M

- request diplomacy/events/advice directly in player language by default;
- dedicated optional translation profile/connection/model;
- reasoning disabled, strict batch schema and tight output cap;
- persistent cache by content hash/source locale/target locale/model policy;
- background, deduplicated, cancellable jobs;
- glossary/protected terms and structure validation;
- local translation option where quality is sufficient.

Acceptance:

- already-Russian text produces zero translation calls;
- changing gameplay model does not change translation model unless configured;
- translated treaty terms/IDs/numbers remain intact;
- cache survives restart and invalidates correctly on source/scenario version.

## Milestone 8 — scenario platform and content maturation

Goal: mature the two continuously maintained development scenarios into authorable, distributable content rather than embedding frozen prompts and ad hoc JSON. Their skeletons and fixtures begin in M1–M3; M8 is not the first time scenario compatibility is tested.

### M8.1 Scenario package v2 and migrations — P1 / XL

- manifest/modules/data pack/map/localization/AI patches/tests/sources layout;
- engine compatibility and semantic versioning;
- no frozen full engine prompts;
- structural, simulation, geometry, provenance and AI-budget validators;
- quality tiers: Draft, Valid, Playable, Curated;
- upgrade preview and rollback.

Acceptance:

- old Open Historia scenario imports to a draft with a complete loss/warning report;
- missing population/economy/leader/control data is reported, never generated silently;
- engine prompt fix reaches compatible scenarios without editing each save;
- scenario update cannot mutate an existing campaign unnoticed.

### M8.2 Authoring and playtest tools — P2 / XL

- spreadsheet/JSON import with field mapping;
- map control/sovereignty/claims paint modes;
- data provenance and uncertainty editor;
- leader/office/succession editor;
- formula/context preview;
- deterministic fixture actions and reference simulations;
- optional AI-assisted draft generation that has no authority until reviewed.

Acceptance:

- World 1916 and World 1797–1815 authors can define period-specific institutions, leaders, economy, armies and territorial state without changing engine code;
- validator exposes every required approximation and missing source;
- automated playtest catches impossible starting balances/fronts.

### M8.3 Pax import boundary — P2 / M

- support only user-owned/authorized exports or documented public formats;
- adapter imports reusable metadata/rules/entities where contracts permit;
- convert workflows only through explicit semantic mapping;
- preserve source/license and emit loss report;
- no scraping/private API bypass/screenshot-as-authoritative-map.

Acceptance:

- imported content remains Draft until identity, geometry, data and tests pass;
- unsupported proprietary workflow is reported, not guessed;
- no creator content is redistributed without permission.

## Milestone 9 — scale, UX and release hardening

### M9.1 Performance — P1 / L

- profile renderer, map data, poll loops, simulation, prompts and persistence separately;
- server push/change notifications instead of duplicate five-second full polling;
- derived-state caching and invalidation graph;
- code-split editor/map/game bundles;
- map tile/GeoJSON pyramid fixes and long-session leak tests;
- only consider a Rust/native hotspot after measured TypeScript optimization.

Acceptance:

- simulation meets budgets in the core specification or records an approved revision;
- 100-turn campaign has bounded memory growth;
- map/editor code is not loaded into unrelated startup paths;
- no UI freeze during AI streaming, translation or simulation.

### M9.2 Player experience and accessibility — P2 / L

- unified command preview/confirmation;
- timeline reveal/intervention/rewind;
- searchable event and call logs;
- status/context inspector;
- dashboards with source/uncertainty/causal views;
- difficulty and information-visibility explanations;
- autosave/recovery UX.
- goal/policy-package workflow, reusable auto-rules, delegated execution and exception inbox;

Acceptance:

- a player can explain why a policy failed without reading a system prompt;
- irreversible actions are visually distinct;
- screen sizes and long stat sheets remain usable;
- recovery path is tested by non-developer playtest.
- a five-year campaign is playable from the national dashboard and exception inbox without routine per-region/per-factory clicking.

## Cross-cutting backlog map

| Area | IDs | Primary milestone |
|---|---|---|
| Observability/cost/cancel | OBS-001… | M0, M6 |
| Persistence/replay/migration | STORE-001… | M0, M1 |
| Identity/domain/events | CORE-001… | M1 |
| Data provenance/import | DATA-001… | M2, M8 |
| Demography/economy/budget | SIM-001… | M2, M3 |
| Territory/control/geometry | MAP-001… | M3 |
| Leaders/politics/reputation | GOV-001… | M4 |
| Military/logistics/combat | MIL-001… | M5 |
| Models/context/memory | AI-001… | M0, M6 |
| Localization/translation | I18N-001… | M0, M7 |
| Scenario fixtures/content/tooling/import | SCN-001… | M1–M3, M8 |
| Performance/UX | PERF-001…, UX-001… | M9 |

Every implementation issue should carry: priority, schema impact, migrations, acceptance tests, benchmark impact, AI-call impact and links to the governing specification section.

## Release gates

### Gate A — safe experimental build

Requires M0 + stable-ID/event skeleton from M1. Suitable for continuing current chat/map experiments without risking campaigns or opaque bills.

### Gate B — simulation alpha

Requires M1, M2, global `Baseline` coverage in both scenario skeletons and reconciled wave-one Russia/Germany/Britain starting states. No requirement for polished combat. The key proof is that twelve headless months advance every polity while the three reference powers exercise distinct mechanics without AI-authored statistics or forced historical outcomes.

### Gate C — grand-strategy beta

Requires leaders/government, armed forces/logistics/combat, state-grounded AI, memory and translation. World 1916/Russia must support multiple mechanically generated authority-transition, war/peace and civil-conflict paths; World 1797 must pass global trade plus coalition, occupation and blockade compatibility fixtures.

### Gate D — scenario platform release

Requires scenario v2 tooling, curated data/source workflow, import boundary and both materially different global scenarios. World 1916 and World 1797–1815 are mandatory validation targets for identities, succession, mobilisation, pre-modern versus industrial logistics, uncertain historical economics and divergence from scripted history.

## What not to do first

- do not rewrite in Kotlin/Java/Rust;
- do not add dozens of generated “custom stats” before ledgers and units exist;
- do not let a cheap model route every request until deterministic routing has been exhausted and measured;
- do not build detailed combat before population/economy/inventory/logistics foundations;
- do not confuse global coverage with false equal precision: establish honest national baselines everywhere, then reconcile supported/curated regional detail;
- do not improve narrative prompts while they still have authority to invent canonical numbers;
- do not copy Pax content or workflows without an authorized export and semantic contract.

## First implementation batch

The first coding batch after this specification should be deliberately small and enabling:

1. commit specs and create linked application issues `OBS-001`, `STORE-001`, `CORE-001`, `I18N-001`;
2. fix the complete test command — **completed in application commit `eebf766`**; CI workflow remains to be added;
3. introduce the AI call registry and deterministic two-party speaker choice;
4. stop runtime LLM translation of static/already-localized UI;
5. introduce world revision + atomic single-artifact write helper with crash tests;
6. scaffold strict TypeScript `domain` package with stable IDs, units, commands/events and runtime schemas;
7. define minimal manifests for `world-1916` and `world-1797`, including fidelity ratings, then carry one sourced 1916 observation for Russia, Germany and Britain end to end;
8. implement a headless deterministic monthly clock plus population/fiscal ledger toy fixture;
9. only then replace one generated/custom statistic panel with a canonical wave-one ledger projection.

This batch produces visible cost improvements immediately while proving the architecture before the XL simulation work begins.

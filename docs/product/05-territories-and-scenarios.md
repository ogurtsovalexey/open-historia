# Territories, map and scenario specification

## Problem statement

The current map represents one administrator/owner and optional claimants. This cannot accurately model a historical situation where legal recognition, effective control, occupation, annexation claims and partial front lines differ.

It also makes map data look more authoritative than it is. A polygon from an administrative dataset is geometry, not a historical control record.

## Territorial status model

```ts
interface TerritorialStatus {
  id: string;
  area: TerritorialAreaRef;
  recognizedSovereign?: PolityId;
  controller?: PolityId;
  occupyingPower?: PolityId;
  deFactoAuthority?: PolityId;
  claimants: PolityId[];
  status:
    | "controlled"
    | "disputed"
    | "occupied"
    | "annexed_unrecognized"
    | "de_facto_state"
    | "demilitarized"
    | "international_administration";
  validFrom: GameDate;
  validUntil?: GameDate;
  recognitionPolicy: string;
  confidence: "exact" | "approximate" | "scenario_choice";
  sources: SourceRef[];
  note?: string;
}

type TerritorialAreaRef =
  | { kind: "region"; regionId: RegionId }
  | { kind: "control_zone"; zoneId: string };
```

### Why both region and control zone

- Crimea and Sevastopol already map cleanly to separate regions.
- Abkhazia is a separate region in the inspected geometry.
- South Ossetia is embedded in Shida Kartli; marking the whole region would be inaccurate.
- Control in Donetsk/Luhansk in 2016 did not match entire oblast boundaries.

`control_zone` is a dated GeoJSON/PMTiles overlay whose geometry can cut across administrative regions. It must never rewrite base region IDs. When a front moves, a new zone revision or domain change updates control.

## Map rendering

Default political mode:

- base fill: effective controller;
- diagonal overlay/outline: recognized sovereign under selected worldview;
- additional thin pattern: multiple claimants where materially useful;
- front/administrative boundary: explicit line layer;
- unknown/approximate control: muted pattern, not false precision.

Tooltip/panel must show:

```text
Recognized sovereign: Ukraine
Effective controller: Russia
Status: occupied / annexation not recognized by selected policy
Since: 2014-02-20
Geometry: whole region
Sources: ...
```

For politically disputed language, UI presents source/policy rather than pretending the application is a legal authority.

### Map modes

- effective control;
- recognized sovereignty;
- claims/disputes;
- alliances/relations;
- conflict fronts;
- transport corridors and logistics throughput;
- terrain, weather and fortification coverage;
- optional scenario-specific metric.

The player should never need to infer control from an unexplained stripe.

### Transport and fortification rendering

Compile scenario transport geometry into vector tiles/PMTiles so the desktop does not load every road vertex into React state. At world zoom show only major international rail, road, sea and pipeline corridors; reveal regional branches and nodes as the player zooms.

Visual contract:

- line family/pattern identifies road, rail, pipeline and sea/river route;
- width represents calibrated capacity band, not number of OSM geometries;
- color represents controller/access or selected supply source;
- condition/damage uses broken/dim/red overlay;
- utilization appears in a logistics mode, with animation optional and disabled by default;
- border crossings, ports, depots, bridges/tunnels and break-of-gauge points have inspectable symbols;
- fortifications render as oriented line/point coverage, not a decorative regional icon;
- tooltip shows endpoints, route, daily capacity/utilization, travel time, controller/access, condition, bottleneck and data date/source.

Routes are canonical graph records; rendered linework is a projection. Editing geometry must update/revalidate connectivity and capacity data, never only draw a line.

### Immutable physical geography and mutable engineering

Elevation, mountains, rivers, lakes, coastlines and baseline land cover belong to a versioned map geodata pack. They are shared read-only inputs and do not bloat each campaign save. The game stores compact derived passability, slope, river-crossing and navigability indexes for simulation; map tiles remain the visual source.

Bridges, tunnels, dams, canals, levees and ferries are separate mutable domain assets. Building or destroying one changes a validated route/capacity/effect record and then the rendered overlay. It never rewrites the underlying mountain or river. Dams may carry an authored reservoir geometry/effect revision, but the core does not pretend to recompute real hydrology.

## Gameplay semantics

- Movement, access, taxation and military presence normally use `controller`.
- Diplomatic/legal claims and most international reactions use `recognizedSovereign`, claimants and recognition policy.
- A conquest changes control first. Annexation, recognition and sovereignty are separate commands and consequences.
- A peace settlement can change recognition and claims without instantly changing control.
- AI context states both dimensions only for relevant areas.

## First historical control packs

The first data milestones are global packs for `world-1916` and `world-1797`, not a vague timeless world map. Every polity needs a playable national baseline; the listed theatres receive the first supported/curated regional depth.

World 1916, with Russia as the first curated path, requires:

- dated imperial administrative regions and stable IDs;
- front/control zones and occupied territory at the chosen start date;
- relevant autonomous/dependent territories and authority relationships;
- strategically meaningful rail, port, river and road geometry;
- sources and uncertainty for boundaries that do not align with the available base polygons.

World 1797, with Europe as the first curated theatre, requires:

- dated polities, dependencies, occupations and contested areas at the chosen start date;
- geometry capable of representing small states, composite monarchies, client states and later campaign border changes;
- ports, navigable rivers, strategic roads and sea-lane nodes;
- no assumption that a colored polity is a centralized modern nation-state.

The current modern claimant records remain migration/audit fixtures, not authoritative historical data for these scenarios. Each scenario item needs controller, recognized sovereign under its period policy, status interval, geometry quality and sources. The scenario engine must support partial zones because fronts and occupations rarely match whole administrative regions.

## Scenario package v2

### Goals

- one versioned, validated contract;
- content updates without copying obsolete engine prompts;
- historical provenance;
- modular mechanics;
- localized content;
- migration from v1 scenarios;
- future import adapters.

### Proposed layout

```text
scenario.zip
  manifest.json
  world/
    polities.json
    people.json
    offices.json
    office-terms.json
    succession-rules.json
    reputation.json
    regions.json
    territorial-status.json
    relations.json
    agreements.json
    conflicts.json
    demographics.json
    population-groups.json
    cultures.json
    languages.json
    religions.json
    laws.json
    institutions.json
    interest-groups.json
    economy.json
    public-finance.json
    trade.json
    resources.json
    infrastructure.json
    transport-nodes.json
    transport-edges.json
    fortifications.json
    terrain-index.json
    engineered-features.json
    armed-forces.json
    politics.json
    technology.json
    structural-pressures.json
    reference-series.json
    historical-anchors.json
  map/
    regions.pmtiles | regions.geojson
    control-zones.pmtiles | control-zones.geojson
    physical-terrain.pmtiles
    hydrography.pmtiles
    physical-index.json
    cities.json
    features.json
    background.*
  localization/
    en.json
    ru.json
  ai/
    rules.md
    profile-overrides.json
    prompt-patches.json
  tests/
    validation-cases.json
    playtest-actions.json
  sources.json
```

Large shared map assets may be content-addressed references instead of embedded duplicates.

### Manifest

```json
{
  "schemaVersion": 2,
  "engineRange": ">=0.1 <1.0",
  "id": "world-1916",
  "version": "1.0.0",
  "titleKey": "scenario.title",
  "startDate": "1916-01-01",
  "defaultLocale": "en",
  "recognitionPolicy": "scenario-diplomatic-recognition-1916",
  "modules": {
    "territorialControl": true,
    "diplomacy": true,
    "demographics": true,
    "economy": true,
    "publicFinance": true,
    "productionAndTrade": true,
    "resourcesAndLogistics": true,
    "armedForces": true,
    "combat": true,
    "projects": true,
    "internalPolitics": true,
    "societyAndIdentity": true,
    "technology": true
  },
  "mapRef": "...",
  "migrationFrom": [1]
}
```

## Prompt policy for scenarios

Scenarios provide:

- world-before-start narrative;
- concise simulation rules;
- structured tags/goals/red lines/anchors;
- optional named prompt patches against a versioned engine template;
- task-profile overrides within user cost ceilings.

They do not carry full frozen copies of every engine prompt. Engine prompt updates are versioned; an old patch is migrated or flagged incompatible, never silently preserved forever.

## Scenario validation

CLI/editor validation must check:

### Structural

- schema and engine compatibility;
- unique stable IDs;
- valid references;
- no display-name identity collisions;
- required localization keys;
- valid dates/intervals.

### Geometry

- valid polygon topology;
- unintended gaps/overlaps;
- control zones inside expected bounds;
- region/control-zone resolution by zoom;
- feature count/performance budget.
- transport graph connectivity, orphan nodes, impossible border crossings and geometry/edge agreement;
- fortification coverage/orientation and dated validity;
- immutable physical layers align with region/control/transport geometry and carry map-pack version/checksum;
- bridges, tunnels, dams, canals and ferries reference valid transport/hydrography nodes and dated project state;

### Historical/provenance

- required source entry for historical territorial status, conflict and leadership assertions;
- explicit scenario-author choice where sources conflict;
- approximation note for partial-control geometry;
- worldview/recognition policy declared.

### Simulation

- playable polity exists and required module data is present;
- active wars have sides/fronts;
- active agreements reference valid parties;
- every occupied office has a valid holder/term and every historical transition has a cause/source;
- succession rules resolve to an eligible holder or an explicit vacancy/caretaker state;
- historical anchors have satisfiable predicates;
- population, public finance, inventories and equipment pass reconciliation checks;
- polity totals reconcile to region allocations within declared residuals/tolerances;
- every starting observation records units, date, quality, provenance and transformation history;
- population-group totals reconcile and identity/law categories reference valid definitions;
- structural pressures have dated drivers, invalidation conditions and sources rather than unconditional scripted outcomes;
- no test action forces the simulation to invent missing core state.

### AI budget

- estimated base context per task;
- warnings for huge rules/lore;
- no scenario can silently force a provider/model or exceed user hard budgets;
- regression action set passes invariant checks on at least one reference model/profile.

## Scenario authoring UX

- Overview: date, lore, modules and recognition policy.
- Polities: stable identity, names/aliases, goals and red lines.
- Simulation data: population, economy, budget, trade, resources, infrastructure, armed forces, politics and technology, with provenance and uncertainty.
- Government: people, offices, terms, elections, succession, leader standing and polity reputation.
- Diplomacy: relations, agreements, wars and unresolved proposals.
- Map: ownership/control/claims as separate paint modes.
- History: anchors and divergences.
- Localization: missing-key dashboard and optional batch pretranslation.
- Sources: per-entity/per-status citation editor.
- AI: concise rules, profile overrides and context preview.
- Validate & playtest: automated report before export/publish.
- Version: changelog, migration preview and compatibility.

## Import and reuse, including Pax Historia

### Legal/product boundary

Do not scrape private APIs, bypass access controls or redistribute creators' text/maps without permission. A public preset page is not automatically an export license.

### Adapter architecture

```ts
interface ScenarioImporter {
  probe(input: ImportInput): ProbeResult;
  import(input: ImportInput, options: ImportOptions): DraftScenarioV2;
  report(): ImportReport;
}
```

Adapters may support:

- Open Historia v1 JSON/ZIP;
- a user-owned Pax export if an official export format is available;
- manually copied public metadata/rules with creator permission;
- GeoJSON/PMTiles/shapefile map data;
- raster-image-assisted map tracing as a draft only.

### Pax conversion expectations

Likely reusable with an authorized export:

- title/date/description;
- world-before-start and simulation rules;
- polity list, aliases, colors and tags;
- region ownership if stable geometry/IDs are available;
- map entities and feature tags;
- localization and source metadata where present.

Not safely reusable automatically:

- proprietary workflows/prompts tied to Pax contracts;
- exact map geometry from a screenshot;
- platform-owned IDs/services;
- copyrighted creator content without license;
- undocumented runtime memory/state.

The importer creates a draft plus a loss report. It never labels a converted scenario “ready” until geometry, identities, territorial status and playtests pass.

## Scenario quality tiers

- **Draft**: opens in editor, may be incomplete.
- **Valid**: schema and geometry pass.
- **Playable**: automated fixtures complete without invariant failure.
- **Curated**: sources reviewed, localization complete, manual playtest recorded.

Popularity/play count is shown separately from quality tier.

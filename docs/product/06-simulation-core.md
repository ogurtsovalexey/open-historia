# Deterministic simulation core specification

## Product decision

The simulation core is the game. The language model is an intelligent participant around that core: it interprets intent, plans for non-player actors, conducts diplomacy, proposes plausible shocks and explains outcomes. It does not invent population, GDP, equipment, casualties or territorial control as prose and then ask the application to believe them.

The target is closer to a readable grand-strategy simulation than to a chat interface with a map. It borrows the useful pillars of Civilization and Hearts of Iron—population, production, state finance, logistics, military readiness and territorial control—without copying their exact rules or simulating every citizen, factory and projectile.

```text
historical/scenario data pack
          +
accepted player and NPC policies
          +
dated deterministic rules + seeded uncertainty
          ↓
demography → labour → production → income/budget → investment/procurement
     ↑            ↓          ↓            ↓                 ↓
migration     unemployment  trade       debt           armed forces
     ↑                       ↓                              ↓
casualties ← politics ← shortages ← logistics ← mobilisation → combat
          ↓
typed events and state deltas
          ↓
AI narration, diplomacy and strategic planning
```

## Non-negotiable rules

1. Canonical statistics are changed only by mechanics, imported scenario data, a validated migration or an explicit visible GM override.
2. LLM output cannot directly set arbitrary numeric state. It may propose typed policy choices, objectives or bounded shocks; the engine computes the numbers.
3. Every displayed value has a unit, date, scope, provenance and derivation. Estimates are marked as estimates.
4. Stocks and flows are not interchangeable. Population, debt and equipment are stocks; births per month, deficit per year and equipment production per day are flows.
5. Accounting identities and conservation rules are executable invariants.
6. The same scenario version, seed, commands and model-approved typed decisions produce the same mechanical result.
7. The engine advances every relevant polity. It must not freeze the rest of the world while only the player receives calculations.
8. Precision follows evidence. The UI may show `about 21,000` rather than a false exact `21,037` when the source is uncertain.
9. No live dependency on external statistical APIs is required to load a campaign. Data is imported, reviewed, licensed and pinned into a versioned data pack.
10. AI absence or provider failure can reduce narrative and NPC sophistication, but cannot corrupt or prevent deterministic state advancement.

## Resolution and time model

### Spatial resolution

Use three related levels rather than one uniform global spreadsheet:

- **polity level**: national accounts, budget, trade, research, strategic reserves and high-level politics;
- **region level**: population, workforce, infrastructure, sector capacity, resources, damage, control and supply access;
- **formation/front level**: military units, equipment, readiness, supply and combat state.

Country totals are sums or explicit consolidations of region values. The engine may retain a residual national bucket where public subnational data does not support a credible split. It must expose that approximation instead of allocating everything with invented precision.

### Time resolution

- daily: combat, movement, supply consumption, acute crises;
- monthly: production, trade delivery, budget cash flow, project progress, migration and most political effects;
- annual/cohort step: births, deaths, age transitions and structural productivity, with monthly prorating where needed;
- event-driven: annexation, treaty activation, default, coup, disaster and other discrete changes.

The UI can jump days, months or years. The engine decomposes the interval into the minimum required ticks and aggregates presentation events. It never asks an LLM to narrate every day of a ten-year jump.

### Active and coarse simulation

All countries receive the same accounting rules, but resolution can adapt safely:

- active wars, player neighbours and directly involved trade partners run full relevant ticks;
- distant peaceful countries can batch equivalent monthly calculations by quarter;
- no coarse path may skip treaty obligations, trade dependencies, demographic conservation or a globally important threshold;
- entering the active set does not regenerate state; it expands already conserved aggregates.

This is an optimization contract, not permission to invent off-screen results.

## Canonical numeric types

Avoid bare `number` fields whose meaning is known only from a prompt.

```ts
type PersonCount = number;       // integer persons after committed rounding
type MoneyMicros = bigint;       // scenario accounting currency, fixed point
type QuantityMicros = bigint;    // fixed-point physical or index quantity
type BasisPoints = number;       // 10_000 = 100%

interface Observation<T> {
  value: T;
  unit: string;
  asOf: GameDate;
  geography: EntityRef;
  quality: "observed" | "estimated" | "modelled" | "scenario_choice";
  confidence?: { low: T; high: T };
  sourceRefs: SourceRef[];
  transformRefs: string[];
}
```

Use fixed-point arithmetic for money and conserved quantities. Floating point is acceptable for intermediate rates and UI projections, never as an unexplained source of accumulating accounting drift.

## Demography

### State

```ts
interface DemographicState {
  population: PersonCount;
  ageBands: Record<"0_14" | "15_24" | "25_54" | "55_64" | "65_plus", PersonCount>;
  labourForce: PersonCount;
  employed: PersonCount;
  urbanPopulation: PersonCount;
  displacedInternal: PersonCount;
  refugeesAbroad: PersonCount;
  birthsYtd: PersonCount;
  civilianDeathsYtd: PersonCount;
  militaryDeathsYtd: PersonCount;
  netMigrationYtd: number;
}

interface PopulationGroup {
  id: PopulationGroupId;
  regionId: RegionId;
  size: PersonCount;
  ageProfileRef: string;
  labourCategory?: string;
  urbanity?: "urban" | "rural";
  cultureId?: CultureId;
  languageIds?: LanguageId[];
  religionId?: ReligionId;
  legalStatus?: "primary" | "accepted" | "citizen" | "resident" | "discriminated";
  livingStandardBand?: string;
  politicalAffinities?: InterestGroupId[];
}
```

Sex-specific or finer five-year cohorts can be enabled for scenarios where mobilisation or long demographic play makes them valuable. They are not required in the first vertical slice.

Population groups are sparse and scenario-relevant, not a full Cartesian product of every age, job, culture and faith. Groups are split only when a distinction changes labour, law, politics, migration, mobilisation or territorial conflict; otherwise they remain aggregated. This retains meaningful religious/cultural/social structure without creating millions of tiny simulation objects.

### Mechanics

For each region and period:

```text
population(t+1)
  = population(t)
  + births
  - natural deaths
  - civilian conflict deaths
  - military deaths assigned to home population
  + immigration
  - emigration
  + inbound displacement
  - outbound displacement
```

Births and natural deaths derive from scenario-calibrated age structure and rates. Migration reacts to wage opportunity, unemployment, safety, border policy, cultural/political friction and existing migrant networks, with clamps so a narrative event cannot move implausible shares overnight.

Population affects labour supply, demand, tax base, mobilisation pool and political pressure. War casualties and displacement feed back into production and legitimacy. Conquered people do not become loyal manpower merely because a polygon changed controller.

Culture, language and religion affect play only through people, institutions, law, history and organized actors. Difference does not automatically mean hostility, and a “convert culture/religion” button cannot delete identities. Acceptance, integration, assimilation, conversion and secularization are gradual processes shaped by education, family/community institutions, mobility, coercion, material incentives and legal equality, with visible humanitarian and political consequences.

## Economy and national accounts

### Primary state

Canonical economic state uses real-valued quantities where supportable:

- real output by sector: agriculture, extractive, manufacturing, construction and services;
- nominal GDP and price level;
- employed labour and unemployment;
- productive capital and capacity utilization;
- household consumption and essential-goods demand;
- government consumption and investment;
- gross fixed investment and depreciation;
- exports/imports by strategic commodity group;
- inventories and shortages;
- exchange rate and foreign reserves for scenarios where external finance matters;
- public revenue, spending, cash, debt, deficit and interest burden.

“Economic strength 73” may exist as a derived UI comparison. It is never the underlying economy.

### Accounting identities

At minimum, the engine checks:

```text
GDP expenditure view ≈ consumption + investment + government + exports - imports
budget balance       = revenue - expenditure
debt(t+1)            = debt(t) - budget balance + valuation adjustments
inventory(t+1)       = inventory(t) + production + imports - use - exports - losses
```

Differences caused by aggregation and rounding must remain inside an explicit tolerance and go to a named statistical discrepancy account. They may not disappear.

### Production

Sector output is a bounded function of:

- installed productive capacity and damage;
- employed workers and skills;
- energy availability;
- required material inputs and inventories;
- transport access and supply efficiency;
- technology/productivity;
- policy, sanctions, occupation and unrest modifiers;
- demand and capacity utilization.

The first implementation should use a transparent Leontief-style bottleneck for strategic inputs plus a simpler production function for labour/capital. This makes an energy embargo or destroyed bridge mechanically visible without requiring a general-equilibrium research project.

```text
feasible output = planned capacity output
                × min(labour availability,
                      energy availability,
                      required input availability,
                      logistics availability)
                × productivity modifiers
```

### Prices, currency and shortages

Do not start with a full market-clearing model. Use indexed price baskets and explicit strategic goods:

- food;
- fuel/energy;
- industrial materials;
- civilian manufactures;
- military equipment categories.

Persistent excess demand raises category prices and shortage severity. Money creation, import prices, exchange-rate pressure and capacity constraints feed inflation. Controls can suppress measured price increases while increasing queues, black markets and fiscal cost.

### Public finance

Policies set tax rates and spending envelopes; actual collections depend on taxable output, compliance and administrative capacity. Spending categories include:

- civilian administration;
- health/education/social transfers as an aggregate;
- infrastructure and investment;
- military personnel;
- operations and maintenance;
- procurement;
- debt service;
- emergency spending.

Deficits consume cash/reserves and create debt subject to financing conditions. Default and hyperinflation are mechanical thresholds with scenario rules, not random narration.

### Trade

Trade is represented by partner, commodity group, annual/monthly capacity, price basis, route and agreement/sanction status. The engine needs bilateral dependencies, not every customs line at runtime.

```ts
interface TradeFlow {
  exporter: PolityId;
  importer: PolityId;
  commodity: CommodityId;
  contractedPerMonth: QuantityMicros;
  deliveredThisMonth: QuantityMicros;
  unitPrice: MoneyMicros;
  routeIds: string[];
  status: "normal" | "constrained" | "embargoed" | "disrupted";
}
```

World trade baseline is aggregated from source classifications into a small versioned game taxonomy. Bilateral import/export reports are reconciled with documented rules because real-world mirror statistics disagree.

## Resources, energy, infrastructure and logistics

### Resource nodes and capacity

Regions may contain deposits, arable output, generation and industrial capacity. A node stores estimated reserves where meaningful, extraction capacity, operating cost, ownership/control, damage and transport link. Unknown reserves remain unknown; the game can model discovery as converting uncertainty into a revised observation.

### Energy

Track at least electricity availability and fuel supply. Generation is grouped into thermal, hydro, nuclear and variable renewables where scenario data supports it. Grid-level engineering is out of scope, but disconnected regions, import dependency and damaged generation must affect output.

### Infrastructure

Transport is a dated multimodal graph, not only a region-level index.

```ts
interface TransportNode {
  id: TransportNodeId;
  kind: "junction" | "city" | "station" | "depot" | "port" | "airport" | "border_crossing";
  regionId: RegionId;
  point: GeoPoint;
  controller: PolityId;
  handlingCapacityPerDay: QuantityMicros;
  storageCapacity?: QuantityMicros;
  conditionBp: BasisPoints;
}

interface TransportEdge {
  id: TransportEdgeId;
  from: TransportNodeId;
  to: TransportNodeId;
  mode: "road" | "rail" | "sea_lane" | "river" | "pipeline" | "airlift";
  geometryRef: string;
  regionIds: RegionId[];
  lengthKm: number;
  baseCapacityPerDay: QuantityMicros;
  travelTimeHours: number;
  conditionBp: BasisPoints;
  surfaceOrGauge?: string;
  electrified?: boolean;
  borderCrossingId?: string;
  bridgeTunnelRefs: string[];
  validFrom: GameDate;
  validUntil?: GameDate;
}
```

The game graph contains strategically relevant corridors between regions and countries, not every residential street or rail siding. Multiple parallel local ways are compiled into a capacity-calibrated corridor while major junctions, mountain passes, bridges, tunnels, ports, gauge changes and border crossings remain explicit chokepoints.

Effective edge capacity depends on:

- physical design and condition;
- terrain, weather and season;
- controller, access/treaty and border/customs state;
- rail gauge/electrification and transshipment;
- available vehicles, rolling stock, fuel and staff;
- congestion and priority allocation;
- damage, repair, sabotage, bombing and interdiction.

Trade and military supply requests are allocated across cached feasible paths by priority, cost and bottleneck capacity. The first version should use cached shortest/least-cost paths plus deterministic capacity allocation; introduce a global min-cost-flow solver only if scenarios demonstrate that the simpler algorithm produces unacceptable routing. Civilian essentials, evacuation, exports and front supply compete under explicit policy rather than invisible ordering.

```text
delivered quantity
  = min(request,
        origin stock/loading,
        every edge residual capacity,
        destination unloading/storage)
    × route reliability
    - documented transit losses
```

Road/rail construction and repair are projects with surveyed route, land/control access, labour, materials, machines, money and time. Capturing a region does not instantly repair, regauge or operate its network. A single generic “infrastructure 68” can remain only as a derived overview score.

### Terrain, weather and fortifications

Base physical geography is immutable scenario/map data:

- elevation, slope and mountain/ridge geometry;
- rivers, lakes, coastline, watersheds and normal navigability/seasonality;
- land cover/biome and baseline passability;
- natural passes, straits and other chokepoints.

It is packaged and versioned with the map as compact raster/vector tiles plus derived gameplay indexes. It is not generated by the LLM, stored repeatedly in every save or altered by ordinary turns. A scenario with a historically different coastline, river course or existing reservoir ships the correct starting geography in its own geodata pack.

Terrain is resolved along movement paths and front/control-zone geometry, not inferred solely from a country's name. A large mixed region uses weighted front segments or control zones rather than one “mountain” flag.

Rivers are both rendered geometry and gameplay edges/barriers. Their width/class, navigability, seasonal regime and crossing points affect movement, transport, supply, trade and defence. A formation crosses through an available bridge, ferry or resolved engineer operation; owning both adjacent regions alone is not a bridge.

Mutable engineered features sit above the immutable layer:

```ts
interface EngineeredGeoFeature {
  id: string;
  kind: "bridge" | "tunnel" | "dam" | "canal" | "levee" | "ferry";
  geometryRef: string;
  connectsNodeIds?: TransportNodeId[];
  conditionBp: BasisPoints;
  capacity?: QuantityMicros;
  projectId?: ProjectId;
  builtAt?: GameDate;
  destroyedAt?: GameDate;
  effects: EffectRef[];
}
```

A bridge or tunnel creates/improves a transport connection and can be damaged or destroyed. A dam may add generation, irrigation/flood-control and a dated reservoir/navigation effect; a canal may add a route. These are rare projects with terrain, engineering, finance, displacement and diplomatic/environmental preconditions. The first version uses authored effect rules rather than attempting a live hydrodynamic model.

Fortifications are dated assets tied to a point, corridor crossing or defensive line. They have orientation, coverage, construction level, maintenance, garrison requirements, damage and known/estimated status. They improve a prepared defender only where the actual attack intersects their coverage; a bunker marker cannot defend an entire oblast.

Terrain and weather affect movement speed, route capacity, detection, attrition, equipment suitability and combat frontage. Technology/training can mitigate specific penalties but does not erase geography.

## Armed forces

### Stocks and organizations

```ts
interface ArmedForcesState {
  activePersonnel: PersonCount;
  reservePersonnel: PersonCount;
  mobilisablePool: PersonCount;
  trainingPipeline: PersonCount;
  personnelBudget: MoneyMicros;
  maintenanceBudget: MoneyMicros;
  procurementBudget: MoneyMicros;
  equipmentPools: Record<EquipmentClassId, EquipmentPool>;
}

interface Formation {
  id: FormationId;
  owner: PolityId;
  location: TerritorialAreaRef;
  personnel: PersonCount;
  equipment: Record<EquipmentClassId, number>;
  organizationBp: BasisPoints;
  readinessBp: BasisPoints;
  moraleBp: BasisPoints;
  experienceBp: BasisPoints;
  supplyBp: BasisPoints;
  doctrineId: string;
  mission: FormationMission;
}
```

Equipment classes should be strategically meaningful and tractable: small arms, artillery, armoured vehicles, tanks, air defence, combat aircraft, helicopters, transport, naval surface/submarine classes and logistics vehicles. Scenario extensions can add detail, but the global core should not require thousands of weapon SKUs.

### Capability is derived

Military capability comes from personnel, equipment availability, training, command, readiness, maintenance, doctrine, air/naval support and sustainable logistics. Military expenditure is an input and calibration source, not a direct capability score; SIPRI explicitly warns against treating spending as an output measure of military capability.

### Mobilisation and procurement

- mobilisation moves eligible population through call-up and training; it is not instantaneous;
- active forces draw labour and fiscal resources away from the economy;
- equipment requires production capacity, licensed/imported supply, money, inputs and time;
- maintenance consumes funds, parts and fuel; neglected stocks lose availability;
- arms imports are dated deliveries, not immediate purchase-to-front teleportation;
- captured equipment changes stocks only after recovery and compatibility losses.

### Combat

Combat resolution is deterministic given state plus a stored seeded uncertainty draw. It uses:

- committed formations and mission;
- effective combat equipment and manpower;
- terrain, weather and fortifications;
- intelligence/reconnaissance;
- organization, morale, experience and doctrine;
- air/naval/fire support;
- delivered supply and route vulnerability;
- attacker/defender posture and frontage.

Outputs are typed: casualties, equipment damaged/destroyed/captured, ammunition/fuel use, organization loss, control-zone movement, infrastructure damage and experience. The LLM may explain or choose an NPC operational objective; it cannot choose casualty numbers.

Avoid a single opaque combat-strength multiplication. The inspector should show the dominant factors and uncertainty band without exposing hidden information the player has not earned.

### Quantity, quality and human factors

Quantity matters through available formations, reserves, frontage, rotation and ability to absorb losses. It is not a linear win multiplier: too many forces on a low-capacity mountain road or narrow front create congestion and supply collapse.

Quality is decomposed rather than stored as one magic value:

- equipment capability and availability;
- individual/unit training and experience;
- officer/command competence;
- doctrine and combined-arms coordination;
- communications, reconnaissance and intelligence;
- maintenance and logistics;
- organization, cohesion and morale;
- willingness to fight for the mission/regime.

Formation morale/cohesion is distinct from national war support and local civilian cooperation/resistance. It changes through casualties, victories/defeats, fatigue, supply, leadership, rotation, perceived legitimacy and treatment. Technology unlocks concrete capabilities—better sensors, range, protection, communications, medicine or production—not a universal `+10% strength` unless it is a derived summary of those effects.

## Politics, administration and society

Politics translates material conditions and decisions into constraints rather than a decorative “stability” die roll.

Track:

- government legitimacy;
- institutional/administrative capacity;
- elite cohesion;
- public approval or war support;
- unrest and separatist pressure by relevant region/group;
- corruption/compliance as fiscal and project modifiers;
- laws/policies, elections and emergency powers;
- repression and civil-liberty costs where the scenario uses them.

Also represent a small scenario-relevant set of organized interests—parties, estates, military, oligarchic/business groups, labour, religious institutions, regional elites, movements and civil society. Each has constituency, organization, resources, leadership, interests and ideology. Laws define political access, citizenship, official language/religion, property/labour/tax regimes, centre-region authority, military service and emergency powers. Written law and implementation capacity are separate.

These can be normalized indices because they are latent constructs, but every change must cite observable causes: casualties, real income, shortages, victory, scandal, occupation policy, faction support or a scenario event. The engine records the cause contributions shown in the UI.

Major unrest should progress through observable stages such as petition, protest, strike, mutiny, insurgency, coup attempt or revolution. A crisis may accelerate under extreme shocks, but it should not appear unprepared merely because a model wanted drama.

## Leaders, government continuity and reputation

### Leaders are canonical entities

A polity name, government, office and current office-holder are not the same object.

```ts
interface Person {
  id: PersonId;
  names: LocalizedNames;
  bornAt?: GameDate;
  diedAt?: GameDate;
  traits: TraitRef[];
  privateFacts: FactRef[];
}

interface OfficeTerm {
  id: OfficeTermId;
  personId: PersonId;
  polityId: PolityId;
  officeId: OfficeId;
  startedAt: GameDate;
  expectedEndAt?: GameDate;
  endedAt?: GameDate;
  mandate: "elected" | "appointed" | "hereditary" | "acting" | "revolutionary" | "military";
  endReason?: "term_end" | "resignation" | "dismissal" | "election_loss" | "death" | "incapacity" | "coup" | "abolished";
}

interface LeaderStanding {
  domesticApprovalBp: BasisPoints;
  eliteSupportBp: BasisPoints;
  institutionalLegitimacyBp: BasisPoints;
  internationalStandingBp: BasisPoints;
  personalAuthorityBp: BasisPoints;
  scandalPressureBp: BasisPoints;
}
```

Standing is audience-specific. A leader can be popular domestically and distrusted abroad; a country can remain a reliable treaty partner while its leader is personally isolated. Traits affect decision tendencies within bounded rules but never replace material state.

### Country reputation is separate

Store reputation as evidence-backed dimensions between actors, not one universal score:

- treaty reliability;
- creditworthiness;
- military credibility/deterrence;
- diplomatic trust;
- human-rights/normative standing where the scenario uses it;
- threat perception;
- historical grievances and gratitude.

Some dimensions are bilateral and some are global rollups. They change from recorded behaviour: keeping or breaching agreements, default, aggression, aid, successful guarantees, atrocities, stable institutions and propaganda exposure. A narration cannot directly add “+20 reputation”.

### Valid office transitions

The authoritative commands are distinct:

```ts
type LeadershipCommand =
  | ScheduleElection
  | CertifyElectionResult
  | AppointOfficeHolder
  | SubmitResignation
  | AcceptOrProcessResignation
  | DeclareIncapacity
  | RecordVerifiedDeath
  | AttemptCoup
  | ResolveCoup
  | ActivateSuccessionRule
  | ChangeConstitutionalRule;
```

Each command has preconditions. Examples:

- an election result needs an eligible election, candidates and a deterministic/preset outcome process;
- a resignation needs the office-holder's agency or a valid NPC decision, an effective time and constitutional processing;
- death needs an accepted cause event or explicit historical/scenario record, not an unsupported sentence;
- assassination needs an operation, access, probability resolution and consequences; a successful result then records death;
- a coup needs actors, support, coercive capacity and a resolution tick; the model cannot jump straight to a new leader;
- succession selects only constitutionally/dynastically/movement-eligible candidates unless the transition itself changes the regime.

When unstructured input claims “President X died”, the fact-check gate classifies it as a proposal. If no valid source/mechanic/GM override supports it, the engine rejects the state change and the narrative must treat it as a rumour, false report or failed action according to context.

### Player resignation

If the player is role-playing the head of government/state, “I resign” is permitted but treated as a high-impact player-agency action:

1. resolve which office and whether the user means a threat, private plan or formal resignation;
2. show immediate constitutional successor/process and major forecast uncertainties;
3. require explicit confirmation unless irreversible-action confirmation was disabled;
4. commit a formal resignation and effective date;
5. activate succession, caretaker/election/appointment mechanics;
6. recalculate government cohesion, policies, projects, diplomatic expectations and leader-specific relations;
7. generate domestic and foreign reactions from the accepted transition state.

The campaign can then follow a configured perspective:

- **polity continuity**: the player controls the successor government;
- **person continuity**: the player continues as the former leader, potentially as opposition/exile/private actor;
- **prompt at transition**: choose after seeing the constitutional outcome.

The impact is not hardcoded as “resignation = crisis”. Derive it from:

- regime personalization and institutional strength;
- constitutional clarity and successor legitimacy;
- leader personal authority and tenure;
- elite/faction dependence on the leader;
- active war, emergency, election and economic conditions;
- unfinished personal promises and diplomacy;
- public approval, scandal and manner/timing of departure.

A routine resignation in a stable parliamentary system may cause a short cabinet transition. The exit or death of a highly personalist leader during war can trigger elite fragmentation, policy reversal, unrest, opportunistic foreign pressure and a prolonged succession struggle. Those effects are typed events and modifiers with visible causes, not merely dramatic text.

### Historical leader timelines and divergence

Scenario data supplies known office terms, electoral calendars, succession rules and dated historical anchors. They are starting evidence, not an immutable script. If alternate history changes eligibility, the constitution, survival or election conditions, the historical successor does not appear automatically on the real-world date.

The model receives only relevant public/private leader facts. Secret health or coup planning obeys information visibility. Memory records personal promises and rivalries against stable person and office-term IDs so a successor can inherit state obligations without inheriting every personal relationship.

## Technology, doctrine and projects

Technology is a set of capabilities and efficiencies, not a generic linear year number. Research capacity derives from education, R&D spending, institutions, industrial base and foreign cooperation. Technologies unlock formulas, equipment or project options; doctrine changes how forces use existing resources.

Construction, reform, intelligence operations, nuclear programs and major procurement are projects with cost schedules, prerequisites, progress, risk and completion effects. The player can see why progress is slow and what resources are reserved.

## Policies, actions and the role of language models

### Player command pipeline

```text
natural-language order
  → intent parser (rules first, LLM only where useful)
  → typed command draft
  → affected state/cost preview
  → clarification or confirmation for material ambiguity
  → domain validation
  → scheduled policy/project/operation
  → deterministic ticks
  → typed outcomes
  → narrative explanation
```

“Double the army” becomes a mobilisation/procurement plan with manpower, equipment, budget and time consequences. It cannot immediately set `military = 2 × old`.

### Management by intent and exception

Depth must not require the player to operate dozens of menus. The default interaction is:

1. set a goal, such as reducing fuel dependence or preparing a defensive line;
2. review a proposed typed policy/project package;
3. set budget, deadline and risk/red-line constraints;
4. delegate routine execution to deterministic ministries/theatre logic;
5. receive an exception only when a threshold, forecast, treaty deadline, blocked project or crisis needs attention;
6. drill down and override individual records only when desired.

Reusable policy templates and auto-rules can maintain reserves, maintenance, procurement or budget bands. An optional LLM minister may adapt strategy but has no hidden spending or state-change authority. See the comparative [grand-strategy mechanics analysis](research/02-grand-strategy-mechanics.md).

### NPC control

NPC AI has two layers:

1. deterministic baseline policy and legal action generator that keeps the world functional without an LLM;
2. optional LLM strategic planner that selects objectives, priorities, offers, threats and risk posture from a bounded action schema.

The planner can say “prioritize air defence imports and avoid escalation for six months.” The engine determines availability, price, delivery, readiness and consequences. Plans are persisted so an NPC does not reinvent its policy every turn.

### Bounded narrative shocks

Emergent events sometimes need facts not derived from ordinary equations: an earthquake, scandal, exceptional harvest, coup attempt or technological breakthrough. The model may propose:

```ts
interface ShockProposal {
  kind: ShockKind;
  targets: EntityRef[];
  start: GameDate;
  duration: Duration;
  severityBand: "minor" | "moderate" | "major" | "catastrophic";
  rationale: string;
  evidenceRefs: string[];
}

interface AppliedModifier {
  target: StatPath;
  operation: "add" | "multiply" | "cap";
  value: number;
  startsAt: GameDate;
  expiresAt?: GameDate;
  stackingRule: string;
  sourceEventId: EventId;
}
```

Rules map severity bands to scenario-bounded effects, validate frequency and prevent double counting. A model cannot output `GDP -70%` directly. High-impact or player-targeted shocks can require a reveal/acceptance policy depending on game mode.

## Data packs and historical calibration

### Build-time ETL, not runtime guessing

```text
official/raw snapshots
  → licensed download cache
  → source-specific parsers
  → ISO/stable polity identity mapping
  → units/base-year harmonization
  → reconciliation and gap rules
  → subnational allocation with confidence
  → invariant validation
  → reviewed scenario data pack
```

Each build records source release/vintage, retrieval date, license, checksums, transformations, imputations and reviewer notes. The campaign pins `dataPackId`, version and checksum.

### Source hierarchy for a modern baseline

Use primary/official sources where possible:

- UN World Population Prospects for national population, age and demographic rates;
- national statistical offices or reviewed geospatial population products for subnational allocation;
- IMF World Economic Outlook and World Bank indicators for macroeconomics, labour, finance, infrastructure and cross-checks;
- UN Comtrade for bilateral goods trade, aggregated into game commodities;
- FAOSTAT for agriculture, food balances and land/resource production;
- U.S. EIA and compatible official national/international sources for energy;
- SIPRI for military spending and major conventional arms transfers;
- official defence budgets, white papers and credible scenario research for personnel/equipment when licensing permits;
- Natural Earth only as a public-domain geometry/reference layer, not as proof of legal sovereignty or effective control.

Missing values use an explicit recipe such as interpolation, regional peer estimate or scenario-author choice. The recipe and confidence travel with the observation. An LLM can help prepare a research draft but is never the cited source.

### Historical and fictional scenarios

For old periods, figures are inevitably estimates. Store ranges and source disputes. Balance should not disguise uncertainty with decimals. Fictional scenarios use author-defined data packs and the same accounting validators.

### Historical trajectory without a historical script

A dated starting snapshot is insufficient: the 1916 war economy and the 1797 European economies also have inherited debt, projects, productive capacity, institutions, demographic momentum, price expectations, trade dependencies and an external military/commodity environment. Scenarios therefore define four layers:

1. starting observations;
2. persistent structural context and already active policies/commitments;
3. reference world series and conditional structural pressures;
4. endogenous divergence from accepted player/NPC actions.

```ts
interface StructuralPressure {
  id: string;
  activeRange: DateRange;
  scope: EntityRef[];
  prerequisites: Predicate[];
  drivers: StatPath[];
  intensityRule: FormulaRef;
  possibleResponses: CommandKind[];
  invalidatedBy: Predicate[];
  sourceRefs: SourceRef[];
}
```

Reference paths may supply global oil prices, technology diffusion or financial conditions with uncertainty bands. They are exogenous inputs only while their assumptions remain valid. Country outcomes are always recalculated from current state, policies, global environment and resolved shocks. A historical recession, war or revolution is a conditional anchor, never an appointment on the calendar.

Scenario authors do not need to enumerate every event. Generic mechanics cover ordinary consequences; selective pressures cover distinctive historical structures; bounded AI proposals fill unusual narrative gaps. Player actions change exposure and prerequisites, so their economic effects propagate rather than being mentioned once in prose.

## Save, replay and migration

Every save records:

- engine ruleset version;
- scenario and data-pack versions/checksums;
- RNG seed and consumed deterministic draw IDs;
- accepted commands and domain events;
- periodic snapshots for fast load;
- explicit GM overrides;
- AI call references, but not hidden reasoning as canonical state.

Replay reconstructs the same mechanical state from snapshot + events. Rule changes require a migration or an old-rules compatibility path; loading must not silently recalculate history under new formulas.

## UI and explainability

### National dashboard

- population and demographic trend;
- employment, output and inflation;
- budget, cash, debt and spending composition;
- production bottlenecks and strategic inventories;
- trade dependencies and sanctions;
- armed forces, equipment availability and readiness;
- active projects, policies and commitments;
- trend charts with real units and source/estimate indicators.

### Region panel and map modes

- population/workforce;
- controller/recognized sovereign/claims;
- sector capacity, resources and energy;
- infrastructure, supply access and damage;
- unrest/displacement;
- formations and front state subject to intelligence visibility.

### “Why did this change?”

Every derived delta provides its major contributions:

```text
Real manufacturing output: -8.4% this month
  -5.1 pp: electricity shortfall
  -2.4 pp: blocked imported components
  -1.7 pp: mobilised labour
  +0.8 pp: emergency overtime policy
```

AI can turn this ledger into readable prose, but the ledger exists first.

## Architecture and performance

Keep the existing TypeScript/Node direction. A JVM rewrite does not make these mechanics more correct. Implement the core as a pure TypeScript package with no React/Electron dependencies:

```text
packages/domain       IDs, commands, events, schemas, units
packages/sim-core     tick systems, formulas, invariants, seeded RNG
packages/data-packs   ETL contracts, provenance and validators
packages/ai           orchestration and typed planning schemas
apps/server           persistence and atomic transactions
apps/desktop          map, dashboards and inspector
```

Run long ticks in a worker thread/Web Worker so UI rendering never blocks. Store normalized records and event deltas, not repeated complete world JSON in every prompt. Profile before introducing Rust; a native module is justified only for a measured, isolated hotspot with a stable TypeScript boundary.

Initial performance budgets on the target Mac are engineering targets to measure, not promises:

- normal monthly global non-war tick: p95 under 100 ms;
- one year of peaceful global simulation: under 1.5 s without narration;
- one active multi-front war month: p95 under 250 ms;
- deterministic core state below 150 MB for a 250-polity modern scenario, excluding map tiles and event archive;
- no simulation tick on the renderer/UI thread.

If these fail, optimize data layout and recomputation graphs before changing language.

## Testing and balancing

### Hard invariants

- population conservation across births, deaths and migration;
- employed people never exceed eligible labour force;
- equipment and commodity stock conservation;
- balanced fiscal and inventory ledgers;
- no negative stock absent an explicit debt/backorder type;
- region sums reconcile with polity totals;
- formations cannot use personnel/equipment twice;
- territory and route access gates supply and taxation;
- identical seed + input produces identical results;
- AI payloads cannot write protected statistic paths.
- an office has at most one effective holder unless its rules explicitly define a collegial office;
- every office transition has a valid predecessor, cause, effective date and succession resolution;
- a person cannot be recorded dead, incapacitated or removed solely by narrative prose;
- polity obligations survive leader replacement unless a validated agreement/regime rule changes them;

### Model and property tests

- golden scenarios for one month, year and decade;
- property-based tests over random legal policies;
- save/replay and migration equivalence;
- stress tests for long wars, hyperinflation, mass mobilisation and partitions;
- idle-world plausibility tests against broad historical/calibration ranges;
- adversarial tool-call tests attempting impossible transfers or numeric overrides.

### Balance philosophy

Do not balance by secretly helping or punishing the player. Difficulty changes information, NPC planning, coordination, political tolerance and allowable assistance—not accounting identities. Scenario balance lives in starting conditions, goals and explicit rules.

## First vertical slices: World 1916/Russia and World 1797–1815

Both scenarios contain and advance the whole world at a minimum playable baseline. Russia inside World 1916 is the primary depth test. It combines industrial mass war, shortages, rail logistics, inflation, contested authority, mass politics, regime transition and possible civil conflict. World 1797 is a thinner parallel compatibility test, with Europe first curated for pre-industrial finance/logistics, dynastic and revolutionary legitimacy, coalitions, occupation and naval blockade.

The Russia slice must include:

1. national and regional population groups with uncertainty/provenance;
2. output, prices, employment/labour mobilisation, budget, debt and monetary/fiscal constraints at a sensible abstraction;
3. grain, fuel, industrial and military-production dependencies;
4. rail/river/port/road corridors, capacity allocation and key bottlenecks;
5. formations, personnel, equipment pools, readiness, replacement, maintenance and mobilisation;
6. dated fronts, occupation, sovereignty and effective control;
7. imperial government, Duma, command, movements, social support and succession/authority rules;
8. surrounding belligerents and national movements at sufficient resolution for war, peace and state-fragmentation choices;
9. deterministic monthly advancement and conditional crisis escalation without scripted February/October events;
10. dashboards and a causal explanation for every material change.

The World 1797 skeleton must load the same ledgers for every polity while disabling absent technologies and modern institutions. It adds global trade plus coalition, separate-peace, client-state, pre-industrial recruitment, sailing-fleet and blockade fixtures before those shared APIs are declared stable.

Acceptance example: redirecting trains toward the front can improve delivered military supply only through available rolling stock, junction and route capacity, while reducing civilian/grain throughput elsewhere. Political consequences follow measured shortages, legitimacy and organization. Dismissing a minister or even abdicating changes offices and coalitions through succession rules; it does not automatically resolve the crisis. In 1797, a blockade reduces trade through inaccessible routes and port/merchant capacity rather than a narrative percentage invented by AI.

## Explicitly deferred complexity

- individual citizens or household agents;
- individual firms, factories or every commodity SKU;
- tactical real-time battles and projectile simulation;
- a globally complete electric-grid or road traffic model;
- a fully endogenous central-bank/financial-market simulator;
- exact order-of-battle data where sources/licensing do not support it;
- neural or LLM-generated formulas inside the authoritative tick loop.

These exclusions limit micro-detail, not the importance of simulation. Population, economy, production, public finance, logistics, armed forces and their feedback loops remain first-class pillars.

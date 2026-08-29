# Target product and domain specification

## Product scope

My Open Historia is a single-player alternate-history statecraft sandbox. The player controls one polity or organization, issues natural-language commands, conducts diplomacy and advances time. It is a real grand-strategy simulation with persistent demographic, economic, fiscal, productive, logistical, military and political state. The presentation should remain understandable, but simplicity in the UI must not mean that the model invents numbers behind it.

### In scope

- causal world simulation;
- natural-language actions and diplomacy;
- stable campaign memory;
- map control, claims and territorial disputes;
- deterministic population, economy, public finance, production and trade;
- armed forces, equipment, mobilisation, logistics and aggregate combat;
- politics, technology and long-running projects;
- culture, language, religion, laws, institutions and organized interests at scenario-relevant resolution;
- modular scenario mechanics;
- inspectable/configurable AI orchestration;
- scenario creation, validation, versioning and import adapters;
- desktop-first operation with local or cloud models.

### Explicitly out of scope for the first architecture

- multiplayer/netcode;
- individual-citizen, individual-firm or every-weapon-SKU simulation;
- real-time tactical combat or projectile simulation;
- microservices;
- an autonomous agent loop that spends without a player-visible action;
- automatic scraping/copying of proprietary Pax scenario content.

## Core game loop

1. **Observe**: player reads timeline, map changes, active commitments and advisor reports.
2. **Decide**: player queues commands or writes diplomatic messages.
3. **Clarify**: ambiguous player commands may be refined, but never replaced without confirmation.
4. **Plan**: player intent and NPC strategy become typed policies, projects, diplomatic terms or operational objectives.
5. **Validate and preview**: domain rules reject impossible IDs, agency violations, unavailable resources and contradictory changes; material commitments show estimated cost/time.
6. **Simulate**: deterministic ticks apply accounting, demographic, production, logistics, political and combat rules.
7. **Reveal**: accepted mechanical outcomes appear event by event; map, statistics and timeline projections advance together.
8. **Intervene or continue**: the player can stop at a revealed event; unrevealed plans are discarded, while already committed mechanical time is retained.
9. **Commit**: one atomic revision stores the accepted prefix, ledgers, world state and rollback point.

## Canonical identity

All domain entities use stable opaque IDs. Names never identify objects.

```ts
type PolityId = string;   // e.g. polity:russian-empire, polity:french-republic
type RegionId = string;   // existing exact map ID where possible
type EventId = string;
type AgreementId = string;
type ConflictId = string;
type ProjectId = string;
type PersonId = string;
type OfficeId = string;
```

Each entity carries:

- canonical ID;
- canonical/default name;
- localized names;
- aliases with validity ranges;
- created/retired dates;
- provenance/source metadata where historical.

Provider prompts receive IDs beside readable names. Model output must return IDs in structured fields; a name resolver is a repair path, never the primary contract.

## World state v2

### Polity

```ts
interface Polity {
  id: PolityId;
  kind: "state" | "de_facto_state" | "organization" | "movement" | "person";
  names: LocalizedNames;
  aliases: Alias[];
  tags: string[];
  government?: GovernmentState;
  demographics?: DemographicStateRef;
  economy?: EconomyStateRef;
  armedForces?: ArmedForcesStateRef;
  politics?: PoliticalStateRef;
  derivedIndicators: DerivedIndicators;
  strategy: StrategyProfile;
  homeRegions: RegionId[];
  active: boolean;
}
```

Land is optional. Statistics and UI modules depend on `kind`, not on assuming every playable entity is a sovereign state.

### Measured state and derived indicators

Population, labour, production, budget, inventories, trade, equipment and casualties are canonical stocks and flows with real units. They are specified in [the deterministic simulation core](06-simulation-core.md).

Normalized values remain useful only for latent or presentation concepts such as legitimacy, administrative effectiveness, readiness, international standing and a comparative “economic power” display. Each derived indicator declares:

- its canonical inputs and formula version;
- its scale and interpretation;
- its effective date;
- causal contributions to the latest change;
- whether it is observable to the player;
- source/confidence metadata for scenario starting values.

An indicator can summarize canonical state but cannot replace it. The engine never resolves a procurement program from “military capacity 74” when personnel, money, equipment, industry and delivery state are available.

### Relations and commitments

```ts
interface BilateralRelation {
  a: PolityId;
  b: PolityId;
  trust: number;
  hostility: number;
  leverageAOverB: number;
  leverageBOverA: number;
  posture: "allied" | "friendly" | "neutral" | "wary" | "hostile";
  grievances: FactRef[];
}

interface Agreement {
  id: AgreementId;
  kind: "treaty" | "alliance" | "ceasefire" | "trade" | "guarantee" | "promise";
  parties: PolityId[];
  terms: AgreementTerm[];
  status: "proposed" | "active" | "breached" | "expired" | "terminated";
  validFrom?: GameDate;
  validUntil?: GameDate;
  evidence: EvidenceRef[];
}
```

A chat sentence is not automatically an agreement. It may create a proposal or promise; the domain layer changes status only when required parties explicitly accept.

### Leaders, offices and reputation

People, offices, governments and polities use separate stable IDs. A current leader is an `OfficeTerm`, not a mutable name field on a country. Elections, appointment, resignation, incapacity, verified death, coup and succession are separate commands with different preconditions and consequences.

Country reputation and leader standing are also separate. Treaty reliability and creditworthiness normally survive a cabinet change; personal trust, authority, scandal and popularity may not. Bilateral reputational dimensions derive from recorded actions and evidence. See [leaders, government continuity and reputation](06-simulation-core.md#leaders-government-continuity-and-reputation).

### Conflicts

```ts
interface Conflict {
  id: ConflictId;
  kind: "war" | "civil_war" | "insurgency" | "border_crisis";
  sides: ConflictSide[];
  aims: WarAim[];
  fronts: Front[];
  status: "active" | "ceasefire" | "settled";
  startedAt: GameDate;
  evidence: EvidenceRef[];
}
```

Fronts reference regions/control zones, participating formations, supply routes and operational state. Combat remains aggregate rather than tactical, but the canonical result is computed from formations, equipment, readiness, terrain and logistics—not a model-generated momentum adjective.

### Projects

Long-running construction, reform, mobilization and research use explicit projects:

```ts
interface Project {
  id: ProjectId;
  owner: PolityId;
  kind: string;
  target?: EntityRef;
  progress: number;
  resourcePlan: ProjectResourcePlan;
  startedAt: GameDate;
  expectedDuration?: Duration;
  status: "planned" | "active" | "blocked" | "completed" | "cancelled";
}
```

This replaces the pattern where the advisor says “it will take two years” but no state records that schedule.

## Domain commands and events

The player and AI both operate through commands. Commands are validated intent; domain events are accepted changes.

Examples:

```ts
type DomainCommand =
  | TransferControl
  | ChangeTerritorialStatus
  | StartConflict
  | ChangeConflictFront
  | ProposeAgreement
  | AcceptAgreement
  | BreachAgreement
  | ChangeRelation
  | StartProject
  | AdvanceProject
  | SetPolicy
  | ChangeBudgetAllocation
  | PlaceTradeOrder
  | MobilizePersonnel
  | ProcureEquipment
  | ScheduleProduction
  | ApplyValidatedShock
  | SpawnUnit
  | MoveUnit
  | CreateMapFeature
  | ChangePolity
  | SubmitResignation
  | RecordVerifiedDeath
  | ActivateSuccessionRule
  | ResolveLeadershipTransition;
```

Every accepted command produces:

- a stable event ID;
- before/after revision;
- effective game date;
- actor and source (`player`, `simulation`, `scenario`, `gm`);
- evidence/causal references;
- a reversible patch or reducer event;
- optional narrative projection.

## Invariants

These are executable validators, not prompt prose:

1. No event can change a region/control zone absent a matching typed command.
2. A region/control zone has exactly one effective controller at a time, but may have multiple claims and one recognized sovereign under the selected worldview.
3. A binding agreement involving the player cannot become active without an explicit player acceptance command.
4. The player's polity cannot declare war, cede territory, surrender or change regime without explicit intent.
5. A conflict front cannot jump through unrelated regions without a declared naval/airborne/special path.
6. A completed project must have existed and advanced through enough game time/capacity unless a GM override explicitly waives it.
7. References must use IDs existing at the transaction base revision.
8. Narrative dates must fall inside the simulated interval.
9. A turn's actions, date, timeline, world and chats share one revision.
10. A scenario migration either completes entirely or leaves the previous version untouched.
11. Population reconciles across births, deaths, migration, displacement and casualty ledgers.
12. Budget, debt, inventories, trade deliveries and equipment obey their accounting/conservation identities.
13. A formation cannot deploy personnel or equipment that is unavailable, already assigned or not yet delivered.
14. LLM output has no write authority over protected numeric paths; it must use a validated policy, project, operation or bounded shock command.
15. The same ruleset, data pack, seed and command stream produces the same mechanical state.

## Causality and alternate history

Historical events are represented as conditional “anchors”, not automatic calendar triggers.

```ts
interface HistoricalAnchor {
  id: string;
  earliestDate: GameDate;
  prerequisites: Predicate[];
  pressures: ConsequenceSeed[];
  status: "possible" | "invalidated" | "occurred" | "superseded";
}
```

If the player removes a cause—e.g. reaches a durable agreement that prevents a historical war—the anchor becomes invalidated. The underlying pressures may produce a different crisis, but the engine cannot replay the original event merely because its historical date arrived.

Scenarios do not need anchors for every real event. Use them for expected high-impact pressures and let the AI create emergent outcomes inside domain constraints.

## Difficulty

Difficulty is a structured policy profile:

- NPC planning horizon;
- risk tolerance and coordination;
- information uncertainty;
- optional, explicitly displayed starting handicaps or assistance profiles;
- concession thresholds;
- severity of setbacks;
- forgiveness for ambiguous player actions.

Difficulty must not:

- lower map/date correctness;
- make every polity irrationally hostile;
- cause the AI to forget agreements;
- change provider reasoning effort implicitly;
- guarantee player failure regardless of preparation.
- secretly create resources, equipment or statistical bonuses mid-campaign.

Model reasoning effort is a separate technical quality/cost setting.

## Modular mechanics

Scenario manifest enables modules:

- `territorialControl` (core, normally required);
- `diplomacy`;
- `demographics`;
- `economy`;
- `publicFinance`;
- `productionAndTrade`;
- `resourcesAndLogistics`;
- `armedForces`;
- `combat`;
- `projects`;
- `internalPolitics`;
- `societyAndIdentity`;
- `technology`;
- `customStats`;
- future world/map modules.

Disabled modules are omitted from UI, context and tool schemas. This saves tokens and avoids forcing troop mechanics into a personal/landless scenario.

## Turn planning and narration

### Fast mode

One model call can interpret an ambiguous command or create short narrative fields. Deterministic mechanics still calculate all numeric consequences. Suitable for ordinary diplomacy, small jumps and low-stakes NPC planning.

### Balanced mode

One main strategic plan call; deterministic validation and simulation; one bounded repair call only if the proposed intent is structurally invalid. Narrative is generated from accepted mechanical outcomes in the same or a cheap second call depending on size.

### Deep mode

For wars, partitions or major political transformations:

1. strategy/adjudication plan;
2. deterministic domain validation, tick execution and impact calculation;
3. narrative realization grounded in accepted commands.

Deep mode is selected by stakes or the user, not simply by message length.

## Event reveal and intervention

The simulation plan is stored as a pending transaction. Each revealed event has a prefix index. The map is projected from base revision + accepted prefix.

On continue: reveal next event.
On intervene: commit only the visible prefix, discard unrevealed output and queue the player's new command from that date.
On cancel before any reveal: commit nothing and charge/call telemetry remains visible.
On application crash: pending output is recoverable as uncommitted work or safely discarded.

## Diagnostics as a player feature

An “AI & simulation inspector” shows:

- current canonical facts and active commitments;
- context sections selected for the last call;
- approximate and provider-reported token counts;
- cached input tokens where available;
- provider/model/reasoning/temperature/output cap;
- latency by routing, provider and validation phase;
- retry/fallback lineage;
- proposed commands, rejected commands and repairs;
- state revision before/after;
- exportable redacted bug report.

API keys and full private prompt bodies are excluded from exports by default.

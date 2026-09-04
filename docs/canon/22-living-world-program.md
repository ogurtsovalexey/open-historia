# 22 — Living world program

Status: owner-directed target and implementation contract, 2026-09-04.

This document defines the next product architecture after the Europe 1935
Strategic V4 work. It starts from the finished player experience and works
backward to repository changes. It supersedes older canon wherever an older
contract requires every future capability, goal, crisis, resource, recipe or
institution to be enumerated in the starting scenario.

The existing deterministic engine, evidence discipline, bounded AI context,
map shell, atomic revisions and replay guarantees are retained. The closed
future catalog and engine-shaped player UI are not.

## 1. Finished product

Open Historia is a personal single-player alternate-history game in which:

- the player expresses political, economic, military, social and scientific
  intentions in natural language;
- rulers, governments, factions and movements make strategically meaningful
  decisions of their own;
- AI determines the semantic direction of history: what actors attempt, what
  new ideas mean, which field changes and which qualitative pace a process
  takes;
- the deterministic engine determines feasibility, exact quantities,
  conservation, aggregation, timing and the committed result;
- only committed state and its causal ledger are historical truth;
- history may diverge without limit, but every divergence must have a causal
  path through the current world.

The concise product rule is:

> **AI creates history; the engine prevents it from lying.**

This is not Europa Universalis or Hearts of Iron with a text box. The player
does not routinely service formula inputs, division templates, basis-point
sliders or production queues. Those mechanics exist to make free-form
decisions honest and consequential. Normal play is a sequence of intentions,
negotiations, material situations and time advances.

## 2. Player promise and scope

The player may attempt to create communism in 1200, investigate electricity in
1500, establish an institution with no historical counterpart, avoid an
authored war or transform a polity into an unfamiliar form of government.

The game must not reject an initiative solely because its name is
anachronistic. It must evaluate the initiative against the world that actually
exists:

- prior knowledge and demonstrated practices;
- materials, production and infrastructure;
- administrative, scientific and organizational capacity;
- available people and specialists;
- funding and opportunity cost;
- interested and resisting groups;
- communication and diffusion;
- earlier player and AI decisions.

A name is not an accomplishment. `We invented electricity` is an untrusted
claim. At most, a valid player order creates an investigation or development
process. Practical effects appear only after validated stages.

"Any scenario" means any historical, counterfactual or fictional political
world expressible with the universal primitives in this document: territory,
population, groups, polities, resources, production, institutions, knowledge,
relations, commitments, conflicts and processes. It does not mean arbitrary
executable scenario code or automatic support for an unrelated physics system.

## 3. Authority and truth hierarchy

### 3.1 Authority

| Owner | Authority |
|---|---|
| Scenario | Starting state, world laws, enabled modules, starting catalogs and source provenance |
| Engine | Canonical state, exact numbers, feasibility, aggregation, validation, effects, time and revisions |
| Strategic AI | Actor goals, strategy, selection among legal actions, proposed initiatives and qualitative process pace |
| Semantic resolver AI | Meaning of a new concept or stage transition, affected domains and causal explanation |
| Player | Intent, negotiation and confirmation of material actions for the controlled subject |
| Narrator/advisor | Explanation of committed results and comparison of engine-provided alternatives |
| Campaign memory | Bounded retrieval index over history; never an independent source of truth |
| UI | Projection and command surface; never state authority |

The amended boundary is:

> AI selects the semantic transition and qualitative pace. The engine checks
> feasibility, translates it into exact quantities and commits the result.

### 3.2 Truth layers, in precedence order

1. Current canonical state and the revision-linked causal ledger.
2. Scenario world rules and immutable starting facts.
3. Per-actor knowledge: public facts, owned facts and evidence-backed
   intelligence. This is epistemic state, not omniscience.
4. Derived campaign-memory summaries and narrative history.
5. Untrusted player and model text.

If memory or narrative conflicts with canonical state, canonical state wins.
If a player claim conflicts with the ledger, the claim is contradicted and
cannot become a command.

### 3.3 Explicit counterfactual editing

Ordinary play never rewrites the past. An intentional retcon is available only
through an explicit editor/Game Master operation. It creates a new revision
branch carrying visible intervention provenance. It is never inferred from an
ordinary order or diplomatic message.

## 4. Authorized hard cut

Compatibility debt must not preserve contradictory architecture. This program
authorizes the integration owner to:

- replace `EconWorldState` with `WorldStateV2`;
- replace engine scenario `/1` and the parallel ScenarioV2 runtime boundary
  with one compiled Scenario V3 contract;
- replace Strategic V4 with a V5 brief that supports both frozen choices and
  open initiatives;
- remove `packages/sim-core` after its useful invariants and tests are ported;
- remove the legacy path where model-authored `impacts` write authoritative
  numeric state;
- remove duplicated UI formulas and model-generated numeric stat sheets;
- reject incompatible old saves explicitly instead of inventing a migration;
- delete obsolete adapters, fixtures and dead UI after the new vertical path
  is green.

Europe 1935 must be migrated. Old development fixtures are migrated only when
they retain a useful regression; otherwise delete them. No heuristic may
invent missing historical inputs.

## 5. Program sequence

Implementation is delivered in the following order. Each numbered section is
one integration phase owned end to end by one strong agent. Read-heavy source
research and mechanical fixture work may be delegated only after the phase
contract and failing tests exist.

1. Canon reset.
2. World State V2.
3. Territorial causality, population and manpower origins.
4. Scenario V3.
5. Claims, evidence and prompt-spoof protection.
6. Generic processes and effects.
7. Strategic AI V5 and the semantic resolver.
8. Existing-domain migration and legacy deletion.
9. Intent-first UI.
10. Europe 1935 migration.
11. Napoleonic Europe 1805.
12. Central Mesoamerica 1450.
13. Automated cross-era acceptance.
14. Codex-operated UI playtests.
15. Defect repair and repeated affected playtests.

The program is not complete at an intermediate green build.

## 6. Phase 1 — canon reset

Update `docs/principles.md`, `AGENTS.md`, `docs/canon/README.md`, canon 00, 02,
05, 07, 15 and 21 so that they point to this document and do not silently
retain a conflicting future-catalog rule.

The new binding principles are:

1. Scenario is starting law, not a closed future.
2. AI owns semantic direction; the engine owns numeric truth.
3. National aggregates derive from primary territorial and entity state.
4. Player/model prose is untrusted input.
5. Runtime concepts require evidence, validation and staged adoption.
6. Campaign memory is a retrieval index, not canonical domain state.
7. Scenario catalogs replace hidden modern or European assumptions.
8. Normal UI exposes intent and consequences, not engine parameters.

Acceptance: a grep/audit finds no active canon statement that forbids all
runtime concepts or treats `techEra` as a universal ceiling.

## 7. Phase 2 — World State V2

### 7.1 Files

Create:

```text
packages/engine/src/world/schema.ts
packages/engine/src/world/control.ts
packages/engine/src/world/selectors.ts
packages/engine/src/world/invariants.ts
packages/engine/src/world/revision.ts
```

The root type is `WorldStateV2`, not `EconWorldState`. It contains the shared
header, world rules, module manifest, catalogs and canonical entity/process
collections, with optional domain projections.

Minimum shape:

```ts
interface WorldStateV2 {
  schemaVersion: 'open-historia-world/2';
  scenarioId: ScenarioId;
  month: GameMonth;
  turn: number;
  revision: WorldRevisionId;
  worldRules: WorldRules;
  modules: ModuleManifest;
  catalogs: ScenarioCatalogs;
  polities: PolityState[];
  regions: RegionStateV2[];
  characters: CharacterState[];
  groups: GroupState[];
  concepts: ConceptState[];
  processes: WorldProcessState[];
  knowledge: KnowledgeState;
  economy?: EconomyState;
  diplomacy?: DiplomacyState;
  finance?: FinanceState;
  politics?: PoliticsState;
  military?: MilitaryStateV2;
  identity?: IdentityState;
  campaign?: CampaignState;
}
```

### 7.2 Primary versus derived state

Canonical primary data includes regional population, control, local
activities/resources/capacity, treasury, national stockpiles, formations,
agreements and processes.

The following are derived, not independently mutable:

- legal, controlled and administered polity population;
- total workforce and tax base;
- total resource access and regional output;
- mobilization ceiling and available manpower;
- mobilized totals when derivable from formations;
- number of controlled regions;
- aggregate identity pressure and supply access.

Implement one selector used by the engine, server, UI and AI:

```ts
derivePolitySnapshot(state, polityId): DerivedPolitySnapshot
```

It returns at least:

```ts
{
  legalPopulation;
  controlledPopulation;
  administeredPopulation;
  workforce;
  taxBase;
  recruitablePopulation;
  mobilizationCeiling;
  availableManpower;
  overmobilizedBy;
  regionalOutput;
  resourceAccess;
  supplyCapacity;
  identityPressure;
}
```

If a derived cache is persisted for performance, invariants must recompute and
byte-compare it before commit.

### 7.3 Control model

Replace ambiguous ownership-only semantics with:

```ts
interface RegionalControl {
  legalOwnerPolityId: PolityId;
  actualControllerPolityId: PolityId;
  administrationAccessBp: BasisPoints;
  extractionAccessBp: BasisPoints;
  recruitmentAccessBp: BasisPoints;
  integrationBp: BasisPoints;
}
```

The contract must represent sovereignty, occupation, autonomy, indirect
control and contested control. The map may consume a simplified projection,
but map ownership is never authoritative.

### 7.4 Acceptance

- One world state and one revision are the live SSOT.
- No server or UI module recomputes national totals independently.
- The same state yields byte-identical derived snapshots.
- Mixed V1/V2 state fails explicitly before mutation.
- Existing useful replay and golden invariants are ported before old state
  code is deleted.

## 8. Phase 3 — territory, population and military causality

### 8.1 One territorial transition

Implement one internal transaction:

```ts
applyTerritorialTransition(state, transition): TerritorialTransitionResult
```

Peace, annexation, occupation, liberation, diplomatic transfer and explicit
Game Master edits all use it. Direct field writes are forbidden by tests.

The region retains its population, composition, resources, activities,
infrastructure, local institutions, damage and active local processes.
Treasury and national stockpiles do not transfer unless explicit terms say so.

In the same revision, recompute for the old and new controllers:

- legal/controlled/administered population;
- workforce, output, consumption and tax base;
- resource and route access;
- recruitment and mobilization ceilings;
- supply connectivity;
- identity mismatch and political pressure;
- goals, crises and strategic triggers.

Occupation grants only access allowed by the control record. It is not full
integration.

### 8.2 Personnel origin

Every formation carries conserved origin rows:

```ts
personnelOrigins: Array<{
  regionId: RegionId;
  personnel: number;
}>
```

Rules:

- mobilized people remain part of regional population but leave workforce;
- demobilization returns surviving people to workforce;
- combat losses reduce formation manpower and the corresponding origin-region
  populations deterministically;
- territorial transfer does not transfer deployed formations;
- the former controller loses new recruitment access immediately;
- the new controller gains access according to actual control, integration,
  identity acceptance and administration;
- if territory loss leaves mobilized manpower above the new ceiling, keep the
  formations and expose `overmobilizedBy`; apply reinforcement, supply and
  political pressure instead of deleting soldiers.

Remove redundant `manpowerCeiling`, `manpowerPool`, `mobilized` and equipment
totals wherever they can be derived safely from primary state.

### 8.3 Required tests

1. Transferring a ten-million-person region changes both polities' derived
   populations, economies and recruitment in the same revision.
2. Annexation and occupation produce different tax and recruitment access.
3. Losing territory below the already-mobilized level produces overmobilization
   without deleting formations.
4. Mobilization reduces workforce; demobilization restores survivors.
5. Combat losses reduce population at origin and conserve the explained world
   population identity.
6. Peace recalculates economy, military, politics and campaign atomically.
7. World population changes only through births, deaths, migration when
   enabled, and recorded losses.

## 9. Phase 4 — Scenario V3

### 9.1 One compiled contract

Replace the runtime split between engine fixture `/1` and ScenarioV2 with:

```text
open-historia-scenario/3
```

Authoring profiles are `historical`, `fictional` and `development`. All compile
deterministically into the same `WorldSeedV2`. Profiles differ only in
provenance requirements:

- historical values require source references, method, confidence and TODOs;
- fictional values require explicit authored assumptions;
- development values are visibly synthetic test inputs.

### 9.2 Scenario-owned catalogs

Move these from universal hard-coded content to scenario declarations:

- resources and goods;
- extraction and production activities;
- processing recipes;
- institution and office catalogs;
- formation archetypes and equipment classes;
- finance forms and available instruments;
- control forms;
- UI terminology for the era.

The engine retains only universal effect and conservation primitives. A
scenario cannot upload executable code.

A medieval scenario must not silently receive coal, oil, bonds, a finance
minister or an industrial research establishment. A future scenario may
declare completely different resources and institutions.

### 9.3 World rules

Add:

```ts
interface WorldRules {
  physicalModel: string;
  knowledgeBaseline: string[];
  communicationModel: string;
  governmentModel: string;
  militaryModel: string;
  hardProhibitions: string[];
  plausibilityContext: string[];
}
```

`hardProhibitions` expresses actual scenario laws, not ordinary historical
unlikelihood. Historical date and `plausibilityContext` influence feasibility
without constituting a hard future ceiling.

### 9.4 Validation command

Add root command:

```text
npm run validate:scenarios
```

Wire it into `npm run ci`. It validates IDs, map links, control, population
sums, recipes, resource graphs, cross-module references, provenance, absence
of undeclared catalog entries, valid starting revision and a deterministic
AI-free twelve-month run.

## 10. Phase 5 — claims, evidence and prompt-spoof protection

### 10.1 Player input contract

Introduce:

```ts
interface PlayerInputInterpretation {
  questions: Question[];
  claims: Claim[];
  requestedActions: RequestedAction[];
  proposedInitiatives: ProposedInitiative[];
}

type ClaimStatus = 'supported' | 'contradicted' | 'unknown' | 'subjective';
```

Past-tense text is never automatically a command or fact. A contradicted claim
may become a request, propaganda proposal or role-play response only after
explicit interpretation; it cannot mutate the claimed domain.

### 10.2 Evidence registry

Create a common evidence type:

```ts
interface EvidenceRecord {
  evidenceId: EvidenceId;
  revision: WorldRevisionId;
  kind: string;
  entityRefs: string[];
  eventRefs: string[];
  canonicalPointers: string[];
  visibility: EvidenceVisibility;
}
```

Models may cite only supplied evidence IDs. They cannot create evidence IDs or
canonical pointers.

### 10.3 Prompt separation

Every state-changing model call serializes physically separate sections:

```text
[AUTHORITATIVE_STATE]
[ACTOR_KNOWLEDGE]
[DERIVED_CHANGES]
[LEGAL_CHOICES]
[OPEN_INITIATIVE_CONTRACT]
[UNTRUSTED_PLAYER_TEXT]
```

User text never appears in `AUTHORITATIVE_STATE`. The engine, not the prompt,
enforces this boundary.

### 10.4 Campaign memory

Campaign-memory prose remains retrieval text only. Every active entry must
link to canonical pointers or revision-linked events. A conflict with current
state makes it stale/superseded. Memory can never restore an entity, transfer a
region, complete a project or apply a modifier.

### 10.5 Adversarial acceptance

Tests must cover a fabricated old conquest, invented technology, invented
army, `ignore the state` instruction, invented evidence ID, stale revision,
false diplomatic statement, claim hidden in a project name and a once-true
memory fact that is no longer active. No case may mutate state outside an
explicitly validated action.

## 11. Phase 6 — generic concepts, processes and effects

### 11.1 Files

Create:

```text
packages/engine/src/processes/schema.ts
packages/engine/src/processes/feasibility.ts
packages/engine/src/processes/reducer.ts
packages/engine/src/processes/effects.ts
packages/engine/src/processes/selectors.ts
```

### 11.2 Concepts

```ts
interface ConceptState {
  conceptId: ConceptId;
  type:
    | 'technology'
    | 'ideology'
    | 'religious-movement'
    | 'institution'
    | 'doctrine'
    | 'economic-practice'
    | 'scientific-theory';
  displayName: LocalizedText;
  description: LocalizedText;
  origin: ConceptOrigin;
  parentConceptIds: ConceptId[];
  supportingEvidenceIds: EvidenceId[];
  domains: string[];
  status: ProcessStage;
  provenance: ProvenanceRecord;
}
```

The application allocates the ID only after accepting a proposal.

### 11.3 Processes

```ts
interface WorldProcessState {
  processId: ProcessId;
  conceptId: ConceptId | null;
  kind: string;
  sponsors: EntityId[];
  affectedEntities: EntityId[];
  stage: ProcessStage;
  progressBp: BasisPoints;
  momentumBp: BasisPoints;
  resistanceBp: BasisPoints;
  funding: number;
  capacityUse: CapacityUse[];
  currentPace: ProcessPace;
  blockers: EvidenceId[];
  accelerators: EvidenceId[];
  startedMonth: GameMonth;
  lastDecisionMonth: GameMonth;
}

type ProcessStage =
  | 'proposed'
  | 'emerging'
  | 'organized'
  | 'demonstrated'
  | 'adopted'
  | 'institutionalized';

type ProcessPace = 'stalled' | 'slow' | 'steady' | 'fast' | 'breakthrough';
```

Scenarios may localize stage names but may not bypass their semantics.

### 11.4 Effect primitives

The engine exposes a strict, extensible union, initially:

```text
capacity.modify
efficiency.modify
resource-access.modify
recipe.unlock
project-capacity.modify
administrative-access.modify
recruitment-access.modify
supply-capacity.modify
group-support.shift
identity-share.shift
legitimacy.modify
relation.modify
knowledge.reveal
institution.create
```

Every effect declares scope, duration, stacking, bounds, causal source and a
ledger record. AI chooses compatible semantic families and targets; it never
supplies the authoritative numeric delta.

### 11.5 Feasibility envelope

The engine builds:

```ts
interface FeasibilityEnvelope {
  allowedDirections: string[];
  allowedPaces: ProcessPace[];
  compatibleEffectFamilies: EffectKind[];
  accelerators: EvidenceId[];
  blockers: EvidenceId[];
  opportunityCosts: PreviewCost[];
  evidenceIds: EvidenceId[];
}
```

AI selects direction, pace and effect families. The engine validates the
selection, computes exact progress/cost, applies resistance and commits stage
effects. Between AI checkpoints, a process follows its last accepted course
deterministically.

Checkpoints occur at stage boundaries, material blocker/accelerator changes,
funding changes, political conflicts and scheduled strategic review.

### 11.6 Domain reuse

- Existing `Project` becomes a specialized process view.
- Authored capabilities become starting concepts.
- Research is a concept-adoption process.
- Political escalation, reforms, mobilization and identity integration reuse
  the process kernel where applicable.
- Specialized reducers may adapt temporarily, but duplicate progression logic
  is deleted after migration.

## 12. Phase 7 — Strategic AI V5

Create `StrategicBriefV5`, `StrategicDecisionV4` and
`SemanticChangeProposalV1`.

V5 retains the validated strengths of V4: one private actor, exact revision,
evidence, frozen legal choices, deterministic dry-run previews, bounded
context, candidate audit, durable plan, no full map and stable commit order.

The decision has three distinct channels:

```ts
interface StrategicDecisionV4 {
  selectedChoiceIds: ChoiceId[];
  processDecisions: ProcessDecision[];
  initiativeProposals: SemanticChangeProposalV1[];
  durablePlan: DurablePlan;
  evidenceIds: EvidenceId[];
}
```

`selectedChoiceIds` cover existing executable objects. `processDecisions`
choose direction and qualitative pace for current processes.
`initiativeProposals` propose a new technology, ideology, institution,
doctrine, movement or unusual project.

An open initiative may create only a validated `proposed` process. It may not
immediately transfer territory, create manpower/resources, sign an agreement,
create a completed capability or assert a past event.

A logical semantic-resolver role runs only when a concept is proposed or a
process reaches a semantic checkpoint. It determines what the emerging stage
means and which effect families are relevant. The engine owns all numbers.

Scheduling rules:

- scheduled actor review remains quarterly by default;
- material war, proposal, crisis, government, occupation, peace, default and
  process checkpoints are immediate;
- ongoing processes do not require monthly model calls;
- a required failed strategic/semantic call pauses at the same revision;
- accepted packages commit in stable polity order;
- recorded decisions replay with zero model calls.

## 13. Phase 8 — existing-domain migration

### 13.1 Economy

- Use scenario resources and recipes.
- Derive labor from regional population minus mobilized origin rows.
- Apply control access before output/tax aggregation.
- Make every UI/AI aggregate use `derivePolitySnapshot`.

### 13.2 Diplomacy and trade

- Keep typed relations, proposals, counters, agreements and conserved trade.
- Natural-language chat is not a state write.
- A promise or ultimatum becomes canonical only through a typed commitment
  acknowledged under the relevant rules.
- Lies may influence beliefs/relations when an explicit deception action is
  accepted, but they never rewrite global truth.

### 13.3 Finance and statecraft

Replace universal modern finance assumptions with scenario profiles such as
central tax, tribute, domain income, commercial republic and planned
allocation. Bonds exist only when the scenario/institutions enable them.

Projects become player-facing views of processes. Standard UI offers policy
stances and visible trade-offs rather than raw basis-point editing.

### 13.4 Politics and characters

- Keep scenario-authored starting factions and authority.
- Permit a validated runtime movement to become a faction.
- Declare offices and titles in the scenario.
- Store ideology as a concept relationship, not a free text trait.

### 13.5 Military

- Keep aggregate formations, supply, occupation and deterministic combat.
- Use population-derived manpower origins.
- Model blockade as route interdiction/capacity effects; do not add tactical
  fleets or division-level order of battle for this program.

### 13.6 Identity and capabilities

- Keep culture and religion as separate regional distributions.
- Add dynamic ideological/religious movements through concepts/processes.
- Replace authored-only future capabilities with starting concepts plus
  runtime concept creation and staged adoption.

### 13.7 Campaign

- Keep soft horizon, non-terminal continuation and multidimensional legacy.
- Permit AI-proposed durable directions grounded in current evidence.
- Engine conditions trigger a material situation; semantic AI frames what the
  crisis means and actors choose positions.
- Legacy reads engine values only.

### 13.8 Advisor and statistics

For engine-driven games, remove model-generated authoritative statistics.
All numbers come from engine selectors. AI explains, compares and recommends;
missing numbers remain unknown.

### 13.9 Legacy removal gate

After the new live vertical path is green, remove model-authored numeric
`impacts`, parallel legacy date/ownership/economy writes, duplicated UI
formulas, `packages/sim-core` and dead adapters/UI. Root scripts and CI must no
longer reference deleted packages.

## 14. Phase 9 — intent-first UI

Retain the inherited map shell. Replace the default information architecture
with these player-level surfaces:

1. **Briefing** — what materially changed and why.
2. **Orders** — free-form intentions and their interpretation.
3. **Diplomacy** — conversations and canonical commitments.
4. **Country** — compact engine-derived condition.
5. **Situations** — decisions that require intervention.
6. **Details** — deep domain data and debug/audit views.

The current nine peer tabs may remain temporarily, but the end state places
engine-shaped economy/statecraft/politics/military/society/campaign details
under `Details`. A normal turn must not require visiting every domain.

### 14.1 Order preview

Before confirmation show:

- interpretation of the player's intent;
- supported, contradicted and unknown claims;
- typed actions to be queued;
- new initiatives/processes to be created;
- cost and duration ranges derived by the engine;
- principal risks and opportunity costs;
- affected regions/groups;
- evidence used.

Standard mode hides basis points and schema IDs. Audit/debug mode may expose
them.

### 14.2 Process card

Show concept/process name, stage, chosen direction, progress, accelerators,
blockers, spending, last semantic decision and next checkpoint.

### 14.3 Causal explanation

Every material changed number has a `Why?` drill-down built from the ledger.
It must separate territorial transfer, births/deaths, combat losses, policy,
production, trade and process effects rather than emitting generic prose.

### 14.4 Automated UI coverage

Extend Playwright at desktop 1440×900 and mobile 390×844 to cover scenario
creation, map selection, free-form order, false claim, preview, confirmation,
time advance, process card, territorial transition, population/economy/manpower
recalculation, clean console, reachable scrolling and keyboard access to the
primary loop.

## 15. Phase 10 — migrate Europe 1935

Migrate the existing benchmark without reintroducing a closed future:

- preserve historical provenance and geography;
- compile its modules into World State V2;
- convert starting capabilities to concepts;
- convert active projects to processes;
- add regional control and personnel origins;
- retain conditional-history anchors only as applicability evidence;
- ensure no authored milestone directly fires an event;
- retain unsupported/baseline polity distinctions explicitly.

Europe 1935 remains a regression and one of the final manual playtests.

## 16. Phase 11 — Napoleonic Europe 1805

Create historical scenario `scenario:napoleonic-europe-1805`, starting
`1805-01-01`.

Minimum active or strategically material subjects:

- French Empire;
- United Kingdom;
- Austria;
- Russia;
- Prussia;
- Spain;
- Ottoman Empire;
- Sweden;
- Denmark–Norway;
- Naples;
- Kingdom of Italy;
- Bavaria or another researched major German ally.

Requirements:

- 80–160 historically appropriate regions;
- regional population and manpower origins;
- era resources/activities including food/grain, timber, iron, horses, cloth,
  arms and gunpowder where supported by research;
- land formations, commanders and supply links;
- coalition obligations and bilateral commitments;
- sea and land trade routes;
- abstract blockade/route interdiction without tactical naval simulation;
- rulers, governments and material factions;
- starting practices/technologies represented as concepts;
- reforms represented as processes rather than instant modifiers;
- no guaranteed Austerlitz, coalition defeat or scripted territorial outcome;
- source/provenance quality equal to the historical Scenario V3 profile.

Historical events may be conditional evaluation anchors only.

## 17. Phase 12 — Central Mesoamerica 1450

Create historical scenario `scenario:central-mesoamerica-1450`. This is the
deliberately dissimilar architectural test selected by the owner-requested
design process: non-European, non-industrial, tribute-centered and without
modern state institutions.

Starting subjects must be resolved by research and include at least:

- Tenochtitlan;
- Texcoco;
- Tlacopan;
- Tlaxcala;
- the Tarascan state;
- Cholula;
- one Mixtec subject;
- one additional independent regional subject justified by sources.

Requirements:

- 30–70 historically defensible regions;
- scenario resources such as maize/food, obsidian, cotton, cacao, timber,
  stone and luxury goods, as sources support;
- tribute finance rather than universal bonds;
- localized offices, titles and authority;
- no undeclared coal, oil, steel or modern industry;
- military strength derived from population and tribute obligations;
- Triple Alliance relationships represented as actual agreements, not one
  unexplained monolithic state unless research requires otherwise;
- religious, dynastic and tributary pressures;
- dynamic concepts and institutions;
- no hidden expectation of European contact or conquest;
- full historical-profile provenance.

This scenario must demonstrate that the core is not merely Europe 1935 with
renamed countries.

## 18. Phase 13 — cross-era machine acceptance

Add compact automated fixtures in addition to the three product scenarios.

### 18.1 False-history fixture

The player says they conquered a named region ten turns earlier and possess an
invented army/technology. The claim is contradicted, no state changes and AI
context retains the authoritative history.

### 18.2 Electricity-in-1500 fixture

An electrical initiative begins as a proposed investigation. Weak material
and institutional conditions prohibit `fast`/`breakthrough`; sustained
investment and preceding concepts can later expand the envelope. No wording
can jump directly to mass electrification.

### 18.3 Communism-in-1200 fixture

The same player label produces a context-appropriate communal, religious,
peasant or urban movement based on actual groups and institutions. It does not
invent an industrial proletariat. Later social changes may transform its
meaning through recorded semantic checkpoints.

### 18.4 Territory fixture

A populous region transfer affects both sides' population, economy, manpower,
politics and supply atomically while preserving global population and local
assets.

### 18.5 Cross-scenario leakage fixture

The Mesoamerican brief contains no undeclared modern resource, institution,
office or finance action. The Napoleonic brief uses its own catalogs. Europe
1935 remains unchanged by loading either scenario.

### 18.6 Replay and epistemics

Recorded AI decisions replay byte-identically without calls. Opponents cannot
see hidden forces, secret commitments, unknown concepts or private evidence.

## 19. Phase 14 — Codex-operated UI playtests

Automated tests do not satisfy this gate. Codex must operate the real
production-equivalent UI as a player after implementation.

### 19.1 Method

For each run Codex must:

- create a fresh game through the visible UI;
- select the player polity through the visible UI;
- issue orders, negotiate, confirm and advance time only through UI controls;
- not use Cheats, Game Master, direct state writes or direct gameplay APIs;
- use a real configured strategic model rather than a mocked provider;
- use read-only state inspection only to audit the result after a turn;
- stop, diagnose, fix and replay an affected path when a material UI or state
  defect appears.

### 19.2 Mandatory runs

| Scenario | Minimum user decision turns | Minimum simulated time |
|---|---:|---:|
| Europe 1935 | 10 | 24 months |
| Napoleonic Europe 1805 | 10 | 24 months |
| Central Mesoamerica 1450 | 10 | 24 months |

Each run is a separate save and includes:

- a material order before most advances;
- at least one diplomatic initiative;
- at least one economic/state process;
- at least one open new-concept initiative;
- at least one political or social consequence;
- at least one military situation or a documented strategic avoidance of war;
- at least one causal `Why?` inspection;
- a legacy assessment at the end.

Across the three runs, at least one populated region must be occupied or
transferred and the old/new population, economy and manpower effects audited.

In every run Codex deliberately submits one false claim about past state. The
game must contradict it or reinterpret it as a requested action/propaganda
without changing the claimed facts.

Suggested open initiatives:

- Europe 1935: a materially alternative political or technological program;
- Napoleonic 1805: accelerated communication, administration or military
  organization;
- Mesoamerica 1450: a novel social institution or radical investigation that
  tests the scenario's own material basis.

### 19.3 Visual audit

Codex visually inspects desktop and mobile rendering of the map, panels,
scrolling, order preview, process cards, event presentation and causal
drill-down. It checks for overlap, unreachable controls, silent horizontal
overflow, unreadable text, stale state and a loop that requires visiting every
detail tab.

### 19.4 Evidence artifacts

Commit redacted reports:

```text
docs/reports/playtests/europe-1935-10-turn.md
docs/reports/playtests/napoleonic-1805-10-turn.md
docs/reports/playtests/mesoamerica-1450-10-turn.md
docs/reports/playtests/final-cross-scenario-assessment.md
```

Each report states player polity, provider/model/effort, dates/revisions, every
turn's intent and outcome, important numeric changes, semantic decisions,
defects found, fixes and replay result. Raw prompts/responses/runs remain
gitignored and must contain no committed secrets.

## 20. Final Definition of Done

The program is complete only when all of these report their actual values:

1. `npm run validate:scenarios` passes all shipped scenarios.
2. Root `npm test` passes.
3. Root `npm run typecheck` passes.
4. Root `npm run lint` adds no violations.
5. Root `npm run build` passes.
6. Root `npm run test:ui` passes desktop and mobile coverage.
7. Determinism guard and recorded-decision replay pass.
8. One live World State V2 is the numeric SSOT.
9. Legacy model-authored numeric effects and duplicate kernels are removed.
10. Europe 1935 is migrated.
11. Napoleonic Europe 1805 is implemented and source-audited.
12. Central Mesoamerica 1450 is implemented and source-audited.
13. False claims cannot mutate canonical state.
14. Territorial change atomically affects population, economy and manpower.
15. Runtime concepts and qualitative AI pace pass the 1200/1500 fixtures.
16. Three separate Codex UI runs complete at least ten player turns and 24
    simulated months each with committed reports.
17. Material defects found during play are fixed and affected paths replayed.
18. `git status` is clean and no secret/raw provider artifact is tracked.

The integration owner must not close the program with only `architecture
implemented` or `tests green`. The product is a game; it must be played through
the user interface and demonstrate causal, cross-era, living behavior.

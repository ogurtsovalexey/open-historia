# 23 — Living world execution backlog

Status: implementation companion to [22 — Living world program](./22-living-world-program.md).  This document turns that product contract into merge-sized work.  It does not weaken or replace canon 22.  Where a task below appears to conflict with canon 22, canon 22 wins and this backlog must be corrected.

Original baseline audited: `feature/campaign-memory` at `5eb4fb73`, after the production Europe 1935, Strategic V4, localization and Codex transport changes.

## 0. Current checkpoint and low-context handoff (2026-09-05)

This section is the authoritative resume point for the next implementation
agent. Do not restart the merge ladder and do not reconstruct completed work
from the old baseline. The current pushed implementation checkpoint is
`3d14edc` on `feature/campaign-memory` (`feat(ai): run staggered Strategic V5
opponents`). The documentation commit containing this section follows it.

The next owner is expected to work serially in one session. Do not start the
repository's agent orchestrator and do not spawn subagents unless the owner
explicitly reverses that instruction. Prefer focused tests while developing;
run the complete gates only at the merge points listed below. This is both a
usage constraint and protection against several agents editing the same
canonical reducer.

### 0.1 What is already implemented

| Area | State at `3d14edc` | Main proof |
| --- | --- | --- |
| Canon and contracts | Complete enough to build on. Canon 22 is the product authority. | `docs/canon/22-living-world-program.md` |
| WorldStateV2 | Canonical schema, hashing, revisions, invariants, evidence registry and grounded selectors exist. Writable national population/army aggregates are not the V2 authority. | `packages/engine/src/world/*`; `worldStateV2.test.ts` |
| Territorial causality kernel | One strict `applyTerritorialTransition` owns control. Population, production, tax and recruitment projections follow the region; formation personnel retain origins. | `control.ts`; territorial/personnel/combat causality tests |
| Claims boundary | Player text is split into questions, claims, requested actions and initiatives. False past claims and prompt spoofing are rejected independently of valid intentions. | `playerInputV2.ts`; `claimsBoundary.test.js` |
| ScenarioV3 | One offline compiler and generic fleet registry ship Europe 1935, Napoleonic 1805 and Central Mesoamerica 1450. | `scripts/scenarios/fleet.mjs`; three scenario packages |
| Open concepts/processes | Unauthored technologies, ideologies, institutions and projects can become funded, staged processes. AI selects semantics and pace; engine derives exact costs, progress and checkpoint effects. | `packages/engine/src/processes/*` |
| Materialized effects | Only `capacity.modify` and `supply-capacity.modify` are currently safe live effect primitives. Unsupported families are deliberately hidden from AI/UI envelopes. | `processEffects.test.ts` |
| Tribute kernel | Typed multi-beneficiary commodity, labor and military-service obligations conserve deliveries and arrears. Mesoamerica contains one sourced example. | `world/tribute.ts`; `tribute.test.ts` |
| Intent-first shell | Six primary surfaces, grounded facts, false-claim preview, confirmation, process cards and a canonical one-month advance are connected to a real saved V2 session. | `intentFirstShell.jsx`; `livingWorldStore.js` |
| Strategic V5 contracts | Private revision-frozen briefs, evidence checks, open initiatives, durable retrieval memory and deterministic materialization exist. | `strategicV5.ts`; `strategicV5.test.ts` |
| Production opponent loop | Required V5 batches are atomic and visibly fail closed. Background calls are evidence-aware and capped; accepted initiatives enter the same engine process path. | `server/livingWorldStrategy.js`; R1 checkpoint |

Completed commits, in dependency order:

```text
8e0f213 feat(ai): add grounded strategic v5 contracts
eb4c61a feat(ui): add grounded intent-first shell
272b9db feat(runtime): add atomic WorldStateV2 sessions
553acab feat(scenarios): migrate Europe 1935 to ScenarioV3
cf999ec feat(scenarios): add grounded Napoleonic Europe 1805
885e59c feat(scenarios): add grounded Central Mesoamerica 1450
6555f0b feat(scenarios): compile the product fleet generically
b7bda70 feat(runtime): start grounded living-world games
12ed1bb feat(ui): connect intent-first living-world runtime
6917726 feat(ai): ground open player initiatives
05c5bb8 feat(living-world): conserve tribute obligations
db4b0cc feat(processes): materialize grounded checkpoint effects
3d14edc feat(ai): run staggered Strategic V5 opponents
```

### 0.2 Verification truth at the checkpoint

Do not report `3d14edc` as fully green without rerunning the interrupted gate.
The following passed after its changes:

```text
npm run lint
npm run build:data-packs
npm run build:engine
node --test \
  packages/data-packs/dist-test/test/europe1935ScenarioV3.test.js \
  packages/data-packs/dist-test/test/napoleonic1805.test.js \
  packages/data-packs/dist-test/test/mesoamerica1450.test.js \
  packages/engine/dist-test/test/compileScenarioV3.test.js \
  server/livingWorldStrategy.test.js \
  server/livingWorldStore.test.js
```

That focused run passed 25 tests. A root `npm test` was intentionally stopped
after all package test builds, before the full Node test run, to conserve the
owner's usage. Therefore the next merge point must run the full gates; their
result is unknown, not failed.

### 0.3 Known gaps that must not be mistaken for completed features

1. Current sharding is based on the monthly `state.turn`. Once the UI advances
   three months, using only the initial shard would starve two shards, while
   calling all three would spend too many model calls. Replace it with the
   bounded, change-aware scheduling contract in section 0.5.
2. Confirmed player requested actions are currently materialized as generic
   processes. There is no V2 production command path for typed diplomacy,
   accepted agreements, combat authority or territorial cession. The visible
   legacy diplomacy/military panes are not permission to call their old
   reducers.
3. `applyTerritorialTransition` is a correct low-level kernel, but no normal
   living-world order can yet produce its required peace/agreement/combat
   authority. Never synthesize `gm` authority from ordinary player prose.
4. Tribute settlement is callable and tested but is not scheduled
   automatically at monthly boundaries.
5. The live UI advances one month. The required play loop is one player
   decision followed by three deterministic monthly boundaries.
6. Relationships in V2 are starting facts only. Pending proposals, responses
   and agreement creation need a typed canonical reducer and evidence.
7. Only two process effect families are materialized. Do not re-expose the
   other enum values until an exact engine reducer and invariant test exist.
8. `server/europe1935Runtime.js`, legacy impacts, old management panes and
   other parallel write paths remain. Delete them only after replacement
   tests pass; do not connect them to V2 as a shortcut.
9. Only `tests/e2e/living-world-intent-shell.spec.js` exists for the new UI,
    and it is mostly a shell fixture. The production Playwright and real game
    gates are still red.

### 0.4 Scope guard for a simpler implementation agent

The remaining work is not permission to build EU/HOI systems. Use aggregate
formations, regional control, typed commitments and long-running processes.
Do not add technology trees, province construction queues, tactical units,
factory-by-factory production, sliders for basis points, or AI-authored exact
numbers. When a missing mechanic is needed, add the smallest scenario-neutral
typed state and reducer that makes one intended player loop honest.

Use `apply_patch` for edits. Keep generated scenario JSON synchronized with
its assembler. Never hand-edit only a generated scenario artifact. Keep every
model-facing context bounded, revision-stamped and actor-private. Every model
output is a proposal until a deterministic engine function validates and
commits it.

### 0.5 Remaining merge ladder (execute strictly in this order)

#### R1 — make Strategic V5 atomic, sparse and visibly fail-closed — complete

Delivered: every required task is resolved before material mutation; provider,
schema and materialization failures preserve the exact WorldStateV2 and
strategic memory; the session publishes a retry/explicit-skip checkpoint;
background calls exclude clock-only evidence and cap at four; supported actors
are callable only when explicitly directed. The next implementation package is
R2.

Owned files:

```text
server/livingWorldStrategy.js
server/livingWorldStore.js
server/livingWorldStrategy.test.js
server/livingWorldStore.test.js
src/runtime/livingWorld.js
src/Game/GameUI/intentFirstShell.jsx
```

Required behavior:

- Resolve every submitted attempt to a semantic package before mutating
  `WorldStateV2` or strategic memory. If any required task fails validation or
  provider execution, return `blockedTasks`; material state, month, revision
  and memory remain byte-identical for the whole strategic boundary.
- Persist a session-level visible checkpoint with bounded reasons. Offer
  `Retry` and an explicit `Continue without this actor decision`. Continue
  records an audit item but creates no hidden action or narrative fallback.
- A scheduled review alone does not cause a call. Store the last reviewed
  revision/evidence IDs in retrieval-only strategic memory and enqueue a task
  only for a new material event, directly addressed proposal, due process
  checkpoint or absent valid plan.
- Coalesce triggers per actor. Per three-month player advance, allow at most
  four background actor calls in stable polity order. Directly addressed
  actors and required semantic checkpoints take priority. Defer the remainder
  without changing their state.
- `active` actors may initiate. `supported` actors receive a call only when
  directly addressed or materially required as a participant. `inert` actors
  never receive a strategic call.

Red tests:

- one failed task beside one accepted task leaves state and all memory
  byte-identical;
- retry at the same revision can commit once, and stale retry is rejected;
- unchanged evidence produces zero background tasks;
- five due actors schedule four and defer one deterministically;
- a directly addressed `supported` actor gets one private response task;
- no brief contains another polity's private evidence.

Merge gate: focused server tests, then `npm test`, `npm run test:scenarios`,
`npm run build`, `npm run lint`, `git diff --check`. Commit this package alone.

#### R2 — typed diplomacy and authorized territory, end to end — complete

Delivered: canonical pending proposals, frozen recipient choices and typed
relationship/territorial acceptance now form one strict path. Player/model
text selects only published IDs and qualitative intent. It cannot provide
numeric access, control profiles, combat, peace or GM authority. Territorial
acceptance uses the agreement authority through `applyTerritorialTransition`;
the offered control snapshot must still match. The three shipped scenarios
declare the empty authored collection and compile their relationship-type
catalogues into the runtime manifest. Server and Playwright coverage prove an
offer is immaterial until the addressed recipient accepts it. The next package
is R3.

Do not route a territorial request through a generic process effect. Add the
smallest canonical proposal state needed for a real negotiation:

```ts
type DiplomaticTerm =
  | { kind: 'relationship'; relationshipTypeId: string; participantPolityIds: string[] }
  | { kind: 'territorial-cession'; regionId: string; fromPolityId: string; toPolityId: string };

interface DiplomaticProposalState {
  proposalId: string;
  proposerPolityId: string;
  recipientPolityIds: string[];
  terms: DiplomaticTerm[];
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  createdAtRevision: string;
  evidenceIds: string[];
}
```

Exact naming may follow repository conventions, but responsibilities may not
be collapsed. Add the collection to ScenarioV3/WorldSeedV2/WorldStateV2 as an
empty starting array, canonical hashing, invariants, evidence registry and
selectors. Compile relationship type IDs into the runtime catalog manifest;
do not accept arbitrary relationship labels from the model.

Extend `requestedActionV2ModelSchema` with a discriminated semantic operation
for at least `process.propose`, `diplomacy.propose` and `territory.offer`.
The model may select visible polity/region/type IDs and qualitative intent; it
may not set shares, access basis points, control profiles or numeric effects.
Confirmation creates a pending proposal, not an agreement and not a transfer.

Expose pending proposals as frozen Strategic V5 choices to their recipients.
An accepted relationship term creates one typed relationship event. An
accepted territorial-cession term calls `applyTerritorialTransition` with
`authority: { kind: 'agreement', agreementId }`, opening phase, exact expected
control and an engine-selected declared control profile. Reject proposals
where the ceding party is not the legal owner, the target is unknown, the
recipient is not a participant, or the revision/control changed. A rejection
changes only proposal status and evidence.

Minimum tests:

- false claim plus a valid diplomatic offer retains only the valid offer;
- offer creation changes no territory/population/army/economy;
- acceptance transfers exactly one region and both polity snapshots reconcile
  in the same committed revision;
- fielded formations do not change allegiance or duplicate;
- rejection and stale acceptance change no control;
- ordinary text cannot select `gm` or `combat` authority;
- a model-supplied access percentage or undeclared relationship type fails.

Add `tests/e2e/living-world-territory.spec.js` only after server tests pass.

#### R3 — monthly settlement inside a three-month player turn — complete

Delivered: normal living-world advance now resolves three local deterministic
monthly boundaries and persists only the final state plus a lossless submonth
audit. `WorldStateV2.turn` remains monthly while session metadata separately
counts successful player decisions. Tribute accepts only explicit `monthly`
cadence; the Mesoamerican authored obligation now declares that simulation
cadence rather than an engine-guessed interval. One-month advance remains a
server-only diagnostic route. The next implementation package is R4.

Add `advance-three-months` as the normal UI option. Keep
`advance-one-month` only as a diagnostic option if existing tests need it.
Store a separate `playerDecisionIndex` in the session/audit metadata; do not
reinterpret monthly `WorldStateV2.turn`.

For each of the three submonths execute one pure, stable sequence and record
all intermediate revisions:

1. apply already-authorized opening agreements/peace transitions;
2. settle obligations due for the current month, including tribute arrears;
3. advance every active process once in stable process-ID order;
4. apply already-resolved closing combat occupations, if the military slice
   exists by then;
5. advance the canonical clock one month.

No model call occurs between these substeps. Strategic and semantic decisions
must already be recorded before the batch. If any deterministic substep fails,
commit none of the three months. Implement on a cloned/local state and persist
only the final state plus a lossless list of submonth transitions.

Initially support the authored `monthly` tribute cadence and reject unknown
runtime cadence rather than guessing. Commodity payer debits must equal
beneficiary credits plus arrears change; labor and military reservations must
continue to reduce workforce/manpower projections without deleting people.

Tests: exact date after 3/30 months, atomic rollback on month two, three process
advances, three tribute settlements, deterministic replay, and no extra AI
calls during submonths.

#### R4 — finish the production intent-first UI and automated acceptance

Make the new six-surface shell the only primary UI for living-world games.
Legacy panes may remain under `Details` read-only until R5, but their old queue
buttons must be unreachable for V2 sessions.

The player must be able to see and operate:

- claim contradiction beside the preserved valid intention;
- process funding, pace, stage, blockers and engine-derived effects;
- pending diplomatic proposal, recipient response and resulting agreement;
- before/after territorial population, tax/output, recruitment and formation
  exception rows;
- strategic checkpoint retry/continue;
- three-month advance progress and causal summary.

Finish Russian and English labels. At 1440x900 and 390x844, no primary control
may be outside the scrollable surface. Add and run the exact WP13 Playwright
files. Tests use the production server/session path; mock only model outputs,
never engine settlement.

#### R5 — cross-era fixtures, legacy deletion and full release gates

Complete WP12 fixtures in two relevant scenarios each. Only after those and
R4 are green, remove live Strategic V4, model-authored impacts, binding-canon
memory, AI-generated exact statistics, Europe-specific runtime branches,
dual engine flags and writable legacy controls. Audit `packages/sim-core`
imports before deciding whether it can be deleted.

Required searches must return no live production matches (test/migration
readers may be explicitly documented):

```bash
rg -n "Binding Canon|model-authored impacts|engineDriven|engineScenario" src server packages
rg -n "polity:(germany|france|ussr)|commodity:(coal|iron|goods)" server packages/engine/src packages/agent-runtime/src
rg -n "europe1935Runtime" server src electron package.json
```

Then run the complete WP14 gate exactly as written. Do not weaken tests to
make deletion pass.

#### R6 — real games and evidence

Run WP15 through the visible production-equivalent UI after all automated
gates pass. The required release evidence is three fresh games, ten player
decisions and 30 simulated months each. The minimum originally requested by
the owner—Napoleonic 1805 plus one structurally unlike scenario—is covered by
Napoleonic France and Mesoamerican Tenochtitlan; Europe 1935 remains mandatory
as the migration regression.

Use the scripted intentions in WP15 as coverage goals, not text that must be
forced through an invalid world. If war/occupation is not legally reachable,
record the actual blocker and repeat the affected path in another fresh save
until the cross-scenario territorial gate is genuinely exercised. Commit only
redacted reports and screenshots; raw provider traffic remains gitignored.

### 0.6 Definition of a safe handoff between remaining packages

At the end of R1-R6, leave:

- one coherent commit per package, pushed to `feature/campaign-memory`;
- a clean `git status`;
- the exact commands and pass/fail counts in the commit/handoff note;
- no generated artifact differing from its assembler;
- no skipped or weakened failing test without a documented product decision;
- no claim that the program is complete before R6 reports exist.

If context is limited, read section 0, the relevant R package, and the
corresponding detailed WP below. Canon 22 decides any conflict.

### 0.7 Minimal bootstrap prompt for the next agent

The owner may start a lower-cost coding agent with this prompt:

```text
Work in /Users/alexey/Documents/projects/open-historia-next on branch
feature/campaign-memory. Work serially: do not spawn subagents and do not run
the agent orchestrator. Read AGENTS.md, docs/principles.md, canon 22, and
section 0 plus R1 of canon 23. HEAD includes 3d14edc and the later handoff-doc
commit. Preserve unrelated changes.

Implement R1 only: make production Strategic V5 all-or-nothing on required
failures, expose a visible retry/explicit-skip checkpoint, and make scheduling
change-aware with the documented four-background-call budget. Write the R1
red tests first. Do not add diplomacy, three-month turns, or legacy adapters
in this commit. Do not let model output author numbers or see another actor's
private evidence. Run the focused tests during development, then the exact R1
merge gate. Commit and push only when green, and report the commit hash, test
counts, and any remaining R1 defect. Then stop for the next instruction.
```

## 1. How an implementation agent must use this backlog

Work in order.  A numbered work package is mergeable only when its prerequisites and exit gate are green.  Do not start several packages that edit the same state schema or turn reducer in parallel.  Parallel work is allowed for research, fixtures, independent UI prototypes and test design; one owner integrates each phase.

Before every package:

1. read `AGENTS.md`, `docs/principles.md`, canon 22 and this file;
2. rebase the package plan on the current branch and preserve unrelated work;
3. write or update the named acceptance tests first;
4. make the smallest coherent hard cut; do not maintain two writable sources of truth;
5. run the package checks plus `npm run typecheck`, `npm test` and relevant Playwright specs;
6. record any deliberate schema break and migration in the commit message and canon notes.

The final program is not accepted by unit tests alone.  WP15 requires three real, Codex-operated UI games.

## 2. Non-negotiable engineering rules

### 2.1 Ownership

- Engine state, reducers, ledgers and invariants own numeric truth.
- Scenario data owns starting facts, vocabulary, world rules and available starting institutions; it does not own future history.
- AI owns interpretation, plans, names, explanations and qualitative pace proposals.
- The player owns intentions and explicit editor/cheat actions, not assertions about canonical past or present.
- UI reads projections and submits intents.  It never silently patches canonical state.

### 2.2 Complexity budget

The implementation may add deep state without adding grand-strategy busywork.  The normal player loop remains:

1. inspect a short causal brief;
2. express one or several natural-language intentions;
3. review the grounded interpretation when material ambiguity exists;
4. advance time;
5. understand what changed and why.

Do not add province-by-province build queues, division templates, trade-route drawing, individual factory placement, technology trees, mana currencies or mandatory spreadsheet panels.  Numeric detail may exist in diagnostics and ledgers while the default interface presents pressures, capacity, trade-offs and trajectories.

### 2.3 Determinism and failure

- The same scenario, canonical state and accepted commands must produce byte-equivalent state and ledgers.
- Every material state mutation must have an engine event, evidence ID and causal ledger entry.
- A missing required strategic AI decision pauses at a visible checkpoint; it does not invent a fallback policy that changes history.
- Narrative/report failure may fall back to deterministic text because it does not alter state.
- No model response may introduce a number directly into canonical state.

## 3. Confirmed baseline defects to turn into red tests

These are observed in the audited baseline and must not be treated as speculative cleanup.

| ID | Current location | Violation | Required outcome |
| --- | --- | --- | --- |
| BASE-01 | `packages/engine/src/state.ts`, `packages/engine/src/militaryReducer.ts` | `manpowerCeiling` is initialized from controlled population and then treated as a conserved lifetime total.  Region transfer changes the economy/population owner but does not rebase either polity's recruitable base. | Recruitment capacity is a projection of current control, population, integration and losses; transfer affects both sides in the same resolved transition. |
| BASE-02 | `packages/engine/src/ledger.ts` | `pool + fielded + casualties = initial ceiling` encodes permanent ownership of a starting national pool and cannot represent changed borders or personnel origin. | Conservation is per person/cohort origin; current recruitment access and existing formation ownership are separate facts. |
| BASE-03 | `packages/agent-runtime/src/index.ts`, `server/agentTurnStore.js` | The interpreter classifies a whole action only as command/report/unsupported/ambiguous.  It cannot separately reject a false claim while preserving a valid intention in the same sentence. | Every input yields claims, intents and presentation requests with independent grounding results. |
| BASE-04 | `server/agentTurnStore.js` | Production Strategic V4 triggers have empty `evidenceIds`; strategic context also exposes textual threats without causal anchors. | Every material trigger cites registered state/event evidence accepted by the current revision. |
| BASE-05 | `server/agentTurnStore.js` | Player report context reads `polity.population`, although population is territorial/ledger-derived. | Reports receive only selector-built, revision-stamped projections. |
| BASE-06 | `src/Game/AI/defaultPrompts.json`, `src/Game/AI/gameplay.js` | Country statistics explicitly ask the model for plausible missing estimates and forbid `unknown`. | Canonical figures come from selectors; modeled estimates are visibly ranged, sourced and never persisted as facts. |
| BASE-07 | `src/Game/AI/gameplay.js`, `src/Game/AI/main.jsx` | Campaign memory is injected as “Binding Canon”. | Memory is retrieval material with evidence references; stale or contradicted memories cannot outrank state/events. |
| BASE-08 | legacy gameplay impact path | Older model-authored impacts still coexist with the engine-driven turn path. | Engine scenarios have exactly one mutation path; legacy impacts are unreachable and then deleted after replacement tests pass. |
| BASE-09 | Europe 1935 pack/runtime | One scenario is maintained as data-pack V2, engine scenario `/1`, historical authoring `/3` and a legacy projection in `server/europe1935Runtime.js`. | One ScenarioV3 authoring package compiles to one `WorldSeedV2` and one derived runtime projection. |
| BASE-10 | Europe 1935 geography | Sixteen Polish map IDs contain `e1935-undefined-ohm-relation-...`; 116 engine regions map to 110 GeoJSON features without explicit off-map/shared-geometry semantics. | Exact feature-ID validation, explicit `scenario-asset`/`base-dataset`/`off-map` links and a reviewed control overlay. |
| BASE-11 | `server/libraryStore.js`, scenario metadata, Electron packaging | Europe 1935 has special loading/materialization and packaging branches; games store both `engineDriven` and `engineScenario`. | Generic compiled scenario registry and seed checksum; no per-scenario server branch or dual mode flag. |
| BASE-12 | `src/Game/GameUI/scenarios.jsx`, `CountryPickerMap.jsx`, `scenarioCountries.js` | Historical packs are shown through legacy editable presets and country-name/code ownership. | Read-only packaged scenario cards and polity IDs end-to-end; cloning creates a new fictional V3 package. |

## 4. Merge ladder

```text
WP0 baseline locks
 └─ WP1 WorldStateV2 shell
     ├─ WP2 territory/population/personnel transition ─┐
     └─ WP3 evidence registry and input security ──────┴─ WP4 ScenarioV3 compiler
             └─ WP5 generic concept/process/effect kernel
                 └─ WP6 Strategic AI V5
                     └─ WP7 domain hard cut
                         └─ WP8 intent-first UI
                             ├─ WP9 Europe 1935 migration
                             ├─ WP10 Napoleonic Europe 1805
                             └─ WP11 Central Mesoamerica 1450
                                 └─ WP12 cross-era acceptance
                                     └─ WP13 automated UI acceptance
                                         └─ WP14 legacy deletion and release gate
                                             └─ WP15 real ten-turn playtests
```

WP2 and WP3 may be implemented on separate branches after WP1, but they must be integrated by one owner before WP4.  WP9–WP11 may be authored in parallel only after the ScenarioV3 compiler and effect vocabulary are frozen.

## 5. WP0 — lock the baseline and tests

### Changes

- Add a machine-readable feature flag/version assertion for `WorldStateV2`, `ScenarioV3`, interpreter V2 and Strategic V5.  Versions identify persisted contracts, not runtime toggles between two engines.
- Add fixture checksum/replay helpers usable by engine, server and Playwright tests.
- Capture the current Europe 1935 start-state checksum as migration input, not as the required post-migration checksum.
- Add `npm` scripts for the focused living-world gates so agents do not rely on hand-selected commands.

### Owned paths

- `package.json`
- new `scripts/living-world-gate.mjs`
- new shared test helpers under `packages/engine/test/` or the repository's existing test-helper convention
- no production reducer changes

### Tests and exit gate

- A replay helper detects one deliberately changed integer.
- The gate fails when a fixture or schema version is missing.
- Existing `npm test` and Europe 1935 Playwright coverage remain green.

## 6. WP1 — WorldStateV2 and authoritative projections

### Changes

- Introduce `open-historia-world/2`, a versioned root state whose primary entities are regions, polities, population cohorts, formations/personnel, institutions/concepts, relationships and evidence-bearing events.
- Keep treasury/stockpiles on their legitimate owner, but remove duplicated population, economy, force and national-capacity totals from writable polity state.
- Replace ad-hoc aggregation in server/UI with pure selectors returning `{ revision, asOfMonth, value, evidenceIds }`.
- Add canonical serialization, parse/migrate, stable ordering and checksum coverage.
- Make projections explicit for polity summary, region summary, recruitment access, productive capacity, fiscal base, force totals and scenario-visible capabilities.

### Initial owned paths

- new `packages/engine/src/world/schema.ts`
- new `packages/engine/src/world/control.ts`
- new `packages/engine/src/world/selectors.ts`
- new `packages/engine/src/world/invariants.ts`
- new `packages/engine/src/world/revision.ts`
- `packages/engine/src/state.ts`, then delete after imports move to `world/*`
- `packages/engine/src/canonical.ts`
- `packages/engine/src/persist.ts`
- `packages/engine/src/selectors.ts`
- `packages/engine/src/historicalScenario.ts`
- `packages/engine/src/index.ts`
- `server/engineSessionStore.js`
- `server/economyStore.js`

### Required APIs

Names may change once, in this package, but responsibilities may not:

```ts
parseWorldStateV2(input): WorldStateV2
canonicalWorldState(state): JsonValue
derivePolitySnapshot(state, polityId): GroundedProjection<PolitySnapshot>
deriveRegionSnapshot(state, regionId): GroundedProjection<RegionSnapshot>
controlOf(state, regionId): RegionalControl
regionsLegallyOwnedBy(state, polityId): RegionId[]
regionsActuallyControlledBy(state, polityId): RegionId[]
deriveRegionalRecruitmentAvailability(state, regionId, polityId): GroundedProjection<RecruitmentAccess>
deriveWorldPopulationIdentity(state): GroundedProjection<PopulationIdentity>
selectCausalBrief(state, polityId, sinceRevision): GroundedProjection<CausalBrief>
```

The persisted-session hard cut is `ENGINE_SESSION_SCHEMA_V3`, which requires `open-historia-world/2`.  `server/engineSessionStore.js` must not accept `ownership` as an independently writable commit input.  Old saves receive explicit incompatibility/backup handling; there is no silent best-effort mixed-state migration.

### Red tests

- A writable `polity.population` or `polity.armySize` field is rejected.
- Permuting input arrays does not change canonical output/checksum.
- Every selector total reconciles exactly with its entity rows.
- Save/load preserves canonical output and rejects unsupported future versions.
- Server report/UI adapters cannot construct their own population aggregate.

Create `packages/engine/test/worldStateV2.test.ts` and `packages/engine/test/derivedPolitySnapshot.test.ts`.  The first owns schema/version/canonicalization tests; the second owns legal, actual and administered contribution rows including occupation/autonomy.

### Exit gate

The existing game runs on WorldStateV2 through a migration adapter, but there is only one in-memory state shape after load.

## 7. WP2 — one territory, population and personnel transition

### Changes

- Replace separate diplomacy/war transfer mutations with one `applyTerritorialTransition` transition used by peace, occupation, annexation, scripted setup and editor actions.
- Distinguish legal owner, current controller, occupation status and integration/access state.
- Keep population, infrastructure, damage, local production and local institutions attached to the region.
- Add population cohort/origin identity sufficient to track residence, recruitment origin, military/civilian status, displacement and irreversible death without simulating individuals.
- Existing formations do not teleport or change allegiance merely because their home region changes controller.
- Recruitment access changes immediately from control, then evolves through occupation/integration policy and legitimacy.
- Casualties reduce both formation strength and the correct living population/cohort exactly once.
- Demobilization returns survivors to a legitimate origin/residence pool under explicit rules; prisoners, defectors and displaced personnel remain accounted for.
- Emit one transition result consumed by economy, fiscal, identity, political, military and UI ledgers.
- Peace cessions and explicit editor interventions take effect at the opening boundary.  Occupation won by combat takes effect at closing: it cannot retroactively award the victor production already resolved that month, but the closing snapshot and next month must use the new actual controller.

### Required control and transition contract

```ts
interface RegionalControl {
  legalOwnerPolityId: PolityId;
  actualControllerPolityId: PolityId;
  kind: 'sovereign' | 'occupation' | 'autonomy' | 'indirect' | 'contested';
  controlProfileId: ControlProfileId;
  administrationAccessBp: BasisPoints;
  extractionAccessBp: BasisPoints;
  recruitmentAccessBp: BasisPoints;
  integrationBp: BasisPoints;
}

interface TerritorialTransition {
  transitionId: TransitionId;
  regionId: RegionId;
  kind: 'annex' | 'occupy' | 'liberate' | 'cede' | 'set-control';
  expectedControl: RegionalControl;
  targetControlProfileId: ControlProfileId;
  legalOwnerPolityId?: PolityId;
  actualControllerPolityId?: PolityId;
  authority:
    | { kind: 'peace'; offerId: OfferId }
    | { kind: 'agreement'; agreementId: AgreementId }
    | { kind: 'combat'; warId: WarId; frontId: FrontId }
    | { kind: 'gm'; interventionId: InterventionId };
  effectivePhase: 'opening' | 'closing';
  expectedRevision: WorldRevisionId;
}
```

Access basis points come from the named scenario control profile, never from an AI command.  The pure internal transition verifies exact expected control, authority and revision; stable-sorted resolution rejects multiple incompatible transitions for one region in one boundary.

### Personnel origin contract

```ts
interface FormationPersonnelOrigin {
  regionId: RegionId;
  personnel: number;
}
```

Origin rows are unique, sorted and sum exactly to formation manpower.  Mobilized people remain living population but are removed from the workforce of their origin region.  Losses are distributed over origins using deterministic largest remainder with `regionId` tie-break, then reduce formation, origin rows and the corresponding living populations in one event.  Demobilization restores survivors to workforce and never adds population.  Losing recruitment access produces derived `overmobilizedBy`; it does not delete or transfer existing formations.

Remove independently mutable `manpowerCeiling`, `manpowerPool`, `mobilized` and `casualties` from polity military state.  Keep policy and conserved equipment reserves; cumulative casualties are ledger history.  Starting formations require authored multi-region origins—assigning all personnel to `homeRegionId` is invalid when a formation exceeds that region's recruitment base.

### Initial owned paths

- `packages/engine/src/tick.ts`
- `packages/engine/src/military.ts`
- `packages/engine/src/militaryReducer.ts`
- `packages/engine/src/diplomacyReducer.ts`
- `packages/engine/src/identityReducer.ts`
- `packages/engine/src/ledger.ts`
- `packages/engine/src/report.ts`
- `packages/engine/src/selectors.ts`

### Red tests

- Transfer a populous region A→B: both population projections, tax/production bases and recruitment-access projections change in the same revision.
- Transfer it back: reversible quantities reconcile; deaths, damage and incurred costs do not rewind.
- Kill 10,000 personnel recruited from two regions: regional/cohort population falls by exactly 10,000, natural and combat deaths remain separate ledger columns, and formation losses are not counted twice.
- Capture a recruitment region while its formation is abroad: the formation remains with its polity; neither side gains duplicate personnel.
- Occupation grants bounded extraction/control but not instant full recruitment, legitimacy or cultural integration.
- One region cannot have two controllers, and every transfer event names exactly one before/after controller.

Split these contracts into `packages/engine/test/territorialCausality.test.ts`, `personnelOrigins.test.ts`, `combatPopulationCausality.test.ts`, `territorialMilitaryCausality.test.ts` and `atomicCrossDomainTransition.test.ts`.  Do not hide all causality assertions in one broad scenario golden.

### Exit gate

Delete the old invariant `manpowerPool + fielded + casualties = initial manpowerCeiling`.  Replace it with cohort conservation and a selector-based current recruitment capacity invariant.

Also delete `MilitaryState.occupations` as a second control authority, `MutableSettlementRegion`, and every reducer assignment to `region.controllerId`.  Military and diplomacy return transition intents; only the world transition owner mutates control/population.  Audit `packages/domain/src/reducer.ts`, `server/worldRevisionFilesystem.js` and `src/runtime/worldRevisionCore.js` after porting and delete them if they remain competing authorities rather than required adapters.

## 8. WP3 — evidence registry, claims and prompt-spoof protection

### Changes

- Replace the flat interpreted action with `PlayerInputInterpretation { questions, claims, requestedActions, proposedInitiatives }` from canon 22.  One sentence may populate several collections.
- A claim records subject, predicate, proposed value/time, source span and grounding status: `supported`, `contradicted`, `unknown` or `subjective`.
- A requested action/initiative records desired direction, targets, urgency and constraints without pretending its preconditions are true.
- Validate model-produced entity IDs, command families and evidence IDs against the exact revision-stamped registry.
- Render player prose and retrieved memory as quoted untrusted data blocks, never as system instructions.
- Give deterministic contradictions to the preview/report layer: “That premise is not in the record; the valid intention can still be attempted as …”.
- Add an explicit, separately authenticated editor/cheat path for deliberate world rewriting.  It does not masquerade as a claim status, and normal play text never invokes it.
- Replace empty Strategic V4 trigger evidence with evidence generated from canonical events/selectors.
- Demote campaign memory to an evidence-linked retrieval index.  Revalidate every active memory fact against current state before prompt inclusion.

### Initial owned paths

- `packages/agent-runtime/src/index.ts`
- `packages/agent-runtime/src/strategicV4.ts`
- new `packages/agent-runtime/src/playerInputV2.ts`
- new `packages/engine/src/evidence.ts`
- `server/agentTurnStore.js`
- `server/codexSubscriptionProvider.js`
- `src/runtime/campaignMemory.js`
- `src/Game/AI/gameplay.js`
- `src/Game/AI/main.jsx`
- `src/Game/AI/defaultPrompts.json`

### Red tests

- “Ten turns ago I conquered France; now recruit there” contradicts the fake conquest, retains the recruitment intention, and creates no command naming French regions.
- “I have 50 million soldiers” never changes any state, brief or memory fact.
- A sentence containing a false premise and a valid domestic investment produces a rejected claim plus a valid grounded intent.
- Prompt-like text inside an order or memory cannot change the tool schema, authority rules or allowed IDs.
- Invented, stale and cross-polity evidence IDs are rejected.
- A report with absent data says that the figure is unavailable or shows a labeled engine estimate range; it never manufactures an exact canonical number.

Put protocol tests in `packages/agent-runtime/test/playerInputV2.test.ts`, `packages/agent-runtime/test/promptSpoofing.test.ts` and `packages/agent-runtime/test/crossEraBriefs.test.ts`; put server authority tests in `server/claimsBoundary.test.js`; extend `src/runtime/campaignMemory.test.js` with stale/contradicted-memory cases.

### Exit gate

No production prompt calls player prose or memory “canon”, and every accepted material AI proposal cites current evidence.

## 9. WP4 — ScenarioV3 compiler and scenario-owned catalogs

### Changes

- Define one authoring schema, `open-historia-scenario/3`, and one compiled engine contract, `open-historia-world-seed/2`.  Runtime code consumes only the seed and its derived projection.
- Move resources, processes, institutions, military unit classes/doctrines, offices, diplomatic agreement forms, identities, calendars and world-rule parameters into scenario catalogs.
- Validate stable IDs, references, units, fixed-point ranges, map linkage, playable polities and catalog closure.
- Permit a scenario to start without concepts that may later emerge through the generic concept kernel.
- Compile useful projections and evidence records, not duplicated mutable national totals.
- Create generic offline scenario validation/compilation CLIs and migrate the reusable parts of Europe-specific scripts into them.
- Reject hidden references to Europe 1935 polity IDs or global Coal/Iron/Goods assumptions outside that data pack.

### Initial owned paths

- new `packages/data-packs/src/v3/schemas.ts`
- new `packages/data-packs/src/v3/profiles.ts`
- new `packages/data-packs/src/v3/provenance.ts`
- new `packages/data-packs/src/v3/assets.ts`
- new `packages/data-packs/src/v3/validator.ts`
- new `packages/data-packs/src/v3/builder.ts`
- `packages/data-packs/src/legacy-adapter.ts`, import/replay only and then delete
- `packages/data-packs/src/index.ts`
- new `packages/engine/src/world/seed.ts`
- new `packages/engine/src/world/compileScenarioV3.ts`
- new `packages/engine/src/world/geography.ts`
- `packages/engine/src/scenario.ts`, legacy input only and then delete
- `packages/engine/src/historicalScenario.ts`
- `packages/engine/src/mapLink.ts`
- new `scripts/scenarios/validate.mjs`
- new `scripts/scenarios/compile.mjs`
- new `scripts/scenarios/lib/geography.mjs`
- new `scripts/scenarios/lib/provenance.mjs`
- new `scripts/scenarios/lib/publish.mjs`
- new `server/scenarioPackStore.js`

Dependency direction is `engine → data-packs → domain` for parsing the authoring contract; data-packs must never import engine.  The compiler and `WorldSeedV2` remain engine-owned.

### Required authoring and compiler contract

```ts
interface ScenarioV3 {
  schemaVersion: 'open-historia-scenario/3';
  id: ScenarioId;
  profile: 'historical' | 'fictional' | 'development';
  metadata: ScenarioMetadata;
  game: {
    startDate: IsoDate;
    defaultPlayerPolityId: PolityId;
    playerEligiblePolityIds: PolityId[];
  };
  worldRules: WorldRules;
  modules: ModuleConfiguration;
  catalogs: ScenarioCatalogs;
  geography: GeographyDefinition;
  startingState: StartingStateDefinition;
  provenance: ProvenanceDefinition;
}

interface CompiledScenario {
  bundleChecksum: Checksum;
  seed: WorldSeedV2;
  seedChecksum: Checksum;
  runtimeProjection: RuntimeScenarioProjection;
  diagnostics: CompilationDiagnostic[];
}
```

Authoring entity collections are records keyed by stable IDs.  Compilation strictly parses, validates asset checksum/MIME/license/effective date, resolves all IDs/catalog references, verifies provenance coverage, canonicalizes order, builds the seed, initializes WorldStateV2/invariants, and only then creates map/UI projection.  Bundle, seed and projection have separate checksums.  Compilation and CI are offline.

Required catalogs cover commodities, activities, arbitrary N-input/N-output recipes, institutions, offices, formation archetypes, equipment classes, finance profiles, revenue channels/instruments, control forms, route classes and localized terminology.  Any seed reference outside these catalogs fails closed.

Historical material values require a stable entity/field binding, canonical value checksum, source IDs, observation date and boundary, transformation method, confidence and a TODO for low confidence.  Fictional values cite an authored premise; development values carry an explicit synthetic marker.  Published national totals are audit controls, never a second runtime total.

Every geography link declares `scenario-asset`, `base-dataset` or `off-map`.  Feature IDs are unique and real; every rendered region has geometry, every feature belongs to one engine region, adjacency is symmetric, and straits/sea lanes/external connections are explicit.  Legal owner and actual controller remain polity IDs, never localized names.

### Red tests

- Minimal fictional, Europe 1935, Napoleonic and Mesoamerican fixtures compile through the same entry point.
- Unknown catalog references fail with exact JSON paths.
- Removing coal from a scenario that never uses coal succeeds; referencing it from a process fails.
- No scenario can seed aggregate population inconsistent with its regions/cohorts.
- Cross-era fixture scanning fails if a scenario receives a resource, office, doctrine or institution only defined by another scenario.
- Three compilations and a permutation of set-like authoring records yield the same seed checksum.
- Historical coverage fails on any unbound material leaf or mismatched canonical-value checksum.
- Geography rejects `undefined`, `null`, empty ID segments, missing feature IDs and unexplained off-map regions.

### Exit gate

`parseScenario` has one runtime output version and every shipped scenario passes `npm run validate:scenarios` without scenario-specific branches in engine code.  Add `validate:scenarios`, `compile:scenarios` and `test:scenarios` to root scripts; validation enters `ci`, compilation enters build/package, and Electron packages `build/scenarios/**` rather than one hard-coded scenario.

## 10. WP5 — generic concepts, processes and effect primitives

### Changes

- Implement runtime concepts for technologies, ideologies, institutions and doctrines with generated stable IDs, discoverer/origin, evidence, maturity, diffusion and polity/region adoption.
- Implement long-running processes with objective, qualitative pace proposed by AI, engine-computed feasibility, numeric progress, investments, blockers, side effects and cancellation/suspension.
- Add a small, composable and scenario-neutral effect vocabulary.  Effects modify named selector inputs/parameters; they do not execute arbitrary model code.
- Separate “conceived”, “demonstrated”, “deployable”, “diffusing” and “institutionalized”.
- Let the AI propose a semantic novelty and causal theory; the engine resolves it against prerequisites, material base, knowledge, institutions, communication, opposition and sustained investment.
- Allow failure, stagnation, partial success, local prototypes, distortion and unintended consequences.
- Do not expose a universal authored tech tree.  Starting catalog entries and generic effect primitives bound mechanics, not imagination.

### Initial owned paths

- new `packages/engine/src/processes/schema.ts`
- new `packages/engine/src/processes/feasibility.ts`
- new `packages/engine/src/processes/reducer.ts`
- new `packages/engine/src/processes/effects.ts`
- new `packages/engine/src/processes/selectors.ts`
- `packages/engine/src/commands.ts`
- `packages/engine/src/pipeline.ts`
- `packages/engine/src/tick.ts`
- `packages/engine/src/ledger.ts`
- `packages/agent-runtime/src/index.ts`

### Red tests

- Electricity in 1500 can begin as a costly experimental concept, cannot instantly electrify an economy, and can accelerate related learning when institutions/materials support it.
- Communism in 1200 can emerge as an ideology with contemporary vocabulary, opposition and organizational limits; it is not rejected merely because of its modern label and does not instantly create an industrial state.
- Two semantically similar names resolve to an existing concept when their mechanics/evidence match, preventing duplicate “electricity” currencies.
- AI-proposed arbitrary numeric multipliers, unknown effect opcodes and cyclic dependencies are rejected.
- Process results replay identically without a model call.

### Exit gate

A test-only fictional scenario can create, advance, diffuse and institutionalize an unforeseen concept using only generic primitives.

## 11. WP6 — Strategic AI V5 semantic resolver

### Changes

- Preserve V4's frozen revision, bounded candidates and evidence validation.
- Replace the assumption that every meaningful future action already has an authored choice ID.
- Give strategic actors a two-stage contract:
  1. choose or propose semantic intent/process/concept using grounded evidence and qualitative urgency/pace;
  2. let deterministic materialization select legal effect primitives, costs, bounds and commands for the frozen revision.
- Store durable plan goals and commitments as non-canonical strategy memory linked to evidence.
- Expose why a proposal was accepted, narrowed, delayed, blocked or held for clarification.
- Required strategic checkpoints fail closed and visibly; prose-only explanations may degrade gracefully.
- Remove Europe-specific external suppliers and other polity IDs from runtime code; candidates come from scenario/world selectors.

### Initial owned paths

- new `packages/agent-runtime/src/strategicV5.ts`
- `packages/agent-runtime/src/strategicV4.ts` during migration, then delete/compatibility-read only
- `packages/agent-runtime/src/index.ts`
- `server/agentTurnStore.js`
- `server/codexSubscriptionProvider.js`
- `src/Game/AI/agentTaskScheduler.js`

### Red tests

- V5 accepts a novel grounded electrification experiment without a pre-authored `choiceId`.
- It rejects invented entities/evidence and materializes no command after revision drift.
- The same semantic proposal and frozen state materialize identically.
- A required checkpoint model failure leaves the turn pending with a visible retry/continue choice and no hidden strategy command.
- A Mesoamerican actor receives no Soviet/United States supplier candidates and no industrial-era default plan.

### Exit gate

All engine-driven opponent strategy uses V5.  V4 is retained only as a persisted-save reader until WP14, not as a second live planner.

## 12. WP7 — migrate domains and remove parallel mutation paths

Migrate one domain at a time, but merge each only when it writes WorldStateV2 and emits the common causal/evidence ledger.

### Domain order

1. economy/resources/process capacity;
2. diplomacy, agreements and trade;
3. finance and statecraft;
4. politics, factions and characters;
5. military, wars, occupations and peace;
6. identity, institutions and concept adoption;
7. campaign goals/crises/legacy assessments;
8. advisor and statistics projections.

### Required changes

- Replace the universal Coal + Iron → Goods recipe with scenario process definitions.
- Replace fixed global office, war-reason, peace-goal, crisis and identity-policy enums with catalog IDs plus generic rule classes where validation needs them.
- Add conserved multi-party obligations for tribute, subsidies, requisitions, labor/military service, personal unions and coalition commitments.  These are not disguised bilateral trade or territorial ownership.
- Replace mandatory bonds/interest/modern budgets and three-to-six modern factions with scenario revenue/instrument catalogs and influence groups/institutions.
- Route every reducer through shared effects/evidence helpers.
- Make reports consume grounded projections only.
- Replace `generateCountryStatSheet` for engine scenarios with selector-built data and optional prose explanation.
- Block legacy `impacts`, direct map ownership edits and free-form numeric AI results for engine scenarios.
- Generalize `server/europe1935Runtime.js` into scenario compilation/registry, `economyStore.js` into a world-session boundary and the engine turn endpoint into one living-world commit/replay path.  Delete scenario-specific bridges after migration.

### Exit gate per domain

- unit and reconciliation tests;
- one server agent-turn test;
- one Playwright-visible causal explanation;
- no writable duplicate field or alternative mutation endpoint;
- no scenario-specific ID in generic runtime code.

## 13. WP8 — intent-first UI

### Changes

- Replace nine equal-weight management tabs as the primary loop with six intent-first surfaces: `Briefing`, `Orders`, `Diplomacy`, `Country`, `Situations`, `Details`.  Together they implement the mental loop “World → Intentions → Consequences”; existing domain panes move under `Details` as drill-down diagnostics.
- Add an order composer that supports multiple natural-language intentions, separates claims, shows grounded targets and asks confirmation only for material ambiguity or irreversible action.
- Add process/concept cards showing stage, qualitative pace, engine feasibility band, main inputs, blockers, support/opposition and latest causal changes.
- Add a causal turn summary: what changed, numeric magnitude, why, evidence and which prior intention/process it serves.
- Show territory transfer effects together: population, fiscal/productive base, recruitment access, legitimacy/integration and personnel exceptions.
- Clearly distinguish canonical values, derived values, estimates/ranges and narrative interpretation.
- Keep exact ledgers accessible but secondary; the game must remain playable without visiting every domain pane.
- Add stable `data-testid` hooks for the complete player loop and visual states.

### Initial owned paths

- new `src/Game/GameUI/briefing.jsx`
- new `src/Game/GameUI/orders.jsx`
- new `src/Game/GameUI/country.jsx`
- new `src/Game/GameUI/situations.jsx`
- new `src/Game/GameUI/details.jsx`
- new `src/Game/GameUI/processCard.jsx`
- new `src/Game/GameUI/causalLedger.jsx`
- `src/Game/GameUI/advisor.jsx`
- `src/Game/GameUI/actions.jsx`
- `src/Game/GameUI/time.jsx`
- `src/Game/GameUI/stats.jsx`
- `src/Game/GameUI/economy.jsx`
- `src/Game/GameUI/military.jsx`
- `src/Game/GameUI/diplomacy.jsx`
- `src/Game/GameUI/statecraft.jsx`
- `src/Game/GameUI/politics.jsx`
- `src/Game/GameUI/society.jsx`
- `src/Game/GameUI/campaign.jsx`
- `src/Game/GameUI/main.jsx`

### UI exit gate

At desktop 1440×900 and mobile 390×844, a new player can submit an intention, detect a rejected false claim, advance a turn, locate the causal outcome and inspect a long-running concept without opening developer tools.  No primary action or confirmation is off-screen or hidden by overflow.  Configure serialized Playwright projects while the server still has a global active game; parallel workers require session isolation first.

## 14. WP9 — migrate and rebalance Europe 1935

- Compile the existing 116 regions and researched start state into ScenarioV3 without reducing geographic or political coverage.
- Move every era-specific resource, process, institution, office, doctrine, agreement and capability into the Europe data pack.
- Preserve researched source notes and distinguish exact authored figures from modeled allocations.
- Replace seven-playable-country runtime assumptions and hard-coded external suppliers with catalog/scenario queries.
- Fix all sixteen Polish `undefined` feature IDs and declare how the six regions without unique GeoJSON features are rendered or intentionally off-map.
- Replace `server/europe1935Runtime.js`, the `server/libraryStore.js` special case, dual `engineDriven`/`engineScenario` metadata and Europe-only Electron asset enumeration with the generic compiled registry.
- Compare the starting state and first deterministic month before/after migration; publish every intentional delta caused by corrected control, population or personnel accounting as a versioned migration note.
- Run at least 24 deterministic months for every playable polity with no negative stock, broken reference, impossible personnel accounting or NaN.
- Update `server/europe1935*.test.js` and `tests/e2e/europe1935.spec.js` to assert ScenarioV3, projections and the intent-first loop.

Exit: Europe 1935 is the migration proof, not a privileged runtime branch.

## 15. WP10 — ship Napoleonic Europe 1805

Start on `1805-01-01`.  The target is 26 named polities and approximately 113 strategically meaningful regions.  Twelve polities are player-eligible: French Empire, United Kingdom of Great Britain and Ireland, Austrian Empire, Russian Empire, Kingdom of Prussia, Kingdom of Spain, Ottoman Empire, Kingdom of Sweden, Denmark–Norway, Kingdoms of Naples and Sicily, Italian Republic and Electorate of Bavaria.

The Italian polity is still the Italian Republic on this date; its transformation into a kingdom is a possible political process.  Bavaria is an electorate.  Start Anglo-French and Anglo-Spanish hostilities that actually exist at the boundary; model Russian/Austrian coalition formation as diplomacy and keep Prussia neutral.  Austerlitz, Trafalgar, the Third Coalition and later crowns are not scripted outcomes.

This scenario must stress coalition diplomacy, dynastic/personal-union relations, conscription, pre-industrial fiscal/logistical strain and theatre-level maritime blockade without borrowing 1935 institutions.  HRE is an institution/commitment network, not one fake polity, and no “Other German States” blob is allowed.

Minimum gate:

- the roster, region allocation, catalogs, blockade contract and source workflow in section 21.2;
- active/dormant coalition relationships encoded as dated facts rather than an inevitable scripted war;
- levies/conscription, supply, fiscal strain, legitimacy and occupation/integration expressed through generic systems;
- three identical compilations, two byte-identical AI-free 12-month runs and one 10-turn/30-month real UI game.

## 16. WP11 — ship Central Mesoamerica 1450

Start on `1450-01-01` with a target of 44 regions (acceptable researched range 40–50) and ten active strategic subjects: Tenochtitlan, Texcoco/Tetzcoco, Tlacopan, independent Tlatelolco, composite Tlaxcallan, Purépecha state, Cholollan, Chalco, Huexotzinco and Yucu Dzaa/Tututepec.  Additional `altepetl`/`ñuu` remain canonical supported or inert subjects without a monthly model call.

This scenario must be structurally unlike Europe: tributary power, city-polity/`altepetl` organization, ecology, market/tribute networks and different military/institutional assumptions.  The Triple Alliance is three polities plus typed agreement/beneficiary shares.  Receiving tribute never changes legal ownership or actual control.  Tlaxcallan has one external diplomatic agency with four internal centers; there is no fictional unitary “Mixtec state”.

Minimum gate:

- no nation-state, standing-army, industrial resource, European office or bilateral-sovereignty default leaks into the scenario;
- the scope, resources, institutions, tribute contract and source cautions in section 21.3;
- tribute, local autonomy, legitimacy and captive-taking represented through generic agreements/processes/effects;
- three identical compilations, two byte-identical AI-free 12-month runs and one 10-turn/30-month real UI game.

## 17. WP12 — cross-era machine acceptance

Create dedicated fixtures/tests, not prompt anecdotes:

- `false-history`: fake prior conquest/power claim is contradicted and never persisted;
- `electricity-1500`: unforeseen technology moves through stages under bounded feasibility;
- `communism-1200`: unforeseen ideology can emerge, adapt and face material/institutional constraints;
- `territory-causality`: populous region transfer reconciles both polities and personnel;
- `scenario-leakage`: catalogs and AI candidates remain scenario-local;
- `replay`: accepted semantic decisions need no later model call to reproduce state;
- `epistemics`: actors receive only knowledge/evidence available to them.

Run every fixture in at least two scenarios where meaningful.  Failure messages must name the invariant, actor, revision and evidence involved.

## 18. WP13 — automated UI and accessibility acceptance

Add focused Playwright suites:

- `tests/e2e/living-world-intent.spec.js`
- `tests/e2e/living-world-claims.spec.js`
- `tests/e2e/living-world-process.spec.js`
- `tests/e2e/living-world-territory.spec.js`
- one spec for each shipped scenario's start and first resolved turn.

Coverage must use real pointer/keyboard paths, assert no unexpected console errors, exercise Russian and English where text is contract-relevant, and capture screenshots at desktop/mobile breakpoints.  Mock the model only to test protocol branches; deterministic engine settlement must be real.

## 19. WP14 — legacy deletion and release gate

Delete only after all replacements are green:

- live Strategic V4 planning and schemas no longer needed to read saves;
- legacy model-authored gameplay impacts for engine scenarios;
- binding-canon memory prompt blocks;
- AI-generated exact country statistics;
- global era-specific catalogs and fixed IDs moved to data packs;
- duplicated polity aggregates and obsolete manpower conservation;
- scenario-specific generic-runtime branches;
- `packages/sim-core` only if an import/replay audit proves WorldStateV2 fully replaces it.

Then run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:ui
npm run agents:test
npm run check:cycles
```

The deletion commit must include an `rg` audit for banned phrases/IDs and a persisted-save migration test.

## 20. WP15 — real Codex-operated playtests

Run three separate new games through the actual UI with the configured production model:

1. Europe 1935;
2. Napoleonic Europe 1805;
3. Central Mesoamerica 1450.

Each run contains ten player decisions followed by three-month UI advances, for 30 simulated months.  Before every decision record date/revision; inspect the structured preview; confirm through UI; after commit use only read-only state/ledger audit.  On decisions 3, 5 and 10 inspect the named surfaces at mobile 390×844, and complete one primary loop by keyboard.  Each run includes:

- one false retrospective claim;
- one ambitious counterfactual concept or institution;
- one external diplomatic interaction;
- one resource/fiscal/political constraint;
- one territorial or military pressure where scenario-appropriate;
- inspection of the causal ledger and process state;
- no cheats, direct API state writes or database edits.

### Europe 1935 script — Poland

| Turn | Required intention/check |
| ---: | --- |
| 1 | Start a bounded process addressing a real food or rail bottleneck from Briefing. |
| 2 | Offer Czechoslovakia staff consultation/communications without claiming an alliance. |
| 3 | Propose a protected national radio/cryptographic civil-defence network; it begins only at `proposed`. |
| 4 | Claim that Poland annexed East Prussia ten turns ago and mobilized two million; both claims must be contradicted. |
| 5 | Choose a comprehensible funding/political stance without entering basis points. |
| 6 | Resolve the largest political/social situation and inspect its ledger evidence. |
| 7 | Raise bounded readiness and inspect workforce/recruitment `Why?`. |
| 8 | Seek trade for a shortage named by the engine. |
| 9 | Change process pace only among feasible options and inspect blockers. |
| 10 | Request legacy assessment and reconcile population, economy, recruitment and causal history. |

Expected final date: no earlier than `1937-07-01`.

### Napoleonic Europe 1805 script — France

| Turn | Required intention/check |
| ---: | --- |
| 1 | Start an army depot/provisions/supply-route process. |
| 2 | Offer Bavaria or another actually available ally a typed coalition obligation. |
| 3 | Propose a standardized civil-military optical relay service; it begins only at `proposed`. |
| 4 | Claim that France destroyed the British fleet at Trafalgar last year and owns Malta; contradict both without changing fleet/control/knowledge. |
| 5 | Form a legal aggregate formation from visible origin regions and inspect workforce. |
| 6 | If legal, pursue a limited war aim against Austria; otherwise address the actual blocker. |
| 7 | Advance on one visible adjacent region only with adequate supply. |
| 8 | Continue or retreat according to the real result; inspect origin casualties and political consequence. |
| 9 | After actual occupation, propose peace concerning one populated region.  If no occupation exists, accept the result and repeat this scenario later on another legal front—the cross-scenario territory gate remains red. |
| 10 | Conclude peace/legacy and compare old/new population, output, fiscal/recruitment access and fielded personnel. |

Expected final date: no earlier than `1807-07-01`.

### Central Mesoamerica 1450 script — Tenochtitlan

| Turn | Required intention/check |
| ---: | --- |
| 1 | Inspect tribute baskets, arrears and routes; start one grounded collection/route process.  UI must not show GDP or bonds. |
| 2 | Negotiate one concrete joint obligation and beneficiary shares with Texcoco and Tlacopan. |
| 3 | Start a chinampa, canoe or market-route maintenance process from real constraints. |
| 4 | Propose a standing inter-`altepetl` tribute-arbitration council with payer delegates; expect resistance and `proposed`, not an instant parliament. |
| 5 | Claim Chalco permanently accepted tribute ten cycles ago and transferred all warriors; contradict tribute and force claims. |
| 6 | Resolve a contextual nobles/calpolli/merchant/priestly situation. |
| 7 | Offer Chalco a limited truce, changed tribute or market/route access without asserting sovereignty. |
| 8 | Raise a bounded levy/tributary contingent or consciously avoid war; inspect origins, workforce and obligations. |
| 9 | Adjust the council/process pace in response to actual blockers. |
| 10 | Request legacy and inspect tribute, population, workforce, recruitment and Triple Alliance relations. |

Expected final date: no earlier than `1452-07-01`.

Commit the following redacted reports:

```text
docs/reports/playtests/europe-1935-10-turn.md
docs/reports/playtests/napoleonic-1805-10-turn.md
docs/reports/playtests/mesoamerica-1450-10-turn.md
docs/reports/playtests/final-cross-scenario-assessment.md
```

For each run preserve in its report or losslessly referenced gitignored audit bundle:

- starting and final canonical checksums;
- every player input and accepted interpretation;
- model/provider metadata and failures/retries;
- monthly commands/events/ledgers or a lossless reference to the saved replay;
- desktop and mobile screenshots of critical states;
- a concise defect log classified as engine, AI contract, scenario data or UI;
- pass/fail against the scenario script and canon 22.

Raw prompts/responses and unredacted run bundles remain gitignored.  Add a read-only `npm run playtest:audit` exporter for revision, grounded snapshots, ledgers, replay checksum and model metadata; it may not accept mutation commands.

Any state corruption, accepted fake fact, unexplained material number, cross-era leak, required-AI silent fallback or non-replayable outcome fails the release gate.  Cosmetic defects may be recorded for follow-up only if the full loop remains understandable and operable.

## 21. Scenario audit details

### 21.1 Package layout and common gates

Playable packages move out of test fixtures:

```text
packages/data-packs/scenarios/europe-1935-benchmark/
packages/data-packs/scenarios/napoleonic-europe-1805/
packages/data-packs/scenarios/central-mesoamerica-1450/
  manifest.json
  scenario.json
  sources.json
  authoring.json
  geography/candidate-region-plan.json
  geography/runtime-regions.geojson
  geography/runtime-land-adjacency.json
  geography/runtime-integration-control.json
  geography/runtime-geography-manifest.json
  starting-state/population.json
  starting-state/control.json
  starting-state/economy.json
  starting-state/obligations.json
  starting-state/diplomacy.json
  starting-state/politics.json
  starting-state/military.json
  starting-state/identity.json
  starting-state/concepts.json
  starting-state/knowledge.json
  starting-state/starting-state-manifest.json
```

The compiler may accept the package as split files but produces only:

```text
build/scenarios/<scenario-id>/world-seed.json
build/scenarios/<scenario-id>/runtime-projection.json
build/scenarios/<scenario-id>/assets/**
```

Generated seed/projection files carry compiler version and checksum and are never hand-edited.  Source-fetch/checkpoint tooling may be scenario-specific and networked; compilation, validation, CI and play are offline.

Required package/compiler tests:

```text
packages/data-packs/test/scenarioV3Schema.test.ts
packages/data-packs/test/scenarioV3Profiles.test.ts
packages/data-packs/test/scenarioV3Validator.test.ts
packages/data-packs/test/scenarioV3Builder.test.ts
packages/data-packs/test/scenarioLeakage.test.ts
packages/data-packs/test/mesoamerica1450.test.ts
packages/engine/test/scenarioV3Compiler.test.ts
packages/engine/test/worldSeed.test.ts
packages/engine/test/scenarioV3TwelveMonth.test.ts
packages/engine/test/geographyProjection.test.ts
server/scenarioPackStore.test.js
tests/e2e/scenario-deck.spec.js
tests/e2e/napoleonic1805.spec.js
tests/e2e/mesoamerica1450.spec.js
```

The scenario deck reads a generic registry and displays a read-only card with title/date, fidelity profile, playable polities, region count, provenance status, seed checksum and validation state.  Country selection and map overlays use polity IDs end-to-end.  `Clone` creates a new fictional V3 draft; it never edits the packaged historical scenario.

### 21.2 Napoleonic Europe 1805 data plan

#### Political scope

Player-eligible (12): French Empire; United Kingdom of Great Britain and Ireland; Austrian Empire; Russian Empire; Kingdom of Prussia; Kingdom of Spain; Ottoman Empire; Kingdom of Sweden; Denmark–Norway; Kingdoms of Naples and Sicily; Italian Republic; Electorate of Bavaria.

Additional autonomous strategic actors (6): Portugal; Batavian Republic; Swiss Confederation; Saxony; Württemberg; Baden.

Small but explicit actors (8): Hanover; Papal States; Etruria; Ligurian Republic; Sardinia; Hesse-Kassel; Hesse-Darmstadt; Brunswick.  There is no `Other German States` polity.  HRE is an institution/commitment network.  Russia is limited to the western strategic theatre, and the Ottoman scope to European lands and western Anatolia.  Colonies, India and remote maritime possessions are represented by sourced external markets/revenue/capacity and sea-route nodes, not fake European regions.

On `1805-01-01`, the Italian Republic has not yet become the Kingdom of Italy and Bavaria has not yet become a kingdom.  See the [Fondation Napoléon account of the Italian transition](https://www.napoleon.org/en/history-of-the-two-empires/articles/how-napoleon-became-king-of-italy/) and its [26 May 1805 coronation chronology](https://www.napoleon.org/en/history-of-the-two-empires/timelines/napoleons-consecration-and-coronation-in-milan-26-may-1805/).  Those transformations are possible processes, not startup facts.

#### Region budget

| Area | Regions |
| --- | ---: |
| France | 16 |
| Britain and Ireland | 9 |
| Austria | 11 |
| Western Russia | 7 |
| Prussia | 8 |
| Spain | 8 |
| Ottoman Europe and western Anatolia | 7 |
| Sweden | 5 |
| Denmark–Norway | 5 |
| Naples and Sicily | 4 |
| Italian Republic | 5 |
| Bavaria | 3 |
| Batavian Republic | 3 |
| Portugal | 3 |
| Switzerland | 3 |
| Saxony, Württemberg, Baden and Hanover | 8 |
| Papal States | 2 |
| Other named small polities | 6 |
| Total | 113 |

#### Catalogs

Commodities: grain, timber, iron, horses, fibers, powder inputs, provisions, cloth, arms, gunpowder and luxury goods.  Activities: agriculture, forestry, mining, horse breeding, textile/craft production, ironworking, arms/powder production, urban crafts, commerce and shipbuilding.  Examples include grain→provisions, fibers→cloth, iron+timber→arms and powder inputs→gunpowder.  Shipbuilding creates maritime capacity/equipment through a process and capacity use, not a universal magic good.

Government uses rulers, chief ministers, decision authority and scenario councils/institutions.  Influence groups include court, bureaucracy, officer corps, clergy, landed estates, merchants/manufacturers, peasantry, urban artisans and reformers.  They are not forced into a modern party count.

Revenue channels include land/domain tax, excise, customs, tribute, requisition, allied subsidy and war contribution.  Instruments include public debt, short notes, forced loan, subsidy and requisition, each gated by institutions.  Scenario profiles may give Britain strong public credit/customs, France centralized tax/requisition capacity and the Ottoman state tribute/customs/domain revenue without making those outcomes universal.  Personal unions/linked crowns such as UK–Hanover and Naples–Sicily are typed relations.

Major powers begin with 2–5 aggregate theatre armies/corps/reserves/militia/garrisons; minor powers with 1–2.  Every formation has archetype, manpower, multi-region personnel origins, arms/artillery/horses/transport, readiness, supply links and optional commander.  Maritime forces are theatre capacities, not tactical fleets.

#### Maritime blockade contract

```ts
interface TradeRouteDef {
  routeId: RouteId;
  mode: 'land' | 'sea' | 'river';
  nodes: RouteNodeId[];
  baseMonthlyCapacity: FixedPoint;
  allowedCommodityIds: CommodityId[];
  maritimeZoneIds?: MaritimeZoneId[];
  accessPolicyId: AccessPolicyId;
  sourceEvidenceIds: EvidenceId[];
}

interface MaritimeTheatreState {
  theatreId: MaritimeTheatreId;
  polityId: PolityId;
  controlBp: BasisPoints;
  blockadeCapacity: FixedPoint;
  escortCapacity: FixedPoint;
  readinessBp: BasisPoints;
}

interface RouteInterdiction {
  interdictionId: InterdictionId;
  routeId?: RouteId;
  zoneId?: MaritimeZoneId;
  enforcingPolityId: PolityId;
  targetPolityIds: PolityId[];
  intensity: 'observe' | 'restrict' | 'close';
  legalBasisId: LegalBasisId;
  startedMonth: number;
}
```

AI selects posture, target, intensity and capacity allocation.  Engine resolves capacity/readiness, basing/access, escort, neutrality, redundancy, season and infrastructure.  Interdiction reduces route capacity and records undelivered goods; it neither erases stock nor guarantees fleet destruction.  Use Channel/North Sea, Atlantic Approaches, Western Mediterranean, Baltic and Eastern Mediterranean as researched strategic zones.  British capacity widens feasibility but does not predetermine Trafalgar; use [Royal Museums Greenwich background](https://www.rmg.co.uk/stories/maritime-history/battle-trafalgar-background) as context, not as a January result.

#### Provenance and gates

Create the source inventory before numerical authoring.  Store observation date, historical boundary, license, checksum and extraction method.  Population uses the nearest defensible census/table, with explicitly documented interpolation to 1805 and regional weights; it is never labeled exact.  The [UK Office for National Statistics publishes census data beginning in 1801](https://www.ons.gov.uk/census/2011census/2011censusdata/censusdata18011991), while historical French tables are available through [Insee's digital statistics library](https://www.bnsp.insee.fr/ark%3A/12148/bc6p06xrtrb.pdf); both still require boundary/date reconciliation.

Acceptance additionally requires `packages/engine/test/napoleonic1805Blockade.test.ts`, exact start-date polity titles, no scripted Third Coalition/Austerlitz/Trafalgar, formation-origin reconciliation, institution-gated finance, unaffected neutral routes, conserved blockade ledger and no undeclared oil/electricity/modern instrument.

### 21.3 Central Mesoamerica 1450 data plan

#### Political and geographic scope

Target 44 regions: Mexican Basin 12; Puebla–Tlaxcala 8; Chalco/Morelos/eastern frontiers 6; Purépecha/western frontier 8; Mixteca/Oaxaca 8; up to two sourced external trade corridors.  Regions represent meaningful `altepetl`, urban centers, frontiers or ecological clusters, not modern provinces.

Active subjects (10): Tenochtitlan; Texcoco/Tetzcoco; Tlacopan; Tlatelolco; Tlaxcallan; Purépecha state; Cholollan; Chalco; Huexotzinco; Yucu Dzaa/Tututepec.  Coixtlahuaca, Tilantongo, Tlaxiaco, Teozacoalco, Xochimilco and other local `altepetl`/`ñuu` are supported or inert canonical subjects.  They retain control, tribute, dynastic and military relations without consuming a monthly AI call.

Tlatelolco remains separate because INAH dates its loss of independence to 1473.  Tlaxcallan has one external agency and four internal `cabeceras`.  Purépecha starting structure includes Pátzcuaro, Ihuatzio and the ascendant Tzintzuntzan.  Chalco is composite, independent and already in the war beginning in 1446; Huexotzinco is separate.  Tututepec is one concrete Mixtec `ñuu`, not a fabricated unified Mixtec state.

The Triple Alliance is three polities plus a typed agreement, shared-war obligations and delivery-specific beneficiary shares.  No universal late-period share formula is hard-coded without evidence for that obligation.  A tribute beneficiary gains neither legal ownership nor actual control.

#### Catalogs

Food includes maize and an aggregate basket; beans, amaranth, chili and fish are separate only if source/granularity justifies them.  Materials include obsidian, timber, stone, clay and salt.  Fibers/goods include cotton, maguey fiber, woven textiles/mantles, pottery and paper.  Prestige/ritual goods include cacao, feathers, copal, shell, greenstone and gold.  Copper is regionally available to Purépecha/western production, never a universal input.

Military supply uses projectile/close weapons, shields, quilted cotton armour, provisions and porters.  Logistics uses canoe, road/portage and relay capacity—no horses or wheeled freight.  Activities/processes include chinampa and rain-fed/terrace agriculture, fishing/salt, obsidian blade production, weaving, pottery/stone/feather/lapidary crafts, market/long-distance exchange, western copper metallurgy and canoe/porter routes.

Institutions are scenario declarations: `altepetl`, `ñuu`, Purépecha polity forms, calpolli/tlaxilacalli, tlatoani, cihuacoatl, councils, tribute collectors, pochteca/market authorities, temple/priestly institutions, telpochcalli/calmecac, Tlaxcallan's four centers, sourced Mixtec dynastic forms and Purépecha irecha/cazonci/Uacúsecha.  None becomes a universal TypeScript enum.

#### Conserved tribute contract

```ts
interface TributeObligation {
  payerPolityIds: PolityId[];
  sourceRegionIds: RegionId[];
  beneficiaries: Array<{ polityId: PolityId; shareBp: number }>;
  deliveries: TributeDelivery[];
  laborService?: LaborObligation;
  militaryService?: MilitaryObligation;
  routeIds: RouteId[];
  cadence: string;
  arrears: Quantity[];
  complianceBp: BasisPoints;
  enforcementBasisId: string;
  evidenceIds: EvidenceId[];
}
```

Each delivery debits conserved goods, labor or personnel from payer/source and credits beneficiaries.  Partial delivery and arrears are ledger entries.  Labor, porters and military service reduce available workforce/recruitment and cannot be counted twice.  Peace may change tribute, route/market access, goods or control; war does not imply annexation.  Military formations remain aggregate household levies, elite retinues, allied/tributary contingents and garrisons constrained by provisions, porters, route, distance and season.

#### Provenance and gates

Use official/institutional material for structure: [The Metropolitan Museum on Triple Alliance tribute with retained local rule](https://82nd-and-fifth.metmuseum.org/toah/ht/08/canm.html); INAH on [Tlatelolco](https://lugares.inah.gob.mx/es/mundial/6438), [Tlaxcallan](https://lugares.inah.gob.mx/es/node/4818), [Tzintzuntzan](https://lugares.inah.gob.mx/es/node/4481), [Huexotzinco](https://lugares.inah.gob.mx/es/node/4282) and [Tututepec](https://www.codices.inah.gob.mx/movil/contenido.php?id=11); and the Cambridge excerpt on [`altepetl` as a core political-economic unit](https://assets.cambridge.org/97810093/68094/excerpt/9781009368094_excerpt.pdf).

INAH's [Matricula de Tributos](https://www.codices.inah.gob.mx/pc/contenido.php?id=54) and the Bodleian [Codex Mendoza](https://digital.bodleian.ox.ac.uk/objects/2fea788e-2aa2-4f08-b6d9-648c00486220/) are later, mainly sixteenth-century evidence.  For a 1450 start they may inform vocabulary, categories and possible cadence, but not exact boundaries, obligations or quantities.  Uncertain ruler, boundary, population or delivery is `unknown` or a ranged derived assumption with confidence, never plausible filler.

Add `packages/engine/test/tribute.test.ts`.  Acceptance forbids undeclared `coal`, `oil`, `steel`, `bond`, `GDP`, `unemployment`, `finance minister`, `head of government` and `industry budget` in Meso state/brief/UI; occurrences are allowed only inside quoted untrusted player text or an explicit rejection.  Tribute must conserve deliveries/shares, not change control, and correctly account for labor/personnel service.

### 21.4 Runtime and scenario acceptance

- `server/scenarioPackStore.js` compiles/loads every package through the same registry; `server/europe1935Runtime.js` is gone.
- Game creation stores `seedChecksum`, not `engineDriven` plus `engineScenario`.
- `RuntimeScenarioProjection` supplies localized polity labels, colors, geometry/overlay and playable IDs.
- No scenario receives executable code or undeclared runtime entity; recipe graphs are acyclic.
- Every material historical value has source/method/confidence/TODO and exact value binding.
- Region totals derive polity totals; population/control, formation origins, recruitment/workforce and all stockpiles reconcile.
- Three compilations are identical, set-like authoring order is irrelevant, and two offline AI-free 12-month runs are byte-equivalent.
- Europe, Napoleonic and Meso briefs share a protocol but not catalogs, terminology, actors or hidden default institutions.
- Model-call scheduling is event/quarterly and active/supported/inert aware; it must be affordable enough for the three 30-month live gates without weakening required checkpoints.

## 22. Package-level handoff template

Every implementation agent must leave this compact handoff in its PR or task result:

```text
Work package:
Canon invariants implemented:
State/schema version change:
Owned files changed:
Legacy path removed or still blocked by:
Tests added first:
Commands run and results:
Replay/checksum evidence:
Known follow-ups outside this package:
```

Do not report a work package complete when its exit gate, migration or named tests remain unfinished.

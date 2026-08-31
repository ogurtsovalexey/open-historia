# 10 — Minimal path to a playable campaign

Status: accepted by the owner 2026-08-31. This document is the binding delivery
sequence after P3a. Its purpose is to unlock a complete grand-strategy loop with
the smallest coherent mechanics, then add depth only where playtesting proves
it useful. Inspirations are Civilization V, Cossacks II, Europa Universalis and
Hearts of Iron; their complexity is not a requirement.

## Preconditions

- P0–P3a remain green and their accepted contracts are not rewritten.
- The inherited map application remains the product shell; the engine remains
  authoritative for formulas, validation, totals and state transitions.
- The current Central Europe scenario has Austria, Germany, Czechia and
  Slovakia across 47 regions. The playable target adds metropolitan France and
  Poland using GADM admin-1 regions and scenario-authored starting facts.
- Campaign memory is a bounded context index, not canonical domain state.

## Cross-cutting contracts

- Every mechanic is an optional scenario module and commits through the same
  atomic, versioned world revision. V1 sessions remain readable and acquire new
  projections only on the first real commit involving that module.
- Player prose and AI intent compile to unified typed commands. The engine
  validates preconditions and resolves all numeric effects; rejected commands
  do not partially mutate state.
- Every domain writes causes to the contribution ledger. Agreements, conflicts,
  projects, characters and known facts live in canonical state, never only in
  prose or campaign memory.
- No model receives the full map, geometry, hidden exact state or unbounded
  history. Briefs contain only task, actor, targets, domains, allowed actions
  and deterministically selected facts.
- The utility model handles advice and allowlisted, reversible routine actions.
  It has no monthly call cap, but has concurrency 6 and caches identical briefs.
  Material decisions require the strategic model: war, peace, alliances,
  ultimatums, succession, coups, major reforms and crises.
- One strategic batch may cover up to six countries. A major crisis may use a
  separate deep call. If a required strategic call is unavailable, time stops
  and the proposal remains a draft; there is no silent utility fallback.
- Player material actions always require explicit confirmation. Rival AI may
  act autonomously within the same validated command contracts.

## Delivery sequence

### 1. Six-polity world and AI orchestration v2

Add metropolitan France and Poland to the product scenario, with synthetic but
scenario-authored economy values and stable polity/region ids. All six polities
receive deterministic ticks and bounded briefs. Introduce the utility/strategic
routing rules above before adding more material actions.

**Playable outcome:** a twelve-month six-country campaign runs atomically; all
countries act, repeated briefs are cached, at most six utility calls run at
once, and a failed required strategic call cannot advance time.

### 2. P3b — diplomacy and bilateral trade

- Relations expose `opinion`, `trust` and `threat`. The strategic model assesses
  situational utility from bounded evidence instead of persisting an invented
  universal score.
- Negotiation is explicit: proposal → counterproposal → accept/reject. Other
  countries know contact occurred but do not automatically know private terms.
- Initial agreements are non-aggression pact, defensive alliance, guarantee
  and military access. Calls to arms are explicit for the player; refusal is
  legal and damages trust.
- Trade supports one-off and recurring resource exchanges, paid with another
  resource or treasury. The engine publishes a base-plus-scarcity reference
  price, validates abstract route connectivity/capacity, partially delivers a
  short contract, and records breach/trust effects. Recurring contracts have a
  fixed term and early-termination penalty.

**Playable outcome:** the player can negotiate, counter, sign and breach a
trade or defensive agreement; an AI country reacts to shortages and relations;
all delivered resources and treasury movements conserve exactly.

### 3. P3c — finance, projects and intelligence

- Finance starts with national tax burden plus exemptions, budget categories
  and priorities, bonds with a credit limit and interest, and a
  restructuring/default crisis. Inflation, currencies and special war-finance
  buttons are deferred; war uses the normal budget.
- A unified `Project` contract covers construction, reforms, research,
  mobilization, intelligence and deception. Projects consume budget and one or
  more shared expandable capacities: administration, science and industry.
  Scenario catalogs provide validated templates; AI may propose bounded
  variants. Familiarity reduces cost, while universities, education,
  repression and brain drain change capacity.
- Each country receives evidence-backed `knownFacts` with confidence, date,
  source and staleness. Scenario-authored `knowledgeSeeds` provide historical
  starting knowledge. The AI may assess evidence narratively but cannot create
  authoritative facts. Espionage and deception are projects/operations.

**Playable outcome:** a country can fund policy through taxes or debt, choose
between competing projects, gather imperfect information and suffer a visible
default or project opportunity cost without secret-state leakage.

### 4. P4 — internal politics and characters

- Scenarios define 3–6 factions and the relevant ideological/traditional axes.
  Economy, identity and policy feed legitimacy, stability and unrest.
- Typed political actions and a dedicated panel expose demands, concessions,
  repression and appointments. Escalation runs from demands through protests
  and strikes to coup or rebellion; AI chooses only from engine-allowed options.
- Scenarios define the ruler, heir and a bounded set of key offices. Characters
  have starting and experience traits, loyalty, ambition and only significant
  personal relations. Succession law determines candidates; autonomous actors
  decide among engine-supplied possibilities.
- The player may create a historical or fictional runtime character. AI
  proposes qualitative trait bands; the engine validates and the player
  confirms the canonical entity.

**Playable outcome:** budget and diplomatic choices visibly move faction
support; the player can appoint officials and survive or lose power through a
deterministic, explainable succession/coup chain without ending the campaign
when a playable successor exists.

### 5. P5 — war, occupation and peace

- Armies are era-localized formations that may split and merge with strict
  manpower/equipment conservation. Standing forces and mobilized reserves draw
  from canonical population and stockpiles.
- Wars require a reason; starting without one applies validated penalties.
  Orders choose posture and target. Commanders contribute skill, traits,
  tactics and accumulated commander/formation familiarity.
- Fronts use connected supply capacity. Combat is aggregate and
  deterministic under a recorded seed. Occupation changes actual control but
  not ownership until a peace settlement commits.
- AI may bargain freely over terms rather than spending a war-score currency.
  The engine validates legal terms and consequences; player acceptance remains
  explicit.

**Playable outcome:** crisis → mobilization → supplied front → combat →
occupation → negotiated peace executes without creating manpower/equipment,
replays byte-identically, and recalculates transferred-region economics in the
same revision as ownership.

### 6. P6 — capabilities and identity

- Research unlocks non-linear capabilities rather than advancing through a
  universal year/tree. Capability work uses the Project system and the same
  science/industry/administrative constraints.
- Regions have a primary culture/religion and minorities. Mismatch affects
  unrest, taxation and recruitment. States define official and accepted
  identities and may choose tolerance, privilege, integration or coercion.
- Identity changes are slow, causal and policy-driven. Migration remains
  deferred until the static and policy loops prove fun.

**Playable outcome:** capability and identity policy create legible economic,
political and military tradeoffs without deterministic historical railroading.

### 7. P7 — campaign goals, crises and balance

- Scenarios offer directions, not formal victory/loss conditions. AI countries
  keep durable goals and may adopt adaptive goals from canonical state.
- A deterministic trigger engine detects crisis conditions; strategic AI forms
  the actors' positions and proposals from bounded facts.
- Campaigns have a soft horizon and may continue. The closing report scores a
  multidimensional legacy. Historical scenarios compare against an authored
  baseline; AI interprets better/worse outcomes and their cost.
- Losing a war, ruler or government does not automatically end play. The game
  ends only if the playable subject ceases to exist and no valid successor is
  available.

**Playable outcome:** a mocked full campaign path completes deal → alliance →
crisis → mobilization → war → occupation → peace → political consequence →
legacy, while still allowing a materially different replay from the same
starting scenario under different commands.

## Acceptance criteria

- Each slice ships as a vertical engine + persistence + bounded AI contract +
  existing-shell UI path; no standalone subsystem is considered delivered.
- Same scenario, commands, recorded model proposals and seed produce
  byte-identical state, ledger and reports.
- Every slice keeps root tests, typecheck, lint, goldens, determinism guard and
  mocked Playwright smoke green. Full-map or hidden-state prompt leakage fails
  the gate.
- Trade, budgets, projects, mobilization and combat have conservation tests;
  stale revisions, invalid ids, unavailable modules and model failure have
  explicit rejection tests.
- The final mocked end-to-end scenario covers the complete playable outcome in
  stage 7 and preserves player confirmation for every material decision.

## Not doing before the loop proves fun

- Colonies, naval warfare and convoys.
- Full markets, currencies and inflation.
- Migration and population diffusion.
- A detailed spy-network simulation.
- Division-level order of battle or tactical combat.
- Backlinks UI, a graph database or a standalone campaign-memory editor.
- Scripted historical event chains; history enters through starting state and
  authored knowledge, never guaranteed outcomes.

## Open questions

None. New depth must be justified by playtest evidence after the corresponding
minimum slice is playable.

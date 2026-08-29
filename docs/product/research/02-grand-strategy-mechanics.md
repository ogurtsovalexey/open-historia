# Comparative mechanics: Civilization, Hearts of Iron, Europa Universalis and Victoria

## Purpose

The goal is not to clone four games or accumulate their menus. It is to identify which causal loops make their worlds feel playable, then express those loops through a smaller number of coherent state systems and high-level decisions suitable for Open Historia's natural-language interface.

Official product pages and developer diaries are used to confirm broad mechanic intent; exact formulas and copyrighted content are not being copied.

## What to adapt

| Source | Strong idea | Adaptation for My Open Historia | Do not copy |
|---|---|---|---|
| Civilization | population/resources/production/technology are legible; leaders have agendas; cities/regions develop visibly | clear dashboard, finite strategic resources, project queue, research/civic capabilities, visible opportunity costs | tile-by-tile worker optimization, universal era/victory script, leader “bonuses” detached from historical state |
| Hearts of Iron | equipment is produced before units can use it; readiness, organization, doctrine and supply matter; fronts create operational constraints | personnel + equipment pools, formations, maintenance/procurement, supply graph, operational objectives and aggregate combat | division-template micromanagement, per-factory clicking and war-only product focus |
| Europa Universalis | government forms, legitimacy, estates, religion/culture, institutions, trade networks, claims, coalitions and long historical pressures interact | offices/succession, interest groups, religious/cultural composition, laws, institutional diffusion, bilateral reputation and conditional historical pressures | monarch “mana”, one-click cultural/religious conversion, scripted mission trees that force history |
| Victoria | population, employment, goods, living conditions, laws and interest groups create political consequences | sparse population groups, labour/needs, material + identity interests, laws, gradual reform and rare foreshadowed revolution | millions of fine-grained pop/building objects, a fully simulated world market before core play is proven |

Paradox describes EU4's long arc through trade, alliances, historical events, rulers and technology; its Cossacks material explicitly connects estates, cultural policy, religion and communicating goals to AI allies. Civilization VI's official overview emphasizes expanding cities, technology/civics, leader agendas, religion, loyalty/governors and environmental change. Victoria's design retrospectives place population, industry, goods, laws and political groups into one feedback loop. These are useful system relationships, not implementation requirements.

## The essential pillars

### 1. People and social composition

Population is more than a manpower total. At the minimum needed for a scenario, region-level sparse groups can carry:

- age and labour eligibility;
- urban/rural location;
- occupation/skill category;
- language/cultural identity;
- religion or non-religion;
- citizenship/accepted/discriminated status under current law;
- material living condition;
- political/interest-group affinity where relevant.

Do not build a full Cartesian product for every combination. Create a group only when a difference affects mechanics or scenario history, and merge negligible compatible groups. The global engine may retain aggregate shares until a group becomes politically or territorially relevant.

### 2. Material economy

People provide labour, consume essentials, pay taxes and react to living conditions. Regions provide capacity, resources, energy and routes. Policies and firms/institutions organize production at an aggregate level. Trade closes some gaps but creates dependencies. Budgets finance government, armed forces and investment. This produces understandable chains such as:

```text
fuel embargo
  → lower delivered energy/transport
  → lower industrial output and military supply
  → shortages/inflation and fiscal pressure
  → falling real incomes, elite conflict and unrest
  → diplomatic or strategic response
```

### 3. Government, law and institutions

Government form is a bundle of enforceable rules:

- who selects/removes office-holders;
- distribution of political power and franchise;
- centre/region relationship;
- property/tax/trade/labour regime;
- citizenship, language and religious policy;
- military service and emergency powers;
- judicial/bureaucratic strength;
- press/information environment.

Laws change gradually through political support, administrative work and resistance. A button does not instantly transform society. Institutions have capacity, coverage and trust; two countries with the same written law can implement it differently.

### 4. Culture, language and religion

These are identities and institutions, not simple colored modifiers. Their effects pass through:

- acceptance/discrimination laws;
- schooling, administration and official language;
- clerical organizations, charities, land/property and education;
- marriage/family and demographic norms where supported by the scenario;
- holidays, mobilization legitimacy and symbolic politics;
- interstate affinity, diaspora and transnational authorities;
- conversion, secularization and assimilation/integration over long periods;
- grievances, autonomy movements and secession risk.

Similarity alone does not determine loyalty, and difference does not automatically create unrest. Material treatment, political inclusion, local institutions, coercion, history, leadership and external sponsors mediate outcomes. Conversion/assimilation is slow, bounded, visible and ethically framed as policy with consequences—not a cost button that deletes identity.

### 5. Interests and political organization

Instead of one universal stability score, represent a small scenario-relevant set of actors: parties, estates, oligarchs, labour, military, church/religious bodies, regional elites, movements and civil society. Each has material interests, ideology, organization, leadership, constituency and resources.

Policies shift support and power. Coalitions form governments. Unrest progresses through warning states—petition, protest, strike, mutiny, insurgency, coup/revolution—so major domestic crises are consequential and rarely appear from nowhere.

### 6. Knowledge, institutions and technology

Research and diffusion depend on education, institutions, investment, industry, trade and international cooperation. Technology unlocks capabilities and raises efficiency; doctrine determines use. Avoid a single global tech tree that lets medieval and modern scenarios share implausible steps. Scenario/era modules select capability graphs.

### 7. Armed force and logistics

Military power is a material derivative of society and economy. People must be recruited/trained; equipment produced/imported/maintained; formations supplied and commanded. Terrain, infrastructure and information constrain operations. This is the most valuable HOI-style lesson and can be controlled through theatre-level objectives rather than template micromanagement.

### 8. Diplomacy, reputation and international systems

Treaties contain terms and obligations. Reputation is actor- and dimension-specific. Trade networks, alliances, guarantees, subjects/dependencies, great-power influence, international institutions and ideological/religious affinity shape choices. Coalitions should emerge from threat and interests, not an arbitrary “everyone attacks expansion” switch.

### 9. Information, intelligence and propaganda

The player should not see canonical truth automatically. Each observation has visibility/confidence and can be wrong or stale. Intelligence operations update knowledge, influence beliefs, protect secrets or enable operations. Propaganda changes perceived facts, morale and standing; it cannot rewrite actual GDP or equipment.

### 10. Environment, health and disasters

Climate, harvests, epidemic disease, natural disasters and environmental damage are optional scenario modules but require generic hooks. They affect population, infrastructure, food/energy and migration through bounded shocks. Modern long campaigns may include emissions/climate trends only when the time horizon and scenario make them meaningful.

## Depth without menu exhaustion

The product should use **management by intent and exception**.

### Command levels

1. **Goal**: “reduce Russian energy dependence within five years.”
2. **Policy package**: the advisor proposes imports, storage, grid projects, budget and diplomacy as a reviewable bundle.
3. **Priority/constraint**: budget ceiling, deadline, protected social spending, risk tolerance.
4. **Execution**: deterministic planner schedules legal projects/orders and reports only exceptions.
5. **Manual drill-down**: available for a player who wants to adjust a route, project, formation or law.

AI may draft the package, but every component is a typed command with computed cost and no hidden authorization.

### Attention budget

- one national dashboard with four to seven current strategic problems;
- an exception inbox for shortages, blocked projects, treaty deadlines, leadership transitions and front crises;
- batch decisions and reusable policy templates;
- auto-rules such as “maintain three months of fuel reserves up to this price”;
- delegated ministries/theatre commands with doctrine, budget and red lines;
- notifications only when a threshold, forecast or player-set objective materially changes;
- drill-down follows “summary → cause → affected records,” not a forest of unrelated menus.

Delegation is deterministic by default; using an LLM minister for strategic adaptation is optional and subject to the same typed authority limits.

### Decision quality

A good decision changes at least two pillars and makes its trade-off visible. Example:

```text
Accelerated mobilisation
  + formations become available sooner
  - labour leaves industry and farms
  - wage/tax base changes
  - training quality may fall
  - equipment/maintenance demand rises
  ± public support depends on threat, law and identities
```

A bad decision is “pay 100 political points for +5 production” without causal meaning.

## Historical economic context without railroading

It is impossible and undesirable for each scenario author to enumerate every future real event. Use four layers.

### Layer 1: dated starting state

The scenario/data pack defines what exists at the start: population, laws, institutions, capital/capacity, inventories, budget/debt, trade, prices, infrastructure, leaders, forces and territorial control. Values include provenance and uncertainty.

### Layer 2: structural context

Persistent conditions describe why the economy behaves as it does:

- resource endowment and geography;
- demographics/education/urbanization;
- institutional and property regime;
- technology/productivity frontier;
- trade/financial integration and import dependency;
- existing sanctions, treaties, debts and projects;
- business cycle, inflation expectations and spare capacity;
- corruption, compliance and administrative reach;
- security environment and disaster/health exposure.

These are canonical state or dated modifiers, not prompt lore.

### Layer 3: exogenous world series and conditional pressures

Some background changes originate outside the current active theatre: world commodity prices, global technology diffusion, financial conditions, climate/harvest patterns and broad demand. Data packs can provide reference trajectories and uncertainty bands.

Historical events use conditional pressures:

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
  sources: SourceRef[];
}
```

A 1916 war-price and supply environment or a 1797 blockade/trade environment can exist as global inputs; a specific revolution, coup, peace or war fires only if its drivers remain present. The game never forces a historical outcome merely because the calendar reached its real date.

### Layer 4: endogenous divergence

Each tick starts from current state, not from a stored future value:

```text
next state = rules(current state,
                   accepted policies/actions,
                   global environment,
                   active structural pressures,
                   resolved bounded shocks)
```

User actions alter capacity, expectations, relationships and exposure, so later outcomes diverge naturally. The UI may show a counterfactual baseline—“versus scenario reference”—but never overwrite actual play to meet it.

### What the AI contributes

The model can:

- recognize that current conditions make a known pressure relevant;
- select realistic NPC responses and political framing;
- propose a novel bounded shock when generic mechanics do not originate it;
- connect mechanical consequences into coherent news and diplomacy;
- identify missing context for a scenario-author review.

It cannot:

- silently fetch or invent a new authoritative starting statistic;
- force a real historical event after its prerequisites were removed;
- assign an exact economic loss, death count or reputation change;
- hide a policy or expenditure inside narration.

## Systems deliberately deferred

The following are useful but should not block global baseline coverage, the World 1916/Russia vertical slice or the World 1797 compatibility skeleton:

- detailed private ownership/firm competition;
- complex banking, securities and central-bank transmission;
- fine-grained social classes across the entire globe;
- colonial settlement/extraction mechanics for all eras;
- detailed naval design and air-wing management;
- global climate model;
- religion-specific bespoke minigames;
- mission trees and fixed victory conditions.

The core must provide extension points so Napoleonic, 1917, medieval or fictional scenarios can enable period-specific modules without carrying modern NATO, fiat-currency or air-power assumptions.

## Design test

For every proposed mechanic, ask:

1. What canonical stock, flow, institution or relationship does it represent?
2. What observable inputs change it?
3. What downstream choices does it affect?
4. Can the player understand the dominant causes?
5. Can it be controlled at goal/policy level without routine micromanagement?
6. Does it work when the LLM is unavailable?
7. Can a scenario disable/replace it for another era?

If it fails most of these questions, it is probably decorative complexity rather than strategic depth.

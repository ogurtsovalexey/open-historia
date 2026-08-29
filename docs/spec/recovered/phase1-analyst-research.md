# Recovered Phase 1 Analyst Research

> Recovered verbatim from local Codex session `01a04ae8-385c-7ca0-84cd-bfb142a2831d`
> (Analyst / Halley, DeepSeek V4 Pro, 2026-08-29T00:31:14.928Z).
> This file preserves the original agent artifact;
> `../consensus-spec.md` is authoritative where decisions differ.

---

Now I have everything needed. Let me compose the Research Doc.

---

# Phase 1 Research Doc: Scenario Architecture

## 1. Scenario Definition — How Paradox Defines Start Dates

### EU4's Bookmark System

EU4 bookmarks live in `/common/bookmarks/`. Each bookmark has:

```
bookmark = {
    name = "<locstring>"
    desc = "<locstring>"
    date = 1444.11.11          # THE canonical field
    center = <province_id>     # Optional: viewport center
    country = <TAG>            # Optional: suggested country
    easy_country = <TAG>       # Optional: recommended for new players
    default = yes              # Only one bookmark gets this
    effect = { <effects> }     # Optional: run only when bookmark explicitly clicked
}
```

**Key insight**: the `date` field IS the scenario. Change the date and the engine reads province history backward from that date to reconstruct the world. No scenario captures a complete snapshot — it's a *procedurally assembled* state from dated entries. The same history files serve all bookmarks equally.

EU4's province history (`/history/provinces/`) uses date-keyed entries:
```
owner = SWE
controller = SWE
add_core = SWE
culture = swedish
religion = catholic
base_tax = 5
base_production = 5
base_manpower = 3
trade_goods = grain
hre = no

1500.1.1 = { owner = RUS }   # Changes at this date
```

This means 1444 and 1618 use the same province files — the engine walks the date tree and takes the most recent entry ≤ start date. This is brilliant for our use: a single `regionHistory` per region, not one per scenario.

### CK3's History Structure

CK3 separates history into `/history/provinces/` (per-barony culture, religion, development, holding type), `/history/titles/` (per-title holder, liege, government, succession), and `/history/cultures/` (per-culture innovations by era). All keyed by date. Culture innovations look like:

```
867.1.1 = {
    discover_innovation = innovation_crop_rotation
    discover_innovation = innovation_gavelkind
}
950.1.1 = {
    join_era = culture_era_early_medieval
}
```

CK3 explicitly separates "what the barony IS" (province history) from "who RULES it" (title history) — which maps perfectly to our `regionOwnershipOverrides` vs. `polities` separation.

### Victoria 3's Ordered Pipeline

Vic3's history init is the most structured. It executes effects in a fixed order that constitutes what I'll call a *scenario assembly pipeline*:

| Order | Key | What it does |
|-------|-----|-------------|
| 1 | STATES | Creates states & assigns ownership; defines homelands, claims, incorporation |
| 2 | COUNTRIES | Sets government, laws, technology, IG composition, policies |
| 3 | POPS | Creates pops per state with culture, religion, profession, size |
| 4 | DIPLOMACY | Sets diplomatic relations, pacts, subjects |
| 5 | POPULATION | Sets pop wealth and literacy tiers |
| 6 | POWER_BLOCS | Creates power blocs |
| 7 | INTERESTS | Declares strategic interests |
| 8 | BUILDINGS | Creates buildings per state |
| 9 | PRODUCTION_METHODS | Sets PMs for buildings |
| 10-21 | MILITARY_FORMATIONS, AI, TREATIES, TRADE, etc. | Remaining subsystems |

### Recommendations for Open Historia

**Adopt a scenario assembly pipeline**, not a flat dataset. The current `wwii-1939.spec.mjs` already has an implicit order (polities → countryAssignments → regionOverrides → cities → simulationRules → startingTimelineText). Make it explicit:

```js
scenarioPipeline: [
    "setupTechnologyEra",       // What's possible and what's forbidden
    "setupPolities",            // Which countries exist
    "setupAlliances",           // Who's allied to whom
    "setupOwnership",           // Who owns what region
    "setupEconomy",             // GDP, resources, development per region
    "setupCultureReligion",     // Per-region culture/religion majorities
    "setupMilitary",            // Starting armies, fleets, forts
    "setupDiplomacy",           // Wars, truces, guarantees, subjects
    "setupNarrative"            // startingTimelineText, campaignMemory seeds
]
```

Each stage produces a layer that the next *may* reference but must not contradict. This is both a data model AND a validation contract (§7 below).

**Add date-keyed region history entries**, not per-scenario region ownership. This lets one region file serve multiple scenarios. The scenario just provides its `startDate` and the pipeline resolves ownership from dated entries ≤ that date:

```json
{
  "regionId": "POL.12_1",
  "history": [
    { "date": "1772-01-01", "owner": "POL", "culture": "polish", "religion": "catholic", "development": 12 },
    { "date": "1795-01-01", "owner": "RUS", "culture": "polish", "religion": "catholic" },
    { "date": "1918-11-11", "owner": "POL" },
    { "date": "1939-10-06", "owner": "GER", "occupier": "GER" }
  ]
}
```

This separates **authored ground truth** (history entries) from **engine assembly** (resolving to start date). It's how EU4 and CK3 actually work.

---

## 2. Ground Truth vs. AI-Generated vs. Engine-Computed

### EU4's Approach

Paradox's split is clean:

| Layer | Source | Example |
|-------|--------|---------|
| **Pre-authored** | `.txt` in `/history/` and `/common/` | Province ownership, country tags, ruler names, capital, religion, culture, tech group, trade goods |
| **Engine-computed** | Formulas in the game binary | Army size from manpower × force limit, income from tax + production + trade, tech cost from institutions, unit stats from tech level |
| **Non-existent** | Not in Paradox games | AI does not author scenario data |

Paradox *never* lets AI create starting conditions. Everything is hand-authored. But we DO let AI fill gaps — this is the novel design problem.

### Mapping to Open Historia

| Category | Source | Because |
|----------|--------|---------|
| **Polity definitions** (tags, names, colors, aliases) | **Author** | These are identity — AI doesn't invent countries |
| **Region ownership** | **Author** (date-keyed history) | Borders are the fundamental ground truth. AI can't invent them. |
| **Alliances, wars, truces** | **Author** (key treaties/conflicts) | These define the scenario's strategic landscape. AI only fills minor relationships. |
| **Technology era constraints** | **Author** | "No nukes before 1945" is author intent, not AI judgment |
| **Major cities** | **Author** | Names, locations, populations per historical record |
| **Per-region culture/religion** | **Author for key regions, AI for unmentioned** | Author defines the broad strokes (Catholic Europe, Sunni Middle East); AI fills exact minority percentages in unmentioned regions |
| **Per-region development** | **AI-generated from historical GDP/population** | Authors can't hand-enter development for 8000+ regions. AI estimates from 1939 economic data. |
| **Military starting positions** | **AI-generated from historical OOB** | Author says "Germany has Wehrmacht in Sept 1939"; AI generates unit placements from historical orders of battle |
| **Diplomatic relations** | **Author for major, AI for minor** | Author: "Axis vs. Allies". AI: "What's Brazil's opinion of Argentina in 1939?" |
| **GDP, inflation, employment** | **Engine-computed** (§6 of principles) | Author sets `regionBaseOutput` + `resources`; engine computes aggregate GDP. Never authored directly. |
| **Starting armies** | **AI-generated, author-approved** | AI generates from historical data; author validates plausibility |

### The EU4 History Files Analogy

EU4's model:
- `/common/countries/` → What a country IS (color, ideas, government, units) — analogous to our `polities`
- `/history/countries/` → What happened to it before start (rulers, wars, decisions) — analogous to our date-keyed region/country history
- `/history/provinces/` → What happened to provinces before start (ownership, culture, religion, development) — analogous to our `regionHistory`

Our extension: we add an **AI gap-filler** that runs after author data is loaded and before the engine starts. The pipeline becomes:

```
Author data → AI gap-filler → Engine assembly → Validated start state
```

The AI gap-filler receives an explicit "missing fields" manifest that the validation layer generates from the author's declared coverage.

### Concrete Field Classification

For the `wwii-1939.spec.mjs`:

**Author-defined (ground truth)**:
- `polities[].name`, `polities[].color`, `polities[].aliases`
- `countryAssignments` (whole-country grants)
- `regionOverrides` (critical border adjustments)
- `cities` (name, location, population, tier)
- `game.startDate`
- Major alliances (Axis, Allies)
- Active wars (Germany–Poland, Japan–China)
- Technology era ceiling
- `startingTimelineText`
- `aiHistoryMode`

**AI-generated (gap-fill)**:
- Per-region `baseDevelopment` for ~8,000 regions beyond key cities
- Per-country `startingEconomy` (GDP estimate, employment structure)
- Military deployments (unit counts × region, from historical OOB)
- Minor diplomatic relations (non-belligerent opinions, trade agreements)
- Per-region minor culture/religion percentages for unmentioned areas

**Engine-computed (never authored)**:
- GDP totals from region development + resources
- Army sizes from population × mobilization rate
- Trade routes from resource distribution
- Technology level from era + institutions
- Culture/religion diffusion (post-start)

---

## 3. simulationRules — From String to Structured Data

### Current State

`wwii-1939.spec.mjs` has:
```js
simulationRules: "It is 1 September 1939. Germany has just invaded Poland..." // ~200 words of prose
```

This is a free-text prompt blob. It works for the current AI prompt pipeline but has zero machine-readable structure, no validation, and no way for the engine to enforce rules automatically.

### EU4's Institutions System

EU4's institutions model is the closest Paradox equivalent to "era rules." Key mechanics:

1. **8 institutions** spanning 1444–1821, each with:
   - Spawn conditions (year, province requirements)
   - Spread modifiers (per-province and per-country)
   - Technology cost penalty for non-embraced (+15%, +30%, +50% per institution level)
   - Bonuses on embrace (e.g., Renaissance: −5% dev cost, −5% construction cost)

2. **Technology groups** at scenario start: Western, Eastern, Muslim, Chinese, etc. Each starts with different institution embracement and tech levels.

3. **Tech levels** (1–32) tied to historical years. Tech 4 "should" appear ~1453. Being ahead incurs +10% cost per year ahead.

This is exactly the pattern we need: a machine-readable structure that the engine can enforce, but which scenario authors define.

### HOI4's Focus Trees as Constraint Model

HOI4 focus trees encode era/strategic constraints via:
- **`prerequisite`**: Must complete focus X before Y (AND/OR logic)
- **`mutually_exclusive`**: Can't take both (e.g., Democratic vs. Fascist path)
- **`available`**: Arbitrary trigger conditions (date, war status, stability)
- **`allow_branch`**: Visibility toggle (e.g., Communist branch only visible if ideology shifted)
- **`bypass`**: Auto-complete if conditions met

This maps to our `forbiddenActions` concept: certain actions are unavailable based on era, technology, or diplomatic state.

### Recommended simulationRules Structure

Replace the prose string with:

```typescript
interface SimulationRules {
  // Core era definition
  techEra: {
    name: string                 // "World War II Era"
    yearRange: [number, number]  // [1939, 1945]
    availableTech: string[]      // "propeller_aircraft", "armored_warfare", "radar", "computing_early"
    forbiddenTech: string[]      // "nuclear_weapons", "jet_aircraft", "icbm", "satellites" — absolute prohibition
    techGroups: Record<string, { // Per-country tech starting point
      level: number
      embracedInstitutions: string[]
    }>
  }

  // Alliance blocks — machine-readable, not prose
  allianceBlocks: Array<{
    id: string                    // "axis", "allies", "comintern"
    name: string
    members: string[]             // Polity tags
    formedDate: string
    type: "defensive" | "offensive" | "non_aggression" | "economic"
  }>

  // Active wars at scenario start
  activeWars: Array<{
    id: string                    // "war-poland-1939"
    name: string
    attackers: { tag: string, role: "primary" | "co-belligerent" }[]
    defenders: { tag: string, role: "primary" | "guarantor" }[]
    startDate: string
    casusBelli: string            // "territorial_conquest", "independence", "containment"
    warGoals: Array<{ target: string, type: string }> // What each attacker wants
  }>

  // Technology and action constraints (HOI4-like)
  constraints: {
    forbiddenActions: string[]    // "declare_war_without_casus_belli" (post-1928 Kellogg-Briand)
    requiredTechFor: Record<string, string[]> // "tank_division" → ["armored_warfare"]
    maxMobilizationRate: number   // Era-dependent ceiling (WW2 ~15%, medieval ~2%)
    diplomaticNorms: string[]     // "embassy_system", "league_of_nations", "un_charter"
  }>

  // Economic era rules (Vic3-like)
  economyRules: {
    baseGDPGrowthRate: number     // 0.02 = 2% peacetime trend
    warEconomyModifiers: Record<string, number> // "consumer_goods_factor": 0.7
    tradePolicyOptions: string[]  // "free_trade", "protectionism", "autarky"
    currencySystem: string        // "gold_standard", "bretton_woods", "fiat"
  }>

  // AI behavior constraints
  aiHistoryMode: "conditional" | "free" | "guided"
  aiPromptOverrides: {           // Era-specific prompt injection for AI
    strategicContext: string      // "Nuclear deterrence does not yet exist. Armies fight with..."
    forbiddenBehaviors: string[]  // "DO NOT suggest nuclear weapons research"
  }>

  // Narrative parameters
  narrativeContext: string        // Short prose for AI prompt, replaces current free-text
  eraFlavor: Record<string, string> // "casus_belli_label": "justification for war"
}
```

### Key Design Decision: Author-Defined, Engine-Enforced

The `constraints.forbiddenActions` list is NOT advisory. The engine MUST reject AI-generated events that violate it. This is the equivalent of EU4 blocking tech advancement past the current institution — the engine owns the enforcement, not the AI.

---

## 4. Economy in Scenarios

### Victoria 3's Approach

Vic3 defines starting economy through:
1. **State-level buildings** (`/history/buildings/`): each state gets explicit building levels (farms, mines, factories, ports, barracks)
2. **Pop-level wealth** (`/history/population/`): each country gets a wealth tier (`effect_starting_pop_wealth_high`) and literacy tier
3. **Pops with professions** (`/history/pops/`): explicit pop counts per state, per culture, per religion, per profession type
4. **Production methods**: preset PMs for buildings
5. **Laws and institutions**: tax rates, tariff policies, welfare

The granularity is *extreme* — Vic3 models every building level, every pop profession. A 1939 scenario with 8,000+ regions cannot replicate this.

### EU4's Approach

EU4 keeps it much simpler:
- `base_tax` per province (administrative income)
- `base_production` per province (production income)
- `base_manpower` per province (recruitment capacity)
- `trade_goods` per province (which trade good)
- Country-level: `treasury`, `stability`, `prestige`, `mercantilism`

### Recommended Approach: EU4 Simplicity, Vic3 Principles

**What the author defines** (per region):
```typescript
interface RegionEconomy {
  regionId: string
  development: {
    agricultural: number   // 1–30, EU4-style base tax equivalent
    industrial: number     // 1–30, base production equivalent
    manpower: number       // 1–30, EU4-style base manpower
  }
  resources: string[]      // "coal", "oil", "iron", "food", "gold", "rubber", "aluminum"
  infrastructure: number   // 0–10, affects mobilization speed and trade throughput
  tradeGood: string        // Primary export good (EU4-like)
}
```

**What the engine computes**:
- `GDP = Σ(region.agricultural × agricultural_value + region.industrial × industrial_value)` × country modifiers
- `Population = Σ(region.development) × era_multiplier × region_modifiers`
- `Manpower pool = Σ(region.manpower) × population_factor × mobilization_laws`

**What AI fills**:
- Per-region development values for regions not hand-authored
- Starting GDP estimates per country (for narrative purposes)
- Employment structure percentages

The author only needs to define development for major regions (capitals, industrial centers, resource-rich areas). AI fills the remaining ~7,900 regions. The engine validates that AI-filled values are within plausible range for the era.

### Economic Granularity Rule

**Don't exceed what a single human can audit.** A scenario with 18 polities and 300 region overrides (like wwii-1939) has ~300 economic data points plus ~100 city populations. That's already the upper bound. Adding per-region development for all 8,000 regions would be un-auditable. Instead:

1. Author defines key regions (capitals, major cities, contested zones)
2. Author defines per-country `startingEconomy` baseline (GDP tier, development level)
3. AI fills per-region development proportionate to region importance (city tier, resource presence)
4. Engine enforces `Σ(region.GDP) ≈ country.GDP_baseline`

---

## 5. Culture and Religion

### CK3's Data Model

CK3 defines culture and religion at the **barony level** (lowest map unit, roughly a city). Each barony in province history gets:

```
culture = swedish
religion = catholic
```

The barony's culture/religion propagate to the county. CK3 also has:
- **Culture pillars** (ethos, language, heritage, martial custom, aesthetic): define a culture's permanent traits
- **Culture traditions**: unlockable modifiers (e.g., `xenophilic`, `stalwart_defenders`)
- **Faith doctrines**: comprehensive religious rules (clerical tradition, head of faith, marriage doctrines, crime doctrines, clergy doctrines, special doctrines)
- **Faith tenets**: 3 core beliefs that define the faith's character (e.g., Armed Pilgrimages, Communion)
- **Holy sites**: 5 locations per faith providing bonuses when controlled

### CK3's Culture Innovation by Date

Cultures discover innovations on historical dates:
```
867.1.1 = { discover_innovation = innovation_crop_rotation }
1066.1.1 = { discover_innovation = innovation_manorialism }
```

This is analogous to our "technology era" concept — what's been discovered by game start.

### Victoria 3's Pop-Based Model

Vic3's approach is pop-centric: each state has explicit pop counts per culture/religion:
```
create_pop = { culture = byelorussian, size = 176925 }
create_pop = { culture = polish, religion = catholic, size = 29783 }
create_pop = { culture = ashkenazi, religion = jewish, size = 26100 }
```

This is extremely precise but requires per-state data for every culture/religion combination — impossible for a global map at Open Historia's scale without AI assistance.

### Recommended Approach: CK3 Simplicity + Vic3 Precision via AI

**Author defines** (per culture group and religion):
```typescript
interface CultureDefinition {
  id: string                    // "germanic"
  name: string                  // "Germanic"
  group: string                 // "western_european"
  color: string                 // Map color
  traditions: string[]          // "militarism", "industrial_efficiency" (CK3-like traits)
}

interface ReligionDefinition {
  id: string                    // "catholic"
  name: string                  // "Catholicism"
  group: string                 // "christian"
  color: string                 // Map color
  traits: string[]              // "hierarchical", "evangelical", "monastic"
}

interface RegionCulture {
  regionId: string
  primaryCultureId: string
  primaryReligionId: string
  minorities: Array<{
    cultureId: string
    religionId: string
    percentage: number          // 0–100
  }>
}
```

**Author defines**: culture and religion definitions (traits, groups, colors), and region culture for key contested regions (Alsace-Lorraine, Danzig, Sudetenland, Bosnia).

**AI fills**: region culture for the remaining ~7,800 regions. AI can reference 1939 census data, but the engine stores the result as authored data once generated.

**Engine computes** (post-start): culture/religion diffusion per §8 of principles.

### Granularity Decision

CK3 uses ~2,700 baronies. We have ~8,000 GID_1 regions. Per-region culture is feasible. Per-region *detailed minority breakdown* (Vic3 style) is not. Recommendation:

- **Ground truth**: primary culture + primary religion per region
- **AI fills**: minority list with approximate percentages (top 3 minorities per region)
- **Engine**: renders cultural map mode from primary culture, with stripes/hatching for significant minorities (>20%)

---

## 6. Pregame History

### How Paradox Handles the Gap

Paradox does NOT simulate the gap between "real history" and game start. Instead:

1. **EU4**: Province history files have date-keyed entries. The engine reads the latest entry ≤ start date. All 400 years of pre-1444 history are just a chain of ownership/culture/religion mutations — no simulation, just authored snapshots at key dates.

2. **CK3**: Title history tracks holder succession by date. Character history tracks birth/death/traits. There is no "simulation" — these are authored by Paradox from historical records. The engine just loads the final pre-start state.

3. **Victoria 3**: The history pipeline builds the world from authored effects. No pregame simulation. Starting pops, buildings, laws are all hand-authored.

4. **HOI4**: The 1936 scenario assumes the engine can reconstruct the world from province ownership + country ideology + military factories. No simulation of interwar period.

**The pattern is universal**: Paradox authors history files by hand from historical research. The "pregame history" IS the authored data. There is no procedural generation of pre-start state.

### What This Means for Open Historia

We have a fundamentally different constraint: AI generates pregame history because we can't hand-author history for every region across every era. Our `pregameHistory` task (referenced in `ai-schemas.md`) already exists — it's the AI equivalent of Paradox's history files.

The flow should be:

1. **Author** defines key historical turning points per region (`regionHistory` entries at critical dates)
2. **AI pregameHistory task** generates connecting events between author-defined milestones
3. **Engine** assembles the final state by applying all events ≤ `startDate`
4. **Validation** ensures the assembled state is internally consistent

This is conceptually identical to what `ai-schemas.md` already documents: the `pregameHistory` task with `PRE_HISTORY_SCHEMA`, validated through the two-layer system, with `campaignMemory` facts as persistent bindings.

### Concrete Recommendation

Add to each region's data:
```typescript
interface RegionHistory {
  regionId: string
  entries: Array<{
    date: string
    owner?: string
    occupier?: string
    culture?: string
    religion?: string
    development?: number
    event?: string   // "Treaty of Versailles transferred this from GER to POL"
  }>
  pregameEvents: string[]  // AI-generated event IDs filling gaps between entries
}
```

The author defines `entries` (ground truth at key dates). The AI `pregameHistory` task fills events between entries. The engine resolves the state at `startDate` by walking the combined timeline.

---

## 7. Scenario Validation — Preventing Contradictory Starting Conditions

### How Paradox Enforces Invariants

Paradox games enforce invariants through the *structure* of their data model, not through explicit validation rules:

1. **EU4 province ownership**: A province can have exactly one `owner` and one `controller`. The file format makes this unambiguous — you set the key, there's no way to assign two owners.

2. **CK3 title hierarchy**: Every barony belongs to exactly one county, every county to one duchy, etc. The `landed_titles` tree enforces this by structure. Holdings have exactly one type.

3. **Victoria 3's assembly order**: The ordered pipeline prevents circular dependencies. Pops are created AFTER states and countries exist. Buildings are created AFTER pops. This is structural validation by construction.

4. **EU4's country tags**: Every country has a unique 3-letter tag. `country_tags/` files enforce this at load time — duplicate tags are a crash, not a runtime error.

### Invariants We Must Enforce

Based on Paradox patterns and our architecture:

| Invariant | How Paradox Enforces | Our Enforcement |
|-----------|---------------------|-----------------|
| Each region has exactly one owner | Province file structure | Validation: `regionOwnershipOverrides` must have no duplicate keys; unowned regions get `unassignedKeepModernOwner` fallback |
| Each country exists with a unique tag | `country_tags/` file structure | Validation: `polities` keys must be unique; referenced tags in `countryAssignments` must exist in `polities` |
| Alliance members must be existing polities | By data structure | Validation: `allianceBlocks[].members` must be subset of `polities` keys |
| Active wars must have valid participants | By data structure | Validation: `activeWars[].attackers/defenders[].tag` must exist in `polities` |
| Technology constraints are absolute | Engine enforces tech group rules | Validation: AI-generated events with `forbiddenActions` violations are rejected at Layer 2 |
| Resource totals are engine-computed | Building/production system | Validation: Engine `Σ(region resources) === country total` — no AI can set country totals directly |
| Cities must be in owned regions | Province/county structure | Validation: `cities[].regionId` must be covered by `regionOwnershipOverrides` or `countryAssignments` |
| No polity has zero regions | Countries must own states in Vic3 | Validation: `isPolityLandless()` check (already exists in `gameState.js:917`) |
| GDP sum constraint | Not enforced (Vic3 models it per-pop) | Soft validation: `Σ(region development) ≈ expected GDP for era` |
| Pre-start nuclear weapons impossible | By technology era | Hard validation: `forbiddenTech` blocks any AI event involving nuclear tech before 1945 |

### Validation Pipeline

Adding to the existing two-layer validation in `ai-schemas.md`:

**Layer 1 (structural)**: JSON Schema validation with `additionalProperties: false`
**Layer 2 (world-aware)**: `validateScenarioConsistency(scenario)` — checks the invariants above
**Layer 3 (scenario assembly)**: `validateAssembledState(worldState, scenarioRules)` — after AI gap-filling, verifies the final world is consistent

Layer 3 would run after the scenario pipeline assembles the world and before the game begins. It catches contradictions that only emerge when all layers are combined (e.g., "Country A is at war with Country B but they share a military access treaty").

### What Open Historia's Architecture Already Enforces

The existing system already provides:
- `validateGameplayPayload` (generic schema validation)
- `validateGeneratedWorldChanges` (map-aware: resolves region names, validates transfers)
- `campaignMemory` facts (causal bindings that survive event window expiration)
- `strict-vs-salvage` retry discipline (bad AI outputs are fixed or fallback'd)

What's missing for scenarios specifically:
1. **Scenario-level schema** with `additionalProperties: false` (the `.spec.mjs` is unvalidated JS)
2. **Cross-field invariant checks** (alliance membership × polity existence, city × region ownership)
3. **Assembly order enforcement** (don't create pops before countries exist)
4. **AI-generated data validation** (gap-filled per-region development must sum to country baseline ± tolerance)

---

## Summary of Concrete Recommendations

| # | What | Priority | Effort |
|---|------|----------|--------|
| 1 | Add `scenarioPipeline` array to `.spec.mjs` defining assembly order | High | Low |
| 2 | Replace string `simulationRules` with structured `SimulationRules` interface (§3) | High | Medium |
| 3 | Convert `regionOverrides` to date-keyed `regionHistory[].entries` to serve multiple scenarios | High | High |
| 4 | Add per-region `development` object with agricultural/industrial/manpower values | Medium | Medium |
| 5 | Add `cultureDefinitions` and `religionDefinitions` to scenario spec | Medium | Medium |
| 6 | Add `regionCulture` with primary + minority structure to region data | Medium | Medium |
| 7 | Add `allianceBlocks` and `activeWars` as structured arrays in simulationRules | Medium | Low |
| 8 | Add scenario-level JSON Schema with `additionalProperties: false` | Medium | Low |
| 9 | Add `validateScenarioConsistency` function checking cross-field invariants | Medium | Medium |
| 10 | Define `forbiddenActions` and `forbiddenTech` lists per era | Low | Low |
| 11 | Expand `campaignMemory` to support scenario-pregame facts as "authored" status | Low | Low |

**Counter-recommendation**: Do NOT adopt Vic3's per-pop economic model. It's too granular for global scale. Stick with EU4-style per-region development values + engine-computed aggregates. The AI fills development gap values, not pop counts.

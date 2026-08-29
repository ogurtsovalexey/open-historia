# Recovered Phase 1 Region Research Supplement

> Recovered verbatim from local Codex session `01a04ae8-385c-7ca0-84cd-bfb142a2831d`
> (Analyst / Halley, DeepSeek V4 Pro, 2026-08-29T00:34:04.082Z).
> This file preserves the original agent artifact;
> `../consensus-spec.md` is authoritative where decisions differ.

---

Now I have everything. Let me compose the supplement.

---

# Research Doc Supplement: Sector Granularity & Region Merging

## Topic 1: Cossacks 2: Battle for Europe — What Matters for Us

### The Core Insight

Cossacks 2's "Battle for Europe" mode is the clearest commercial precedent for a turn-based global strategy layer with resource-driven diplomacy. Its design choices are instructive precisely because it makes the opposite trade-off from us: ~24 sectors vs. our ~8,000 GID_1 regions. The lesson isn't "copy their number" — it's "match granularity to player decision frequency."

### Sector-Based Map: The 24-Sector Model

The global map divides Napoleonic Europe into roughly 24 sectors, each corresponding to a historical region (Bavaria, Lombardy, Catalonia, etc.). Each sector is colored by owner. A nation's general — the only movable unit — can advance one sector per turn. Red pointers indicate attack (hostile sector), green pointers indicate movement through allied territory.

**Why this number works**: at 24 sectors, a player can survey their entire empire in seconds, evaluate threat adjacency instantly, and make one strategic decision per turn (move general X to sector Y). There is zero "what's this tiny province over here?" overhead. Every sector matters.

**What we can learn**: not 24, but the principle that the *decision surface* should match the *turn cadence*. Our turns are flexible (not 1/day), but the player should never feel like they're managing 8,000 individual tiles.

### General-as-Movable-Unit

One general per nation. The general IS the army — no separate unit counters. When the general enters a hostile sector, the game drops into real-time tactical battle. When an enemy attacks a general-less sector, the battle is auto-resolved. A general can also move through allied sectors (green arrows).

**What maps to us**: we already have `units` in `world.json` with a `unitsController`. The Cossacks model suggests adding a **`commanders`** entity — distinct from regular units — that carries strategic weight:

```typescript
interface Commander {
  id: string
  polityTag: string
  name: string
  location: string            // regionId
  traits: string[]            // "aggressive", "defensive", "logistician"
  armyComposition: Record<string, number>  // "infantry": 12000, "cavalry": 3000
  movementPoints: number      // 1 = can move to adjacent sector this turn
}
```

The commander doesn't replace units but *groups* them. A player moves a commander to a region; the engine resolves which units are there. Without a commander, conflict in a region is auto-resolved (AI jump with no player involvement). This directly mirrors Cossacks 2's two-tier conflict model.

### Auto-Resolve: Already Our Pattern

Cossacks 2's auto-resolve (no general = automated battle) is exactly our pattern: when the player isn't actively managing a theater, the AI `jumpForward` handles it. The key Cossacks difference is that auto-resolve outcomes in Cossacks are deterministic and immediate (attack succeeds or fails, sector changes hands). Our AI jumps are richer but slower. Recommendation: add a `conflictResolution` mode to `simulationRules`:

```
"conflictResolution": "detailed" | "auto" | "mixed"
```

- `detailed`: all battles produce full AI events with narrative
- `auto`: engine resolves conflicts formulaically (EU4-style dice rolls) — no AI call
- `mixed` (default): player-involved theaters get detailed; distant theaters auto-resolve

### Sector Resources & Upgrades

Each sector provides resources (food, coal, gold). Seizing towns within a sector's battle map grants resource income. The player can also build sector improvements (fortifications). This maps directly to:

1. Our `resources.regions` per-region resource definitions
2. Our `markers` system for built structures
3. The concept that a *sector* (not every individual region) is the economic unit

### Concrete Recommendations

| Cossacks 2 Feature | Open Historia Adaptation |
|---|---|
| ~24 sectors | 200-300 macro-regions (see Topic 2) |
| General moves 1 sector/turn | Commander entity with movement points |
| Auto-resolve without general | AI auto-jump for unmanaged theaters |
| Per-sector resources | Resources assigned at macro-region level, not per-GID_1 |
| Sector upgrades (fortifications) | Markers at macro-region level |
| Coalition diplomacy | Alliance blocks in `simulationRules.allianceBlocks` |

---

## Topic 2: Region Merging / Simplification Per Scenario

### The Problem at Scale

8,000 GID_1 regions pose three concrete burdens:

1. **Authoring**: no human can set `development.agricultural`, `development.industrial`, `culture`, `religion`, `resources`, and `tradeGood` for 8,000 regions. Even for wwii-1939 with its ~300 `regionOverrides`, the author only touches ~4% of available regions.

2. **AI token cost**: with `mapSemantics`, the AI doesn't see 8,000 regions, but the underlying *engine* must store and compute economy/culture/religion per region. 8,000 × 3 development fields × 2 culture fields = 48,000 data points to keep current.

3. **Player cognitive load**: no player cares about the agricultural output of `RUS.71_1` (some Siberian subdivision). They care about "Western Siberia produces oil and grain."

### How Paradox Games Handle This

**EU4's Province Hierarchy** (3,272 provinces):

| Tier | Count | Purpose |
|------|-------|---------|
| Province | 3,272 | Land ownership, warfare movement, development, buildings |
| Area | ~650 (2-5 provinces each) | States & territories mechanic |
| Region | ~80 | Mission targets, regional effects |
| Super-region | ~15 | Institution spread speed, trade companies |
| Continent | 6 | Trade company eligibility, coring range |

Key pattern: **development density is not uniform**. Europe has 827 provinces (25% of 3,272) but 33% of total development. Germany alone has ~145 provinces — more than all of South America (249). The density follows historical population and political fragmentation, not geographic area.

**EU4 Wasteland**: regions that cannot be colonized or traversed (Sahara, Himalayas, Greenland interior). They're *on the map* (not invisible) and get colored to match the surrounding owner if >50% bordering provinces share an owner. This is the model for "don't remove regions, just make them non-interactive."

**Victoria 3's Two-Tier System** (~730 state regions):

| Tier | Count | What it holds |
|------|-------|--------------|
| State region | ~730 | Pops, buildings, resources, development, culture homelands, claims, traits |
| Province (tile) | Thousands | Warfare fronts, visual terrain, split-state borders |

Vic3's insight: **separate the gameplay unit from the visual unit**. The provinces exist for warfare movement and front-lines, but ALL economic and demographic data lives at the state level. Provinces are pure geography; states are the game.

**CK3's Three-Tier Hierarchy** (~2,700 counties, ~400 duchies, ~150 kingdoms):

| Tier | Count | Purpose |
|------|-------|---------|
| Barony (holding) | ~9,000+ | Individual settlement, development, culture/religion source |
| County | ~2,700 | Character domain, capital, most development |
| Duchy | ~400 | De jure borders, duchy buildings, succession |
| Kingdom | ~150 | Vassal contracts, crown authority |
| Empire | 29 | Top-level de jure structure |

CK3's hierarchy is the most fine-grained: **each barony** has its own culture, religion, development, and holding type. But baronies are not the decision unit — counties are. Players never manage individual baronies; they manage counties and duchies.

### The Pattern Across All Three Games

```
Visual/Granular Unit (province/barony) ≠ Gameplay Unit (state/county/duchy)
```

The physical map is detailed. The decision layer is coarser. This is exactly what we need.

### Recommendation: `macroRegions`

**Do not remove or physically merge GID_1 regions.** The map renders them as-is. Borders, ownership, warfare, cities — all stay at GID_1 level. Instead, add an **optional grouping layer** that scenarios can define:

```typescript
// In the scenario .spec.mjs:
macroRegions: Record<string, MacroRegion>

interface MacroRegion {
  id: string                    // "western_europe_france_north"
  name: string                  // "Northern France"
  gid1Regions: string[]         // ["FRA.11_1", "FRA.14_1", "FRA.27_1", ...]
  center: [number, number]      // Optional: lat/lng for labeling

  // Economy — ONE set of values for the whole macro-region
  development: {
    agricultural: number        // 1-30
    industrial: number          // 1-30
    manpower: number            // 1-30
  }

  // Culture — ONE primary + top minorities for the macro-region
  culture: {
    primary: string             // "french"
    minorities: Array<{ id: string, share: number }>  // [{id: "breton", share: 0.08}]
  }

  // Religion
  religion: {
    primary: string             // "catholic"
    minorities: Array<{ id: string, share: number }>
  }

  // Resources
  resources: string[]           // ["iron", "coal", "food"]
  tradeGood: string             // "wine"
}
```

### Merge Rules

1. A `macroRegion` groups contiguous GID_1 regions owned by the same polity at scenario start.
2. If no `macroRegions` defined, the engine groups GID_1 regions **automatically** by GID_0 (modern country borders) with a default flag `autoMacroRegions: true`.
3. If `macroRegions` is explicitly empty (`{}`), every GID_1 region is its own macro-region (full granularity — expensive, for detail-oriented authors).
4. Region ownership changes apply to individual GID_1 regions (as now). When enough regions of a macro-region change hands, the macro-region **splits** (Vic3's split state pattern). The engine creates two new macro-regions: one for each owner.
5. Merged macro-regions inherit weighted-average development and resource counts from their component regions.

### Which Mechanics Use macroRegions?

| Mechanic | At macro-region level? | Why |
|----------|----------------------|-----|
| **Economy** (development, GDP) | ✅ Yes | Computing per-GID_1 GDP for 8,000 regions is wasteful; 200-300 macro-regions is fast |
| **Culture / Religion** | ✅ Yes | Diffusion at 200-300 regions is tractable per in-game month |
| **Resources** | ✅ Yes | Resource totals are per-macro-region; seized in chunks |
| **Ownership / Borders** | ❌ No | Stays at GID_1 — borders are the truth layer |
| **Cities** | ❌ No | Already defined per GID_1 region in the scenario |
| **Units / Warfare** | ❌ No | Movement and combat follow GID_1 borders |
| **Trade routes** | ✅ Yes | Trade flows between macro-regions, not individual GID_1 tiles |
| **Infrastructure** | ✅ Yes | One infrastructure score per macro-region; affects mobilization speed |

### What the Scenario Author Sees

For the `wwii-1939.spec.mjs`, an author would define something like:

```js
macroRegions: {
  "ger_ruhr": {
    name: "Ruhr Valley",
    gid1Regions: ["DEU.5_1", "DEU.7_1", "DEU.9_1", "DEU.11_1"],
    development: { agricultural: 8, industrial: 28, manpower: 18 },
    culture: { primary: "german", minorities: [] },
    religion: { primary: "protestant", minorities: [] },
    resources: ["coal", "iron", "steel"],
    tradeGood: "coal"
  },
  "pol_silesia": {
    name: "Upper Silesia",
    gid1Regions: ["POL.8_1", "POL.9_1", "POL.12_1"],
    development: { agricultural: 10, industrial: 22, manpower: 14 },
    culture: { primary: "polish", minorities: [{id: "german", share: 0.15}] },
    religion: { primary: "catholic", minorities: [{id: "protestant", share: 0.10}] },
    resources: ["coal", "zinc"],
    tradeGood: "coal"
  }
}
```

But they DON'T need to define all 300 — AI can fill the rest. The author defines the critical ones (Ruhr, Silesia, London basin, Donbas, Tokyo-Kanto, Pennsylvania coal belt, etc.) and AI fills the remaining ~280 macro-regions from historical economic data.

### Rendering Implications

The map **still renders GID_1 borders** at zoom levels below 6 (as it does now — `Nations.jsx` draws individual region fills). Above zoom 6, macro-region borders could be rendered as a thicker overlay (like EU4's area borders vs. province borders). The `ownerColoring` is computed per GID_1 (from `regionOwnershipOverrides`), so a macro-region split doesn't require map re-tessellation — just recoloring.

In MapLibre terms: add a `macroRegions` source layer that draws coarser borders at higher zoom levels. The data is a computed overlay from the `macroRegions` grouping, rendered similarly to how `Nations.jsx` already handles country labels and fills. No new rendering engine needed.

### When to Use macroRegions vs. Full Granularity

| Scenario Type | Use macroRegions? | Typical Count |
|---------------|-------------------|---------------|
| WWI / WWII (global) | ✅ Yes, 200-300 | ~250 |
| Medieval (CK3-like) | ✅ Yes, 300-500 | ~400 |
| Cold War (global) | ✅ Yes, 200-300 | ~250 |
| Ancient (regional, e.g. just Mediterranean) | No — 1,500 GID_1 regions is fine | Full |
| Napoleonic (EU-focused) | ✅ Yes, ~150 | ~150 |
| Modern Day (tutorial) | ✅ Yes, auto by GID_0 | ~200 |

### Final Architecture Decision

The proposal is a **two-tier model** modeled on Vic3's state/province split:

```
Tier 1: GID_1 Region (the map truth layer)
  - Ownership, borders, cities, unit movement
  - ~8,000 regions, immutable geography

Tier 2: MacroRegion (the gameplay decision layer)
  - Economy, culture, religion, resources, infrastructure
  - 100-500 regions per scenario, scenario-defined or auto-generated
  - Merges 5-50 GID_1 regions each
  - Splits on ownership change beyond threshold
```

This preserves the visual detail of the 8,000-region map while reducing the authoring and compute surface to a manageable scale. It mirrors Vic3's proven architecture and gives scenario authors explicit control over where to add detail (hand-define the Ruhr) vs. where to accept auto-grouping (auto-merge Siberia).

# Recovered Phase 1 Developer Technical Spec

> Recovered verbatim from local Codex session `01a04af1-3f09-7e30-aefe-10d667c1b565`
> (Developer / Mill, DeepSeek V4 Pro, 2026-08-29T00:40:32.303Z).
> This file preserves the original agent artifact;
> `../consensus-spec.md` is authoritative where decisions differ.

---

Now I have a thorough read of the architecture. Let me produce the spec.

---

# Technical Spec: Phase 1 Scenario Architecture

## 1. Scenario Assembly Pipeline

### 1.1 Stage Order

The existing pipeline in `build-preset.mjs` reads, compiles, and writes sequentially. The new pipeline adds stages **between** parsing and writing. Order:

```
STAGE 0 — Parse spec
  Input:   .spec.mjs
  Output:  Resolved ScenarioSpec (the default export)
  Action:  Dynamic import of the ESM file; shallow validation that `id` + `meta` exist

STAGE 1 — Build polity map (unchanged)
  Input:   ScenarioSpec.polities, .countryAssignments, .regionAssignments
  Output:  polityOverrides (owner → { name, color, aliases, note }), regionOverrides (GID_1 → owner)
  Action:  Existing logic from build-preset.mjs:60–180

STAGE 2 — Build geometry + cities (unchanged)
  Input:   regionOverrides, ScenarioSpec.cities, region catalog from PMTiles
  Output:  regions.geojson, cities.geojson, colors.json
  Action:  Existing compileCities, writeRegions logic

STAGE 3 — Seed economy.json [NEW]
  Input:   ScenarioSpec.economy, polityOverrides, regionOverrides, region catalog
  Output:  economy.json
  Action:  If spec.economy present, use it directly. If absent, generate from MacroRegions (see §3).
           Each entry: { development: { agriculture, industry, manpower }, gdp: number, macroRegionId: string }
           EU4-style: agricultural/industrial/manpower per region on 1–30 scale.

STAGE 4 — Seed culture.json [NEW]
  Input:   ScenarioSpec.culture, polityOverrides, regionOverrides
  Output:  culture.json
  Action:  If spec.culture present, use it directly. If absent, generate defaults
           (owner's polity name maps to a single default culture group).

STAGE 5 — Seed religion.json [NEW]
  Input:   ScenarioSpec.religion, polityOverrides
  Output:  religion.json
  Action:  Maps macroRegion → primary/secondary religions with adherence percentages.

STAGE 6 — Seed resources.json [NEW]
  Input:   ScenarioSpec.resources, region catalog
  Output:  resources.json
  Action:  Per-macroRegion resource listing: { type, abundance, exploited }.
           If absent, generate sparse defaults.

STAGE 7 — Seed mobilization.json [NEW]
  Input:   ScenarioSpec.mobilization, polityOverrides
  Output:  mobilization.json
  Action:  Per-polity: { manpowerPool, conscriptionRate, standingForces, reserves }.
           Seeded from spec or left empty.

STAGE 8 — Seed influence.json [NEW]
  Input:   ScenarioSpec.influence, polityOverrides
  Output:  influence.json
  Action:  Directed graph: polity → { targetPolity, score, domains }.
           Diplomatic/economic/cultural influence scores 0–100.

STAGE 9 — Assemble world.json (extended)
  Input:   All prior outputs
  Output:  world.json with new fields: simulationRules (structured), economy, culture,
           religion, resources, mobilization, influence headers + macroRegionDefs
  Action:  Write the existing world.json keys PLUS inline the structured simulationRules
           object and `macroRegionDefs` array (the mapping of GID_1 → MacroRegion IDs).

STAGE 10 — Validate [NEW]
  Input:   All outputs
  Output:  Validation report (pass/fail + errors)
  Action:  Run three-layer validation (see §5). Fatal errors abort; warnings log.

STAGE 11 — Write to disk + manifest (unchanged)
  Action:  Existing logic, plus the 6 new JSON files.
```

### 1.2 Stage Dependency Rules

- Stages **reference** earlier stages' outputs but never contradict them. Example: if Stage 3 auto-generates economy and Stage 5's religion references a macroRegion that doesn't exist, Stage 10 catches it.
- Each stage writes its own file. No stage rewrites another stage's file.
- The write order to disk is: `economy.json`, `culture.json`, `religion.json`, `resources.json`, `mobilization.json`, `influence.json`, then the existing set.

### 1.3 Integration Points

| Point | Location | What changes |
|---|---|---|
| `build-preset.mjs` | After region geometry step (line ~250) | Insert Stages 3–10 as function calls: `seedEconomy()`, `seedCulture()`, etc. |
| `exportPreset.js` `buildGameSeed()` | `src/Editor/exportPreset.js` | Add new structured fields to the returned seed object |
| `JSON_URLS` | `src/runtime/assets.js:64` | Add 6 new keys: `economy`, `culture`, `religion`, `resources`, `mobilization`, `influence` |
| Server route `/api/runtime/json/:assetKey` | `server/server.js:520` | No change needed — the route already dispatches by `assetKey` dynamically |
| `server/libraryStore.js` `SCENARIO_ASSET_FILES` | ~line 237 | Add 6 new entries to the asset map |
| `WORLD_DEFAULTS` | `src/runtime/gameState.js:11` | Add new fields (see §2) |

---

## 2. Spec File Format Redesign

### 2.1 `ScenarioSpec` TypeScript Interface

New file: `src/runtime/specTypes.ts`

```ts
// ── Core identities ──────────────────────────────────────────────────────
export interface ScenarioSpec {
  id: string;
  meta: ScenarioMeta;
  game: ScenarioGame;

  // ── Existing (unchanged) ───────────────────────────────────────────────
  allowedUnitTypes?: string[];              // default: all UNIT_TYPES
  relabelOwnedCountries?: boolean;
  polities?: Record<string, PolityDef>;
  countryAssignments?: Record<string, string[]>;
  regionAssignments?: Record<string, string>;
  cities?: CityDef[];
  simulationRules?: string | StructuredSimulationRules;  // NEW union type
  startingTimelineText?: string;

  // ── NEW top-level fields (all optional) ────────────────────────────────
  economy?: EconomySpec;
  culture?: CultureSpec;
  religion?: ReligionSpec;
  resources?: ResourcesSpec;
  mobilization?: MobilizationSpec;
  influence?: InfluenceSpec;
  macroRegions?: MacroRegionDef[];          // hand-authored macro-regions
  regionHistory?: RegionHistoryEntry[];     // date-keyed per-region entries
}

// ── Existing types ───────────────────────────────────────────────────────
export interface ScenarioMeta {
  name: string;
  heroTitle?: string;
  heroSubtitle?: string;
  eyebrow?: string;
  subtitle?: string;
  accentColor?: string;
  coverImage?: string;
  description?: string;
  author?: string;
}

export interface ScenarioGame {
  country: string;
  startDate: string;
  gameDate?: string;
}

export interface PolityDef {
  name: string;
  color: string;
  aliases?: string[];
  note?: string;
}

export type CityDef = [string, string | [number, number], number, number];

// ── NEW: Structured simulation rules ──────────────────────────────────────
export interface StructuredSimulationRules {
  era: string;
  constraints: SimulationConstraints;
  factions: SimulationFaction[];
  technologyLevel: TechnologyLevel;
  diplomacyDefaults: DiplomacyDefaults;
}

export interface SimulationConstraints {
  noAirPower?: boolean;
  noGunpowder?: boolean;
  noNaval?: boolean;
  maxUnitTier?: number;
  narrativeRules: string[];          // prose directives (the old string, split)
}

export interface SimulationFaction {
  code: string;
  name: string;
  disposition: "aggressive" | "defensive" | "expansionist" | "isolationist" | "opportunistic";
  goals: string[];
}

export interface TechnologyLevel {
  era: "ancient" | "classical" | "medieval" | "renaissance" | "industrial" | "modern" | "future";
  notable: string[];
}

export interface DiplomacyDefaults {
  allianceBlockRadius: number;
  treatyDurationMonths: number;
}

// ── NEW: Economy ─────────────────────────────────────────────────────────
export interface EconomySpec {
  macroRegions: EconomyRegionEntry[];
}

export interface EconomyRegionEntry {
  macroRegionId: string;
  development: {
    agriculture: number;   // 1–30, EU4-style
    industry: number;      // 1–30
    manpower: number;      // 1–30
  };
  gdp?: number;
}

// ── NEW: Culture ─────────────────────────────────────────────────────────
export interface CultureSpec {
  groups: CultureGroup[];
}

export interface CultureGroup {
  id: string;
  name: string;
  macroRegions: string[];
  parentGroup?: string;
}

// ── NEW: Religion ────────────────────────────────────────────────────────
export interface ReligionSpec {
  faiths: FaithEntry[];
}

export interface FaithEntry {
  id: string;
  name: string;
  macroRegionAdherence: Record<string, number>;  // "nileDelta": 85 = 85% adherence
}

// ── NEW: Resources ───────────────────────────────────────────────────────
export interface ResourcesSpec {
  deposits: ResourceEntry[];
}

export interface ResourceEntry {
  type: string;             // "iron", "gold", "oil", "grain", "horses", "timber", "silk"
  abundance: "scarce" | "moderate" | "abundant" | "dominant";
  exploited: boolean;
  macroRegionId: string;
}

// ── NEW: Mobilization ────────────────────────────────────────────────────
export interface MobilizationSpec {
  polities: MobilizationEntry[];
}

export interface MobilizationEntry {
  polityCode: string;
  manpowerPool: number;
  conscriptionRate: number;    // 0.0–1.0
  standingForces: number;
  reserves: number;
}

// ── NEW: Influence ───────────────────────────────────────────────────────
export interface InfluenceSpec {
  edges: InfluenceEdge[];
}

export interface InfluenceEdge {
  fromPolity: string;
  toPolity: string;
  score: number;               // 0–100
  domains: ("diplomatic" | "economic" | "cultural" | "military")[];
}

// ── NEW: MacroRegion definition ──────────────────────────────────────────
export interface MacroRegionDef {
  id: string;                  // stable id, e.g. "lowerEgypt", "italianPeninsula"
  name: string;                // human-readable, e.g. "Lower Egypt"
  gid1s: string[];            // "EGY.1_1", "EGY.2_1" — GADM admin-1 codes
  category?: "heartland" | "frontier" | "colony" | "tribal";
  notes?: string;
}

// ── NEW: Region history ──────────────────────────────────────────────────
export interface RegionHistoryEntry {
  gid1: string;
  entries: DatedRegionEntry[];
}

export interface DatedRegionEntry {
  date: string;               // "0117-01-01"
  owner: string;
  development?: { agriculture: number; industry: number; manpower: number };
  religion?: string;
  culture?: string;
  notes?: string;
}
```

### 2.2 Required vs. Optional

| Field | Required | Default |
|---|---|---|
| `id` | **Yes** | — |
| `meta.name` | **Yes** | — |
| `game.country` |  **Yes** | — |
| `game.startDate` | **Yes** | — |
| `polities` | No | `{}` |
| `countryAssignments` | No | `{}` |
| `simulationRules` (prose) | No | `""` |
| `simulationRules` (structured) | No | Generated from prose string at build time |
| `economy` | No | Auto-generated from MacroRegions |
| `culture` | No | One default group per polity |
| `religion` | No | Empty |
| `resources` | No | Sparse defaults (no deposits) |
| `mobilization` | No | Empty (AI fills in game) |
| `influence` | No | Empty (AI fills in game) |
| `macroRegions` | No | Auto-generated (see §3) |
| `regionHistory` | No | Empty |

### 2.3 `simulationRules` Transformation

At build time (Stage 0), `build-preset.mjs` detects whether `spec.simulationRules` is a string or object:

```js
// In build-preset.mjs, after the spec is loaded:
const resolveSimulationRules = (raw) => {
  if (typeof raw === "object" && raw !== null && raw.constraints) {
    return raw; // already structured
  }
  // Legacy prose string: wrap in structured envelope
  return {
    era: spec.meta.name || spec.id,
    constraints: {
      narrativeRules: raw ? [String(raw)] : [],

// ...trucated for brevity — we infer booleans from keyword scan
      noAirPower: /no air/i.test(String(raw)),
      noGunpowder: /no gunpowder/i.test(String(raw)),
    },
    factions: [],
    technologyLevel: { era: "modern", notable: [] },
    diplomacyDefaults: { allianceBlockRadius: 0, treatyDurationMonths: 12 },
  };
};
```

The structured object is persisted as `world.simulationRules` (replacing the current prose string in `WORLD_DEFAULTS:68`). The AI reads it from there. The old prose is preserved as `constraints.narrativeRules[0]`.

### 2.4 File Location

- `src/runtime/specTypes.ts` — new file, the canonical TS interface
- A JS module `src/runtime/specTypes.js` is NOT needed at runtime; `build-preset.mjs` (Node) imports the TS via `tsx` or we define a plain `.mjs` mirror at `scripts/presets/lib/specTypes.mjs` with JSDoc type annotations.

**Decision**: Create `scripts/presets/lib/specTypes.mjs` (plain JS with JSDoc, consumed by `build-preset.mjs`) and a separate `src/runtime/specTypes.ts` for the editor's TS consumption. They must be kept in sync.

---

## 3. Two-Tier Region Model

### 3.1 Types

In `specTypes.mjs` / `specTypes.ts`:

```ts
interface MacroRegion {
  id: string;          // stable, e.g. "lowerEgypt"
  name: string;        // "Lower Egypt"
  gid1s: string[];     // ["EGY.1_1", "EGY.2_1"] — references to GADM admin-1 IDs
  category: "heartland" | "frontier" | "colony" | "tribal";
  dominantPolity?: string;
}
```

### 3.2 Where MacroRegions Live

**At rest**: `world.json` gains a `macroRegionDefs: MacroRegion[]` field. Each runtime JSON (economy.json, culture.json, religion.json, resources.json) keys its data by `macroRegionId`.

**In memory**: The existing `WORLD_DEFAULTS` in `gameState.js` gains `macroRegionDefs: []`. The field is normalized by `normalizeWorldState`.

**In the spec**: `spec.macroRegions` is the optional hand-authored list. When absent, auto-generation runs.

### 3.3 Auto-Generation Algorithm

When `spec.macroRegions` is absent, Stage 2.5 (inserted after geometry) runs:

```
INPUT: regionOverrides (GID_1 → owner), region catalog, polityOverrides

ALGORITHM (group_by_owner_then_convex_hull):
1. Group all GID_1 by their effective owner (from regionOverrides).
2. For each owner, compute connected components of adjacent GID_1 regions.
   Adjacent = share a border in the catalog's geometry.
3. For each connected component:
   a. If component has ≤ 5 GID_1s → merge into single macroRegion.
   b. If component has > 5 GID_1s → split by cardinal zones (N/S/E/W/Center)
      within the hull, targeting 4–8 GID_1s per macroRegion.
4. Assign category based on:
   - "heartland": contains the owner's capital city (spec.cities, tier=4)
   - "frontier": bordered by a different owner or unclaimed
   - "tribal": no owner (unclaimed regions)
   - "colony": capital in a different continent
5. Generate stable IDs: slugify("ownerName-directionalDescriptor").
   Example: "romanEmpire-italianPeninsula", "romanEmpire-northGallia"
6. Name: human-readable from GADM country + cardinal.
   Example: "Northern Gaul", "Italian Peninsula"

OUTPUT: MacroRegion[] written to world.macroRegionDefs
```

Target: 100–500 macroRegions per scenario. For roman-117 with ~90 owned GADM countries, that yields roughly 150–250 macroRegions (each GADM country has 2–5 admin-1 regions, each macroRegion groups 3–8 GID_1s).

### 3.4 Merge/Split Rules

When an event transfers a region (via `regionOwnershipOverrides`):

1. The GID_1's macroRegion **does not change** — it's a stable spatial grouping.
2. The economy/development data for that GID_1 **moves with it**: the recipient polity now controls those development points.
3. A **check runs** on next poll: if a macroRegion has >60% GID_1s owned by a new polity, the macroRegion's `dominantPolity` updates. If split exactly 50/50, it stays contested.
4. Full macroRegion re-computation is **out of scope for Phase 1** — only dominantPolity updates.

### 3.5 Which Mechanics Use Which Tier

| Mechanic | Uses GID_1 | Uses MacroRegion |
|---|---|---|
| Map rendering (fill, borders) | ✅ | — |
| Region ownership | ✅ | — |
| Unit deployment / movement | ✅ | — |
| City labels | ✅ | — |
| Economy / development | — | ✅ |
| Culture group distribution | — | ✅ |
| Religion adherence | — | ✅ |
| Resource deposits | — | ✅ |
| Mobilization pools | — | ✅ |
| AI diplomacy context | ✅ (region names) | ✅ (macro stats) |

---

## 4. Modular JSON Storage

### 4.1 New Runtime Assets

Six new files per scenario under `server/data/scenarios/<id>/`:

| File | Content | Seeded by |
|---|---|---|
| `economy.json` | `Record<macroRegionId, EconomyData>` | Stage 3 |
| `culture.json` | `{ groups: CultureGroup[], macroRegionMapping: Record<macroRegionId, string> }` | Stage 4 |
| `religion.json` | `{ faiths: FaithEntry[] }` | Stage 5 |
| `resources.json` | `ResourceEntry[]` | Stage 6 |
| `mobilization.json` | `Record<polityCode, MobilizationData>` | Stage 7 |
| `influence.json` | `InfluenceEdge[]` | Stage 8 |

### 4.2 `JSON_URLS` Extension

In `src/runtime/assets.js:64`:

```js
export const JSON_URLS = {
  // ... existing keys ...
  economy: "",
  culture: "",
  religion: "",
  resources: "",
  mobilization: "",
  influence: "",
};
```

In `setRuntimeAssetToken()` (~line 260), add:

```js
JSON_URLS.economy = withRuntimeToken("/api/runtime/json/economy");
JSON_URLS.culture = withRuntimeToken("/api/runtime/json/culture");
JSON_URLS.religion = withRuntimeToken("/api/runtime/json/religion");
JSON_URLS.resources = withRuntimeToken("/api/runtime/json/resources");
JSON_URLS.mobilization = withRuntimeToken("/api/runtime/json/mobilization");
JSON_URLS.influence = withRuntimeToken("/api/runtime/json/influence");
```

### 4.3 Server Asset Routing

In `server/libraryStore.js` `SCENARIO_ASSET_FILES` (~line 237):

```js
const SCENARIO_ASSET_FILES = {
  // ... existing ...
  economy: "economy.json",
  culture: "culture.json",
  religion: "religion.json",
  resources: "resources.json",
  mobilization: "mobilization.json",
  influence: "influence.json",
};
```

The `/api/runtime/json/:assetKey` route in `server/server.js:520` already dispatches dynamically — no change needed.

### 4.4 Polling & Diff Updates

The existing polling infrastructure in `assets.js` polls `world.json` every 5 seconds. The new files follow the same pattern:

- **Independent polling**: Each file has its own `readJson()` call with its own polling interval.
- **Initial load**: All 6 files are fetched once on game start alongside the existing set.
- **Diff semantics**: The `Content-Length` HEAD check (`jsonHeadersFor` at ~line 48) already works for any JSON URL — the client stores a `Content-Length` header, the server responds with the actual byte length, and a mismatch triggers refetch. No new diff infrastructure needed.
- **Polling intervals**:
  - `economy.json`, `resources.json`, `mobilization.json`: 30s (changes slowly)
  - `culture.json`, `religion.json`: 60s (rarely changes)
  - `influence.json`: 15s (changes with diplomacy)
- **isNoStoreJsonUrl**: The geo files (regionsGeojson, citiesGeojson) skip cache. The new JSONs are NOT geo — they use normal cache behavior (cache in Cache API, poll via HEAD).

### 4.5 Integration with Existing `readJson`

No structural changes. Existing functions read any URL in `JSON_URLS`. The new files are just more keys. The read path in `readJson` (~line 540) checks `Content-Length`, handles concurrent requests, and caches normally — all of which apply without modification.

---

## 5. Validation Architecture

### 5.1 Layer 1: JSON Schema Validation

**Where**: New file `scripts/presets/lib/specSchema.mjs`

Define JSON Schema for `ScenarioSpec`. Applied at `build-preset.mjs` time, after import, before any stage runs.

```js
import Ajv from "ajv";
import specSchema from "./specSchema.json" with { type: "json" };

const ajv = new Ajv({ allErrors: true });
const validateSpec = ajv.compile(specSchema);

// In build-preset.mjs, after loading the spec:
if (!validateSpec(spec)) {
  const errors = validateSpec.errors.map(e => `${e.instancePath} ${e.message}`).join("\n  ");
  die(`spec validation failed:\n  ${errors}`);
}
```

Schema enforces:
- `id`: non-empty string, matches `^[a-z0-9]+(-[a-z0-9]+)*$`
- `meta.name`, `game.country`, `game.startDate`: required
- `economy.macroRegions[*].development.{agriculture,industry,manpower}`: integers 1–30
- `religion.faiths[*].macroRegionAdherence`: values 0–100, sum ≤ 100 per macroRegion
- `macroRegions[*].gid1s`: non-empty string array
- `influence.edges[*].score`: 0–100

**Dependency**: Add `ajv` to devDependencies (tree-shaken from runtime).

### 5.2 Layer 2: World-Aware Validation

**Where**: New function `validateWorldAware(spec)` in `build-preset.mjs` (or `scripts/presets/lib/validatePreset.mjs`)

Runs after Stage 1–2 (once region catalog + polity map are built). Checks:

```js
const validateWorldAware = (spec, catalog, polityOverrides, regionOverrides) => {
  const errors = [];

  // 1. All polities referenced in regionAssignments exist
  for (const [gid1, owner] of Object.entries(spec.regionAssignments ?? {})) {
    if (!polityOverrides[owner] && !spec.polities?.[owner]) {
      errors.push(`regionAssignments.${gid1}: owner "${owner}" not defined in polities`);
    }
  }

  // 2. All GID_1 in regionAssignments exist in catalog
  const catalogIds = new Set(catalog.map(r => r.GID_1));
  for (const gid1 of Object.keys(spec.regionAssignments ?? {})) {
    if (!catalogIds.has(gid1)) {
      errors.push(`regionAssignments.${gid1}: not found in region catalog`);
    }
  }

  // 3. All country codes in countryAssignments exist in catalog
  const catalogGid0s = new Set(catalog.map(r => r.GID_0));
  for (const code of Object.keys(spec.countryAssignments ?? {})) {
    if (!catalogGid0s.has(code)) {
      errors.push(`countryAssignments.${code}: not found in catalog GID_0 codes`);
    }
  }

  // 4. All macroRegion gid1s reference real catalog entries
  for (const mr of spec.macroRegions ?? []) {
    for (const gid1 of mr.gid1s) {
      if (!catalogIds.has(gid1)) {
        errors.push(`macroRegions.${mr.id}.gid1s: "${gid1}" not in catalog`);
      }
    }
  }

  // 5. MacroRegion gid1s don't overlap
  const seen = new Map();
  for (const mr of spec.macroRegions ?? []) {
    for (const gid1 of mr.gid1s) {
      if (seen.has(gid1)) {
        errors.push(`macroRegions: GID_1 "${gid1}" assigned to both "${seen.get(gid1)}" and "${mr.id}"`);
      }
      seen.set(gid1, mr.id);
    }
  }

  // 6. Economy/culture/religion/resources macroRegionIds exist
  const mrIds = new Set((spec.macroRegions ?? []).map(mr => mr.id));
  for (const entry of spec.economy?.macroRegions ?? []) {
    if (!mrIds.has(entry.macroRegionId)) {
      errors.push(`economy.macroRegions: "${entry.macroRegionId}" not in macroRegions`);
    }
  }
  // ... similar for culture, religion, resources

  return errors;
};
```

### 5.3 Layer 3: Assembly Consistency Validation

**Where**: New function `validateAssemblyConsistency(spec, outputs)` in `build-preset.mjs`

Runs after all stages (just before write). Checks the fully assembled outputs:

```js
const validateAssemblyConsistency = (spec, economy, culture, religion, resources, mobilization, influence, macroRegions, world) => {
  const errors = [];

  // 1. No landless polities
  const ownersWithRegions = new Set(Object.values(world.regionOwnershipOverrides));
  for (const code of Object.keys(spec.polities ?? {})) {
    if (!ownersWithRegions.has(code)) {
      errors.push(`polity "${code}" has no assigned regions (landless polities are not allowed)`);
    }
    // Exception: a polity with `mobilization` but no regions is landless → error
    // Exception: a polity with `influence` edges but no regions → warn, not error
  }

  // 2. GDP sum check
  const totalGdp = Object.values(economy).reduce((sum, e) => sum + (e.gdp || 0), 0);
  if (totalGdp > 0 && (totalGdp < 1e6 || totalGdp > 1e14)) {
    errors.push(`economy: total GDP ${totalGdp} seems implausible for era`);
  }

  // 3. Development values in range
  for (const [id, data] of Object.entries(economy)) {
    for (const field of ["agriculture", "industry", "manpower"]) {
      if (data.development?.[field] < 1 || data.development?.[field] > 30) {
        errors.push(`economy.${id}.development.${field}=${data.development[field]} out of [1,30]`);
      }
    }
  }

  // 4. Religion adherence per macroRegion sums ≤ 100
  for (const faith of religion?.faiths ?? []) {
    const mrTotals = {};
    for (const [mrId, pct] of Object.entries(faith.macroRegionAdherence ?? {})) {
      mrTotals[mrId] = (mrTotals[mrId] || 0) + pct;
    }
    for (const [mrId, total] of Object.entries(mrTotals)) {
      if (total > 100) {
        errors.push(`religion.${faith.id}: macroRegion "${mrId}" adherence sums to ${total} (>100)`);
      }
    }
  }

  // 5. Influence edges reference real polities
  const allPolities = new Set(Object.keys(spec.polities ?? {}));
  for (const edge of influence ?? []) {
    if (!allPolities.has(edge.fromPolity)) {
      errors.push(`influence: fromPolity "${edge.fromPolity}" not defined`);
    }
    if (!allPolities.has(edge.toPolity)) {
      errors.push(`influence: toPolity "${edge.toPolity}" not defined`);
    }
  }

  // 6. Every GID_1 is covered by exactly one macroRegion
  const mrCoverage = new Map();
  for (const mr of macroRegions ?? []) {
    for (const gid1 of mr.gid1s) {
      mrCoverage.set(gid1, (mrCoverage.get(gid1) || 0) + 1);
    }
  }
  const doubled = [...mrCoverage.entries()].filter(([, n]) => n > 1);
  if (doubled.length) {
    errors.push(`macroRegions: ${doubled.length} GID_1(s) belong to multiple macroRegions`);
  }

  return errors;
};
```

### 5.4 Integration with Existing Validation

- `validateGameplayPayload` (`gameplaySchemas.js:1100`): No change needed — it validates AI output, not scenario data.
- `validateGeneratedWorldChanges` (`gameplay.js:1236`): No change needed — it validates AI-generated world diffs.
- The new validations run only at **build time** in `build-preset.mjs`. They do NOT run in the browser `assets.js` path — the browser trusts the server's output.

---

## 6. Migration Strategy

### 6.1 New Script: `scripts/presets/migrate-presets.mjs`

Purpose: Convert 6 existing `.spec.mjs` files to the new format with structured fields.

**Process per preset**:

```
1. Load existing spec via dynamic import.
2. Parse old simulationRules string → StructuredSimulationRules (using the keyword scan from §2.3).
3. Run auto-generation for macroRegions (same algorithm as build-preset Stage 2.5).
4. Run auto-generation for economy, culture, religion, resources.
   (mobilization and influence remain empty — AI fills at runtime).
5. Write new spec file alongside the old one with suffix:
   scripts/presets/roman-117.spec.v2.mjs
   The old file stays untouched.
6. Output a diff summary to stdout: what was added, suggested manual cleanup.
```

### 6.2 Migration Diff Strategy

Each migrated spec produces:

- **Idempotent**: Running twice produces the same output (deterministic auto-generation).
- **Human-reviewable**: The new file is a separate `.v2.mjs` file. The author diffs old vs. new with `diff scripts/presets/roman-117.spec.mjs scripts/presets/roman-117.spec.v2.mjs`.
- **Manual cleanup markers**: Comments in the output flag what needs human attention:

```js
// ⚠️ HUMAN REVIEW: simulationRules keywords detected:
//    noAirPower=true, noGunpowder=true
//    Verify these are correct for the era.
export default {
  // ...
  simulationRules: {
    era: "classical",
    constraints: { noAirPower: true, noGunpowder: true, narrativeRules: ["..."] },
    // ⚠️ HUMAN REVIEW: factions auto-generated from polities. Add goals.
    factions: [
      { code: "ROM", name: "Roman Empire", disposition: "defensive", goals: [] },
    ],
    // ⚠️ HUMAN REVIEW: technologyLevel auto-detected. Adjust if wrong.
    technologyLevel: { era: "classical", notable: [] },
    diplomacyDefaults: { allianceBlockRadius: 0, treatyDurationMonths: 12 },
  },
  // ⚠️ HUMAN REVIEW: macroRegions auto-generated (186 groups). Verify borders.
  macroRegions: [ /* ... */ ],
  // ⚠️ HUMAN REVIEW: economy auto-generated. Adjust development values.
  economy: { macroRegions: [ /* ... */ ] },
};
```

### 6.3 What Migration Produces vs. Manual Cleanup

| Produced automatically | Needs manual author review |
|---|---|
| `simulationRules` (structured envelope) | `factions[].goals` (AI-prompting directives) |
| `macroRegions[]` (grouping by owner adjacency) | `macroRegions[].name` (verify human-readable) |
| `economy.macroRegions[]` (default development 10/10/10) | Development values per era accuracy |
| `culture.groups[]` (one per polity, named after polity) | Actual culture group names + parent hierarchies |
| `religion.faiths[]` (empty) | Era-appropriate faiths + adherence % |
| `resources.deposits[]` (empty) | Resource locations by era |
| `mobilization` (empty) | Starting force sizes |
| `influence` (empty) | Diplomatic edges |

---

## 7. Editor Integration (Minimal)

### 7.1 Changes to `doc.metadata`

In `createDocument()` (`useMapDocument.js:64`), the `metadata` object gains:

```js
metadata: {
  // ... existing fields ...
  simulationRules: "",        // prose string (editor's existing text field)
  macroRegions: [],           // MacroRegionDef[] — hand-authored list
  economy: null,              // EconomySpec | null
  culture: null,              // CultureSpec | null
  religion: null,             // ReligionSpec | null
  resources: null,            // ResourcesSpec | null
  mobilization: null,         // MobilizationSpec | null
  influence: null,            // InfluenceSpec | null
  regionHistory: [],          // RegionHistoryEntry[]
}
```

These fields are **persisted in the map document** (`server/data/mapeditor-documents/<id>.json`) and survive save/load. They are **editable by the map author** via new panels (out of scope for this spec, but the storage must be ready).

### 7.2 Changes to `exportPreset.js` `buildGameSeed()`

In `buildGameSeed()` (`exportPreset.js`), the returned seed object gains:

```js
return {
  // ... existing fields ...
  simulationRules: doc.metadata?.simulationRules || "",
  macroRegions: doc.metadata?.macroRegions || [],
  economy: doc.metadata?.economy || null,
  culture: doc.metadata?.culture || null,
  religion: doc.metadata?.religion || null,
  resources: doc.metadata?.resources || null,
  mobilization: doc.metadata?.mobilization || null,
  influence: doc.metadata?.influence || null,
  regionHistory: doc.metadata?.regionHistory || [],
};
```

The `world` object in the seed also gains `macroRegionDefs` so it propagates to `world.json`:

```js
const world = {
  // ... existing ...
  macroRegionDefs: doc.metadata?.macroRegions || [],
  simulationRules: resolveSimulationRules(doc.metadata?.simulationRules),
};
```

### 7.3 Dual-Format Export

`buildGameSeed()` already emits an object consumed by `createScenario` (server-side) that writes world.json, colors.json, flags.json, tags.json. The 6 new files follow the same pattern: add them to the seed, and extend `createScenario` to write them:

In `server/libraryStore.js` `createScenarioFromSeed()` (or equivalent), add:

```js
for (const key of ["economy", "culture", "religion", "resources", "mobilization", "influence"]) {
  if (seed[key]) {
    writeJsonFile(getScenarioJsonPath(scenarioId, key), seed[key]);
  }
}
```

The old `.spec.mjs` format is **not emitted** by the editor — the editor exports a game seed, not a spec. To produce a `.spec.mjs` from an editor document requires a separate "Export as Spec" button (Phase 2).

---

## 8. Performance & Scale

### 8.1 Data Volume Analysis

Target: 200–300 macroRegions. Each JSON file:

| File | Entries | Approx. size | Example |
|---|---|---|---|
| `economy.json` | 300 × 3 numbers + 1 string | ~15 KB | `{"nileDelta": {"development":{"agriculture":22,"industry":8,"manpower":15},"gdp":1200000}}` |
| `culture.json` | 15 groups + 300 mappings | ~8 KB | `{"groups":[...], "macroRegionMapping":{"nileDelta":"egyptian"}}` |
| `religion.json` | 10 faiths × avg 30 regions | ~18 KB | `{"faiths":[{"id":"romanPagan","macroRegionAdherence":{...}}]}` |
| `resources.json` | ~50 deposits | ~3 KB | `[{"type":"iron","abundance":"moderate","macroRegionId":"norica"}]` |
| `mobilization.json` | 30 polities × 4 numbers | ~3 KB | `{"ROM":{"manpowerPool":450000,"conscriptionRate":0.02,...}}` |
| `influence.json` | ~90 edges × 5 fields | ~8 KB | `[{"fromPolity":"ROM","toPolity":"PART","score":15,"domains":["military"]}]` |

**Total new payload: ~55 KB** (uncompressed). With gzip, ~12 KB. This is less than the existing `world.json` (which carries campaignMemory, consolidatedHistory, countryStats, markers, units).

### 8.2 Polling Impact

Current polling: `world.json` every 5s, `colors.json`/`tags.json`/`flags.json` on demand.

New polling:
- `economy.json`: every 30s → 2 req/min
- `resources.json`: every 30s → 2 req/min
- `mobilization.json`: every 30s → 2 req/min
- `culture.json`: every 60s → 1 req/min
- `religion.json`: every 60s → 1 req/min
- `influence.json`: every 15s → 4 req/min

Total: **12 additional req/min**. All are HEAD-based diff checks — the full body is transferred only on actual change. Existing polling already handles `world.json` at 12 req/min (5s interval). Adding 12 more is a ~100% increase in polling overhead but well within the existing architecture (the browser's `setInterval` + `readJson` pattern was designed for this).

**Optimization**: If needed, batch-poll all 6 files with a single `/api/runtime/json/simulation-state` endpoint that returns a combined diff. Defer to Phase 2.

### 8.3 MapLibre Rendering: MacroRegion Overlay Layer

MacroRegions need a **border-only overlay** on the map (no fill — the existing region fill is sufficient). Implementation:

- **Source**: A new GeoJSON source computed client-side from `world.macroRegionDefs` + the existing `regions.geojson` geometry. The client dissolves GID_1 shapes into macroRegion boundaries using a simplified union (turf.js `union` or a MapLibre data-driven line layer).
- **Layer**: A line layer at `z-index: 3` (above region fills at z=2, below labels/cities at z=4), with:
  - Line width: 2px at zoom ≥ 5, 0 otherwise (no clutter at world view)
  - Line color: `rgba(255,255,255,0.5)` (white glow) or `rgba(0,0,0,0.3)` (subtle dark)
  - Dashed: `[4, 4]` to distinguish from region borders (solid)
- **Performance**: 300 macroRegion boundaries = ~300 polygon features with simplified geometry (Douglas-Peucker to 50 vertices). Renders in a single draw call. No performance concern — the existing Nations layer renders 3,600+ regions already.

The dissolve computation happens **once** on scenario load in a Web Worker, cached by `macroRegionDefs` identity. File: `src/Game/Map/MacroRegionBorders.jsx` (new).

---

## Summary of New/Modified Files

| File | Action | Lines (est.) |
|---|---|---|
| `scripts/presets/lib/specTypes.mjs` | **New** | ~200 |
| `src/runtime/specTypes.ts` | **New** | ~180 |
| `scripts/presets/lib/specSchema.json` | **New** | ~150 |
| `scripts/presets/lib/seedEconomy.mjs` | **New** | ~80 |
| `scripts/presets/lib/seedCulture.mjs` | **New** | ~60 |
| `scripts/presets/lib/seedReligion.mjs` | **New** | ~50 |
| `scripts/presets/lib/seedResources.mjs` | **New** | ~60 |
| `scripts/presets/lib/autoMacroRegions.mjs` | **New** | ~120 |
| `scripts/presets/lib/validatePreset.mjs` | **New** | ~180 |
| `scripts/presets/migrate-presets.mjs` | **New** | ~200 |
| `scripts/presets/build-preset.mjs` | **Modified** | +100 |
| `src/runtime/assets.js` | **Modified** | +30 |
| `src/runtime/gameState.js` | **Modified** | +40 |
| `src/Editor/exportPreset.js` | **Modified** | +30 |
| `src/Editor/useMapDocument.js` | **Modified** | +10 |
| `server/libraryStore.js` | **Modified** | +20 |
| `src/Game/Map/MacroRegionBorders.jsx` | **New** | ~60 |
| **Total estimated new code** | | ~1,170 lines |
| **Total estimated modifications** | | ~230 lines |

The existing 49K-line codebase is minimally touched — the new code is additive, behind optional fields, and gated on spec presence. Backward compatibility is guaranteed: existing `.spec.mjs` files without new fields produce the same output as today.

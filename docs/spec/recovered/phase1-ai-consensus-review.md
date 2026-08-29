# Recovered Phase 1 AI Engineer Consensus Review

> Recovered verbatim from local Codex session `01a04af1-b51c-7df3-a129-deab2d99567d`
> (AI Engineer / Heisenberg, DeepSeek V4 Pro, 2026-08-29T06:42:19.870Z).
> This file preserves the original agent artifact;
> `../consensus-spec.md` is authoritative where decisions differ.

---

## Consensus Review: AI Engineer vs. Developer Specs

I've done a line-by-line comparison. Here are all conflicts, resolutions, and a unified proposal.

---

### Conflict Map

| # | Topic | Developer (Mill) | AI Engineer (Me) | Severity |
|---|-------|-----------------|-------------------|----------|
| 1 | `simulationRules` shape | `{ era, constraints, factions[], technologyLevel, diplomacyDefaults }` | `{ techEra, aiHistoryMode, eraNarrative, allowedUnitTypes[], forbiddenActions[], allianceBlocks[], activeWars[], diplomaticPostures[] }` | **Critical** |
| 2 | `factions[]` vs `allianceBlocks[]`+`diplomaticPostures[]` | `factions[]` with `{ name, members[], disposition, goals[] }` — non-directional group | `allianceBlocks[]` (formal, named) + `diplomaticPostures[]` (directional, pairwise) | **Critical** |
| 3 | Technology constraints | Boolean flags: `noAirPower`, `noGunpowder`, `noNaval`, `maxUnitTier` | String arrays: `allowedUnitTypes[]`, `forbiddenActions[]` | **High** |
| 4 | Validation | Engine-side Layers 1–3 in build pipeline only | AI `validateScenario` task for semantic checks | **Medium** |
| 5 | Gap-fill ordering | 11-stage pipeline, no explicit AI gap-fill stage | `fillScenarioGaps` as standalone AI task | **High** |
| 6 | AI call-time directives | Not specified | `ECONOMY_MODIFIER_REFERENCE`, prompt templates, `buildSimulationRulesText()` | **Low** |
| 7 | `regionHistory` | Date-keyed per-region entries in spec | Not in my spec; analyst recommended, PO didn't require | **Medium** |
| 8 | Naming | `StructuredSimulationRules` (TS interface) | `simulationRules` (world.json field) | **Low** |

---

### Resolution Proposals

#### Conflict 1+2: Unified `simulationRules` — Three-Layer Architecture

**Problem:** Your `factions[]` is author-friendly but non-directional. My `allianceBlocks[]` and `diplomaticPostures[]` are AI-consumable but verbose for authors.

**Root cause:** We're designing for different consumers. Your interface is for scenario authors writing `.spec.mjs`. Mine is for AI prompts reading `world.json` at runtime. These should be *derived*, not duplicated.

**Resolution: Three representation layers with a build-time transform.**

```
Layer A (Author)          Layer B (Runtime/AI)         Layer C (Prompt)
.spec.mjs                 world.json                   Rendered text
─────────────────────────────────────────────────────────────────────
StructuredSimulationRules → simulationRules (JSON)  → buildSimulationRulesText()
  .era                       .techEra                    "TECH ERA: ww1"
  .constraints               .allowedUnitTypes[]          "ALLOWED UNITS: infantry, armor..."
  .constraints + narrative   .forbiddenActions[]          "FORBIDDEN: nuclear_weapons..."
  .factions[]                .allianceBlocks[]            "ACTIVE ALLIANCES: Triple Entente..."
  .factions[] + new field    .diplomaticPostures[]        "DIPLOMATIC POSTURES: Serbia → Austria-Hungary: hostile"
  .factions[] + new field    .activeWars[]               "ONGOING WARS: ..."
  ──                         .aiHistoryMode               "AI HISTORY MODE: conditional"
  ──                         .eraNarrative                "ERA CONTEXT: The year is 1914..."
```

**Layer A (Author):** Extend Developer's `StructuredSimulationRules`:

```typescript
interface StructuredSimulationRules {
  era: string;                          // "ww1", "napoleonic", "medieval"
  aiHistoryMode?: "conditional" | "free" | "guided";  // ADDED — default "conditional"
  eraNarrative?: string;                // ADDED — human-readable context paragraph
  constraints: {
    noAirPower?: boolean;
    noGunpowder?: boolean;
    noNaval?: boolean;
    maxUnitTier?: number;
    narrativeRules?: string[];          // ADDED — "no nuclear weapons", "no satellites"
  };
  factions: Array<{
    name: string;
    members: string[];                  // country codes: GBR, FRA, RUS
    type: "alliance" | "rivalry" | "coalition" | "bloc";  // ADDED — disambiguates
    allianceType?: "defensive" | "offensive" | "non_aggression" | "entente"; // for type=alliance
    disposition?: "cooperative" | "neutral" | "competitive" | "hostile";
    since?: string;                     // ADDED — ISO date the faction formed
    goals?: string[];
    toward?: string;                    // ADDED — for directional postures (type=rivalry)
  }>;
  activeConflicts?: Array<{             // ADDED — separate from factions for clarity
    name: string;
    belligerents: string[][];           // [["FRA","RUS","GBR"], ["GER","AUT"]]
    since?: string;
    intensity?: "cold" | "limited" | "total";
  }>;
  technologyLevel: {
    era: string;
    notable?: string[];
  };
  diplomacyDefaults: {
    allianceBlockRadius: number;
    treatyDurationMonths: number;
  };
}
```

**Layer B (Runtime):** Build pipeline transforms Layer A → B. The transform logic:

```js
// In build-preset.mjs, Stage 2 (Polity Map):
function buildRuntimeSimulationRules(authorFormat, polityNames) {
  // polityNames: { "GBR": "Britain", "FRA": "France", ... }
  return {
    techEra: authorFormat.era,
    aiHistoryMode: authorFormat.aiHistoryMode || "conditional",
    eraNarrative: authorFormat.eraNarrative || "",
    allowedUnitTypes: deriveAllowedUnits(authorFormat.constraints, authorFormat.technologyLevel),
    forbiddenActions: deriveForbidden(authorFormat.constraints),
    allianceBlocks: authorFormat.factions
      .filter(f => f.type === "alliance")
      .map(f => ({
        name: f.name,
        members: f.members.map(c => polityNames[c] || c),
        since: f.since || "",
        type: f.allianceType || "defensive",
      })),
    activeWars: (authorFormat.activeConflicts || []).map(w => ({
      name: w.name,
      belligerents: w.belligerents.map(side => side.map(c => polityNames[c] || c)),
      since: w.since || "",
      intensity: w.intensity || "limited",
    })),
    diplomaticPostures: authorFormat.factions
      .filter(f => f.type === "rivalry" || f.type === "bloc")
      .flatMap(f => f.members
        .filter(m => m !== (f.toward || ""))
        .map(m => ({
          from: polityNames[m] || m,
          toward: polityNames[f.toward || ""] || f.toward,
          posture: f.disposition || "hostile",
          reason: f.goals?.[0] || "",
        }))),
  };
}
```

**Rationale:** One source of truth (author format), one derived consumer (runtime format), one renderer (prompt text). The build transform is deterministic, testable, and the Developer owns it. The AI Engineer owns the `buildSimulationRulesText()` renderer and the prompt templates that consume the runtime format.

---

#### Conflict 3: Technology Constraints

**Problem:** Your boolean flags are engine-enforcement primitives. My string arrays are AI guidance primitives. They encode the same information differently.

**Resolution:** Your `constraints` is the **source of truth**. My `allowedUnitTypes[]` and `forbiddenActions[]` are **derived** at build time via a lookup table:

```js
const TECH_ERA_UNIT_TABLE = {
  ww1: ["infantry", "armor", "artillery", "naval", "air", "garrison"],
  napoleonic: ["infantry", "artillery", "naval", "garrison"],
  medieval: ["infantry", "garrison"],
  // ...
};

const TECH_ERA_FORBIDDEN_TABLE = {
  ww1: ["nuclear_weapons", "satellite_recon", "cyber_warfare", "jet_aircraft", "helicopters"],
  napoleonic: ["nuclear_weapons", "satellite_recon", "cyber_warfare", "air", "armor", "gunpowder_artillery"],
  // ...
};

function deriveAllowedUnits(constraints, techLevel) {
  let units = TECH_ERA_UNIT_TABLE[techLevel.era] || [];
  if (constraints.noAirPower) units = units.filter(u => u !== "air");
  if (constraints.noNaval) units = units.filter(u => u !== "naval");
  if (constraints.noGunpowder) units = units.filter(u => !["armor", "artillery"].includes(u));
  return units;
}

function deriveForbidden(constraints) {
  const forbidden = new Set(TECH_ERA_FORBIDDEN_TABLE[/* era */]);
  (constraints.narrativeRules || []).forEach(r => forbidden.add(r));
  return [...forbidden];
}
```

Your `constraints.narrativeRules[]` string array (new field I'm proposing to add) becomes the seed for `forbiddenActions`. "Nuclear weapons in WW1 scenario" is a narrative rule, not an engine constraint — the engine doesn't know what a nuke is, but the AI needs to be told not to invent one.

---

#### Conflict 4: Validation — Two Complementary Layers

**Problem:** Your Layers 1–3 are deterministic, engine-side. My `validateScenario` is AI-driven, semantic. Could they collide?

**Resolution: They don't collide — they serve different purposes and run at different times.**

| | Developer's Layers | AI Engineer's `validateScenario` |
|---|---|---|
| **What it checks** | Types, required fields, cross-field invariants, assembly integrity | Historical anachronisms, logical contradictions, narrative consistency |
| **How** | Deterministic code | AI model call |
| **When** | Build pipeline (every publish) | Build pipeline (optional, author-triggered) |
| **Output** | Hard errors (blocks publish) | Warnings + errors (advisory) |
| **Example** | "MacroRegion references GID_1 region that doesn't exist" | "techEra is 'ww1' but no 'air' in allowedUnitTypes — are aircraft intentionally excluded?" |

**Pipeline order:**

```
Stage 1-9: Parse → Seed all files → fillScenarioGaps (AI)
    ↓
Stage 10: Assemble World
    ↓
Developer Layer 1: specSchema.json validation (structural)
    ↓
Developer Layer 2: validateWorldAware() (cross-field invariants)
    ↓
[AI Engineer] validateScenario (optional, semantic)  ← runs here
    ↓
Developer Layer 3: validateAssemblyConsistency() (post-AI-gap-fill checks)
    ↓
Stage 11: Write to disk
```

Layer 2 runs before AI validation because it catches deterministic errors cheaply. AI validation runs after gap-fill because the gap-fill might introduce inconsistencies worth checking. Layer 3 runs last because it verifies the final assembled state.

**The `validateScenario` task prompt explicitly includes only the structured spec fields** (not the full map), so it runs fast (~2,300 tokens) and can't hallucinate about regions it can't see.

---

#### Conflict 5: Gap-Fill Ordering in the Pipeline

**Problem:** Your 11-stage pipeline seeds files sequentially. My `fillScenarioGaps` fills across all domains. Where does it slot in?

**Resolution: `fillScenarioGaps` is a dedicated stage between seed stages and assembly.**

Proposed pipeline (your 11 stages, numbered):

```
 1. Parse spec
 2. Build Polity Map (code→name resolution)
 3. Build Geometry
 4. Seed Economy    ← writes author-defined economy fields
 5. Seed Culture    ← writes author-defined culture fields
 6. Seed Religion   ← writes author-defined religion fields
 7. Seed Resources  ← writes author-defined resource fields
 8. Seed Mobilization
 9. Seed Influence
─── NEW ───
10. Fill Scenario Gaps (AI)  ← one runJsonTask("fillScenarioGaps") call
    • Collects all blank fields from stages 4-9
    • Single AI call fills development, culture/religion minorities,
      resource discoveries, economy baselines
    • Writes gap-fill results into the same modular JSON files
─── END NEW ───
11. Assemble World → consistency pass
12. Validate (Layers 1-3 + optional AI semantic)
13. Write to disk
```

**Why one call, not six:** Six separate AI calls for economy, culture, religion, resources, mobilization, and influence would cost ~42K tokens at publish time and risk inconsistency (AI fills "Balkans are Catholic" in religion but "Ottoman Muslim" in culture). One holistic call with the full gap manifest costs ~7K tokens and ensures cross-domain coherence.

---

#### Conflict 6: AI Call-Time Directives

**Problem:** Your spec doesn't specify where prompt templates or `ECONOMY_MODIFIER_REFERENCE` live.

**Resolution: Developer doesn't own these — they live in AI Engineer territory.** You need to know only two things:

1. **`world.simulationRules` must be structured JSON** (not prose string). Your build pipeline produces it (see Conflict 1 resolution). The AI prompt system reads it via `buildSimulationRulesText()`. For backward compatibility with old saves that still have prose strings, the text builder detects `typeof === "string"` and passes through unchanged.

2. **New helper variables** that my prompt templates reference need corresponding entries in `promptContext.js` → `buildPromptContext()`. But I own `promptContext.js` and `defaultPrompts.json`. The Developer just needs to ensure the runtime data is available on `world.json` at the fields I expect:
   - `world.simulationRules` — structured object (not string)
   - `world.macroRegionDefs` — the two-tier region definitions
   - `world.cultureJson` or `world.culture` — culture data
   - `world.religionJson` or `world.religion` — religion data
   - `world.economyJson` or `world.economy` — economy baselines

---

#### Conflict 7: `regionHistory`

**Problem:** Your spec includes date-keyed per-region history entries. I didn't include it. The analyst recommended it.

**Resolution: Include the TypeScript interface as a placeholder; defer runtime implementation to Phase 2.**

```typescript
// In ScenarioSpec — PLACEHOLDER for Phase 2
regionHistory?: Record<string, Array<{
  date: string;
  event: string;
  impacts?: {
    development?: { agricultural?: number; industrial?: number; manpower?: number };
    owner?: string;
    culture?: string;
    religion?: string;
  };
}>>;  // keyed by macroRegionId
```

The Developer includes the interface so `.spec.mjs` files can carry history without a migration later. The build pipeline writes it into `world.json` as `regionHistory`. But:
- AI tasks in Phase 1 do NOT consume it (too much token budget)
- `validateScenario` can reference it if present
- Phase 2 will add `buildRegionHistoryContext()` for pregameHistory prompts

---

#### Conflict 8: Naming

**Problem:** Your `StructuredSimulationRules` (TS interface) vs. my `simulationRules` (world.json field).

**Resolution:**

| Context | Name | Type |
|---------|------|------|
| `.spec.mjs` author format | `simulationRules` field, typed as `StructuredSimulationRules` | TS interface |
| `world.json` runtime field | `simulationRules` | JSON object (Layer B format) |
| `build-preset.mjs` transform | `buildRuntimeSimulationRules()` | Function |
| `promptContext.js` renderer | `buildSimulationRulesText()` | Function |
| AI prompt variable | `${simulationRules}` / `${HISTORICAL_PRESET_SIMULATION_RULES}` | String |

No clash. Same field name at both layers, different shapes, connected by a build transform.

---

### What the Developer Missed (from my spec)

| # | Item | Where it goes | Owner |
|---|------|--------------|-------|
| 1 | `aiHistoryMode` field on `StructuredSimulationRules` | `.spec.mjs` author format | Developer |
| 2 | `eraNarrative` field on `StructuredSimulationRules` | `.spec.mjs` author format | Developer |
| 3 | `activeConflicts[]` (separate from `factions[]`) | `.spec.mjs` author format | Developer |
| 4 | `faction.type` discriminator ("alliance"|"rivalry"|"coalition"|"bloc") | `.spec.mjs` author format | Developer |
| 5 | `faction.toward` for directional postures | `.spec.mjs` author format | Developer |
| 6 | `faction.since` date field | `.spec.mjs` author format | Developer |
| 7 | `constraints.narrativeRules[]` string array | `.spec.mjs` author format | Developer |
| 8 | `buildRuntimeSimulationRules()` transform in build pipeline | `build-preset.mjs`, Stage 2 | Developer |
| 9 | `mapSemantics` concrete schema (I provided full schema at §5) | New file `src/Game/AI/mapSemanticsSchema.js` | Developer |
| 10 | `PREGAME_HISTORY_SCHEMA` extended with `factsUsed[]` | `gameplaySchemas.js` | AI Engineer |
| 11 | `FILL_GAPS_SCHEMA` and `FILL_GAPS_TOOL` | `gameplaySchemas.js` | AI Engineer |
| 12 | `fillScenarioGaps` stage in pipeline (Stage 10) | `build-preset.mjs` | Developer |
| 13 | `validateScenario` optional AI task | `gameplay.js` + `gameplaySchemas.js` | AI Engineer |
| 14 | `buildCultureReligionSummary()` + `buildMacroRegionSummaryText()` | `promptContext.js` | AI Engineer |

---

### What I Accept from the Developer's Spec

| # | Item | Rationale |
|---|------|-----------|
| 1 | 11-stage assembly pipeline | Clean separation of concerns. I'll integrate `fillScenarioGaps` as Stage 10 and `validateScenario` as optional post-Stage-12. |
| 2 | `constraints` as boolean flags | Better for engine enforcement than my string arrays. My `allowedUnitTypes`/`forbiddenActions` become derived outputs. |
| 3 | `factions[]` as authoring concept | Richer than my flat arrays. With additions (`type`, `toward`, `since`), it feeds both `allianceBlocks` and `diplomaticPostures`. |
| 4 | `technologyLevel.notable[]` | Adds narrative flavor to prompts ("notable technologies: dreadnoughts, machine guns, poison gas"). Easy to render. |
| 5 | 6 modular JSON files with polling intervals | Aligns with principles.md §15. I accept the file list: economy (30s), culture (60s), religion (60s), resources (30s), influence (30s), mobilization (30s). |
| 6 | Three-layer engine validation | Complements my AI semantic validation. Layers 1-2 run before AI; Layer 3 runs after. |
| 7 | Migration utility (`migrate-presets.mjs`) | Essential for adoption. `.v2.mjs` with `⚠️ HUMAN REVIEW` markers is the right approach. |
| 8 | MacroRegion auto-gen algorithm | Connected components + cardinal-zone splitting is correct. I accept it. |
| 9 | `regionHistory` TS placeholder | Deferred to Phase 2 but interface is defined now. |
| 10 | `diplomacyDefaults` (allianceBlockRadius, treatyDurationMonths) | Engine parameters I don't need to touch. Useful for the Developer's mobilization/influence seeding. |

---

## Consensus Proposal

### Unified `StructuredSimulationRules` (Author Format)

```typescript
interface StructuredSimulationRules {
  // ── Era identity ──
  era: string;                              // "ww1" | "napoleonic" | "medieval" | ...
  aiHistoryMode: "conditional" | "free" | "guided";  // default "conditional"
  eraNarrative?: string;                    // human-readable context, ~1-3 sentences

  // ── Engine constraints (Developer owns) ──
  constraints: {
    noAirPower?: boolean;
    noGunpowder?: boolean;
    noNaval?: boolean;
    maxUnitTier?: number;
    narrativeRules?: string[];             // "no nuclear weapons", "no satellites", etc.
  };

  // ── Factions, alliances, conflicts ──
  factions: Array<{
    name: string;
    members: string[];                     // country codes
    type: "alliance" | "rivalry" | "coalition" | "bloc";
    allianceType?: "defensive" | "offensive" | "non_aggression" | "entente";
    disposition?: "cooperative" | "neutral" | "competitive" | "hostile";
    since?: string;                        // ISO date
    toward?: string;                       // for directional postures (single country code)
    goals?: string[];
  }>;

  activeConflicts?: Array<{
    name: string;
    belligerents: string[][];              // two sides, each an array of country codes
    since?: string;
    intensity?: "cold" | "limited" | "total";
  }>;

  // ── Technology (Developer owns, AI Engineer consumes notable[]) ──
  technologyLevel: {
    era: string;
    notable?: string[];                    // "dreadnoughts", "machine guns", "telegraph"
  };

  // ── Engine tuning (Developer owns, AI doesn't consume) ──
  diplomacyDefaults: {
    allianceBlockRadius: number;
    treatyDurationMonths: number;
  };
}
```

### Runtime `simulationRules` (world.json Format — Derived)

```typescript
interface RuntimeSimulationRules {
  techEra: string;
  aiHistoryMode: "conditional" | "free" | "guided";
  eraNarrative: string;
  allowedUnitTypes: string[];
  forbiddenActions: string[];
  allianceBlocks: Array<{
    name: string; members: string[]; since: string; type: string;
  }>;
  activeWars: Array<{
    name: string; belligerents: string[][]; since: string; intensity: string;
  }>;
  diplomaticPostures: Array<{
    from: string; toward: string; posture: string; reason: string;
  }>;
}
```

### Updated 13-Stage Pipeline

```
 1. Parse .spec.mjs
 2. Build Polity Map      ← code→name resolution + buildRuntimeSimulationRules()
 3. Build Geometry
 4. Seed Economy          ← author-defined fields only
 5. Seed Culture          ← author-defined fields only
 6. Seed Religion         ← author-defined fields only
 7. Seed Resources        ← author-defined fields only
 8. Seed Mobilization
 9. Seed Influence
10. Fill Scenario Gaps    ← ONE AI call: fills blanks in 4-9 outputs
11. Assemble World
12. Validate (Layers 1-3) ← engine: structural + world-aware + assembly
13. [Optional] AI Validate ← runJsonTask("validateScenario"), advisory output
14. Write to disk
```

### Division of Labor

| Deliverable | Developer | AI Engineer |
|-------------|-----------|-------------|
| `StructuredSimulationRules` TS interface | ✅ Owns, defines | ✅ Reviews, adds `aiHistoryMode`, `eraNarrative`, `narrativeRules`, `faction.type`, `faction.toward`, `faction.since`, `activeConflicts` |
| `buildRuntimeSimulationRules()` transform | ✅ Implements in build pipeline | ✅ Reviews derived field logic |
| `simulationRules` runtime JSON shape | ✅ Writes to world.json | ✅ Consumes in prompt builders |
| `buildSimulationRulesText()` renderer | — | ✅ Implements in `promptContext.js` |
| `FILL_GAPS_SCHEMA` + tool | — | ✅ Implements in `gameplaySchemas.js` |
| `fillScenarioGaps` pipeline stage | ✅ Integrates Stage 10 into build pipeline | ✅ Implements `fillScenarioGaps()` in `gameplay.js` |
| `VALIDATE_SCENARIO_SCHEMA` + tool | — | ✅ Implements in `gameplaySchemas.js` |
| `validateScenario` pipeline stage | ✅ Integrates optional Stage 13 | ✅ Implements `validateScenario()` in `gameplay.js` |
| `PREGAME_HISTORY_SCHEMA` + `factsUsed[]` | — | ✅ Implements |
| `ECONOMY_MODIFIER_REFERENCE` call-time directive | — | ✅ Implements in `gameplay.js` |
| `buildCultureReligionSummary()` etc. | — | ✅ Implements in `promptContext.js` |
| `mapSemanticsSchema.js` + two-tier pipeline | ✅ Implements cheap-model resolution | ✅ Defines schema, owns expensive-model prompt |
| `regionHistory` TS placeholder | ✅ Defines interface | — (Phase 2) |
| Migration utility | ✅ Implements `migrate-presets.mjs` | — |
| 6 modular JSON files + polling | ✅ Implements | — |
| Layers 1-3 validation | ✅ Implements in build pipeline | — |
| New helper variables in `defaultPrompts.json` | ✅ Wires in `buildPromptContext` | ✅ Defines helpers + prompt text |

### Open Questions (Defer to Implementation)

1. **`fillScenarioGaps` model:** Gemini 2.5 Pro vs. GPT-4o — which provider? Decision at implementation time based on benchmarked accuracy for historical data.
2. **`validateScenario` mandatory or optional?** I recommend optional (advisory) for Phase 1; mandatory once we have confidence in the task's precision.
3. **`mapSemantics` cheap model:** Gemini Flash vs. local Ollama 3B? Benchmark spatial name-matching accuracy with sample data before deciding.
4. **`regionHistory` in pregameHistory prompt:** Deferred to Phase 2. The PO's user stories don't require it for Phase 1.



# Recovered Phase 1 Developer Consensus Review

> Recovered verbatim from local Codex session `01a04af1-3f09-7e30-aefe-10d667c1b565`
> (Developer / Mill, DeepSeek V4 Pro, 2026-08-29T06:40:11.494Z).
> This file preserves the original agent artifact;
> `../consensus-spec.md` is authoritative where decisions differ.

---

## Consensus Review — Developer's Analysis

I've analyzed Heisenberg's spec against mine. Here's the conflict breakdown and resolution proposal.

---

### Conflict Matrix

| # | Topic | My Spec | His Spec | Severity |
|---|---|---|---|---|
| C1 | `simulationRules` shape | `{ factions[], technologyLevel, diplomacyDefaults }` | `{ allianceBlocks[], activeWars[], diplomaticPostures[], forbiddenActions[] }` | **High** — different structs, different consumers |
| C2 | Economy authorship | Per-region dev values in spec, auto-generated | AI fills from gap manifest, engine computes from modifiers | **Medium** — complementary, not conflicting |
| C3 | macroRegion origin | Auto-generation algorithm defined | Assumes they exist before `fillScenarioGaps` | **Low** — sequential pipeline stages |
| C4 | Validation architecture | Three-layer: Schema → World-aware → Assembly | `validateScenario` AI task + `factsUsed[]` cross-check | **Medium** — overlapping concerns, different approaches |
| C5 | AI call-time directives | Not defined | `ECONOMY_MODIFIER_REFERENCE` directive | **Gap** — I didn't define directive layer |

---

### Resolution Proposals

#### C1 — `simulationRules` Shape (HIGH)

**Diagnosis**: We designed for different consumers. Mine encodes **static world facts** (who are the factions, what tech level, what are diplomatic defaults). His encodes **AI behavioral constraints** (what the AI must never do, what wars are active, what postures exist). These are NOT the same data — they're two halves of the simulation contract.

**Resolution — merge into a single two-section structure**:

```ts
interface StructuredSimulationRules {
  // ── Section A: World facts (my spec, consumed by prompt context builder) ──
  worldState: {
    techEra: SimulationEra;
    factions: FactionDef[];           // mine: { code, name, disposition, goals }
    allianceBlocks: AllianceBlock[];  // his: { name, members[] }
    activeWars: ActiveWar[];          // his: { attacker, defender, casusBelli }
    diplomaticPostures: PostureEdge[]; // his: { from, to, posture }
  };

  // ── Section B: AI constraints (his spec, injected as system prompt directives) ──
  aiDirectives: {
    eraNarrative: string[];           // bullet points from prose (his transform)
    allowedUnitTypes: string[];
    forbiddenActions: string[];       // e.g. "no gunpowder weapons", "no air power"
    aiHistoryMode: "strict" | "flexible" | "sandbox";
  };
}
```

**Rationale**: Section A seeds `promptContext.js`'s simulation state. Section B gets injected into every task's system message. Both are needed. Separation makes it clear which part an author controls vs. which part constrains the AI. The combined payload replaces the current prose string entirely — `buildSimulationRulesText()` (his) produces a compact bulleted rendering for injection, consuming both sections.

#### C2 — Economy Authorship (MEDIUM)

**Diagnosis**: We describe two paths to the same destination. I specified manual/auto-generated initial values. He specified AI gap-fill. Both are correct for different scenarios.

**Resolution — three-tier economy initialization**:

```
Priority order:
1. spec.economy.macroRegions[]     → author wrote it, use as-is
2. AI fillScenarioGaps            → author didn't write it, AI generates
3. Auto-generation defaults        → AI unavailable, generate 10/10/10 per region
```

My auto-generation (Stage 3) becomes the **fallback**, not the primary path. His `fillScenarioGaps` becomes the **preferred path for authored presets**. The gap manifest sent to the AI includes `macroRegionIds[]` (from my auto-generated macroRegions) with empty `development` and `gdp` fields.

His `ECONOMY_MODIFIER_REFERENCE` directive stays — it's a permanent runtime constraint: "engine computes absolute GDP from development × population; you provide modifier deltas only." This prevents the AI from hallucinating 21st-century GDP figures into a 117 AD scenario.

#### C3 — macroRegion Origin (LOW)

**Diagnosis**: Not a conflict — sequential stages. My Stage 2.5 generates macroRegions. His `fillScenarioGaps` runs after and receives them.

**Resolution**: Set the pipeline order explicitly:

```
Stage 2.5: autoGenerateMacroRegions() → world.macroRegionDefs
Stage 3:   seedEconomy() with macroRegionIds from Stage 2.5
Stage 3b:  [NEW] if economy is empty, queue fillScenarioGaps AI task
Stage 4-8: seedCulture/Religion/Resources/Mobilization/Influence
Stage 9:   assemble world.json
Stage 10:  validateScenario (AI) + validateAssemblyConsistency (engine)
```

No structural changes needed — just sequencing.

#### C4 — Validation Architecture (MEDIUM)

**Diagnosis**: My three-layer validation is **engine-side** (runs in `build-preset.mjs` at build time). His `validateScenario` is **AI-side** (asks the model to find logical contradictions). These serve different purposes and both are valuable.

**Resolution — four-layer validation with clear ownership**:

| Layer | Owner | When | What |
|---|---|---|---|
| L1: Schema | Engine (`ajv`) | Build time, pre-stage-1 | Type/shape/range validation |
| L2: World-aware | Engine (`validateWorldAware`) | Build time, post-stage-2 | Cross-field invariants against catalog |
| L3: AI audit | AI (`validateScenario` task) | Build time, post-stage-9 | Logical contradictions (his contribution) |
| L4: Assembly | Engine (`validateAssemblyConsistency`) | Build time, pre-write | Post-AI-fill: GDP sums, landless polities, coverage |

**His `factsUsed[]`** in pregame history becomes a L2 cross-check: each cited fact must reference a real spec field. I accept this fully.

**L3 AI output schema**:
```json
{
  "errors": [{ "field": "simulationRules.factions[0]", "message": "ROM disposition 'defensive' contradicts activeWars entry where ROM is attacker" }],
  "warnings": [{ "field": "economy.macroRegions", "message": "Lower Egypt development (28/24/22) is unusually high for 117 AD; verify against scholarship" }]
}
```

L3 errors are warnings to the author, not build blockers — the AI can hallucinate about history. L1, L2, and L4 errors **are** build blockers.

#### C5 — AI Call-Time Directives (GAP)

**Diagnosis**: I didn't define where AI behavioral directives live. He defined `ECONOMY_MODIFIER_REFERENCE` as a call-time directive.

**Resolution**: Accept his approach. Add a `callTimeDirectives` section to the assembled `world.json` that `promptContext.js` reads and injects:

```js
// In world.json:
{
  "callTimeDirectives": {
    "economyModifierOnly": true,        // from his spec
    "cultureShiftsEnabled": true,       // from his extended mapSemantics
    "religionShiftsEnabled": true,
    "resourceDiscoveriesEnabled": true,
    "influenceChangeEnabled": true
  }
}
```

This lives in `WORLD_DEFAULTS` in `gameState.js` and is seeded from `simulationRules.aiDirectives` at build time.

---

### What Heisenberg Missed from My Spec

| Missed Item | Importance | Consensus Action |
|---|---|---|
| JSON Schema (L1) validation with `ajv` | **High** — prevents malformed specs from reaching the build pipeline | Add to pipeline; he didn't object, just didn't mention it |
| MacroRegion auto-generation algorithm | **High** — his `fillScenarioGaps` needs macroRegion IDs as input | My algorithm runs first; his task consumes the output |
| Modular JSON storage (`economy.json`, etc.) | **High** — defines the runtime data model | My design stands; his task output writes directly to these files |
| Polling intervals and diff-update strategy | **Medium** — runtime performance | My analysis stands; no conflict with his approach |
| Migration script for 6 presets | **Medium** — backward compatibility | My `migrate-presets.mjs` approach stands; his `fillScenarioGaps` can be invoked during migration |
| Editor `doc.metadata` changes | **Low** — Phase 2 concern | My storage design stands; his gap manifest format could inform the editor UI |
| MapLibre macroRegion overlay layer | **Low** — rendering detail | My approach stands |

---

### What I Accept from His Spec

| Accepted | Rationale |
|---|---|
| `fillScenarioGaps` task + schema | Complements auto-generation with AI-authored values. Gap manifest is the right interface — compact, only missing fields. |
| `validateScenario` AI task | Adds logical-contradiction detection that engine validators can't catch (e.g., "faction has 'expansionist' disposition but no neighbors"). Becomes L3 in the four-layer model. |
| `factsUsed[]` in pregame history | Traceability from AI output back to spec fields. Enables L2 cross-validation. |
| Extended `mapSemantics` | `cultureShifts`, `religionShifts`, `resourceDiscoveries`, `influenceChanges` are needed for the AI to know it can modify these domains. |
| `ECONOMY_MODIFIER_REFERENCE` directive | Prevents AI from hallucinating absolute GDP. Engine computes; AI provides deltas. |
| Call-time directive injection | The right pattern for engine→AI behavioral constraints. |
| 40-macroRegion cap in prompts | Practical token management. Full list for `fillScenarioGaps` only. |
| Token budget justification | 100 token savings per prompt × hundreds of turns is real and justifies the migration. |

---

### Consensus Proposal — Unified Architecture

**1. `ScenarioSpec` interface** — Combine our types:

```ts
interface ScenarioSpec {
  // Existing (unchanged)
  id: string; meta: ScenarioMeta; game: ScenarioGame;
  polities?: Record<string, PolityDef>;
  countryAssignments?: Record<string, string[]>;
  regionAssignments?: Record<string, string>;
  cities?: CityDef[];
  startingTimelineText?: string;

  // Structured simulation rules (merged C1 resolution)
  simulationRules?: StructuredSimulationRules;

  // Module fields (my spec)
  economy?: EconomySpec;
  culture?: CultureSpec;
  religion?: ReligionSpec;
  resources?: ResourcesSpec;
  mobilization?: MobilizationSpec;
  influence?: InfluenceSpec;
  macroRegions?: MacroRegionDef[];
  regionHistory?: RegionHistoryEntry[];
}
```

**2. Assembly pipeline** — Seven stages with AI integration:

| Stage | Owner | Output |
|---|---|---|
| 0. Parse + L1 validate | Engine | Resolved spec |
| 1. Build polity map | Engine (existing) | polityOverrides, regionOverrides |
| 2. Build geometry + cities | Engine (existing) | regions.geojson, cities.geojson |
| 2.5. Auto-generate macroRegions | Engine (new) | macroRegionDefs |
| 3. Seed economy | Engine → AI gap-fill | economy.json |
| 4–8. Seed culture/religion/resources/mobilization/influence | Engine → AI gap-fill | 5 JSON files |
| 9. Assemble world.json | Engine | world.json with macroRegionDefs + callTimeDirectives |
| 10. Validate | Engine (L2, L4) + AI (L3) | Validation report |

**3. New AI tasks** (his contribution):

- `fillScenarioGaps` — one-time, receives gap manifest, returns baseline values
- `validateScenario` — one-time, receives full spec, returns errors[] + warnings[]

**4. New runtime assets** (my contribution):

- `economy.json`, `culture.json`, `religion.json`, `resources.json`, `mobilization.json`, `influence.json`
- Polled independently via HEAD diff checks
- Served through existing `/api/runtime/json/:assetKey`

**5. Migration** (my contribution):

- `migrate-presets.mjs` converts 6 presets to new format
- Auto-generates macroRegions, queues `fillScenarioGaps` for economy/culture/religion
- Produces `.v2.mjs` files alongside originals

**6. Token budget** (his analysis accepted):

- Structured rules: ~250 tokens vs ~750 prose = **500 token savings per prompt**
- macroRegion cap of 40/turn: ~600 tokens
- Gap manifest: compact, only missing fields, ~200 tokens

---

### Unresolved for Phase 2

- Editor UI panels for structured fields (storage ready, UI not designed)
- "Export as Spec" button from editor
- Batch-poll endpoint for 6 simulation files
- Full macroRegion re-computation on ownership changes (Phase 1 does dominantPolity updates only)

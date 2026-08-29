# Recovered Phase 1 PO Vision

> Recovered verbatim from local Codex session `01a04ae7-efe2-79a1-bd9f-12314847d79d`
> (PO / Mencius, DeepSeek V4 Pro, 2026-08-29T00:27:47.130Z).
> This file preserves the original agent artifact;
> `../consensus-spec.md` is authoritative where decisions differ.

---

Now I have a thorough picture. Let me produce the Vision Doc.

---

# Vision Doc: Phase 1 — Scenario Architecture

**Project:** Open Historia
**Author:** PO
**Date:** 2026-08-29
**Status:** Ready for DISCOVERY phase

---

## Goal

Redesign the scenario architecture so that a `.spec.mjs` file is a **self-contained, machine-validatable definition of an entire world at time zero**, covering not just borders and cities but economy, culture, religion, resources, mobilization, influence, and era constraints — all as structured data, not prose strings. The AI fills gaps without ever contradicting the spec. Every new mechanic added to the engine must be spec-definable on day one.

**Why now:**
- `simulationRules` is a free-text string. It works for the current ~6 presets, but it is unparseable by the engine, unvalidatable, and can't drive structured constraints (e.g. "no nuclear weapons" = a boolean + date gate, not prose the AI might ignore).
- Economy, culture, religion, resources, mobilization, and influence exist in `principles.md` and the AI prompts, but have **no schema, no spec surface, and no validation**. The AI generates them with no spec guardrails.
- The `pregameHistory` generation loop already exists (`maybeGeneratePregameHistory`, `submit_pregame_history` tool) but has no structured spec to ground it — it generates backstory from thin prose, not from spec-defined facts.
- We are about to implement these six mechanics in the engine. Without a spec format that can express them, every mechanic will be AI-only with no scenario-author control.

---

## User Stories

### US-1: "I define era constraints once, the engine enforces them everywhere"
As a scenario author, I want to declare structured era rules — `techEra`, `forbiddenActions`, `allowedUnitTypes`, `aiHistoryMode`, `allowedDiplomacyActions` — as typed fields so that the AI cannot propose nuclear weapons in 1200 BC and the engine can gate UI actions (e.g. "Propose Alliance" unavailable if `allowedDiplomacyActions` excludes it).

### US-2: "I set each country's starting economy in the spec"
As a scenario author, I want to declare per-country starting GDP, inflation, unemployment, employment structure, and tax rate in the spec, so every game seeded from my scenario begins with the same economic baseline rather than the AI inventing numbers that drift between runs.

### US-3: "I place culture and religion on the map, the engine diffuses them"
As a scenario author, I want to define cultural groups and religious groups with per-region primary assignments and minority percentages, so the Cultural and Religious map modes render authored data from turn zero and the engine's diffusion formulas modify it from a known starting state.

### US-4: "I place resources on regions, engine totals follow ownership"
As a scenario author, I want a `resources` block in the spec that maps region IDs to resource types (oil, coal, iron, food, gold) and quantifies them, so that conquering a coal region subtracts coal from the loser and adds it to the winner automatically — and so that the AI's `mapSemantics` can include `resourceDiscovery` events without inventing the resource map from scratch.

### US-5: "I tune mobilization for my era in structured fields"
As a scenario author, I want to set `manpowerPool`, `mobilizationRate`, `maxMobilizationRate`, and `demobilizationDelay` in the spec per country and globally, so the engine computes how many troops can be raised and how long it takes, rather than the AI guessing medieval vs. industrial mobilization rates.

### US-6: "I seed influence relationships in the spec"
As a scenario author, I want to define suzerain-vassal relationships (`suzerain`, `vassal`, `autonomyLevel`) and sphere-of-influence overlays (`influencer`, `influenced[]`, `influenceStrength`) as spec fields, so the Real map mode shows Manchukuo as a Japanese puppet with 20% autonomy and Mongolia as a Soviet satellite — all from spec, not AI guesswork.

### US-7: "The pregame history generator respects my spec facts"
As a scenario author, I want the `pregameHistory` generator to receive **structured facts from my spec** (pre-existing alliances since a date, pre-war territorial transfers, historical characters, unresolved tensions) so the generated timeline up to `startDate` is consistent with my era and does not contradict ground truth.

---

## Acceptance Criteria

### AC-1: `simulationRules` is structured JSON with formal schema
- `simulationRules` is a **JSON object**, not a string.
- Has a JSON Schema (`simulationRulesSchema`) with required fields: `techEra` (enum), `aiHistoryMode` (enum: `conditional` | `free` | `guided`), `allowedUnitTypes` (string[]), `forbiddenActions` (string[]).
- Optional fields: `eraNarrative` (string — the human-readable prose that currently lives in the string, preserved verbatim for AI prompts), `alliances` (object[] with dates), `activeWars` (object[] with dates), `globalModifiers` (object).
- The schema is co-located in `src/Game/AI/gameplaySchemas.js` alongside existing schemas.
- A `validateSimulationRules` validator runs on scenario load and rejects invalid rules before the game starts.

### AC-2: Economy fields exist in spec and seed `economy.json`
- The spec gains an `economy` block: `{ globalModifiers: {}, countries: { CODE: { gdp, inflation, unemployment, employmentStructure, taxRate, debt } } }`.
- On scenario select → game creation, these values seed `economy.json` (a new runtime asset, per principles §6).
- If a country has no `economy.countries.CODE`, the AI fills it on first turn (gap-fill, not spec-contradiction).
- The engine's economy formulas (`GDP = Σ(regionBaseOutput × development × modifiers)`) reconcile spec-authored totals with region-level data.

### AC-3: Culture and religion are spec-definable and seed their JSON assets
- The spec gains `culture: { groups: {}, regions: {} }` and `religion: { groups: {}, regions: {} }`.
- `groups` maps group codes to `{ name, color, description }`.
- `regions` maps region IDs to `{ primary: groupCode, minorities: { groupCode: percentage } }`.
- On game creation, these seed `culture.json` and `religion.json` (per principles §8, §15).
- The Cultural and Religious map modes render from this data on turn zero.

### AC-4: Resources are spec-definable and seed `resources.json`
- The spec gains `resources: { regions: { regionId: { resourceType: quantity } } }`.
- `resourceType` enum: `oil`, `coal`, `iron`, `food`, `gold`, `timber`, `rare_metals`.
- `quantity` is an integer representing abstract production units.
- On game creation, seeds `resources.json`. Country totals are engine-computed as `Σ(resources of owned regions)`.
- AI `mapSemantics.resourceDiscoveries` can add new resource entries to regions but cannot delete spec-authored ones.

### AC-5: Mobilization is spec-definable
- The spec gains `mobilization: { global: { eraMultiplier, baseMobilizationDelay }, countries: { CODE: { manpowerPool, maxMobilizationRate } } }`.
- Seeds `mobilization.json` on game creation.
- The engine's mobilization formulas (`src/runtime/` — new module) read these values and compute `mobilized`, `deploymentDelay`, and `demobilizationUnemploymentShock`.

### AC-6: Influence is spec-definable
- The spec gains `influence: { relationships: [{ suzerain, vassal, autonomyLevel, since }], spheres: [{ influencer, influenced[], strength }] }`.
- Seeds `influence.json` on game creation.
- The Real map mode renders vassal territories with blended colors and overlays.
- Autonomy levels are engine-enforced: low-autonomy vassals cannot declare war independently.

### AC-7: `pregameHistory` generator receives structured spec facts
- The `pregameHistory` prompt (in `src/Game/AI/gameplayPrompts.js`) receives a `specFacts` block derived from the structured fields: pre-existing alliances, active wars as of `startDate`, territorial notes, era context.
- The `PREGAME_HISTORY_SCHEMA` gains an optional `factsUsed[]` field so the AI can report which spec facts it incorporated.
- The validator (`validatePregameEvents`) checks that generated events do not contradict spec facts (no "France invades Germany" if `alliances` says they are allied since 1892).
- Existing `startingTimelineText` remains as the narrative opening; `pregameHistory` events form a chronological timeline leading up to it.

### AC-8: Backward compatibility with existing presets
- A migration utility (`scripts/migrate-presets.mjs`) converts all 6 existing `.spec.mjs` presets to the new format.
- The build system (editor export → game seed) emits both old-style `simulationRules` string (for any legacy consumer) and the new structured object.
- The `buildPromptContext` function in `promptContext.js` reads the new structured fields and constructs prompt-friendly text blocks, falling back to the old string if the structured object is absent.

### AC-9: TypeScript types for the spec format
- A `ScenarioSpec` TypeScript interface is defined in `src/runtime/specTypes.ts`.
- All new fields are typed. The spec format is the canonical source; the TypeScript type is derived from it and used by the validator.
- `WORLD_DEFAULTS` in `gameState.js` is updated to include the new fields with sensible defaults (`null` or `{}` for AI-gap-fill).

---

## Scope Boundaries

### In Phase 1

| Deliverable | Detail |
|---|---|
| `simulationRules` → structured JSON | Schema, validator, migration of presets |
| `economy` spec block | Per-country starting values, seeds `economy.json` |
| `culture` + `religion` spec blocks | Groups + per-region assignments, seeds JSON |
| `resources` spec block | Per-region resource map, seeds `resources.json` |
| `mobilization` spec block | Global + per-country, seeds `mobilization.json` |
| `influence` spec block | Suzerain-vassal + spheres, seeds `influence.json` |
| `pregameHistory` spec grounding | Structured facts feed into generator prompt |
| TypeScript types | `ScenarioSpec`, field-level interfaces |
| Migration utility | Convert existing 6 presets |
| Editor UI updates | New fields in scenario editor (textareas → structured forms) |

### Deferred to Phase 2+

| Item | Rationale |
|---|---|
| Economy formula implementation | Spec defines values; engine formulas are a separate DEV + AI Engineer task |
| Culture/religion diffusion engine | Spec defines starting state; diffusion logic is engine work |
| Resource depletion mechanics | AI resource discovery is in scope (through modifiers); depletion formulas are engine work |
| Technology tree or discovery system | `techEra` gates actions; full tech progression is a separate phase |
| Diplomacy action validation from spec | `allowedDiplomacyActions` gates UI; full diplomacy system is engine work |
| Unit type combat formulas | `allowedUnitTypes` gates which types exist; combat resolution is engine work |
| Editor structured-form UX | Phase 1 provides the data fields in the export path; full WYSIWYG editor forms are deferred |

---

## Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| **Spec completeness** | All 6 existing presets migrate without data loss | `scripts/migrate-presets.mjs` runs clean; diff shows only structural changes, no loss of meaning |
| **AI contradiction rate** | Zero spec-contradicting AI events in 50 test jumps | Automated test: run 50 `autoJumpForward` cycles, check `validateTimelineDates` + spec-invariant checks, count violations |
| **Spec validation coverage** | 100% of structured fields covered by schema validation | `validateSimulationRules` + per-block validators reject every known invalid shape |
| **Prompt token efficiency** | `simulationRules` token count ≤ current string average across presets | Compare `buildPromptContext` output token count before/after for all 6 presets |
| **Pregame history consistency** | Zero spec-contradicting pregame events in 10 generations per preset | For each preset, run `maybeGeneratePregameHistory` 10×, validate all events against spec facts |
| **Editor round-trip** | Edit → export → import → edit preserves all new fields | Export a preset with all new fields populated, re-import, assert equality |
| **Backward compatibility** | A legacy `simulationRules` string still works if structured object is absent | `buildPromptContext` fallback test |

---

## Baseline Format Sketch

This is illustrative — the Analyst and Developer will finalize the schema. It shows the target shape:

```typescript
interface ScenarioSpec {
  id: string;
  meta: { /* existing, unchanged */ };
  game: { country, startDate, gameDate };
  relabelOwnedCountries: boolean;
  unassignedKeepModernOwner: boolean;
  allowedUnitTypes: string[];

  polities: Record<string, { name, color, aliases }>;
  countryAssignments: Record<string, string[]>;
  regionAssignments: Record<string, string>;
  cities: Array<[string, string | [number, number], number, number]>;

  // NEW — structured simulation rules
  simulationRules: {
    techEra: "ancient" | "classical" | "medieval" | "renaissance" | "industrial" | "modern" | "atomic" | "information";
    aiHistoryMode: "conditional" | "free" | "guided";
    allowedUnitTypes: string[];
    forbiddenActions: string[];
    alliances?: Array<{ parties: string[]; since: string }>;
    activeWars?: Array<{ attacker: string; defender: string; since: string; name: string }>;
    globalModifiers?: Record<string, number>;
    eraNarrative: string;  // The existing prose, preserved verbatim
  };

  // NEW — economy
  economy?: {
    globalModifiers?: Record<string, number>;
    countries?: Record<string, {
      gdp?: number;
      inflation?: number;
      unemployment?: number;
      employmentStructure?: { agriculture: number; industry: number; services: number };
      taxRate?: number;
      debt?: number;
    }>;
  };

  // NEW — culture
  culture?: {
    groups: Record<string, { name: string; color: string; description?: string }>;
    regions: Record<string, { primary: string; minorities?: Record<string, number> }>;
  };

  // NEW — religion
  religion?: {
    groups: Record<string, { name: string; color: string; description?: string }>;
    regions: Record<string, { primary: string; minorities?: Record<string, number> }>;
  };

  // NEW — resources
  resources?: {
    regions: Record<string, Record<string, number>>;
  };

  // NEW — mobilization
  mobilization?: {
    global?: { eraMultiplier?: number; baseMobilizationDelay?: number };
    countries?: Record<string, { manpowerPool?: number; maxMobilizationRate?: number }>;
  };

  // NEW — influence
  influence?: {
    relationships?: Array<{ suzerain: string; vassal: string; autonomyLevel: number; since?: string }>;
    spheres?: Array<{ influencer: string; influenced: string[]; strength: number }>;
  };

  // EXISTING — preserved as-is
  startingTimelineText: string;
}
```

---

## Key Design Decisions Embedded in This Vision

1. **All new fields are optional.** If a preset leaves `economy` empty, the AI fills it. This preserves the "AI fills gaps" principle (§1) while giving authors control.

2. **`eraNarrative` preserves the prose.** The existing `simulationRules` string is NOT discarded — it becomes `simulationRules.eraNarrative` and is injected into AI prompts exactly as today. The structured fields ADD constraints the engine can enforce; they don't REPLACE the rich historical context the AI needs.

3. **The existing export pipeline is the integration point.** `src/Editor/exportPreset.js:242` writes `simulationRules` from `doc.metadata.simulationRules`. We extend `doc.metadata` in the editor to hold the structured fields, and `exportPreset.js` writes both the structured object and the legacy string for backward compatibility.

4. **Each mechanic seeds its own runtime JSON asset.** The principle of modular storage (§15) is applied consistently: `economy.json`, `culture.json`, `religion.json`, `resources.json`, `mobilization.json`, `influence.json` are all seeded at game creation from spec fields, and polled independently by the client.

5. **Spec validation happens at scenario load, not build time.** A scenario with invalid `simulationRules` should be caught when the player selects it, not when the author exports it. This keeps the editor forgiving and the runtime strict.

6. **The migration utility is a deliverable, not an afterthought.** Six presets exist. Each is a 200+ line `.spec.mjs` with nuanced editorial choices. A manual migration would introduce bugs. The migration script must produce diffs that can be reviewed line-by-line.

---

This Vision Doc is ready for the **Analyst** to research best practices (Europa Universalis IV defines starting conditions in script files with typed blocks; Crusader Kings 3 uses a similar `history/` folder pattern with per-title, per-province, per-character files) and for the **Developer** and **AI Engineer** to produce a joint Technical Spec + Prompt Spec during the DESIGN phase.

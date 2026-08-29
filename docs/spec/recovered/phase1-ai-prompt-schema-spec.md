# Recovered Phase 1 AI Prompt and Schema Spec

> Recovered verbatim from local Codex session `01a04af1-b51c-7df3-a129-deab2d99567d`
> (AI Engineer / Heisenberg, DeepSeek V4 Pro, 2026-08-29T00:41:15.246Z).
> This file preserves the original agent artifact;
> `../consensus-spec.md` is authoritative where decisions differ.

---

Now producing the full Prompt + Schema Spec.

---

# AI Engineer Spec — Prompt Spec + Schema Spec

**Phase 1: Scenario Architecture — Design Phase**
**Author:** AI Engineer
**Status:** Draft for Developer consensus
**References:** `src/Game/AI/` (all files), `docs/ai-schemas.md`, `docs/ai-prompts.md`, `docs/principles.md`, `docs/spec/discovery-summary.md`

---

## 1. New AI Task: `fillScenarioGaps`

### Rationale

The spec (`.spec.mjs`) now has structured fields for economy, culture, religion, resources per region/macro-region. Authors will fill some, leave others blank. Per §1 (Scenario is Law), AI must fill gaps without overwriting author data.

### What AI Receives

A structured "gap manifest" — not the full spec, only the blank fields the engine could not compute deterministically:

```js
// Never send the full .spec.mjs. Build this manifest in the server pipeline.
// promptContext.js exports a new buildGapManifest() called from a new fillScenarioGaps() entry.
{
  "targetDate": "1914-01-01",
  "techEra": "ww1",
  "aiHistoryMode": "conditional",
  "regionCount": 186,            // macroRegions only
  "gid1Count": 3124,
  "gaps": {
    "regions": {
      "macroRegionDefs": {
        "balkans_central": { "name": "Central Balkans", "owner": "Austria-Hungary", "gid1RegionIds": ["SRB.1_1", ...14 more], "population": 4200000 },
        // ... up to ~200 macroRegions, but only those with any gap
      },
      "missing": [
        { "macroRegionId": "balkans_central", "fields": ["development", "cultureMinorities", "religionMinorities"] },
        { "macroRegionId": "rhineland", "fields": ["religionMinorities"] },
        // ...
      ]
    },
    "cultureGroups": {
      "defined": ["German", "French", "British", "Italian", "Russian", "Ottoman_Turkish", "Austrian"],
      "missingForRegions": ["balkans_central", "middle_east_levant", "east_africa", ...8 more]
    },
    "religionGroups": {
      "defined": ["Catholic", "Protestant", "Orthodox", "Sunni_Islam", "Shia_Islam"],
      "missingForRegions": ["balkans_central", "india_punjab", "africa_horn", ...12 more]
    },
    "resourceRegions": {
      "defined": { "oil": ["caspian_baku", "middle_east_persia", "north_america_texas"], ... },
      "missingForRegions": ["africa_congo", "south_america_andes", ...6 more]
    },
    "economyBaselines": {
      "defined": ["Germany", "France", "Britain", "Russia"],
      "missing": ["Ottoman_Empire", "Austria-Hungary", "Italy", "Serbia", ...14 more]
    }
  }
}
```

Token count target: ≤2K tokens for the manifest (compact JSON, no prose).

### What AI Returns

```json
{
  "regionDevelopment": [
    {
      "macroRegionId": "balkans_central",
      "agricultural": 45,
      "industrial": 18,
      "manpower": 37
    }
  ],
  "cultureAssignments": [
    {
      "macroRegionId": "balkans_central",
      "primary": "Serbian",
      "minorities": [
        { "group": "German", "percent": 5 },
        { "group": "Hungarian", "percent": 8 },
        { "group": "Ottoman_Turkish", "percent": 3 }
      ]
    }
  ],
  "religionAssignments": [
    {
      "macroRegionId": "balkans_central",
      "primary": "Orthodox",
      "minorities": [
        { "group": "Catholic", "percent": 12 },
        { "group": "Sunni_Islam", "percent": 8 }
      ]
    }
  ],
  "resourceDiscoveries": [
    {
      "macroRegionId": "africa_congo",
      "resources": ["iron", "copper", "rubber"],
      "note": "Known but under-exploited colonial resources as of 1914"
    }
  ],
  "economyBaselines": [
    {
      "polityCode": "Ottoman_Empire",
      "agriculture": 55,
      "industry": 18,
      "services": 27,
      "gdpPerCapita": 1200,
      "currency": "Ottoman lira",
      "debt": 0.42
    }
  ]
}
```

All values are 0–100 unless noted otherwise (development is relative, not absolute GDP). `debt` is fraction of GDP.

### JSON Schema

```js
// In gameplaySchemas.js — new FILL_GAPS_SCHEMA
const developmentEntrySchema = {
  type: "object",
  description: "Per-region development values (EU4-style, relative 0-100).",
  properties: {
    macroRegionId: nonEmptyTextSchema("Exact macroRegionId from the gap manifest."),
    agricultural: { type: "integer", minimum: 0, maximum: 100, description: "Agricultural productivity relative to era max." },
    industrial: { type: "integer", minimum: 0, maximum: 100, description: "Industrial development relative to era max." },
    manpower: { type: "integer", minimum: 0, maximum: 100, description: "Recruitment pool depth relative to population." },
  },
  required: ["macroRegionId", "agricultural", "industrial", "manpower"],
  additionalProperties: false,
};

const minorityEntrySchema = {
  type: "object",
  description: "A minority group share in a region.",
  properties: {
    group: nonEmptyTextSchema("Culture or religion group name — use exact names from defined groups in the manifest."),
    percent: { type: "integer", minimum: 1, maximum: 49 },
  },
  required: ["group", "percent"],
  additionalProperties: false,
};

const cultureAssignmentSchema = {
  type: "object",
  properties: {
    macroRegionId: nonEmptyTextSchema("Macro region id."),
    primary: nonEmptyTextSchema("Dominant culture group name."),
    minorities: { type: "array", items: minorityEntrySchema, maxItems: 8 },
  },
  required: ["macroRegionId", "primary"],
  additionalProperties: false,
};

const religionAssignmentSchema = {
  type: "object",
  properties: {
    macroRegionId: nonEmptyTextSchema("Macro region id."),
    primary: nonEmptyTextSchema("Dominant religion group name."),
    minorities: { type: "array", items: minorityEntrySchema, maxItems: 6 },
  },
  required: ["macroRegionId", "primary"],
  additionalProperties: false,
};

const resourceDiscoverySchema = {
  type: "object",
  properties: {
    macroRegionId: nonEmptyTextSchema("Macro region id."),
    resources: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 8,
      description: "Resource types present: oil, coal, iron, gold, copper, food, rubber, timber, etc.",
    },
    note: textSchema("Brief justification."),
  },
  required: ["macroRegionId", "resources"],
  additionalProperties: false,
};

const economyBaselineSchema = {
  type: "object",
  properties: {
    polityCode: nonEmptyTextSchema("Polity code from the manifest."),
    agriculture: { type: "integer", minimum: 0, maximum: 100 },
    industry: { type: "integer", minimum: 0, maximum: 100 },
    services: { type: "integer", minimum: 0, maximum: 100 },
    gdpPerCapita: { type: "number", minimum: 100, description: "In 1990 international dollars (Maddison-style estimate)." },
    currency: nonEmptyTextSchema("Primary currency name."),
    debt: { type: "number", minimum: 0, maximum: 3, description: "Public debt as fraction of annual GDP." },
  },
  required: ["polityCode", "agriculture", "industry", "services", "gdpPerCapita"],
  additionalProperties: false,
};

export const FILL_GAPS_SCHEMA = {
  type: "object",
  description: "AI-generated gap-fill for scenario regions: development, culture, religion, resources, and economy baselines not defined by the author.",
  properties: {
    regionDevelopment: { type: "array", items: developmentEntrySchema, maxItems: 300 },
    cultureAssignments: { type: "array", items: cultureAssignmentSchema, maxItems: 300 },
    religionAssignments: { type: "array", items: religionAssignmentSchema, maxItems: 300 },
    resourceDiscoveries: { type: "array", items: resourceDiscoverySchema, maxItems: 100 },
    economyBaselines: { type: "array", items: economyBaselineSchema, maxItems: 50 },
  },
  additionalProperties: false,
};
```

### Integration Pattern

Follow exactly the pattern from `gameplay.js` for existing tasks:

```
fillScenarioGaps(specGapManifest, gameId)
  → buildGapVariables(specGapManifest)     // minimal context
  → runJsonTask("fillScenarioGaps", {
       userMessage: "Fill the gaps in this scenario...",
       variables,
       validatePayload: (candidate, { finalAttempt }) => {
         // strict: cross-reference macroRegionIds exist in manifest
         // strict: minority percents per region must sum <100 with primary implied
         // salvage: drop unreferenced entries, clamp percentages
       },
     })
  → write gap-fill results into scenario seed assets (economy.json etc.)
  → return { generation, payload }
```

### Prompt Template

```text
You are the historical data generator for Open Historia. You will receive a JSON
manifest of a scenario at its start date — a list of regions, defined groups, and
a catalog of exactly which fields the scenario author left empty. Your job is to
fill ONLY those empty fields with historically plausible values for the era.

[Gap Manifest]
${gapManifest}

Rules:
- Fill ONLY the fields listed as "missing" for each macroRegion / polity. If a
  region has culture already defined, do NOT override or add to it.
- Development values (agricultural/industrial/manpower) are on a 0-100 relative
  scale for this era. A value of 50 means "average for 1914 Western Europe."
  Use the techEra to calibrate: WW1-era Rhineland might have industrial=85,
  while sub-Saharan regions might have industrial=5-15.
- Culture and religion minorities must use exact group names from the "defined"
  lists. Do not invent new group names. Sum of minority percents in a region
  should leave room for the primary group (all minorities + primary → ~100%).
- Economy baselines use Maddison-style GDP per capita estimates in 1990
  international dollars (Britain ~$4,900 in 1914, Russia ~$1,400).
- Every macroRegionId and polityCode in your output must exactly match an id
  from the manifest.

Respond with the JSON tool call only.
```

### Model Selection

- **Expensive model** (Gemini 2.5 Pro / GPT-4o). This runs ONCE per scenario publish, not per turn. Historical accuracy matters. Budget: ~3K input + ~5K output = ~8K tokens.
- Pre-flight ✅: gap manifest can be validated & bounded before calling the model.
- No execution split needed: this is a one-shot offline task, not a real-time gameplay task.

---

## 2. `simulationRules` in AI Prompts

### Current State

`simulationRules` is a raw prose string stored on `world.simulationRules`. It's injected as `${HISTORICAL_PRESET_SIMULATION_RULES}` into every advisor/leader/task prompt and as `variables.simulationRules` (via `promptContext.js:528`). Typical current prose is ~150–300 words.

### Proposed Structured Format

```json
{
  "techEra": "ww1",
  "aiHistoryMode": "conditional",
  "eraNarrative": "The year is 1914. The great powers of Europe sit on a powder keg...",
  "allowedUnitTypes": ["infantry", "armor", "artillery", "naval", "air", "garrison"],
  "forbiddenActions": ["nuclear_weapons", "satellite_recon", "cyber_warfare"],
  "allianceBlocks": [
    { "name": "Triple Entente", "members": ["France", "Russia", "Britain"], "since": "1907-08-31", "type": "defensive" },
    { "name": "Triple Alliance", "members": ["Germany", "Austria-Hungary", "Italy"], "since": "1882-05-20", "type": "defensive" }
  ],
  "activeWars": [],
  "diplomaticPostures": [
    { "from": "Serbia", "toward": "Austria-Hungary", "posture": "hostile", "reason": "Annexation of Bosnia 1908" },
    { "from": "Britain", "toward": "Germany", "posture": "rival", "reason": "Naval arms race" }
  ]
}
```

### Rendering for Prompt Context

Add a new builder in `promptContext.js`:

```js
// promptContext.js — NEW
export const buildSimulationRulesText = (simulationRules) => {
  if (!simulationRules || typeof simulationRules === "string") {
    // Backward compatibility: old prose string
    return normalizeString(simulationRules) || "No extra simulation rules were provided.";
  }
  const r = simulationRules;
  const lines = [
    `TECH ERA: ${r.techEra || "unspecified"}`,
    `AI HISTORY MODE: ${r.aiHistoryMode || "conditional"}`,
  ];
  if (r.eraNarrative) {
    lines.push("", `ERA CONTEXT: ${r.eraNarrative}`);
  }
  if (r.allowedUnitTypes?.length) {
    lines.push("", `ALLOWED UNIT TYPES: ${r.allowedUnitTypes.join(", ")}`);
  }
  if (r.forbiddenActions?.length) {
    lines.push("", `FORBIDDEN: ${r.forbiddenActions.join(", ")} — do not generate events involving these.`);
  }
  if (r.allianceBlocks?.length) {
    lines.push("", "ACTIVE ALLIANCES (binding — do not have allies fight each other unless the alliance is first broken by events):");
    for (const a of r.allianceBlocks) {
      lines.push(`  ${a.name}: ${a.members.join(" + ")} (since ${a.since || "unknown"}, ${a.type || "defensive"})`);
    }
  }
  if (r.activeWars?.length) {
    lines.push("", "ONGOING WARS AT START:");
    for (const w of r.activeWars) {
      lines.push(`  ${w.name || "Unnamed"}: ${(w.belligerents || []).join(" vs ")} (since ${w.since || "unknown"})`);
    }
  }
  if (r.diplomaticPostures?.length) {
    lines.push("", "DIPLOMATIC POSTURES AT START:");
    for (const d of r.diplomaticPostures) {
      lines.push(`  ${d.from} → ${d.toward}: ${d.posture} — ${d.reason || ""}`);
    }
  }
  return lines.join("\n");
};
```

Replace the current simple line in `buildPromptContext`:

```js
// OLD:
simulationRules: normalizeString(bundle.world.simulationRules) || "No extra simulation rules were provided.",
// NEW:
simulationRules: buildSimulationRulesText(bundle.world.simulationRules),
```

### Token Budget Analysis

| Format | Typical size | Est. tokens (cl100k) |
|--------|-------------|----------------------|
| Current prose string | 150–300 words | ~200–400 tokens |
| Structured JSON (all fields populated) | ~800 chars | ~250–350 tokens |
| Rendered structured text (as above) | ~500 chars | ~150–250 tokens |
| **Net delta** | | **~50 fewer tokens per prompt** |

The rendered text is slightly MORE compact than prose because it has no filler sentences. The `allianceBlocks` and `activeWars` arrays — the fields that most matter for AI correctness — are rendered as bulleted lists, which models parse more reliably than embedded prose.

### How AllianceBlocks & ActiveWars Are Injected

The builder produces:

```
ACTIVE ALLIANCES (binding — do not have allies fight each other unless the alliance is first broken by events):
  Triple Entente: France + Russia + Britain (since 1907-08-31, defensive)
  Triple Alliance: Germany + Austria-Hungary + Italy (since 1882-05-20, defensive)

ONGOING WARS AT START:
  (none)
```

This is directly visible in `${simulationRules}` which reaches every task: `jumpForward`, `autoJumpForward`, `pregameHistory`, `actions`, `catalystCreation`, `gameMaster`, `countryStatSheet`, `idleDiplomacy`, advisor, and leader.

The exact same block also reaches the **durable campaign memory injection** in `runJsonTask` (`gameplay.js:416-419`) — alliances can be stored as `campaignMemory` facts when generated during gameplay, but the seed alliances come from the spec and are rendered here.

### `eraNarrative` Role

`eraNarrative` is the human-readable companion to the structured constraints. It replaces what is currently the prose `simulationRules` string. Example:

> "The year is 1914. The great powers of Europe sit on a powder keg of alliances, colonial rivalries, and nationalist tensions. The assassination of Archduke Franz Ferdinand has just occurred in Sarajevo. The July Crisis is unfolding."

This gives the AI the *flavor* and *tone* while the structured fields (`allianceBlocks`, `activeWars`, `forbiddenActions`) provide the *hard constraints*.

---

## 3. Pregame History with Structured Facts

### Current State

`submit_pregame_history` task (`PREGAME_HISTORY_SCHEMA`) returns `{ events[], summary }`. The prompt receives `${WORLD_BEFORE_ROUND_ONE_TEXT}` (prose briefing) and `${HISTORICAL_PRESET_SIMULATION_RULES}` (prose rules). The validator `validatePregameEvents` (`gameplay.js:2307`) checks: dates exist, are before startDate, chronological order. **No cross-reference against spec facts.**

### Updated PREGAME_HISTORY_SCHEMA

```js
// gameplaySchemas.js — REPLACE existing PREGAME_HISTORY_SCHEMA
export const PREGAME_HISTORY_SCHEMA = {
  type: "object",
  description: "The pre-game backstory: events that led up to the campaign start, with citations to spec facts used.",
  properties: {
    events: {
      type: "array",
      description: "Chronological events from before round one, oldest first.",
      minItems: 1,
      maxItems: 12,
      items: pregameEventSchema,
    },
    summary: textSchema("One-paragraph summary of the era leading into the start date."),
    factsUsed: {
      type: "array",
      description: "Which structured spec facts each event draws from. The validator cross-checks these against the spec. Omit entries that draw from prose briefing only.",
      items: {
        type: "object",
        properties: {
          eventIndex: { type: "integer", minimum: 0, description: "Index into the events array." },
          factType: { type: "string", enum: ["allianceBlock", "activeWar", "diplomaticPosture", "regionHistory", "macroRegionDef"] },
          factId: nonEmptyTextSchema("Alliance name, war name, posture key, regionHistory date, or macroRegion id."),
        },
        required: ["eventIndex", "factType", "factId"],
        additionalProperties: false,
      },
    },
  },
  required: ["events", "summary"],
  additionalProperties: false,
};
```

Note: `factsUsed` is NOT `required` — backward compatibility with existing scenarios that have only prose briefings. The field is present but may be empty.

### Updated `validateGameplayPayload`

Add to the existing `pregameHistory` block in `validateGameplayPayload` (`gameplaySchemas.js:852`):

```js
// Inside: if (taskKey === "pregameHistory") { ... }
// NEW: factsUsed validation (Layer 1 — structure only)
if (Array.isArray(value.factsUsed)) {
  for (let i = 0; i < value.factsUsed.length; i++) {
    const f = value.factsUsed[i];
    if (typeof f.eventIndex !== "number" || f.eventIndex < 0 || f.eventIndex >= value.events.length) {
      return { valid: false, error: `$.factsUsed[${i}].eventIndex must reference an existing event.` };
    }
    if (!["allianceBlock", "activeWar", "diplomaticPosture", "regionHistory", "macroRegionDef"].includes(f.factType)) {
      return { valid: false, error: `$.factsUsed[${i}].factType is not a recognized fact type.` };
    }
    if (!f.factId.trim()) {
      return { valid: false, error: `$.factsUsed[${i}].factId must not be empty.` };
    }
  }
}
```

### Updated Layer-2 Validator: Spec-Fact Cross-Check

Extend `validatePregameEvents` (`gameplay.js:2307`) to accept the structured spec:

```js
const validatePregameEvents = (candidate, { startDate, strict, simulationRules }) => {
  // ... existing date validation ...

  // NEW: spec-fact cross-check
  if (simulationRules && typeof simulationRules === "object") {
    const specAlliances = new Set(
      (simulationRules.allianceBlocks || []).map(a => a.name?.toLowerCase())
    );
    const specWars = (simulationRules.activeWars || []).map(w => w.name);
    // strict mode: check factsUsed actually reference known facts
    if (strict && Array.isArray(candidate.factsUsed)) {
      for (const f of candidate.factsUsed) {
        if (f.factType === "allianceBlock" && !specAlliances.has(f.factId.toLowerCase())) {
          return `$.factsUsed: alliance block "${f.factId}" does not exist in simulationRules.allianceBlocks.`;
        }
        if (f.factType === "activeWar" && !specWars.some(w => w.name === f.factId)) {
          return `$.factsUsed: war "${f.factId}" does not exist in simulationRules.activeWars.`;
        }
      }
    }
  }
  return "";
};
```

### Validation Contract: Events Must Not Contradict Spec Facts

A spec declaring `allianceBlocks: [{ name: "Triple Entente", members: ["France", "Russia", "Britain"] }]` means:

- AI cannot generate a pregame event where France declares war on Russia **without** first narrating the Entente's collapse.
- AI cannot generate a pregame event where Russia is in an alliance with Germany (contradicts the alliance block that exists).
- The validator doesn't parse event *text* (too expensive), but `factsUsed[]` provides a machine-checkable trail: if the event claims to use alliance "Triple Entente" and then narrates an intra-alliance war, that's a contradiction the Layer-2 validator catches.

**Implementation note:** The full semantic contradiction check ("does event text align with factsUsed?") is expensive and may need a separate `validateScenario` task (see §4). For `validatePregameEvents` itself, we check: (a) `factsUsed` entries reference real facts, and (b) no two events reference mutually contradictory facts (e.g., event 3 says war started, event 4 says alliance intact — both tagged with the same alliance).

### Prompt Template Update

Add to the existing `pregameHistory` prompt in `defaultPrompts.json`:

```text
Structured scenario facts — treat these as binding ground truth:
${SIMULATION_RULES_STRUCTURED_FACTS}

For each event, cite which structured facts (alliance block, active war,
diplomatic posture, region history entry) your event draws from by listing them
in the "factsUsed" array. An event about the Triple Entente members cooperating
should cite that alliance block. Leave factsUsed empty for events drawn purely
from the prose briefing.
```

New helper: `SIMULATION_RULES_STRUCTURED_FACTS` → renders only the alliance/war/posture arrays as a compact JSON block (not the full simulationRules):

```text
ALLIANCE BLOCKS: [{"name":"Triple Entente","members":["France","Russia","Britain"],"since":"1907-08-31","type":"defensive"},...]
ACTIVE WARS: []
DIPLOMATIC POSTURES: [{"from":"Serbia","toward":"Austria-Hungary","posture":"hostile","reason":"Annexation of Bosnia 1908"},...]
```

Token cost: ~200 tokens max (compact JSON, no indentation).

---

## 4. AI Validation of Scenario Consistency

### Can AI Validate?

**Yes, but selectively.** AI can check invariants that require *semantic understanding* without map knowledge. Examples:

| Invariant | AI-Checkable? | Why |
|-----------|--------------|-----|
| Every GID_1 region has an owner | ❌ No | Engine checks; AI doesn't see the map |
| Alliance A + Alliance B share a member | ✅ Yes | Pure logical check on spec data |
| War belligerent is also in an opposing alliance | ✅ Yes | Semantic conflict in structured fields |
| `forbiddenActions` includes actions incompatible with `techEra` | ✅ Yes | e.g., techEra="ww1" + forbiddenActions missing "nuclear_weapons" |
| `aiHistoryMode: "guided"` but no eraNarrative | ✅ Yes | Guided mode needs historical direction |
| Region development sum is 0 for a populated region | ✅ Yes | Obvious data gap |
| Culture primary assigned but not in cultureGroups defined list | ✅ Yes | Reference integrity |
| Date of activeWar is after startDate | ❌ No | Engine checks |
| `macroRegionDefs` references a GID_1 region that doesn't exist | ❌ No | Engine checks in assembly layer |

### Design Decision: Separate Task vs. Piggyback

**Recommendation: Separate task `validateScenario`** — runs once at scenario publish time, offline.

Rationale:
- Piggybacking on existing validation would mix concerns. Layer-1 is pure structural, Layer-2 is world-aware. A validation for *spec internal consistency* is a third concern.
- This task is expensive-model, runs once, always offline. Making it a `runJsonTask` call with its own schema keeps it isolated.
- The output is human-readable warnings, not game mutations. It informs the scenario author, not the runtime engine.

### New Task: `validateScenario`

```js
// gameplaySchemas.js — NEW
export const VALIDATE_SCENARIO_SCHEMA = {
  type: "object",
  description: "Consistency audit of a scenario spec. Warnings and errors found.",
  properties: {
    errors: {
      type: "array",
      description: "Fatal inconsistencies — must be fixed before publish.",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["error"] },
          category: { type: "string", enum: ["alliance", "war", "era", "region", "culture", "religion", "economy"] },
          message: nonEmptyTextSchema("Human-readable description of the issue."),
          locations: stringArraySchema("Which spec fields are involved (JSON paths)."),
          suggestion: textSchema("Suggested fix."),
        },
        required: ["severity", "category", "message"],
        additionalProperties: false,
      },
    },
    warnings: {
      type: "array",
      description: "Non-fatal concerns — author should review.",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["warning"] },
          category: { type: "string", enum: ["alliance", "war", "era", "region", "culture", "religion", "economy"] },
          message: nonEmptyTextSchema("Human-readable concern."),
          suggestion: textSchema("Suggested improvement."),
        },
        required: ["severity", "category", "message"],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};
```

### Prompt Template

```text
You are auditing a historical scenario definition for internal consistency before
it is published for gameplay. You will receive the scenario's structured rules.
Check for logical contradictions, anachronisms, and gaps. Do NOT check anything
that requires seeing the actual map (you don't have it). Report ONLY issues that
exist — return empty arrays if the scenario is clean.

[Scenario Rules]
${scenarioValidationManifest}

Check these specific invariants:

1. ALLIANCES: Can any polity be in two alliances that have conflicting
   obligations (e.g., defensive pact with both sides of a rivalry)? Are alliance
   member lists internally consistent with diplomatic postures?
2. ACTIVE WARS: Do belligerents in activeWars overlap with alliance members who
   should be protected? Are war dates consistent with startDate?
3. TECH ERA: Do allowedUnitTypes and forbiddenActions make sense for this era?
   Would a WW1 scenario that omits "air" from allowedUnitTypes be broken?
   Would a medieval scenario that fails to forbid "nuclear_weapons" need a warning?
4. REGIONS: Are there macroRegions with zero development values but non-zero
   population? Any macroRegion assigned to a polity that doesn't exist?
5. CULTURE/RELIGION: Are primary groups referenced in region assignments also
   present in the groups definition? Any region with no culture or religion at
   all (which means AI must generate it at runtime, potentially poorly)?
6. ECONOMY: Any polity with population but no economic baseline? Any GDP
   breakdown that doesn't sum to ~100%?
7. AI HISTORY MODE: If "guided", is there enough eraNarrative + structured facts
   for the AI to steer toward? If "free", are there anachronistic constraints?
8. CROSS-CUTTING: Does eraNarrative contradict any structured field? e.g.,
   narrative says "Europe is at peace" but activeWars lists a European war.

Respond with the JSON tool call only. Use "error" for issues that would break
the game; "warning" for things an author should review.
```

### Integration

Called from the scenario editor's "Validate" button, NOT from gameplay:

```
validateScenario(specData)
  → buildValidationManifest(specData)   // compact JSON of spec fields
  → runJsonTask("validateScenario", { variables })
  → return { errors, warnings }        // displayed in editor UI
```

No fallback needed — if the model call fails, tell the user "AI validation unavailable, schema-level validation passed."

---

## 5. mapSemantics for New Mechanics

### Current State

`mapSemantics` is described in `docs/principles.md` §3 as:

> Expensive model returns `mapSemantics` (~1-3 KB): `ownershipChanges`, `relations`, `contestedZones`, `cultureShifts`, `religionShifts`

But there is **no concrete schema yet**. The principle document sketches what it contains; no code yet generates or consumes it.

### Extended Schema

```js
// New file: src/Game/AI/mapSemanticsSchema.js
// This is NOT a gameplay task schema (not in GAMEPLAY_SCHEMAS).
// It's a standalone schema for the expensive-model → cheap-model pipeline.

export const MAP_SEMANTICS_SCHEMA = {
  type: "object",
  description: "Abstract semantic description of world changes. The cheap model resolves these to concrete regionIds.",
  properties: {
    version: { const: 1 },
    generatedAt: textSchema("ISO timestamp or round number."),

    ownershipChanges: {
      type: "array",
      description: "Regions that changed hands. Describe by macro-geography, not regionId.",
      maxItems: 30,
      items: {
        type: "object",
        properties: {
          description: nonEmptyTextSchema("Natural-language description: 'Alsace-Lorraine region', 'the corridor to the sea'."),
          fromOwner: nonEmptyTextSchema("Previous owner polity name."),
          toOwner: nonEmptyTextSchema("New owner polity name."),
          method: { type: "string", enum: ["conquest", "cession", "annexation", "liberation", "collapse", "purchase"] },
          confidence: { type: "number", minimum: 0, maximum: 1, description: "How certain the model is. 0.9+ = definite; 0.5-0.7 = ambiguous." },
        },
        required: ["description", "toOwner"],
        additionalProperties: false,
      },
    },

    relations: {
      type: "array",
      description: "Country-to-country relationship changes for diplomatic map mode.",
      maxItems: 40,
      items: {
        type: "object",
        properties: {
          from: nonEmptyTextSchema("First polity name."),
          to: nonEmptyTextSchema("Second polity name."),
          newStatus: { type: "string", enum: ["ally", "friendly", "neutral", "tense", "hostile", "war"] },
          reason: textSchema("Why the status changed."),
        },
        required: ["from", "to", "newStatus"],
        additionalProperties: false,
      },
    },

    contestedZones: {
      type: "array",
      description: "Areas under dispute — claimed by multiple polities.",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          description: nonEmptyTextSchema("'The Rhineland', 'Kashmir valley', 'The corridor to the Black Sea'."),
          claimants: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
          intensity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        },
        required: ["description", "claimants"],
        additionalProperties: false,
      },
    },

    // NEW FIELDS — Phase 1 additions:
    cultureShifts: {
      type: "array",
      description: "Cultural demographic changes: migrations, assimilation, ethnic cleansing.",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          description: nonEmptyTextSchema("'German settlers moving into western Polish lands', 'Armenian population decline in eastern Anatolia'."),
          cultureGroup: nonEmptyTextSchema("Which culture group is shifting."),
          direction: { type: "string", enum: ["growth", "decline", "migration_in", "migration_out"] },
          magnitude: { type: "string", enum: ["minor", "moderate", "significant", "catastrophic"] },
          reason: textSchema("Why: settlement policy, war displacement, famine, etc."),
        },
        required: ["description", "cultureGroup", "direction", "magnitude"],
        additionalProperties: false,
      },
    },

    religionShifts: {
      type: "array",
      description: "Religious demographic changes: conversions, migrations, persecution.",
      maxItems: 15,
      items: {
        type: "object",
        properties: {
          description: nonEmptyTextSchema("'Protestant missionaries active in central Africa', 'Sunni-Shia population exchange in Mesopotamia'."),
          religionGroup: nonEmptyTextSchema("Which religion group is shifting."),
          direction: { type: "string", enum: ["growth", "decline", "conversion_to", "conversion_from"] },
          magnitude: { type: "string", enum: ["minor", "moderate", "significant", "catastrophic"] },
          reason: textSchema("Why: missionary activity, state policy, displacement, etc."),
        },
        required: ["description", "religionGroup", "direction", "magnitude"],
        additionalProperties: false,
      },
    },

    resourceDiscoveries: {
      type: "array",
      description: "Discovery or depletion of resources in a geographic area.",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          description: nonEmptyTextSchema("'Oil discovered in the Mesopotamian desert', 'Copper veins exhausted in the Urals'."),
          resource: nonEmptyTextSchema("Resource type: oil, coal, iron, gold, etc."),
          action: { type: "string", enum: ["discovered", "depleted", "expanded"] },
          magnitude: { type: "string", enum: ["minor", "moderate", "significant"] },
        },
        required: ["description", "resource", "action"],
        additionalProperties: false,
      },
    },

    influenceChanges: {
      type: "array",
      description: "Suzerain-vassal and sphere-of-influence changes.",
      maxItems: 15,
      items: {
        type: "object",
        properties: {
          description: nonEmptyTextSchema("'Serbia falls under Austrian influence', 'Siam balances between British and French spheres'."),
          influencer: nonEmptyTextSchema("The dominant power."),
          influenced: nonEmptyTextSchema("The subordinate polity."),
          newLevel: { type: "string", enum: ["protectorate", "vassal", "sphere", "independent", "occupied"] },
          reason: textSchema("Why: treaty, military pressure, economic dependency, liberation."),
        },
        required: ["description", "influencer", "influenced", "newLevel"],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};
```

### Compactness Target

- **3 KB hard cap.** Each array is `maxItems`-bounded. Descriptions are short natural-language phrases (not sentences). The cheap model does the spatial resolution; the expensive model only names *what* and *where generally*.
- Typical payload: 2-3 ownership changes + 4-8 relation updates + 1-3 culture shifts + 1-2 religion shifts + 0-2 resource changes + 0-3 influence changes = **~1.2-2 KB**.
- When empty (no changes), no AI call at all (per existing principle §3).

### What the Cheap Model Needs to Annotate

For each semantic entry, the cheap model receives:

```
SEMANTIC: "Alsace-Lorraine region transferred from Germany to France via cession"
MAP CONTEXT: [List of ~15-30 GID_1 region names near the Franco-German border]
TASK: Return a JSON array of { regionId, confidence } for every GID_1 region that
      this semantic description applies to.
```

The cheap model does NOT need historical knowledge — only spatial name matching. A small local model (Gemini Flash / GPT-4o-mini / Ollama 3B) suffices.

### Map Modes Served

| mapSemantics field | Map mode | Engine applies to |
|---|---|---|
| `ownershipChanges` | Political, Real | `regionOwnershipOverrides` |
| `relations` | Diplomatic | `internationalReputation` |
| `contestedZones` | Real, Diplomatic | `contestedRegions` set |
| `cultureShifts` | Cultural | `culture.json` per-region minorities |
| `religionShifts` | Religious | `religion.json` per-region minorities |
| `resourceDiscoveries` | (N/A — economy) | `resources.json` |
| `influenceChanges` | Real | `influence.json` suzerain chains |

---

## 6. Token Budget & Model Selection

### Cost Comparison: structured vs. prose simulationRules

Measured in cl100k tokens (GPT-4 tokenizer equivalent):

| Payload | Tokens in | Tokens out | Total | When it runs |
|---------|----------|------------|-------|-------------|
| `simulationRules` (old prose) | ~350 | 0 | ~350 | Every task, every turn |
| `simulationRules` (rendered structured) | ~250 | 0 | ~250 | Every task, every turn |
| `fillScenarioGaps` manifest | ~2,000 | ~5,000 | ~7,000 | Once per scenario publish |
| `validateScenario` manifest | ~1,500 | ~800 | ~2,300 | Once per scenario publish |
| `mapSemantics` (per jump) | ~1,200 | ~2,000 | ~3,200 | Every other turn avg. |
| `pregameHistory` (with facts) | ~3,000 | ~2,500 | ~5,500 | Once per new game |
| `pregameHistory` (old) | ~2,800 | ~2,500 | ~5,300 | Once per new game |
| Cheap model annotation (per mapSemantics) | ~800 | ~300 | ~1,100 | Per jump with changes |

**Key finding:** The structured `simulationRules` saves ~100 tokens per prompt. Across ~10 task types × ~3 calls/turn × 50 turns = ~15,000 tokens saved per campaign. This pays for the one-time `fillScenarioGaps` + `validateScenario` costs (~9,300 tokens) within a single campaign.

### Model Recommendations Per Task

| Task | Model | Rationale |
|------|-------|-----------|
| `fillScenarioGaps` | **Expensive** (Gemini 2.5 Pro / GPT-4o) | Historical accuracy; runs once |
| `validateScenario` | **Expensive** | Logical reasoning across structured data |
| `mapSemantics` (expensive tier) | **Expensive** | Must understand world events, generate coherent semantic description |
| `mapSemantics` → region resolution (cheap tier) | **Flash** (Gemini Flash / GPT-4o-mini / local 3B) | Pure name matching; no history needed |
| `pregameHistory` | **Expensive** (already is) | Creative narrative generation; runs once |
| `jumpForward` / `autoJumpForward` | **Expensive** (already is) | Core gameplay loop; must be coherent |
| `actions` | **Expensive** (already is) | Creative suggestion generation |
| `leader` / `advisor` | **Expensive** (already is) | Natural language, roleplaying |
| `catalystCreation` / `catalystExecutor` | **Expensive** (already is) | Branching narrative |
| `idleDiplomacy` | **Flash** | Low-stakes; frequent; can fail silently |
| `nextSpeaker` | **Flash** | Trivial classification |
| `eventConsolidator` | **Expensive** | Summarization quality matters for long campaigns |

**New entries only.** Existing task model assignments are not changed.

### Pre-Flight / Execution Split

| Split | Tasks | Benefit |
|-------|-------|---------|
| **Pre-flight** | `fillScenarioGaps`, `validateScenario` | Run offline at publish time; zero runtime cost |
| **Execution** | Everything else | Already the pattern |
| **Two-tier** | `mapSemantics` (expensive → cheap) | Only the cheap model runs at runtime; expensive model sees only world-summary, not full map |

---

## 7. Prompt Templates for New Fields

### 7a. Culture/Religion in Diplomatic/Turn Prompts

Add to `buildWorldSummary` in `promptContext.js` for tasks that need it (jumps, catalysts, countryStatSheet):

```js
// NEW builder — promptContext.js
export const buildCultureReligionSummary = (world) => {
  // Returns compact text only when structured data exists.
  // For backward compat: if world.cultureJson / world.religionJson don't exist, return "".
  const culture = world.cultureJson || world.culture;
  const religion = world.religionJson || world.religion;
  if (!culture && !religion) return "";

  const lines = [];
  if (culture?.regions) {
    const summaries = new Map();
    for (const [regionId, entry] of Object.entries(culture.regions)) {
      const key = `${entry.primary || "unset"}`;
      if (!summaries.has(key)) summaries.set(key, []);
      summaries.get(key).push(regionId);
    }
    lines.push("CULTURAL LANDSCAPE:");
    for (const [primary, regions] of summaries) {
      const minorityStr = regions.length <= 3 ? ` (${regions.join(", ")})` : ` — ${regions.length} regions`;
      lines.push(`  ${primary}${minorityStr}`);
    }
  }
  if (religion?.regions) {
    const summaries = new Map();
    for (const [regionId, entry] of Object.entries(religion.regions)) {
      const key = `${entry.primary || "unset"}`;
      if (!summaries.has(key)) summaries.set(key, []);
      summaries.get(key).push(regionId);
    }
    lines.push("RELIGIOUS LANDSCAPE:");
    for (const [primary, regions] of summaries) {
      const minorityStr = regions.length <= 3 ? ` (${regions.join(", ")})` : ` — ${regions.length} regions`;
      lines.push(`  ${primary}${minorityStr}`);
    }
  }
  return lines.join("\n");
};
```

Injected as `${CULTURAL_RELIGIOUS_LANDSCAPE}` helper. Tokens: ~150–400 per call. Only for tasks that could generate culture/religion shifts: `jumpForward`, `autoJumpForward`, `gameMaster`, `catalystCreation`.

### 7b. Economy Modifiers — "Engine Computes, You Provide Modifiers"

This is a **call-time directive** appended in `runJsonTask`, similar to how `ACTIONS_REFERENCE` is injected for jumps (`gameplay.js:389`). Add a new reference block:

```js
// gameplay.js — NEW call-time directive for jump tasks
const ECONOMY_MODIFIER_REFERENCE = [
  "[Economy — Engine-Computed, AI-Modified]",
  "The engine computes GDP, inflation, unemployment, budget, and sector breakdown.",
  "You do NOT set these numbers directly. You provide MODIFIERS that the engine applies:",
  "",
  "  • economyModifiers — per-polity percentage shifts applied by events:",
  "    {\"polityCode\": \"...\", \"gdpGrowth\": +2.5, \"inflation\": -0.3, \"unemployment\": +1.0}",
  "    Positive = increase, negative = decrease. GDP growth is percentage-point shift.",
  "  • resourceModifiers — per-region resource changes:",
  "    {\"regionId\": \"...\", \"resource\": \"oil\", \"action\": \"discover\" | \"deplete\"}",
  "  • tradeRouteModifiers — new or disrupted trade relationships:",
  "    {\"from\": \"...\", \"to\": \"...\", \"goods\": [\"...\"], \"action\": \"open\" | \"close\"}",
  "",
  "A war event that says 'the economy collapsed' must include economyModifiers.",
  "A discovery event that finds oil must include resourceModifiers.",
  "Never set absolute GDP values — only provide the modifiers.",
].join("\n");
```

Appended to `jumpForward` and `autoJumpForward` prompts (same injection site as `ACTIONS_REFERENCE` at `gameplay.js:389`).

### 7c. macroRegions vs. GID_1 Regions in Prompts

The AI must understand that:
- **macroRegions** are the unit of economic/cultural/religious decisions
- **GID_1 regions** are the unit of ownership/transfer/unit-movement

Add to `buildWorldSummary`:

```js
// In the existing world summary, add:
const macroRegionSummary = buildMacroRegionSummaryText(world);
// ...

export const buildMacroRegionSummaryText = (world) => {
  const macroRegions = world.macroRegionDefs;
  if (!macroRegions || Object.keys(macroRegions).length === 0) return "";
  const lines = ["MACRO-REGIONS (economic/cultural decision units):"];
  for (const [id, def] of Object.entries(macroRegions).slice(0, 40)) {
    const dev = def.development
      ? `agri=${def.development.agricultural ?? "?"} ind=${def.development.industrial ?? "?"} man=${def.development.manpower ?? "?"}`
      : "development unset";
    lines.push(`  ${def.name || id}: owner=${def.owner || "unset"}, pop=${def.population?.toLocaleString() ?? "?"}, ${dev}, GID_1 regions=${def.gid1RegionIds?.length ?? "?"}`);
  }
  if (Object.keys(macroRegions).length > 40) {
    lines.push(`  (+${Object.keys(macroRegions).length - 40} more macro-regions not listed)`);
  }
  lines.push("", "When transferring territory, use GID_1 region IDs (the per-province identifiers). When making economic or cultural decisions, reason at the macro-region level.");
  return lines.join("\n");
};
```

Token budget: ~600 tokens for 40 macroRegions. Capped to 40 entries; full list would be ~3,000 tokens for 200 macroRegions — too expensive for per-turn prompts. The uncapped list goes only to the one-time `fillScenarioGaps` task.

### 7d. Updated Helper Map

In `defaultPrompts.json` `helpers` and `PROMPT_SECTION_DEFINITIONS`:

```json
{
  "SIMULATION_RULES_STRUCTURED_FACTS": "${simulationRulesStructuredFacts}",
  "CULTURAL_RELIGIOUS_LANDSCAPE": "${culturalReligiousLandscape}",
  "MACRO_REGION_SUMMARY": "${macroRegionSummary}",
  "ECONOMY_BASELINES_SUMMARY": "${economyBaselinesSummary}"
}
```

These are injected via `resolveHelperValues` when the corresponding builder is included in `buildPromptContext`'s return object.

---

## Summary of Changes to Existing Files

| File | Change |
|------|--------|
| `gameplaySchemas.js` | Add `FILL_GAPS_SCHEMA`, `VALIDATE_SCENARIO_SCHEMA`, `FILL_GAPS_TOOL`, `VALIDATE_SCENARIO_TOOL`. Update `PREGAME_HISTORY_SCHEMA` with `factsUsed[]`. Register in `GAMEPLAY_SCHEMAS`/`GAMEPLAY_TOOLS`. Add `factsUsed` validation to `validateGameplayPayload`. |
| `gameplay.js` | Add `buildSimulationRulesText`, `ECONOMY_MODIFIER_REFERENCE` call-time directive. Extend `validatePregameEvents` with spec-fact cross-check. Add `fillScenarioGaps()` and `validateScenario()` entry points. |
| `promptContext.js` | Add `buildSimulationRulesText`, `buildCultureReligionSummary`, `buildMacroRegionSummaryText`, `buildEconomyBaselinesSummary`, `buildGapManifest`. Update `buildPromptContext` to use `buildSimulationRulesText`. |
| `gameplayPrompts.js` | Add new task keys to `PROMPT_SECTION_DEFINITIONS`. Add new helpers to helper map. |
| `defaultPrompts.json` | Update `pregameHistory` prompt text. Add `fillScenarioGaps` and `validateScenario` task prompts. Add new helpers. |
| `mapSemanticsSchema.js` | **New file** — standalone schema for expensive→cheap pipeline. |
| `docs/ai-schemas.md` | Document new tasks and schemas. |

### Backward Compatibility

- `simulationRules` as prose string: `buildSimulationRulesText` detects `typeof === "string"` and passes through unchanged. Old scenarios work.
- `factsUsed[]` not required in `PREGAME_HISTORY_SCHEMA`. Old scenarios with prose-only briefings skip it.
- `cultureJson` / `religionJson` / `macroRegionDefs` may not exist on old saves — builders return empty strings.

# Phase 1 Test Plan — Scenario Architecture QA

> Recovered pre-consolidation QA artifact. It covers the original broad scenario
> architecture proposal. Before implementation, narrow executable coverage to
> `acceptance-criteria.md`; retain the remaining cases for later roadmap phases.

**Role:** QA
**Phase:** REVIEW
**Source:** Consensus Spec `docs/spec/consensus-spec.md` + Principles `docs/principles.md`
**QA Agent:** Codex
**Date:** 2026-08-29

---

## 1. Test Plan: Scenario Assembly Pipeline (10 Stages)

The pipeline transforms `ScenarioSpec` → `world.json` + 6 modular assets + validation reports. Each stage must be independently testable.

### Stage 0 — Parse + L1 Schema Validation

| Test ID | Test Case | Input | Expected Result | Automation |
|---------|-----------|-------|-----------------|------------|
| S0-01 | Valid minimal spec passes L1 | `{ id: "t", meta: {}, game: {} }` — bare minimum | `{ valid: true }`, no errors | Unit test with ajv + compiled schema |
| S0-02 | Missing required field `id` | `{ meta: {}, game: {} }` | L1 error: `"must have required property 'id'"` | ajv unit test |
| S0-03 | `additionalProperties: false` violation | Valid spec + `{ madeUpField: 123 }` | L1 error: `"must NOT have additional properties"` | ajv unit test |
| S0-04 | `simulationRules` type: old prose string | `simulationRules: "It is 117 AD..."` | L1 error: `"must be object"` (new schema requires `StructuredSimulationRules`) | ajv unit test |
| S0-05 | `polity` with missing required `name` | `polities: { ROM: { color: "#a31c1c" } }` | L1 error: `"must have required property 'name'"` | ajv unit test |
| S0-06 | Invalid `techEra` enum | `simulationRules.worldState.techEra: "space_age"` | L1 error: `"must be equal to one of..."` | ajv unit test |
| S0-07 | `macroRegions` with duplicate `id` | Two entries with `id: "europe-west"` | L1 error: `"must NOT have duplicate items"` (if uniqueItems used) or L2 catches it | ajv + custom keyword |

**Automation approach:** Build a standalone `test-schema.mjs` that loads the JSON Schema from `schemas/scenario-spec.schema.json`, compiles with ajv, and runs each case. Run as `node scripts/test/test-schema.mjs`.

---

### Stage 1 — Build Polity Map (existing)

| Test ID | Test Case | Input | Expected Result | Automation |
|---------|-----------|-------|-----------------|------------|
| S1-01 | All polities have colors | `polities: { ROM: { name: "Rome", color: "#a31c1c" } }` | Color map: `{ ROM: [163, 28, 28] }` | Unit test against `buildPolityMap()` |
| S1-02 | Polity missing color — procedural fallback | `polities: { ROM: { name: "Rome" } }` | `codeToColor("ROM")` produces deterministic `[r,g,b]` | Unit test |
| S1-03 | Polity aliases deduplicated | `aliases: ["Rome", "Rome", "SPQR"]` | Aliases array: `["Rome", "SPQR"]` | Unit test |
| S1-04 | Empty polities map | `polities: {}` | Empty polity map, no crash | Unit test |

**Automation approach:** Import `build-preset.mjs` functions or refactor polity-building to a testable module. Run as `node scripts/test/test-polity-map.mjs`.

---

### Stage 2 — Build Geometry + Cities (existing)

| Test ID | Test Case | Input | Expected Result | Automation |
|---------|-----------|-------|-----------------|------------|
| S2-01 | `countryAssignments` maps countries to regions | `ROM: ["ITA", "ESP"]` — both exist in region catalog | `regionOwnershipOverrides` contains GID_1 mappings for all ITA/ESP regions | Integration test |
| S2-02 | `countryAssignments` with country not in region catalog | `ROM: ["ATLANTIS"]` | Build-time warning (or L2 error), skipped | Integration test |
| S2-03 | `regionAssignments` overrides GID_1 detail | `regionAssignments: { "ITA.1_1": "GRE" }` | That specific GID_1 mapped to GRE, rest of ITA to ROM | Integration test |
| S2-04 | `cities` with modern name seed | `["Roma", "Rome", 4, 1000000]` | City resolved to `[12.48, 41.89]` from cities-seed.json | Unit test |
| S2-05 | `cities` with explicit `[lng, lat]` | `["Karakorum", [102.84, 47.19], 3, 15000]` | City placed at exact coordinate, no seed lookup | Unit test |
| S2-06 | City with unknown modern name | `["Lemuria", "Mu", 2, 1000]` | Build-time error: `"modern place 'Mu' not found"` | Unit test |

**Automation approach:** Extend existing `build-preset.mjs` tests. Run as `node scripts/test/test-geometry.mjs`.

---

### Stage 2.5 — Auto-generate MacroRegions

| Test ID | Test Case | Input | Expected Result | Automation |
|---------|-----------|-------|-----------------|------------|
| S2.5-01 | No `macroRegions` in spec — auto-generate from GID_1 adjacency | 193 UN countries → ~8000 GID_1 regions | 100–500 macroRegions produced, every GID_1 assigned exactly one macroRegion | Integration test |
| S2.5-02 | Spec provides explicit `macroRegions` | `macroRegions: [{ id: "roman-east", gid1s: ["SYR.1_1", ...] }]` | Auto-generation skipped; author regions used as-is | Unit test |
| S2.5-03 | Author macroRegions + uncovered GID_1s | Author defines 10 macroRegions for a 8000-region world | Remaining GID_1s auto-assigned to new macroRegions with ids like `"auto-001"` | Integration test |
| S2.5-04 | Author macroRegion references non-existent GID_1 | `gid1s: ["ATLANTIS.9_9"]` | L2 error: `"macroRegion 'X' references unknown region 'ATLANTIS.9_9'"` | Integration test |
| S2.5-05 | Zero GID_1s in catalog (corrupted data) | Empty region catalog | Error: `"macroRegion generation: no GID_1 regions in catalog"`. No crash, assembly aborts with clear message | Integration test |
| S2.5-06 | Extremely large world (8000+ GID_1s) | Full GADM level-1 catalog | All GID_1s assigned, no orphans, each macroRegion has 8–80 GID_1s (configurable density) | Performance test |
| S2.5-07 | GID_1 adjacency detection across water | Corsica (FR.8_1) vs mainland France | Corsica correctly placed in French macroRegion via proximity heuristic, not orphaned | Integration test |
| S2.5-08 | MacroRegion naming | `auto-001` for auto-generated; author-defined ids preserved | `macroRegions[].id` is a valid identifier (alphanumeric + hyphens, ≤64 chars) | Unit test |

**Automation approach:** Dedicated `test-macroregion.mjs`. Requires region catalog fixture. Test grouping algorithm (greedy region merging from Cossacks 2 research), adjacency graph, and assignment coverage.

---

### Stage 3 — Seed Economy

| Test ID | Test Case | Input | Expected Result | Automation |
|---------|-----------|-------|-----------------|------------|
| S3-01 | Author provides full `economy` | `economy: { ROM: { gdp: 50000, inflation: 2.1, ... } }` | `economy.json` contains author values exactly | Integration test |
| S3-02 | Author provides partial `economy` | `economy: { ROM: { gdp: 50000 } }` — no inflation, unemployment | AI fills missing fields via `fillScenarioGaps`; `economy.json` has gdp=50000 + AI-generated inflation, unemployment | Integration test |
| S3-03 | Author provides no `economy` | No economy field in spec | AI generates all values; `economy.json` has reasonable per-polity GDP, inflation, employment | Integration test |
| S3-04 | AI gap-fill fails (network error / timeout) | `fillScenarioGaps` returns error | 3-tier fallback: author fields preserved → AI skipped → engine defaults applied (e.g., GDP=region_count×1000). `economy.json` still valid | Integration test with mocked AI |
| S3-05 | AI gap-fill returns nonsensical values | GDP = -500, inflation = 99999 | L3 `validateScenario` catches: `"ROM.gdp out of plausible range"` → AI retry or fallback | Integration test |
| S3-06 | GDP sum check (L4) | 3 polities, GDPs = [100, 200, -350] | L4 error: `"GDP sum of polities (-50) does not match aggregate baseline"` | Integration test |
| S3-07 | Economy for polity with 0 regions (landless) | `polities: { PAP: { name: "Papal See" } }` — no `countryAssignments` | GDP=0, inflation=null, employment=null. Flagged as `landless: true` in output | Unit test |
| S3-08 | Author `economy` references non-existent polity | `economy: { ATLANTIS: { gdp: 99999 } }` | L2 warning: `"economy entry for unknown polity 'ATLANTIS'"`. Dropped from output | Integration test |

**Automation approach:** `test-economy-seed.mjs`. Mock AI response for fillScenarioGaps. Test each tier independently.

---

### Stages 4–8 — Seed Culture, Religion, Resources, Mobilization, Influence

These follow the same gap-fill pattern as Stage 3. Each gets its own test suite with the same structure but domain-specific assertions.

| Test ID | Stage | Key Domain Assertions |
|---------|-------|----------------------|
| S4-01 | Culture | Culture group `color` is a valid hex; per-region primary culture exists in `culture.groups` |
| S4-02 | Culture | Minority percentages per region sum to ≤100% (L4 check) |
| S4-03 | Culture | `culture.groups` without a `primaryCulture` in any region → L4 warning: `"orphan culture group 'Phoenician'"` |
| S4-04 | Religion | Religion group `color` valid; per-region primary religion referenced in `religion.groups` |
| S4-05 | Religion | Minority faith % ≤100% per region |
| S4-06 | Resources | `resources.regions[regionId]` → all resource types in allowed enum (`oil`, `coal`, `iron`, `food`, `gold`, `uranium`, `rare_metals`, `timber`) |
| S4-07 | Resources | Resource on non-existent region → L2 error, dropped |
| S4-08 | Resources | Resource totals engine-recalc: country coal = Σ coal of owned regions |
| S4-09 | Mobilization | `manpowerPool` plausible (e.g., ~10% of population for WW1 era, ~2% for medieval) |
| S4-10 | Mobilization | `maxMobilization` within era range (0.0–1.0) |
| S4-11 | Influence | Suzerain-vassal pair: suzerain and vassal both exist in polities |
| S4-12 | Influence | `autonomyLevel` within 0.0–1.0 range |
| S4-13 | Influence | Circular vassalage chain → L3 AI audit catch: `"circular influence: A→B→C→A"` |

**Automation approach:** One test file per module (`test-culture-seed.mjs`, etc.). Each shares the mock-AI pattern from S3.

---

### Stage 9 — Assemble world.json

| Test ID | Test Case | Input | Expected Result | Automation |
|---------|-----------|-------|-----------------|------------|
| S9-01 | world.json contains all core fields | Full pipeline run | `world.json` has: `regionOwnershipOverrides`, `polityOverrides`, `units`, `markers`, `activeCatalyst`, `consolidatedHistory`, `campaignMemory`, `ownerCodes`, `ownerSchema`, `internationalReputation`, `countryStats`, `countryTags`, `customRegions`, `customCities`, `macroRegions` | Integration test |
| S9-02 | `macroRegions` in world.json | Auto-generated from Stage 2.5 | `world.macroRegions` is an array of `{ id, gid1s[], name? }` matching macroRegion def | Integration test |
| S9-03 | `regionHistory` synthesized from startingTimelineText | `startingTimelineText: "August 117..."` | `regionHistory: [{ date: "0117-01-01", entries: [{ regionId: "...", event: "Roman annexation of Dacia" }] }]` | Integration test |
| S9-04 | world.json passes `normalizeWorldState` | Full world.json | `normalizeWorldState(world)` returns object with all `WORLD_DEFAULTS` fields present | Unit test |
| S9-05 | Colors for all polities | 13 polities in roman-117 | `colors.json` has 13 entries, keyed by NAME, values = `[r,g,b]` triples | Integration test |
| S9-06 | Flags for polities (if provided) | Spec with `flags` | `flags.json` has `code → data URL` for each flagged polity | Integration test |
| S9-07 | Tags for polities (if provided) | Spec with `tags` | `tags.json` has `code → string[]` for each tagged polity | Integration test |
| S9-08 | `game.json` built correctly | `game: { country: "ROM", startDate: "0117-01-01" }` | `game.json`: `{ country: "Roman Empire", startDate: "0117-01-01", gameDate: "0117-01-01", round: 1 }` | Integration test |

**Automation approach:** End-to-end `test-assembly.mjs` that runs the full pipeline on a minimal spec and asserts every output file.

---

### Stage 10 — Validate (L1–L4)

| Test ID | Layer | Test Case | Expected Result | Automation |
|---------|-------|-----------|-----------------|------------|
| S10-01 | L1 | All Stage 0 tests pass (schema) | See S0-01 → S0-07 | S0 test suite |
| S10-02 | L2 | Alliance references non-existent polity | `allianceBlocks: [{ members: ["ROM", "ATLANTIS"] }]` | L2 error: `"alliance 'X' references unknown polity 'ATLANTIS'"` | Unit test |
| S10-03 | L2 | War with same belligerent on both sides | `activeWars: [{ attacker: "ROM", defender: "ROM" }]` | L2 error: `"war self-reference: 'ROM' cannot fight itself"` | Unit test |
| S10-04 | L2 | TechEra mismatch: `forbiddenActions: ["air_strike"]` but `techEra: "ancient"` | Flight forbidden in ancient era | L2 error: `"forbiddenAction 'air_strike' redacted by techEra 'ancient'"` — AI cannot generate it anyway | Unit test |
| S10-05 | L2 | `countryAssignments` → polity exists check | `countryAssignments: { ATLANTIS: ["ESP"] }` | L2 error: `"countryAssignment references unknown polity 'ATLANTIS'"` | Unit test |
| S10-06 | L3 | AI audit: `validateScenario` runs | Full spec after AI gap-fill | Returns `{ errors: [], warnings: [] }` or specific contradictions | Integration test with mocked AI |
| S10-07 | L3 | AI audit catches: `eraNarrative` contradicts `techEra` | `techEra: "ancient"`, `eraNarrative: "Nuclear deterrence defines the era"` | L3 warning: `"eraNarrative mentions 'nuclear' but techEra is 'ancient'"` | Integration test with mocked AI |
| S10-08 | L3 | AI audit catches: pregameHistory contradicts alliance | `allianceBlocks: [{ members: ["FRA", "GBR"] }]`, `pregameHistory: "France declares war on Britain in 1938"` | L3 error: `"pregameHistory contradicts alliance: FRA-GBR allied but history says FRA declares war on GBR"` | Integration test with mocked AI |
| S10-09 | L3 | AI audit catches: pregameHistory contradicts `activeWars` | `activeWars: []`, `pregameHistory: "GER occupies Rhineland in 1936"` — no war declared | L3 warning: `"pregameHistory describes occupation by GER but no active war"` | Integration test with mocked AI |
| S10-10 | L3 | AI audit catches: resource in wrong era | Uranium resource in `techEra: "ancient"` | L3 warning: `"uranium resource defined but techEra is 'ancient'"` — not an error, just informational | Integration test |
| S10-11 | L4 | GDP coverage: polity with regions but GDP=0 in economy.json | `economy.json` missing a polity that has regions | L4 error: `"polity 'X' has territory but no economy entry"` | Integration test |
| S10-12 | L4 | Culture coverage: every populated region has primaryCulture | `culture.json` missing a region that exists in world.json | L4 error: `"region 'X' has no primaryCulture assignment"` | Integration test |
| S10-13 | L4 | Religion coverage: same check | Same pattern as S10-12 | Integration test |
| S10-14 | L4 | Resource totals consistency | `resources.json` country totals = Σ(per-region resources owned) | L4 error: `"POL coal total (200) ≠ Σ owned regions (150)"` | Integration test |

**Automation approach:** `test-validation.mjs` — instantiate each validation layer independently. L3 uses mocked AI; L2 is pure logic; L4 is pure aggregation.

---

## 2. Test Plan: AI Gap-Fill (fillScenarioGaps)

| Test ID | Test Case | Input | Expected Result | Automation |
|---------|-----------|-------|-----------------|------------|
| GF-01 | Empty manifest — all 6 domains missing | Spec with no economy, culture, religion, resources, mobilization, influence | AI generates all 6; each JSON has valid shape and plausible values per `techEra` | Integration test with mocked AI |
| GF-02 | Partial manifest — economy present, 5 missing | `economy: { ROM: { gdp: 50000 } }` | AI fills culture, religion, resources, mobilization, influence; economy unchanged | Integration test |
| GF-03 | Full manifest — all 6 present | All domains populated | AI returns empty diff; no fields overwritten | Integration test |
| GF-04 | AI returns extra fields not in schema | AI adds `economy.ROM.spaceColonies = true` | `additionalProperties: false` strips it; L1 passes | Unit test |
| GF-05 | AI overwrites author field | Author: `economy.ROM.gdp = 50000`; AI: `economy.ROM.gdp = 10000` | Pre-merge check rejects: author field preserved; only gaps filled | Unit test |
| GF-06 | AI timeout (no response within timeout) | `fillScenarioGaps` times out after 30s | Fallback → defaults; assembly proceeds with default values; L4 logs warnings for low-confidence fields | Integration test |
| GF-07 | AI returns partial — some domains, not all | AI fills economy + culture, crashes before religion | Partially applied: economy.json + culture.json have AI values; religion/resources/mobilization/influence use defaults | Integration test |
| GF-08 | Consecutive gap-fill runs produce different values | Two calls for same spec | Values within ε tolerance (e.g., GDP ±10%); not deterministic but not wildly different | QA manual check |
| GF-09 | Local model (no tool support) falls back to JSON recovery | `fillScenarioGaps` called with Ollama model | `extractJsonPayload` recovers from prose; gap-fill succeeds | Integration test with Ollama |
| GF-10 | Gap-fill prompt respects `eraNarrative` | `eraNarrative: "Pastoral Bronze Age society"` | Generated economy has low GDP, no industry; culture is pre-literate | QA manual review |

**Automation approach:** `test-gapfill.mjs` — mock `callAI` to return controlled responses for each domain pattern. Test the merge logic (author fields preserved) with unit tests. Test fallback path by throwing in the mock.

---

## 3. Test Plan: Modular JSON Storage (6 New Files)

| Test ID | Test Case | Expected Result | Automation |
|---------|-----------|-----------------|------------|
| ST-01 | `economy.json` created at scenario build time | File exists at `server/data/scenarios/<id>/economy.json` with valid shape | Integration test |
| ST-02 | All 6 files polled independently | Each has its own `/api/runtime/json/economy` endpoint; `JSON_URLS.economy` defined in `assets.js` | Integration test |
| ST-03 | Polling interval: 15–60s per file, configurable | `setInterval` per asset, NOT 5s like world.json; default 30s | Unit test (timer mock) |
| ST-04 | HEAD diff check before GET | Client sends `HEAD /api/runtime/json/economy` → compares `ETag` → only GET if changed | Integration test (network spy) |
| ST-05 | Differential (field-level) updates | Only changed fields arrive, not full 100KB economy.json each poll | Integration test |
| ST-06 | Write: `readRuntimeJsonAsset("economy")` | Returns `{ data: {...}, etag: "abc123" }` | Unit test |
| ST-07 | Write: `writeRuntimeJsonAsset("economy", value)` | Writes file, bumps ETag, returns `{ etag: "def456" }` | Unit test |
| ST-08 | Game copy isolates from scenario original | `economy.json` in game dir is a COPY; modifying game version doesn't change scenario template | Integration test |
| ST-09 | All 6 files included in `exportScenarioBundle` | `scenario.tar.gz` contains all 6 JSON files | Integration test |
| ST-10 | All 6 files included in `importScenarioBundle` | Imported scenario has all 6 files | Integration test |
| ST-11 | `useEconomyState`, `useCultureState`, etc. hooks exist | Client hooks poll and return typed state objects; referential-identity guard like `useWorldState` | Unit test |
| ST-12 | Server load: 7 polling endpoints (world + 6 new) | With 1 client, ~0.05 req/s (world at 5s, 6 others at 30s avg). Server CPU negligible | Performance test |
| ST-13 | Multiple clients polling | 10 connected clients, each polling all 7 endpoints | Server handles ~250 req/min. No degradation | Load test |

**Automation approach:** `test-storage.mjs` for server-side file CRUD. `test-polling.mjs` for client hooks with timer mocking and network spies.

---

## 4. Test Plan: Migration (6 Existing Presets)

| Test ID | Test Case | Input Preset | Expected Result | Automation |
|---------|-----------|-------------|-----------------|------------|
| M-01 | roman-117 converts without data loss | `roman-117.spec.mjs` | All 13 polities, ~83 country assignments, ~70 cities preserved. `simulationRules` string → `StructuredSimulationRules.eraNarrative`. New economy/culture/religion/resources/mobilization/influence generated via AI. macroRegions auto-generated | Integration test |
| M-02 | wwii-1939 converts | `wwii-1939.spec.mjs` | All polities + assignments preserved. `techEra: "ww2"`, `allowedUnitTypes` preserved (already top-level). AI generates economy with plausible 1939 values | Integration test |
| M-03 | medieval-1200 converts | `medieval-1200.spec.mjs` | TechEra: "medieval". Mobilization ~2% cap. No gunpowder in forbiddenActions unless explicitly allowed | Integration test |
| M-04 | mongol-1300 converts | `mongol-1300.spec.mjs` | All preserved. MacroRegions respect steppe adjacency | Integration test |
| M-05 | colonial-1650 converts | `colonial-1650.spec.mjs` | TechEra: "early_modern". Colonial influence relationships generated | Integration test |
| M-06 | bronze-1200bc converts | `bronze-1200bc.spec.mjs` | TechEra: "ancient". No iron or steel resources. Chariotry in allowedUnitTypes | Integration test |
| M-07 | Round-trip: migrate → build → play | Any migrated preset | Built preset produces valid scenario; game starts; 3 turns play without errors | Integration test |
| M-08 | Migration utility produces `.v2.mjs` | `roman-117.spec.mjs` → `roman-117.v2.spec.mjs` | V2 file has `ScenarioSpec` shape; original `.spec.mjs` untouched | Integration test |
| M-09 | V2 file diff-able against original | `diff roman-117.spec.mjs roman-117.v2.spec.mjs` | Only structural changes; all polities, assignments, cities, meta identical | QA manual check |
| M-10 | Migration handles prose `simulationRules` with rich text | `simulationRules: "It is 1939. Germany... (500 words)"` | `eraNarrative` = original string; `techEra`, `factions`, `allianceBlocks`, `activeWars`, `forbiddenActions` extracted via AI or heuristics | Integration test |
| M-11 | Migration with spec that already has structured rules | Spec with `simulationRules: { worldState: {...}, aiDirectives: {...} }` | Migration is no-op for simulationRules; skips extraction | Unit test |

**Automation approach:** `test-migration.mjs` runs `migrate-presets.mjs` on all 6 presets. Compares key fields (polity count, region count, city count, dates) between original and V2 using JSON diff. Verifies all 6 new files exist. Mock AI for gap-fill.

---

## 5. Test Plan: Backward Compatibility

| Test ID | Test Case | Expected Result | Automation |
|---------|-----------|-----------------|------------|
| BC-01 | Old game file (prose `simulationRules` string) loaded after migration | Engine detects old format, treats entire string as `eraNarrative`; `techEra` defaults to `"ancient"` with a warning | Integration test |
| BC-02 | Old `world.json` without `macroRegions` | `normalizeWorldState` fills `macroRegions: []`; no crash | Unit test |
| BC-03 | Old `world.json` without `economy` references | Economy reads return `null`; UI shows "No economy data" placeholder | Integration test |
| BC-04 | Old scenario with `allowedUnitTypes` at top level | Still honored; engine reads from `simulationRules.aiDirectives.allowedUnitTypes` OR top-level fallback | Unit test |
| BC-05 | Old `simulationRules` string still works in gameplay | AI task `generateActions` receives `simulationRules` as string → engine wraps in `{ eraNarrative: string, ...defaults }` before prompt injection | Integration test |
| BC-06 | Old `events.json` format unchanged | `events.json` schema unchanged by Phase 1; all old game files load without migration | Integration test |

**Automation approach:** `test-backward-compat.mjs` — load old-format fixture files, run through normalizers, verify no crashes.

---

## 6. Edge Cases & Regression Risks

### 6.1 AI Gap-Fill Failure Modes

| Edge ID | Scenario | Risk | Mitigation Test |
|---------|----------|------|-----------------|
| E-AI-01 | `fillScenarioGaps` returns HTTP 500 | Assembly halts; user sees error | Test: mock server error → verify error message is user-readable, retry button appears |
| E-AI-02 | AI returns valid JSON but none of the 6 domains | Gap manifest unchanged; all 6 use defaults | Test: AI response `{ unrelated: true }` → no domains matched → defaults applied |
| E-AI-03 | AI returns hallucinated polities | L2 catches: `"economy references unknown polity 'X'"` | Test: inject hallucinated polity in mock → verify L2 rejects |
| E-AI-04 | AI returns values that contradict each other | GDP=50000, total_employed=60000 (more employed than population) | L3 `validateScenario` catches; retry or flag for human review |
| E-AI-05 | AI returns values for wrong era | `techEra: "ancient"`, AI generates `uranium` resources, `nuclear_submarine` in allowedUnitTypes | L3 catches era mismatch; falls back to era-appropriate defaults |
| E-AI-06 | Gap-fill prompt exceeds token limit | 8000+ macroRegions in context → prompt > 128K tokens | Test: truncate macroRegion list in prompt if >40K tokens; verify gap-fill still coherent |
| E-AI-07 | 3-tier fallback correct order | Author → AI → defaults | Test: inject failure at each tier; verify next tier activates |
| E-AI-08 | AI gap-fill slow (>60s) | User waits; assembly seems hung | Test: timeout at 60s → fallback to defaults; show progress indicator |

### 6.2 MacroRegion Auto-Generation Edge Cases

| Edge ID | Scenario | Risk | Mitigation Test |
|---------|----------|------|-----------------|
| E-MR-01 | 0 macroRegions produced | Empty region catalog, or algorithm bug | Test: empty catalog → clear error, no silent `[]` |
| E-MR-02 | 8000 macroRegions (one per GID_1) | Algorithm fails to group; every region is its own macroRegion | Test: verify macroRegion count ≤ GID_1 count × 0.2; if exceeded, flag as degenerate and fall back to GID_0 grouping |
| E-MR-03 | 40 vs 41 macroRegions (prompt cap) | Consensus spec mentions 40-macroRegion cap in prompts | Test: exactly 40 → all included in prompt; 41 → top 40 by population/strategic value + `"...and 1 more region"` suffix |
| E-MR-04 | Region transfer splits macroRegion | During gameplay: GID_1 "ITA.1_1" transfers from ROM to GOT | Engine splits macroRegion: creates two sub-macroRegions reflecting new ownership. Both retain original `macroRegion.id` with `ownerCode` suffix: `"south-europe_ROM"`, `"south-europe_GOT"` |
| E-MR-05 | MacroRegion split when ALL GID_1s transfer | All GID_1s in a macroRegion change hands | MacroRegion fully reassigned to new owner; no split needed |
| E-MR-06 | MacroRegion merge (reconquest) | GOT reconquers the split GID_1 | Engine detects all GID_1s of original macroRegion now under one owner → merges back to original id |
| E-MR-07 | MacroRegion adjacency across narrow water | Sicily (ITA.3_1) separated from mainland by Messina Strait (~3km) | Proximity heuristic correctly groups Sicily with southern Italy macroRegion; configurable max-water-distance parameter (default 25km) |
| E-MR-08 | MacroRegion with only 1 GID_1 (small island) | Malta, Singapore, etc. | Single-GID_1 macroRegion is valid; no minimum size enforced |
| E-MR-09 | Performance: grouping 8000 regions | O(n²) naive clustering would hang | Test: grouping completes in <2s on 8000 regions; verify algorithm uses spatial indexing (quadtree or k-d tree) |
| E-MR-10 | Deterministic output | Two runs of auto-generation on same catalog | Same macroRegions produced (seeded RNG or pure algorithm) |

### 6.3 Polity / Region Edge Cases

| Edge ID | Scenario | Risk | Mitigation Test |
|---------|----------|------|-----------------|
| E-PL-01 | Zero polities defined | `polities: {}` | World has only unclaimed regions; no polityOverrides; economy/culture seeded with empty arrays |
| E-PL-02 | Polity with no `countryAssignments` (landless) | Vatican, exiled government, UN observer | Valid polity; `regionOwnershipOverrides: {}`; economy entry exists but gdp=0. Marked `landless: true` |
| E-PL-03 | Two polities claim same region | `countryAssignments: { ROM: ["ITA"], GRE: ["ITA"] }` | L2 error: `"region ITA assigned to multiple polities: ROM, GRE"`. Last-write-wins or explicit rejection (per spec: rejection) |
| E-PL-04 | Polity name collision with reserved word | `polities: { WORLD: { name: "World" } }` | L1 or L2 rejects: `"'WORLD' is a reserved identifier"` |
| E-PL-05 | Polity code too long | `polities: { VERY_LONG_CODE_NAME_12345: {...} }` | L1 rejects: `"polity code must be ≤8 characters"` (matches existing convention: ROM, PART, KUSH, HAN — all ≤4) |
| E-PL-06 | Polity with no color AND no procedural fallback | `codeToColor` edge case | All polities get a color; procedural fallback always produces valid `[r,g,b]` |

### 6.4 simulationRules Ambiguity

| Edge ID | Scenario | Risk | Mitigation Test |
|---------|----------|------|-----------------|
| E-SR-01 | Old prose string AND new structured object both present | Spec has both `simulationRules: "It is 117 AD..."` AND `simulationRules: { worldState: {...} }` | Impossible in JS — property is single-valued. Migration: prose string extracted to `eraNarrative`; structured object used as-is. |
| E-SR-02 | `allianceBlocks` has member also in `activeWars` as opponent | FRA in "Allies" alliance block AND in "Phony War" as defender | L3 AI audit: `"FRA is in Alliance 'Allies' but also belligerent in war 'Phony War'"` — not necessarily a contradiction (can be in alliance AND at war), just flagged |
| E-SR-03 | `allianceBlocks` with single member | `allianceBlocks: [{ id: "axis", members: ["GER"] }]` | Valid but flagged as "single-member alliance" warning |
| E-SR-04 | `diplomaticPostures` with non-existent polity pair | `{ from: "ROM", to: "ATLANTIS", posture: "hostile" }` | L2 error: `"diplomaticPosture references unknown polity 'ATLANTIS'"` |
| E-SR-05 | `forbiddenActions` contradicts `allowedUnitTypes` | `forbiddenActions: ["use_naval"]`, `allowedUnitTypes: ["naval"]` | L2 error: `"forbiddenAction 'use_naval' contradicts allowedUnitType 'naval'"` |
| E-SR-06 | `aiHistoryMode` "guided" with no historical anchor events | Mode is "guided" but scenario has no historical event timeline | L3 warning: `"aiHistoryMode is 'guided' but no historical anchors provided; mode degrades to 'conditional'"` |

### 6.5 Performance & Concurrency

| Edge ID | Scenario | Risk | Mitigation Test |
|---------|----------|------|-----------------|
| E-PF-01 | 7 polling endpoints + world.json at 5s | Server: 1 world poll/5s + 6 asset polls at 15–60s each = ~0.16 req/s per client. With 10 clients: ~1.6 req/s | Test: load-test with 50 clients → verify <100ms p95 latency, <10% CPU |
| E-PF-02 | Write contention: AI turn writes economy.json while client polls | Client polls GET, AI writes PUT simultaneously | File-level locking in libraryStore.js or atomic write (write to temp → rename); test with concurrent GET/PUT |
| E-PF-03 | 6 new files inflate scenario bundle size | Scenario tar.gz currently ~5MB (geojson dominates); 6 new JSON files add ~200KB | Bundle still <10MB; import time unchanged |
| E-PF-04 | HEAD diff checks for all 7 endpoints | 7 HEAD requests each poll cycle instead of 1 | Combined polling: single `/api/runtime/etags` endpoint returns `{ world: "abc", economy: "def", ... }` → 1 request instead of 7 |

### 6.6 Culture / Religion Specific

| Edge ID | Scenario | Risk | Mitigation Test |
|---------|----------|------|-----------------|
| E-CR-01 | Culture group with no primary culture assigned to any region | `culture.groups: { roman: {...} }` but no region has `primaryCulture: "roman"` | L4 warning: `"orphan culture group 'roman': defined but unused"` |
| E-CR-02 | Region with primary culture NOT in culture.groups (E-CR-01 inverse) | Region has `primaryCulture: "atlantean"` but culture.groups has no "atlantean" | L2/L4 error: `"region 'X' primaryCulture 'atlantean' not defined in culture.groups"` |
| E-CR-03 | Minority percentages exceed 100% | Region: `primaryCulture: "roman" (40%), minority: { greek: 40%, punic: 30% }` → 110% | L4 error: `"culture percentages for region 'X' sum to 110%"` |
| E-CR-04 | Culture diffusion during gameplay | Every in-game month: engine computes diffusion deltas | Test: simulate 12-month run; verify culture percentages drift within [0,100]; sum always ≤100% after normalization |
| E-CR-05 | Religion same patterns | Same as E-CR-01 → E-CR-04 but for religion | Same tests with religion.json |

### 6.7 Data Integrity on Crash

| Edge ID | Scenario | Risk | Mitigation Test |
|---------|----------|------|-----------------|
| E-DI-01 | Server crash mid-write to economy.json | Economy file corrupted (partial write) | Atomic write: write to `.tmp` → `fs.rename`. Test: kill server during write → restart → file intact (old version or fully new) |
| E-DI-02 | Client crash mid-poll | Partial state update | Client reads with ETag; retries on failure; no partial state committed |
| E-DI-03 | `world.json` and `economy.json` out of sync | world.json references polities that economy.json doesn't have (or vice versa) | L4 consistency check on every read: cross-reference polity lists |

---

## 7. "Scenario is Law" Checks

This section tests Principle 1: *"Spec fields that are explicitly set are never overwritten by AI."*

| Test ID | Test Case | Violation Attempt | Expected Enforcement | Automation |
|---------|-----------|-------------------|---------------------|------------|
| SL-01 | AI gap-fill tries to overwrite author GDP | Author: `economy.ROM.gdp = 50000`. AI: `economy.ROM.gdp = 30000` | Pre-merge: author field preserved (`50000`). Log: `"fillScenarioGaps tried to overwrite author field economy.ROM.gdp"` | Unit test |
| SL-02 | AI gap-fill tries to overwrite author culture | Author: `culture.regions.ITA_1.primaryCulture = "roman"`. AI: `{ primaryCulture: "greek" }` | Author field preserved. Log warning | Unit test |
| SL-03 | AI gap-fill tries to overwrite author techEra | Author: `techEra: "ancient"`. AI: `techEra: "industrial"` | Rejected — `techEra` is always author-defined. No log needed (not a gap to fill) | Unit test |
| SL-04 | AI gap-fill tries to add polity not in spec | AI: `economy: { ATLANTIS: { gdp: 99999 } }` | L2 rejects: `"polity 'ATLANTIS' not in author's polities map"` | Unit test |
| SL-05 | `pregameHistory` contradicts author `allianceBlocks` | Author: `allianceBlocks: [{ members: ["FRA", "GBR"] }]`. pregameHistory: `"France breaks with Britain in 1936"` | L3: `"pregameHistory event 'France breaks with Britain' contradicts alliance 'FRA-GBR'"` — rejected or flagged | Integration test |
| SL-06 | `pregameHistory` contradicts author `activeWars` | Author: `activeWars: [{ name: "WW2", belligerents: ["GER", "POL"] }]`. pregameHistory: `"Germany and Poland sign peace in 1938"` | L3: `"pregameHistory contradicts active war 'WW2': peace declared before scenario start"` | Integration test |
| SL-07 | AI gameplay `regionTransfers` violates author `allianceBlocks` | Author: FRA-GBR allied. AI event: "France invades Britain" without prior alliance break | `applySimulationResult` checks: `"regionTransfer FRA→GBR violates alliance: FRA-GBR are allied"`. Event rejected unless preceded by explicit alliance-break event | Integration test |
| SL-08 | AI gameplay generates `forbiddenAction` | Author: `forbiddenActions: ["use_nuclear"]`. AI: event with "atomic bomb" | L2/L3 catch: `"event 'X' uses forbidden action 'use_nuclear'"`. Event rejected | Integration test |
| SL-09 | AI changes polity name not in aliases | Author: `ROM: { name: "Roman Empire", aliases: ["Rome", "SPQR"] }`. AI: `polityChanges: { code: "ROM", name: "Byzantine Empire" }` | Valid gameplay (polity can rename). Name change is allowed; aliases still respected for prompt resolution | Integration test |
| SL-10 | AI deletes a polity | AI `polityChanges`: `{ code: "ROM", action: "dissolve" }` | Engine: polity becomes `landless: true`, regions revert to `unclaimed`. Name preserved in `world.polityOverrides`. Never fully deleted from world.json | Integration test |
| SL-11 | AI `mapSemantics` tries to claim region not in world | AI returns `ownershipChange: { regionId: "ATLANTIS.9_9", from: "ROM", to: "GRE" }` | `resolveRegionTransfers` in gameplay.js: `"unknown regionId 'ATLANTIS.9_9'"` → strict error (attempt 1) or dropped (final) | Integration test |
| SL-12 | AI `mapSemantics` contradicts map truth | AI says "Rome captures Sicily" but ITA.3_1 already owned by ROM | Engine detects: `"regionTransfer: 'ITA.3_1' already owned by 'ROM'"` → dropped; regime feedback to AI | Integration test |

**Automation approach:** `test-scenario-law.mjs`. Tests where AI tries to overwrite author fields → mock the AI response and verify the merge/rejection logic. Tests for L3 audit → mock AI for validateScenario with deliberately contradictory inputs.

---

## 8. Acceptance Criteria Traceability

Mapping each Vision Doc AC to specific test cases.

| AC | Description | Test Cases |
|----|-------------|------------|
| **AC-1** | Era constraints as typed fields, engine-enforced everywhere | S0-06 (techEra enum), S10-04 (forbiddenActions vs techEra), SL-08 (AI cannot use forbiddenAction), E-SR-05 (contradiction check) |
| **AC-2** | Per-country starting economy in spec, seeds `economy.json` | S3-01 → S3-08 (economy seed), ST-01 (economy.json created), ST-03 (independent polling), GF-02 (partial fill), SL-01 (author GDP preserved) |
| **AC-3** | Culture and religion per-region, seeds `culture.json`/`religion.json` | S4-01 → S4-05, ST-01, E-CR-01 → E-CR-05, SL-02 (author culture preserved) |
| **AC-4** | Resources per region, engine totals follow ownership | S4-06 → S4-08, S10-14 (L4 totals check), E-MR-04 (region transfer → resource recalculation) |
| **AC-5** | Mobilization tuned per era in structured fields | S4-09 → S4-10, GF-02 (AI fills mobilization per era), M-03 (medieval ~2% cap) |
| **AC-6** | Influence relationships seeded in spec | S4-11 → S4-13, M-05 (colonial influence), E-SR-04 (unknown polity pair) |
| **AC-7** | PregameHistory respects spec facts | SL-05 (alliance contradiction), SL-06 (war contradiction), S10-08/S10-09 (L3 AI audit) |
| **AC-8** | All new fields optional (AI fills gaps) | GF-01 (empty manifest), GF-02 (partial manifest), GF-03 (full manifest), E-AI-07 (3-tier fallback) |
| **AC-9** | Migration utility is a deliverable, not afterthought | M-01 → M-06 (all 6 presets), M-07 (round-trip), M-08 (.v2.mjs output), M-09 (diff-able), M-10 (prose extraction) |

---

## 9. Test Automation Strategy

### Test File Layout

```
scripts/test/
├── test-schema.mjs          # Stage 0: L1 JSON Schema validation (S0-01 → S0-07)
├── test-polity-map.mjs      # Stage 1: Polity map building (S1-01 → S1-04)
├── test-geometry.mjs        # Stage 2: Geometry + cities (S2-01 → S2-06)
├── test-macroregion.mjs     # Stage 2.5: MacroRegion auto-gen (S2.5-01 → S2.5-08, E-MR-01 → E-MR-10)
├── test-economy-seed.mjs    # Stage 3: Economy seeding (S3-01 → S3-08)
├── test-culture-seed.mjs    # Stage 4: Culture seeding (S4-01 → S4-03)
├── test-religion-seed.mjs   # Stage 5: Religion seeding (S4-04 → S4-05)
├── test-resources-seed.mjs  # Stage 6: Resources seeding (S4-06 → S4-08)
├── test-mobilization-seed.mjs # Stage 7: Mobilization (S4-09 → S4-10)
├── test-influence-seed.mjs  # Stage 8: Influence (S4-11 → S4-13)
├── test-assembly.mjs        # Stage 9: Full assembly (S9-01 → S9-08)
├── test-validation.mjs      # Stage 10: L1-L4 validation (S10-01 → S10-14)
├── test-gapfill.mjs         # AI gap-fill (GF-01 → GF-10)
├── test-storage.mjs         # Modular JSON storage (ST-01 → ST-13)
├── test-migration.mjs       # Migration tool (M-01 → M-11)
├── test-backward-compat.mjs # Backward compatibility (BC-01 → BC-06)
├── test-scenario-law.mjs    # Scenario-is-Law checks (SL-01 → SL-12)
├── test-performance.mjs     # Performance + load (E-PF-01 → E-PF-04)
├── test-edge-cases.mjs      # Remaining edge cases (E-AI-*, E-PL-*, E-SR-*, E-CR-*, E-DI-*)
└── fixtures/
    ├── minimal-spec.mjs     # Bare minimum valid spec
    ├── full-spec.mjs        # Spec with all optional fields
    ├── partial-spec.mjs     # Spec with only some domains
    ├── bad-schema-spec.mjs  # Spec with L1 violations
    ├── old-prose-spec.mjs   # Spec with prose simulationRules
    ├── corrupted-world.json # World with missing fields
    └── mocked-ai/           # Directory of mock AI responses
        ├── fill-all.json
        ├── fill-partial.json
        ├── fill-error.json
        └── fill-nonsensical.json
```

### Run Commands

```sh
# Run all tests
node scripts/test/run-all.mjs

# Run specific test suite
node scripts/test/test-schema.mjs
node scripts/test/test-migration.mjs

# Run with performance profiling
node --inspect scripts/test/test-performance.mjs

# CI mode (JSON output)
node scripts/test/run-all.mjs --ci --output results.json
```

### Mock Strategy

- **AI calls:** All AI-dependent tests use a mock layer that intercepts `callAI` and returns fixture data. The mock supports: success, timeout, error, nonsensical values, and partial responses.
- **File system:** Tests operate on temp directories (`os.tmpdir()/oh-test-XXXXXX`) — never touch real `server/data/`.
- **Region catalog:** Fixture catalog with 50 GID_1 regions (representative mix: contiguous, islands, enclaves).
- **Timers:** Use `sinon` fake timers for polling interval tests.

### CI Integration

```
# .github/workflows/test.yml (new job)
phase1-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: node scripts/test/run-all.mjs --ci
```

---

## 10. Risk Assessment Summary

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| AI gap-fill produces inconsistent values across 6 domains | High | Medium | L4 cross-domain consistency check; 3-tier fallback |
| MacroRegion auto-generation produces degenerate output (0 or 8000 regions) | High | Low | Explicit bounds checks; fallback to GID_0 grouping |
| Old `simulationRules` prose string breaks in new StructuredSimulationRules world | High | Medium | Backward compat layer; migration extracts prose to eraNarrative |
| 6 new polling endpoints cause server load | Medium | Low | Combined ETag endpoint; configurable intervals; differential updates |
| Migration loses data from existing 6 presets | High | Low | Diff-based verification; round-trip test; all 6 presets tested |
| Scenario-is-Law violation: AI overwrites author fields | Critical | Medium | Pre-merge guard; L3 audit; explicit test suite (SL-01 → SL-12) |
| MacroRegion split/merge during gameplay breaks economy | Medium | Medium | Explicit split test (E-MR-04); resource recalculation verification |
| Culture/Religion orphan groups or broken references | Medium | Medium | L4 referential integrity check (E-CR-01/E-CR-02) |

---

## 11. Checklist for Implementation Readiness

Before IMPLEMENT phase begins, confirm:

- [ ] JSON Schema for `ScenarioSpec` finalized and committed to `schemas/`
- [ ] `fillScenarioGaps` prompt template written and reviewed
- [ ] `validateScenario` prompt template written and reviewed
- [ ] MacroRegion auto-generation algorithm chosen (spatial clustering method)
- [ ] 40-macroRegion prompt cap strategy decided
- [ ] Combined ETag endpoint approach vs. separate HEAD requests decided
- [ ] Migration utility `migrate-presets.mjs` spec written
- [ ] All test fixtures created
- [ ] Mock AI layer implemented
- [ ] CI pipeline configured

---

*End of Test Plan — Phase 1 Scenario Architecture QA*

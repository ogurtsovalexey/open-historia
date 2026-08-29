# Open Historia — Principles & Architecture Decisions

This document is the **canonical source of truth** for all architectural
decisions, design principles, and constraints. Every agent (PO, Analyst,
Developer, AI Engineer, QA) MUST reference this document before making any
design or implementation decision. Changes to this document require discussion
and consensus.

---

## 1. Scenario is Law (Сценарий — Закон)

The `.spec.mjs` file is **immutable ground truth** for every game seeded from
that scenario. It defines:

- `polities` — polities of the era with colors and aliases
- `countryAssignments` / `regionOverrides` — starting borders
- `cities` — cities with historical names and populations
- `simulationRules` — era rules: alliances, active wars, tech era, forbidden actions
- `startingTimelineText` — narrative opening
- `game.startDate` — starting date

**AI fills gaps, never overrides.** AI-generated `polityChanges` and
`regionTransfers` are validated against `simulationRules.alliances` and
`activeWars`. If a spec declares "FRA-RUS alliance since 1892", AI cannot
generate an event where France declares war on Russia without first breaking
that alliance through explicit in-game events.

**Validation contract**: every AI-generated `impacts` block is checked against
spec invariants. Spec fields that are explicitly set are never overwritten by AI.

---

## 2. Application = Engine, AI = Brain (Движок + Мозг)

**The application** owns: formulas, statistics, storage, recalculation.
- Economy: GDP, inflation, unemployment, employment structure — computed by formulas
- Resources: per-region resource map, totals per country, recalculated on region transfer
- Culture/religion: diffusion computed by the engine once per in-game month
- Mobilization: manpower pool, mobilization rate, deployment delays

**The AI** owns: what changes, by how much, and why.
- Generates modifiers (e.g. `war_mobilization: +15% industrial output`)
- Generates events that the engine applies
- Generates `mapSemantics` for map-mode rendering
- Does NOT compute formulas or modify totals directly

---

## 3. The Map Does NOT Go Into AI (Карта не ездит в AI)

The full world map (~8000+ regions, 200+ KB) never travels into AI prompts.

**Two-tier architecture:**

1. **Expensive model** returns `mapSemantics` (~1-3 KB):
   - `ownershipChanges`: which regions changed hands
   - `relations`: country-to-country statuses
   - `contestedZones`: which areas are disputed
   - `cultureShifts` / `religionShifts`: demographic deltas

2. **Cheap model** (or algorithmic fallback) resolves semantics to concrete `regionId`
   annotations. If `mapSemantics` is empty (no changes), no AI is called at all.

3. **The application** interprets annotations and renders map layers.

This applies to all 5 map modes: Political, Real, Diplomatic, Cultural, Religious.

---

## 4. Full Emergent Gameplay (Без Railroaded Событий)

Scenarios define only **starting conditions**. No guaranteed historical events
(no "1917 Russian Revolution must happen").

Everything that happens after `startDate` is emergent — driven by AI decisions,
player actions, and engine mechanics.

---

## 5. AI and History — Conditional Mode (AI и История)

Controlled by `simulationRules.aiHistoryMode`:

| Mode | Behavior |
|------|----------|
| `conditional` (default) | AI knows real history. Follows it only if countries have not significantly diverged from their historical path |
| `free` | AI is blind to real history. Pure sandbox |
| `guided` | AI tries to follow history wherever possible |

Scenario authors choose the mode. Players cannot override.

---

## 6. Economy — Formula Engine (Формульный Движок)

**Engine computes:**
- GDP = Σ(regionBaseOutput × development × modifiers)
- Inflation = f(moneySupply, GDP_growth, war_status)
- Unemployment = f(population, mobilized, industry_capacity)
- Budget = taxRevenue − expenses; Debt accumulates
- Employment structure: % agriculture / industry / services

**Scenario defines:**
- `regionBaseOutput` for each region
- `resources` map (oil, coal, iron, food, gold — per region)
- Starting macro indicators per country

**AI changes:** modifiers only (via `economy.modifiers[]`). Never raw numbers.

**Region transfer → immediate recalculation.** Lose a coal region → country coal
total drops instantly. No delay.

---

## 7. Resources are Region-Bound (Ресурсы привязаны к Регионам)

Scenario defines which resources are in which regions:
```json
{ "resources": { "regions": { "RUS.4_2": ["oil", "coal"] } } }
```

Country totals are engine-computed: `Σ(resources of owned regions)`.

AI events can discover new resources or deplete existing ones — but only through
modifiers, never by directly editing totals.

---

## 8. Culture & Religion — Two Separate Layers

Both are stored in `world.json` (separated into `culture.json` / `religion.json`
in the modular storage). Each has:
- Primary group per region
- Minority percentages per region
- Color-coded groups for map rendering

**Diffusion:** engine recomputes once per in-game month, only when
culture/religion-related events have occurred. AI generates `cultureShifts` and
`religionShifts` in `mapSemantics`; the engine applies deltas.

**Two separate map modes:** Cultural (language/ethnic groups) and Religious
(faith groups).

---

## 9. Mobilization — Historical Context (Исторический Контекст)

Mobilization timing matches the historical era, modified by:
- Player/AI reforms (faster mobilization)
- Infrastructure degradation (slower)
- Context (peace vs. war, distance, technology)

Engine stores `mobilization{}` in `world.json`:
- `manpowerPool` — total recruitable population
- `mobilized` — currently under arms
- `maxMobilization` — era-dependent ceiling (WW1 ~8-10%, medieval ~2%)

Units appear on the map with a delay computed by the engine. Demobilization
causes unemployment shock (engine formula).

---

## 10. Narrative Science (Нарративная Наука)

Discoveries are AI-generated events with modifiers:
- "Newton publishes Principia" → `polityChanges.stats.science += 5`
- No separate tech tree
- Bound by `simulationRules.techEra` and `forbiddenActions` (no nuclear physics in WW1)

---

## 11. Five Map Modes

| Mode | Data Source | What It Shows |
|------|------------|---------------|
| **Political** | `regionOwnershipOverrides` | De jure borders |
| **Real** | `regionOwnershipOverrides` + `influence[]` + occupation | Actual control + vassals |
| **Diplomatic** | `internationalReputation` | Relations: green/red/neutral |
| **Cultural** | `culture.regions` | Language/ethnic groups |
| **Religious** | `religion.regions` | Faith groups |

All rendered on the client side from engine-computed data. AI provides
`mapSemantics` only when changes occur.

---

## 12. Turns — Flexible (Гибкие Ходы)

The player chooses the jump duration. AI adapts event density accordingly.
No fixed "1 turn = 1 month" constraint.

---

## 13. Multi-Agent Process

All development follows this cycle:

1. **DISCOVERY** — PO + Analyst (parallel, then sync)
2. **DESIGN** — Developer + AI Engineer (joint, consensus required)
3. **REVIEW** — PO + QA (parallel, cross-review all specs)
4. **IMPLEMENT** — Developer + AI Engineer (parallel, continuous sync)
5. **VERIFY** — QA (test plan execution, fix → re-test)

**Deadlocks → human escalation.** When Developer and AI Engineer cannot agree,
escalate to the project owner with 2-3 concrete options.

---

## 14. Tech Stack — JS/TS, Single Codebase

- **Language**: JavaScript/TypeScript (new code in TS, existing JS gradually migrated)
- **Single codebase** produces all 3 platforms: desktop, web, Android
- **No separate backend** — economy/culture/religion computations run in the
  browser/WebView via Web Workers for heavy tasks

---

## 15. Storage — Modular JSON

`world.json` is split into modular files, each with its own endpoint and polling:

| File | Contents |
|------|----------|
| `world.json` | Core: region ownership, polities, units, markers, catalysts, campaign memory |
| `economy.json` | Per-country macro indicators, modifiers |
| `culture.json` | Cultural groups, per-region primary + minorities |
| `religion.json` | Religious groups, per-region primary + minorities |
| `resources.json` | Per-region resources, country totals |
| `influence.json` | Suzerain-vassal relationships, autonomy levels |
| `mobilization.json` | Manpower pools, mobilized counts |

---

## 16. Differential Polling (Дифференциальный Polling)

Instead of sending the full state every 5 seconds, only changed fields are sent
(JSON Patch or field-level diff). Reduces traffic by 10-50× for large worlds.

The 5-second interval stays; the payload shrinks.

---

## 17. Repository — Private GitHub

The canonical repository is private on GitHub. Forking and access are
controlled by the project owner.

---

## Revision History

| Date | Change | Author |
|------|--------|--------|
| 2026-08-29 | Initial version — all principles from planning session | Planning session |

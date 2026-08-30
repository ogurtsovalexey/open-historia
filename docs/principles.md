# Open Historia — Principles & Architecture Decisions

This document is the **canonical source of truth** for architectural principles
and constraints. Detailed product decisions live in `docs/product/`; accepted
phase contracts live in `docs/spec/`. If documents disagree, precedence is:
principles → accepted phase contract → product roadmap → recovered agent notes.

---

## 1. Scenario is Law (Сценарий — Закон)

The authored scenario package is **immutable ground truth** for every game
seeded from that scenario. Existing `.spec.mjs` files are the current adapter;
Scenario Package v2 is the target contract. It defines:

- `polities` — polities of the era with colors and aliases
- `countryAssignments` / `regionOverrides` — starting borders
- `cities` — cities with historical names and populations
- `simulationRules` — era rules: alliances, active wars, tech era, forbidden actions
- `startingTimelineText` — narrative opening
- `game.startDate` — starting date

**AI never silently fills canonical gaps and never overrides authored facts.**
An authoring assistant may propose sourced Draft values, but human review must
promote them into the scenario package. Runtime proposals are validated against
scenario invariants and current canonical state.

**Validation contract**: every AI-generated `impacts` block is checked against
spec invariants. Spec fields that are explicitly set are never overwritten by AI.

---

## 2. Application = Engine, AI = Brain (Движок + Мозг)

**The application** owns: formulas, statistics, storage, recalculation.
- Economy: GDP, inflation, unemployment, employment structure — computed by formulas
- Resources: per-region resource map, totals per country, recalculated on region transfer
- Culture/religion: diffusion computed by the engine once per in-game month
- Mobilization: manpower pool, mobilization rate, deployment delays

**The AI** proposes intent, strategy, explanations, bounded events and severity
bands. The engine validates those proposals and resolves actual numeric effects.
AI does not own starting values, formulas, totals, transactions or final state.

---

## 3. The Map Does NOT Go Into AI (Карта не ездит в AI)

The full world map (~8000+ regions, 200+ KB) never travels into AI prompts.

**Two-tier architecture:**

1. **Expensive model** returns `mapSemantics` (~1-3 KB):
   - `ownershipChanges`: which regions changed hands
   - `relations`: country-to-country statuses
   - `contestedZones`: which areas are disputed
   - `cultureShifts` / `religionShifts`: demographic deltas

2. **Deterministic entity and geometry resolution** maps semantics to concrete
   `regionId` annotations. A utility model is only an optional fallback for
   unresolved names or ambiguous scope. If semantics are empty, no AI is called.

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

**AI changes:** bounded modifier or shock proposals only. The engine resolves
validated effects. AI never creates authoritative starting numbers or totals.

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

Both are separate domain modules and may be materialized as
`culture.json` / `religion.json` projections. Each has:
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

Every bounded DeepSeek task has a GPT plan gate before implementation. The
worker receives one read-only planning run, GPT approves or amends that plan,
and the same worker then receives one implementation run. Worker corrections
and automatic retries are forbidden: a rejected implementation is preserved as
evidence and returned to owner/GPT analysis. All DeepSeek phases use the
approved V4 Pro model and enforced request-token budgets.

**Deadlocks → human escalation.** When Developer and AI Engineer cannot agree,
escalate to the project owner with 2-3 concrete options.

---

## 14. Tech Stack — JS/TS, Single Codebase

- **Language**: JavaScript/TypeScript (new code in TS, existing JS gradually migrated)
- **Single codebase** produces all 3 platforms: desktop, web, Android
- **No separate backend** — economy/culture/religion computations run in the
  browser/WebView via Web Workers for heavy tasks

---

## 15. Storage — Versioned, Atomic, Modular

Domain data is modular, but a turn is committed under one world revision.
Multiple files must never expose a mixed revision after a crash. Current JSON
files are migration-compatible projections behind a transaction boundary:

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

## 16. Revision-Based Synchronization

Consumers request changes since a known world revision. The preferred contract
is a revision manifest plus changed assets or field-level patches. Existing
5-second polling may remain as a compatibility fallback, while slow-changing
projections may use longer intervals. Exact transport and intervals require
measurement; correctness never depends on polling timing.

---

## 17. Repository Privacy and Handoffs

The canonical development repository is the private GitHub remote `private`
(`ogurtsovalexey/open-historia-next`). The `origin` remote remains the public
fork and MUST NOT receive consolidated planning or private development work.
Parallel agents use separate worktrees and commit-based handoffs.

---

## Revision History

| Date | Change | Author |
|------|--------|--------|
| 2026-08-29 | Resolve AI authority, atomic storage, synchronization and repository-status conflicts | Codex consolidation |
| 2026-08-29 | Initial version — all principles from planning session | Planning session |

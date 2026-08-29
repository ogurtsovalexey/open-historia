# Phase 1 Consensus Specification

Status: accepted after consolidation
Scope: minimum foundations for a reliable vertical slice
Implementation: not started

## 1. Pareto Goal

Phase 1 does not implement the whole grand-strategy roadmap. It establishes the
smallest foundation that removes the largest current risks:

1. every AI call has an explicit task, context manifest, budget and cost record;
2. canonical state changes commit atomically under one world revision;
3. stable IDs, typed commands/events and runtime validation replace prose-owned state;
4. one World 1916 slice proves the path across Russia, Germany and Britain.

World 1797 remains a thin compatibility fixture. World 1853 and World 1690 stay
in the roadmap until the shared kernel is proven.

## 2. Relationship to the Product Corpus

The global direction in `../product/` remains authoritative for later work.
This phase narrows it; it does not discard simulation, logistics, culture,
religion, influence, map modes or the four-scenario program.

The existing `.spec.mjs` format remains supported. Scenario Package v2 in
`../product/05-territories-and-scenarios.md` is the target contract, introduced
incrementally rather than as a flag-day rewrite.

## 3. Binding Decisions

| Topic | Decision |
|---|---|
| Scenario authority | Authored scenario facts are immutable starting truth. |
| Missing data | Required gaps fail; optional gaps are explicit unknowns or assumptions. |
| AI authoring | AI may propose sourced Draft patches; it never silently creates canonical values. |
| Runtime AI | AI proposes bounded intents/events; deterministic mechanics resolve final effects. |
| Build | A pinned scenario builds and loads offline with zero LLM calls. |
| Regions | GID-level map truth plus reviewed macro-regions for aggregation. |
| Storage | Modular projections share one atomic world revision. |
| Validation | Deterministic checks block; optional AI semantic review is advisory. |
| Stack | Incremental TypeScript in the existing cross-platform codebase. |
| Phase 1 localization | English (`en`) and Russian (`ru`) are the only supported UI locales. Static UI uses checked-in catalogs and makes zero model calls; missing Russian keys fall back to English and fail development/CI coverage checks. |

## 4. Minimum Scenario Contract

The implementable Phase 1 shapes, ID grammar, provenance rules, protected paths,
Draft lifecycle and deterministic build inputs are defined by the accepted
[Minimal Scenario V2 Integrity Contract](scenario-v2-integrity.md). The compact
interfaces below remain the consensus overview.

```ts
interface ScenarioV2Adapter {
  schemaVersion: 2;
  id: string;
  meta: ScenarioMeta;
  game: ScenarioGame;
  polities: Record<PolityId, PolityDef>;
  regionAssignments?: Record<RegionId, PolityId>;
  cities?: CityDef[];
  simulationRules: AuthorSimulationRules;
  historicalFacts?: HistoricalFact[];
  macroRegions?: MacroRegionDef[];
  fidelity: ScenarioFidelityManifest;
  sources: SourceRef[];
  assumptions?: ScenarioAssumption[];
}

interface HistoricalFact {
  id: FactId;
  effectiveRange: DateRange;
  subjectRefs: EntityId[];
  predicate: string;
  value: unknown;
  sourceRefs: SourceId[];
  confidence: "high" | "medium" | "low" | "assumption";
}
```

Numbers carry units, effective dates, provenance, confidence and transformation
notes. Optional fields are allowed only when fidelity metadata explains them.

## 5. Simulation Rules

Scenario authors write one structured representation. The build derives runtime
capabilities and task-specific prompt text deterministically.

```ts
interface AuthorSimulationRules {
  era: string;
  aiHistoryMode: "conditional" | "free" | "guided";
  eraNarrative?: string;
  constraints: {
    noAirPower?: boolean;
    noGunpowder?: boolean;
    noNaval?: boolean;
    maxUnitTier?: number;
    narrativeRules?: string[];
  };
  factions?: FactionDef[];
  activeConflicts?: ConflictDef[];
  technologyLevel: { era: string; notable?: string[] };
}
```

New v2 scenarios cannot emit prose-only rules. Legacy string rules remain
readable through a migration adapter.

## 6. Pregame Integrity

AI-generated pregame text must be traceable:

```ts
interface PregameNarrativeDraft {
  text: string;
  factsUsed: FactId[];
  inferredClaims: Array<{
    claim: string;
    evidenceRefs: FactId[];
    confidence: "high" | "medium" | "low";
  }>;
}
```

Unknown `factsUsed` references or contradictions with authored facts fail
validation. Narrative generation is an authoring operation, not a hidden game
startup call.

## 7. Deterministic Build Path

1. Parse the legacy adapter or v2 manifest.
2. Validate types, IDs, ranges and provenance.
3. Resolve polity, region and entity identities.
4. Build geometry and reviewed macro-region mappings.
5. Record explicit unknowns, assumptions and fidelity.
6. Derive runtime rules and capabilities.
7. Assemble projections under one candidate world revision.
8. Reconcile references and protected historical facts.
9. Atomically publish the revision manifest and projections.

An optional `draftScenarioGaps` tool may produce a reviewable patch before this
pipeline. Its output never enters canonical files automatically.

## 8. Validation

| Layer | Blocking | Purpose |
|---|---|---|
| Schema | Yes | Shapes, ranges, IDs and required provenance. |
| World-aware | Yes | References, dates, control and era constraints. |
| Reconciliation | Yes | Totals, residuals, macro/GID mappings and cross-module consistency. |
| Semantic AI review | No | Possible anachronisms or suspicious assumptions. |
| Atomic publish | Yes | Checksums, one revision and rollback safety. |

AI findings remain advisory until expressed as deterministic validation rules.

## 9. Runtime State

Phase 1 should not immediately split every future mechanic into separate files.
First introduce a world revision and atomic write helper around the current
state. Modular economy/culture/religion/resources/mobilization/influence assets
are later projections of that revision, not independent databases.

Consumers synchronize by revision. Current polling remains a compatibility
mechanism; exact intervals are measured rather than frozen in the domain spec.

## 10. Implementation Sequence

1. AI call registry and observable context/cost ledger.
2. World revision plus crash-safe atomic commit tests.
3. TypeScript domain scaffold for stable IDs, commands, events and schemas.
4. Minimal v2 scenario adapter with provenance and pregame `factsUsed` checks.
5. World 1916 wave-one fixtures for Russia, Germany and Britain, each carrying
   one sourced observation through load, command, deterministic state change,
   save/replay and narrative explanation.
6. World 1797 thin fixture proving no hidden modern-era assumption.

Only after these pass should the team add full modular simulation domains,
automatic macro-region tooling or optional AI authoring assistants.

## 11. Deferred Roadmap

- Full economy, population, logistics, armed forces and politics.
- Culture/religion diffusion and five mature map modes.
- World 1853 and World 1690 content production.
- Model selection for optional authoring and semantic review.
- Detailed Scenario Package v2 editor and distribution.
- Live macro-region splitting after control changes.

The recovered agent specifications in `recovered/` remain valuable design input
for these later milestones, but they are not a Phase 1 implementation checklist.

## 12. World 1916 Curation Waves

| Wave | Polities | Purpose |
|---|---|---|
| 1 — foundation and debugging | Russian Empire, German Empire, British Empire | Revolution/state continuity; industrial land war; naval, colonial and trade systems. |
| 2 — continental completion | France, Austria-Hungary, Ottoman Empire, United States | Republican politics, multinational collapse, straits/imperial reform, neutral-to-belligerent transition. |
| 3 — global breadth | Republic of China and regional actors, Japan, Italy, Spain, Switzerland | Fragmented authority, Asian great-power expansion, secondary belligerents, neutrality and finance. |

Every other polity reaches an honest `Baseline` before World 1916 is called
globally playable. A wave means curation order, not separate engine code.

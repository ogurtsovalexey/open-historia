# Minimal Scenario V2 Integrity Contract

Status: Accepted Phase 1 design contract
Scope: AC-4, AC-5, AC-6 and AC-9 only

This contract defines the smallest authored scenario input that can build and
load deterministically, preserve provenance and protect starting truth. It is
not the full Scenario Package v2 platform described in the product roadmap.
Economy, culture, religion, logistics, armed forces, politics, distribution and
authoring UI remain later modules.

## 1. Authority and lifecycle

A Scenario V2 package is immutable authored input. A game stores the package ID,
version and input checksum from which it was seeded, but runtime commands never
write back into the package. AI output has two possible roles:

- at authoring time it may produce a `DraftScenarioPatch` for review;
- at runtime it may propose typed commands/events against the mutable game.

Neither role may mutate the scenario directly. A Draft becomes authored input
only through an explicit human review operation outside the build command.
Loading, building and starting a pinned package perform zero network requests
and zero model calls.

## 2. Phase 1 package boundary

The logical input bundle has three required JSON documents and one optional
Draft area:

```text
scenario-v2/
  manifest.json       # identity, version, entrypoints and pinned assets
  scenario.json       # authored starting world and integrity records
  sources.json        # source metadata referenced by scenario facts
  drafts/             # ignored by canonical build; never auto-applied
```

An implementation may accept the same logical documents as one in-memory
object for tests. File names and content are resolved from `manifest.json`; the
builder must not discover arbitrary files by directory order or glob.

The minimum manifest is:

```ts
interface ScenarioV2Manifest {
  schemaVersion: 2;
  id: ScenarioId;
  contentVersion: SemVer;
  engineRange: string;
  defaultLocale: string;
  scenarioPath: "scenario.json";
  sourcesPath: "sources.json";
  assets: ScenarioAssetRef[];
}

interface ScenarioAssetRef {
  id: AssetId;
  kind: "regions" | "cities" | "background" | "other";
  path?: RelativePackagePath;
  contentAddress?: `sha256:${string}`;
  mediaType: string;
  required: boolean;
}
```

`sources.json` is a strict `SourceRef[]`. Manifest and scenario IDs must match;
`contentVersion` is SemVer without a leading `v`, and `engineRange` is a
deterministically parsed SemVer range. `defaultLocale` must exist in scenario
metadata when localized metadata is present.

Every required local asset has a SHA-256 content address. A shared asset may be
addressed without an embedded `path`, but it must already exist in the local
content-addressed store before build. The builder never downloads a missing
asset. Paths are package-relative, use `/`, and cannot contain an absolute
prefix, `..`, URL, drive letter or symlink escape.

## 3. Stable identifiers

IDs are opaque after validation. Display and localized names never participate
in equality or references. All slugs are lowercase ASCII, begin with a letter,
end with a letter or digit, and contain only single `-` separators. Maximum ID
length is 160 characters.

| Entity | Format | Example |
|---|---|---|
| Scenario | `scenario:<slug>` | `scenario:world-1916` |
| Polity | `polity:<slug>` | `polity:russian-empire` |
| Source | `source:<scenario-slug>:<slug>` | `source:world-1916:russia-yearbook-1916` |
| Fact | `fact:<scenario-slug>:<slug>` | `fact:world-1916:russia-observation-001` |
| Assumption | `assumption:<scenario-slug>:<slug>` | `assumption:world-1916:russian-territorial-basis` |
| Macro-region | `macro-region:<scenario-slug>:<slug>` | `macro-region:world-1916:eastern-front-test` |
| Draft patch | `draft-patch:<scenario-slug>:<slug>` | `draft-patch:world-1916:gap-pass-001` |
| Package asset | `asset:<scenario-slug>:<slug>` | `asset:world-1916:regions` |

Source geography uses a qualified ID rather than silently treating a dataset
label as scenario truth:

```ts
interface RegionRef {
  id: RegionId;                 // region:gadm-4-1:RUS.33_1
  dataset: "gadm" | string;
  datasetVersion: string;       // 4.1
  nativeId: string;             // exact immutable GID, e.g. RUS.33_1
}
```

`RegionId` has the form `region:<dataset-slug>:<native-id>`. The native segment
may contain ASCII letters, digits, `.`, `_` and `-` and is case-sensitive.
Normalization must never change the native ID. Scenario-owned macro-regions
list exact `RegionId` members and never renumber or replace them.

The dataset slug is the normalized dataset plus version (`gadm` + `4.1` →
`gadm-4-1`) and must agree with the two explicit fields. All scenario-scoped ID
namespaces must match the slug in the manifest Scenario ID; a World 1797 package
cannot silently reference `fact:world-1916:*`.

IDs are unique across their entity type. A reference uses the full typed ID;
aliases and localized names are import/repair metadata only. Unknown,
wrong-type and duplicate references are blocking errors with JSON paths.
For ID-keyed records such as `polities`, the record key must equal the embedded
`id`; the builder never repairs one from the other.

## 4. Minimum authored scenario

```ts
interface ScenarioV2 {
  schemaVersion: 2;
  id: ScenarioId;
  meta: ScenarioMeta;
  game: {
    startDate: GameDate;
    defaultPlayer: PolityId;
  };
  polities: Record<PolityId, PolityDef>;
  regions: RegionRef[];
  regionAssignments?: Record<RegionId, PolityId>;
  cities?: CityDef[];
  simulationRules: AuthorSimulationRules;
  historicalFacts: HistoricalFact[];
  assumptions: ScenarioAssumption[];
  macroRegions: MacroRegionDef[];
  fidelity: ScenarioFidelityManifest;
}

interface ScenarioMeta {
  title: string;
  description?: string;
  locales?: Record<string, { title: string; description?: string }>;
}

interface PolityDef {
  id: PolityId;
  name: string;
  aliases?: string[];
  color: `#${string}`;
}

interface MacroRegionDef {
  id: MacroRegionId;
  name: string;
  members: RegionId[];
  purpose: "aggregation" | "fixture" | "historical-area";
  geometryAssetRef?: AssetId;
}
```

`AuthorSimulationRules` is the accepted structured form from
`consensus-spec.md`: `era`, `aiHistoryMode`, `constraints` and
`technologyLevel` are required; factions and active conflicts are optional.
New v2 packages cannot store a prose-only rules string. Narrative rules may
appear only inside `constraints.narrativeRules[]` and never substitute for a
mechanical capability flag.

For Phase 1, macro-regions are reviewed semantic groupings. Membership is
explicit, non-empty and duplicate-free. One source region may not belong to two
macro-regions with the same `purpose` unless the scenario declares the overlap
in an accepted assumption. Macro-regions do not change Region IDs, sovereignty
or control and are never expanded by fuzzy matching. Dynamic splitting and
promotion are deferred.

## 5. Facts, values and provenance

All authored starting observations use one shape:

```ts
interface HistoricalFact {
  id: FactId;
  role: "observation" | "starting-value";
  subjectRefs: EntityId[];
  predicate: string;
  effectiveRange: DateRange;
  value: FactValue;
  sourceRefs: SourceId[];
  assumptionRefs: AssumptionId[];
  confidence: "high" | "medium" | "low" | "assumption";
  transformation: TransformationStep[];
  note?: string;
}

type FactValue =
  | { kind: "quantity"; amount: string; unit: string; scope?: string }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "entity-ref"; value: EntityId }
  | { kind: "unknown"; expectedKind: "quantity" | "text" | "boolean" | "entity-ref"; reason: string };

interface TransformationStep {
  operation: "identity" | "unit-conversion" | "calendar-conversion" |
    "currency-conversion" |
    "territorial-allocation" | "aggregation" | "scenario-choice";
  description: string;
  inputSourceRefs: SourceId[];
  formula?: string;
}

interface SourceRef {
  id: SourceId;
  title: string;
  publisher?: string;
  publicationDate?: string;
  locator: string;
  retrievedAt?: GameDate;
  contentHash?: `sha256:${string}`;
  license: {
    status: "redistributable" | "metadata-only" | "unknown";
    name?: string;
    url?: string;
  };
  note?: string;
}
```

Decimal quantities serialize as base-10 strings, never binary floating-point.
The unit string is required even for counts (`person`, `unit`, `RUB-1913`, etc.).
`GameDate` is the engine's `YYYY-MM-DD` proleptic-Gregorian serialization, not
a claim that a historical source used that calendar. A source using another
calendar requires an explicit conversion transformation and, when the mapping
is a scenario choice, an assumption reference. `DateRange.from` and optional
`DateRange.until` are inclusive and `from <= until`. Fiscal year, territorial
scope and population universe go in `scope` and/or transformation, not in an
undocumented field name.

An `unknown` is data, not a default. It has no amount and cannot enter a formula
until a typed mechanic defines explicit unknown handling. `sourceRefs` may be
empty only for `unknown` values whose reason describes the completed/limited
source search, or for known values with a non-empty `assumptionRefs` list. All
known values require at least one source or an accepted assumption; using both
is allowed and normally preferable.

An `observation` preserves what a source reports, including incompatible
estimates. A `starting-value` is the one value consumed by the fixture/runtime
for its declared subject, predicate, range and scope. Multiple comparable
starting values are a reconciliation error. Selecting one from conflicting
observations requires traceable transformations and, where evidence does not
decide the choice, an authored assumption.

## 6. Missing data, assumptions and fidelity

Required package structure, identity, player polity, start date, simulation
rules, region references and every value consumed by an enabled Phase 1 fixture
mechanic cannot be omitted. Missing required data is a blocking error.

Optional data is allowed only when the fidelity manifest records why it is
unknown, assumed or not applicable:

```ts
interface ScenarioAssumption {
  id: AssumptionId;
  statement: string;
  rationale: string;
  affectedPaths: JsonPointer[];
  sourceRefs: SourceId[];
  status: "authored";
}

interface ScenarioFidelityManifest {
  intendedUse: "test-fixture" | "development-scenario" | "playable-scenario";
  polityLevels: Record<PolityId, "Baseline" | "Supported" | "Curated">;
  gaps: Array<{
    path: JsonPointer;
    disposition: "unknown" | "assumption" | "not-applicable";
    reason: string;
    assumptionRef?: AssumptionId;
  }>;
}
```

An assumption is authored starting truth for that package version, visibly
marked as a scenario choice; it is not a fact manufactured by AI. Every fact
with `confidence:"assumption"` has a non-empty `assumptionRefs` list, is covered
by the referenced assumption's affected path and a fidelity gap, and uses a
`scenario-choice` transformation. Draft or unreviewed assumptions cannot appear
in canonical input.

`playable-scenario` is invalid unless every selectable polity has at least
`Baseline`. A `test-fixture` may contain only its named test seats but must not
be presented in the scenario library as a global/playable historical package.
Fidelity expresses honest coverage, never permission to invent detail.

This contract deliberately does not choose the Russian 1916 territorial basis,
Julian-to-Gregorian conversion policy, British metropole-versus-empire scope,
fiscal-year alignment, disputed historical estimate or redistribution license.
When a Phase 1 fixture consumes such a value, it must preserve competing
`observation` facts and identify the selected `starting-value` with explicit
scope/transformation and an authored assumption where evidence alone does not
determine the choice. Until review occurs, the value remains an `unknown`/gap
or the entire package remains Draft. Source license status is recorded per
source and never inferred from availability of a download.

## 7. Protected authored truth

Every field in the canonical input bundle is immutable after game creation.
The following path families additionally form the explicit protected-path test
set for imports, Draft patches and AI proposals:

```text
/manifest/schemaVersion
/manifest/id
/manifest/contentVersion
/scenario/id
/scenario/schemaVersion
/scenario/game/startDate
/scenario/polities/*/id
/scenario/regions/*/id
/scenario/regions/*/datasetVersion
/scenario/regions/*/nativeId
/scenario/regionAssignments/*
/scenario/simulationRules
/scenario/historicalFacts/*
/scenario/assumptions/*
/scenario/macroRegions/*/members
/sources/*
```

Runtime commands/events may carry references to these values but cannot emit
patch operations targeting `scenario/**`. A mutable campaign may change current
control, name, policy or statistics through accepted domain events; the authored
starting projection and its provenance remain available under the pinned
scenario checksum for comparison and replay.

Only a reviewed authoring operation can create a new content version. It writes
a new side-by-side package or package revision; it never edits an existing game
or an already published package version in place.

## 8. Pregame narrative integrity

Pregame narrative is optional authoring output and is never generated during
normal build/load/startup. Its Draft shape is:

```ts
interface PregameNarrativeDraft {
  schemaVersion: 1;
  scenarioId: ScenarioId;
  baseInputChecksum: `sha256:${string}`;
  segments: PregameNarrativeSegment[];
  factsUsed: FactId[];
  inferredClaims: InferredClaim[];
}

interface PregameNarrativeSegment {
  text: string;
  kind: "fact" | "inference" | "narrative-color";
  factRefs: FactId[];
  claimRefs: string[];
}

interface InferredClaim {
  id: string;
  claim: string;
  evidenceRefs: FactId[];
  confidence: "high" | "medium" | "low";
  assertion: {
    subjectRef: EntityId;
    predicate: string;
    operator: "equals" | "not-equals" | "less-than" | "less-or-equal" |
      "greater-than" | "greater-or-equal" | "contains";
    value: Exclude<FactValue, { kind: "unknown" }>;
  };
}
```

The displayed `text` is the ordered concatenation of segments. Validation is
deterministic and blocking:

1. `scenarioId` and checksum must match the pinned input.
2. Every `factsUsed`, `factRefs` and `evidenceRefs` ID must resolve.
3. `factsUsed` must equal the de-duplicated union of segment/evidence fact IDs.
4. `fact` segments require at least one fact reference; `inference` segments
   require at least one claim reference; narrative color cannot carry an
   assertion or factual number.
5. Every assertion subject/predicate/type/unit must be comparable with its
   evidence and any protected `starting-value` for the same
   subject/predicate/overlapping range.
6. A claim whose assertion contradicts an authored comparable starting value
   fails. Quantity comparisons require the same canonical unit; text supports
   only `equals`, `not-equals` and `contains`; entity/boolean supports equality
   and inequality. Unsupported comparison is a validation error, not a pass.
   Unknown evidence cannot prove an equality or numeric bound.
7. A claim cannot cite an assumption as higher confidence than `low`.

`narrative-color` rejects claim/fact references and ASCII numeric tokens. This
is a narrow deterministic guard, not semantic understanding. An authoring model
receives only the selected facts/assumptions and task-specific map semantics;
package geometry and the full region catalog never enter its prompt.

The validator does not pretend to understand arbitrary prose. It guarantees the
structured assertions above. Possible semantic contradiction inside wording is
reported by optional advisory review and keeps the artifact Draft; it never
changes canonical facts. Promotion requires human review of the rendered text.

## 9. Draft patch and legacy migration

```ts
interface DraftScenarioPatch {
  schemaVersion: 1;
  id: DraftPatchId;
  status: "draft";
  base: {
    scenarioId: ScenarioId;
    contentVersion: SemVer;
    inputChecksum: `sha256:${string}`;
  };
  operations: Array<{
    op: "add" | "replace" | "remove";
    path: JsonPointer;
    value?: JsonValue;
    sourceRefs: SourceId[];
    assumptionRefs: AssumptionId[];
    rationale: string;
  }>;
}
```

Draft patches are validated and previewed against their exact base checksum.
They cannot target generated output, existing games or another scenario. No
command in the runtime/build path applies them automatically. Promotion is a
separate reviewed authoring action that emits a new `contentVersion`, runs the
full validation/build pipeline and produces a diff/report.

Legacy `.spec.mjs` compatibility has two distinct paths:

- the existing trusted local legacy builder remains readable and unchanged;
- an explicit migration command imports its resolved data into a new sibling
  Draft directory and writes a loss/gap report.

Migration never rewrites the `.spec.mjs`, its generated scenario, any save or
manifest entry. Name-keyed identities receive deterministic proposed IDs plus a
collision report; unresolved collisions block the Draft. Prose simulation rules
move to `constraints.narrativeRules[]` and create a warning that mechanical
capabilities still require review. Missing sources, units, confidence and
territorial basis become explicit fidelity gaps, never fabricated assumptions.
Running migration twice from the same input produces byte-identical Draft data
and report; noncanonical execution metadata is printed separately.

## 10. Deterministic build and checksum

The builder operates in this order:

1. parse strict JSON documents (or the resolved trusted legacy adapter);
2. validate schemas and ID syntax;
3. resolve all typed references;
4. validate dates, units, sources, assumptions, fidelity and macro membership;
5. reconcile protected facts and optional pregame Draft assertions;
6. resolve only locally pinned assets;
7. normalize set-like collections by typed ID and preserve order-significant
   arrays such as narrative segments and transformation steps;
8. canonicalize JSON using RFC 8785/JCS semantics encoded as UTF-8;
9. calculate `sha256` per logical input and one bundle input checksum;
10. assemble candidate runtime projections and publish them through the atomic
    revision boundary.

Canonical checksum input includes schema-valid manifest/scenario/source data,
the byte hashes of required assets and the builder contract version. It excludes
Drafts, file paths outside the package, mtime, permissions, `generatedAt`, local
machine/user data, logs, network responses, LLM output and atomic publication
revision IDs. The output manifest records both the stable input checksum and
artifact checksums. Three clean builds from identical pinned input must match.

No build step reads current time, locale, unordered filesystem enumeration,
randomness, environment credentials or network. Diagnostics are sorted by JSON
path, code and referenced ID so failure reports are deterministic too.

## 11. Validation ownership

| Layer | Zod/JSON Schema | World-aware/reconciliation |
|---|---|---|
| Strict object keys and primitive types | Yes | No |
| ID/date/decimal/checksum/path syntax | Yes | No |
| Discriminated fact/Draft unions | Yes | No |
| Known and correctly typed references | No | Yes |
| Source/license availability rules | Shape only | Yes |
| Effective ranges and scenario start | Shape only | Yes |
| Macro membership/overlap | Shape only | Yes |
| Required data for enabled fixture mechanics | No | Yes |
| Fidelity gap/assumption coverage | Shape only | Yes |
| Protected-path mutation | Patch shape only | Yes |
| Comparable pregame contradiction | Assertion shape only | Yes |
| Semantic anachronism/free-prose meaning | No | Advisory only |
| Canonical checksums/atomic publication | No | Build/persistence |

All input schemas use strict objects and discriminated unions. Zod is the
runtime source of truth; exported JSON Schema must accept and reject the same
representative fixtures. World-aware validation takes already parsed values
and returns stable `{code, path, message, refs[]}` diagnostics. It never repairs
or drops invalid canonical data silently.

Diagnostic codes use stable families: `schema.*`, `reference.*`,
`provenance.*`, `integrity.*`, `build.*` and `migration.*`. Human wording may
improve without changing the code/path contract used by tests and tooling.

## 12. Examples

Minimal structural test-fixture input (not a playable historical scenario):

```json
{
  "manifest": {
    "schemaVersion": 2,
    "id": "scenario:world-1797-contract-test",
    "contentVersion": "0.1.0",
    "engineRange": ">=0.1.0 <1.0.0",
    "defaultLocale": "en",
    "scenarioPath": "scenario.json",
    "sourcesPath": "sources.json",
    "assets": []
  },
  "scenario": {
    "schemaVersion": 2,
    "id": "scenario:world-1797-contract-test",
    "meta": {
      "title": "World 1797 contract test",
      "locales": { "en": { "title": "World 1797 contract test" } }
    },
    "game": {
      "startDate": "1797-01-01",
      "defaultPlayer": "polity:kingdom-of-prussia"
    },
    "polities": {
      "polity:kingdom-of-prussia": {
        "id": "polity:kingdom-of-prussia",
        "name": "Kingdom of Prussia",
        "aliases": [],
        "color": "#334455"
      }
    },
    "regions": [{
      "id": "region:gadm-4-1:DEU.1_1",
      "dataset": "gadm",
      "datasetVersion": "4.1",
      "nativeId": "DEU.1_1"
    }],
    "regionAssignments": {
      "region:gadm-4-1:DEU.1_1": "polity:kingdom-of-prussia"
    },
    "simulationRules": {
      "era": "revolutionary-and-napoleonic",
      "aiHistoryMode": "conditional",
      "constraints": {
        "noAirPower": true,
        "narrativeRules": []
      },
      "technologyLevel": {
        "era": "early-industrial",
        "notable": []
      }
    },
    "historicalFacts": [{
      "id": "fact:world-1797-contract-test:prussia-road-capacity-unknown",
      "role": "starting-value",
      "subjectRefs": ["polity:kingdom-of-prussia"],
      "predicate": "transport.road-capacity",
      "effectiveRange": { "from": "1797-01-01" },
      "value": {
        "kind": "unknown",
        "expectedKind": "quantity",
        "reason": "No reconciled source has been selected for this contract fixture."
      },
      "sourceRefs": [],
      "assumptionRefs": [],
      "confidence": "low",
      "transformation": []
    }],
    "assumptions": [],
    "macroRegions": [{
      "id": "macro-region:world-1797-contract-test:prussia-contract-test",
      "name": "Prussia contract test area",
      "members": ["region:gadm-4-1:DEU.1_1"],
      "purpose": "fixture"
    }],
    "fidelity": {
      "intendedUse": "test-fixture",
      "polityLevels": {
        "polity:kingdom-of-prussia": "Baseline"
      },
      "gaps": [{
        "path": "/historicalFacts/0/value",
        "disposition": "unknown",
        "reason": "This schema fixture deliberately has no road-capacity estimate."
      }]
    }
  },
  "sources": []
}
```

Synthetic valid fact/source pair (the values below demonstrate shape and are
not historical evidence):

```json
{
  "source": {
    "id": "source:world-1916:synthetic-contract-example",
    "title": "Synthetic contract example — not historical evidence",
    "locator": "docs/spec/scenario-v2-integrity.md#examples",
    "license": { "status": "metadata-only" }
  },
  "fact": {
    "id": "fact:world-1916:russia-starting-revenue-001",
    "role": "starting-value",
    "subjectRefs": ["polity:russian-empire"],
    "predicate": "fixture.monthly-revenue",
    "effectiveRange": { "from": "1916-01-01", "until": "1916-01-31" },
    "value": { "kind": "quantity", "amount": "1000000", "unit": "RUB-1913", "scope": "fixture estimate; declared territorial basis" },
    "sourceRefs": ["source:world-1916:synthetic-contract-example"],
    "assumptionRefs": [],
    "confidence": "low",
    "transformation": [{
      "operation": "aggregation",
      "description": "Synthetic transformation for the contract shape example; not historical evidence.",
      "inputSourceRefs": ["source:world-1916:synthetic-contract-example"]
    }]
  }
}
```

Explicit unknown rather than a hidden zero:

```json
{
  "id": "fact:world-1797:prussia-road-capacity-unknown",
  "role": "starting-value",
  "subjectRefs": ["polity:kingdom-of-prussia"],
  "predicate": "transport.road-capacity",
  "effectiveRange": { "from": "1797-01-01" },
  "value": {
    "kind": "unknown",
    "expectedKind": "quantity",
    "reason": "No reconciled fixture source has been selected."
  },
  "sourceRefs": [],
  "assumptionRefs": [],
  "confidence": "low",
  "transformation": []
}
```

Invalid examples include a known quantity without a unit/source, a fact whose
`polity:*` subject is absent, an overlapping macro member without an assumption,
a Draft assertion that says revenue equals `2000000` against the protected
`1000000` fact, and a legacy migration that writes over its input directory.

## 13. Phase 1 acceptance matrix

| Test | Expected result | Gate |
|---|---|---|
| Build the same pinned bundle three times with clock/network/credentials unavailable | Identical input and artifact checksums; zero generation requests | AC-4 |
| Missing required manifest/scenario/source document | Stable blocking path diagnostic | AC-4 |
| Missing required shared asset in local content store | Offline blocking error; no download attempt | AC-4 |
| Rename a polity display/localized name | All stable references remain valid | AC-4, AC-5 |
| Known quantity lacks unit, effective range, source or confidence | Blocking validation error | AC-5 |
| Optional gap omitted from fidelity manifest | Blocking validation error | AC-5 |
| Explicit unknown with gap record | Valid but never coerced to zero/default | AC-5 |
| Assumption lacks authored status/rationale/affected path | Blocking validation error | AC-5 |
| Unknown source/entity/fact/assumption/macro member reference | Blocking typed path diagnostic | AC-5, AC-6 |
| Pregame Draft references unknown `factsUsed` | Blocking validation error | AC-6 |
| `factsUsed` differs from referenced union | Blocking validation error | AC-6 |
| Comparable assertion contradicts protected fact | Blocking validation error | AC-6 |
| Narrative-color segment contains factual assertion/number | Blocking validation error | AC-6 |
| Optional semantic reviewer flags prose | Artifact remains Draft; canonical build unchanged | AC-6 |
| Runtime/AI patch targets a protected scenario path | Rejected before state commit | AC-6, AC-9 |
| Legacy import with name collision/missing provenance | Side-by-side Draft plus stable loss/gap report; original unchanged | AC-9 |
| Repeat legacy import from identical input | Byte-identical Draft/report; no second mutation | AC-9 |
| Draft patch base checksum is stale | Blocking error; no auto-rebase/apply | AC-9 |
| Load existing preset/save after v2 tooling is installed | Existing bytes and behavior unchanged | AC-9 |
| Same 1797 fixture enables no rail/air capability | Shared validator rejects an injected modern-only rule | AC-4, AC-5 |

Passing this contract makes #26 implementable and supports the narrow #19
vertical-slice proof. It does not make either historical scenario globally
playable and does not authorize unsourced content production.

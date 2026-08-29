# Phase 1 Test Plan - Evidence-Grounded Executable QA Matrix

> Canonical reference: this plan maps the binding Phase 1 acceptance criteria in
> [`acceptance-criteria.md`](acceptance-criteria.md) AC-1 through AC-9 to executable
> tests. It replaces the recovered pre-consolidation artifact with a bidirectional
> matrix that names a real production boundary for every proposed test.
>
> Scope: only AC-1 through AC-9. Recovered later-roadmap material is preserved under
> a clearly labeled deferred heading at the end of this document.

Issue ownership in this document is sourced from live Issue bodies and labels
(`gh issue view` on the private repository), not from the original decomposition
sentence. The authoritative mapping is:

| Issue | Title | State | Role here |
|-------|-------|-------|-----------|
| #2 | Audit runtime translation AI usage | closed | Evidence source for static-localization gap |
| #10 | Implement the accepted AI call registry and ledger | closed | Monolithic origin, later decomposed |
| #11 | Verify AI registry budgets, redaction and provider parity | closed | Prior QA, superseded by #40 |
| #12 | Remove runtime AI from static UI translation | open | AC-1 static-localization implementation |
| #16 | Define atomic world-revision contract | closed | Accepted AC-2 contract |
| #17 | Implement six-projection atomic world revisions | open | AC-2 implementation |
| #18 | Scaffold strict TypeScript domain package | open | AC-3 implementation |
| #19 | Prove the World 1916/1797 vertical slice end to end | open | AC-7 / AC-8 implementation |
| #22 | Define the minimal Scenario V2 integrity contract | closed | Accepted AC-4 / AC-5 / AC-6 / AC-9 contract |
| #26 | Implement the minimal Scenario V2 adapter and validators | open | AC-4 / AC-5 / AC-6 / AC-9 implementation |
| #37 | Build the pure AI registry and ledger core | open | AC-1 implementation (core) |
| #38 | Instrument provider transports with enforced budgets | open | AC-1 implementation (transports) |
| #39 | Integrate invocation outcomes with validation and committed effects | open | AC-1 implementation (outcomes) |
| #40 | Prove redaction, persistence and production-seam parity | open | AC-1 independent QA |

---

## 1. Acceptance-Criteria Bidirectional Mapping

Every row below names one production boundary and marks it EXISTS NOW or PLANNED.
EXISTS NOW is used only where a repository-wide search located the exact symbol in
runtime code. PLANNED marks a boundary whose implementation Issue is open and not
yet merged.

### AC-1 - Observable AI

Source contract: [`ai-call-registry.md`](ai-call-registry.md); implementation #12,
#37, #38 and #39; independent QA #40.

| Test ID | Production Boundary | Fixture/Precondition | Observable Expected Failure/Result | Runner/Discovery Path | Status | Owner vs. QA |
|---------|--------------------|----------------------|------------------------------------|-----------------------|--------|--------------|
| AC-1-01 | EXISTING `callAI` in `src/Game/AI/main.jsx` | Mock provider returning usage; canary secrets in prompt | No ledger record is produced today (registry not yet wired); planned result: invocation + transport-attempt stubs exist before dispatch | `node --test` colocated under `src/Game/AI/` | PLANNED | #37/#38 implement, #40 validates |
| AC-1-02 | PLANNED task-registry lookup inside `callAI` | Unknown `taskId` passed to an instrumented call | PLANNED: rejected before network and recorded as `registry.unknown` | `node --test` colocated `src/Game/AI/` | PLANNED | #37 implements, #40 validates |
| AC-1-03 | PLANNED context-manifest guard at final prompt assembly | Prompt assembled for `timeline.advance`; attempt to register a full-map item | PLANNED: `fullMapIncluded: false` is the only accepted value; a full-map item fails the guard before dispatch | `node --test` at the assembly seam | PLANNED | #37 implements, #40 validates |
| AC-1-04 | PLANNED deterministic speaker selection | Exactly two eligible speakers | PLANNED: deterministic selection with zero model calls; no `legacy.two-party-speaker` record | `node --test` speaker-selection unit | PLANNED | #37/#39 implement, #40 validates |
| AC-1-05 | PLANNED static localization path | Language-pack string lookup | PLANNED: zero model calls; no `legacy.runtime-translation` record | `node --test` with mocked `callAI` spy | PLANNED | #12 implements; #39 integrates; #40 validates |
| AC-1-06 | PLANNED three accounting levels | Structured task with parse failure then correction then success | PLANNED: 1 invocation, 2 generation attempts, >=2 transport attempts | `node --test` ledger unit | PLANNED | #37 implements, #40 validates |
| AC-1-07 | PLANNED redaction boundary | Canary secrets in headers, URLs, prompts, responses, error bodies | PLANNED: none appear in serialized records | `node --test` canary tests | PLANNED | #37 implements, #40 validates |
| AC-1-08 | PLANNED provider adapters for gemini, openai, anthropic, openai-compatible, anthropic-compatible | One modeled response per provider family | PLANNED: same domain record shape; missing usage/cost stays `null`, never zero | `node --test` adapter suite | PLANNED | #38 implements, #40 validates |
| AC-1-09 | PLANNED bounded ledger | >200 closed invocations simulated | PLANNED: oldest closed evicted; current and recent survive restart | `node --test` ledger unit | PLANNED | #37 implements, #40 validates |

The five provider families above are taken from the accepted contract enum
(`AiProfileSnapshot.providerKind` in `ai-call-registry.md` section 4) and from the
current `PROVIDER_OPTIONS` in `src/Game/AI/providerConfig.js`.

Validation wording (unchanged): every production model call has a registered task,
selected profile, context manifest, token budget, latency, usage/cost record and
accepted state effect. Two-party speaker selection and static localization make no
model call.

### AC-2 - Atomic State

Source contract: [`atomic-world-revision.md`](atomic-world-revision.md) (#16 accepted); implementation #17.

| Test ID | Production Boundary | Fixture/Precondition | Observable Expected Failure/Result | Runner/Discovery Path | Status | Owner vs. QA |
|---------|--------------------|----------------------|------------------------------------|-----------------------|--------|--------------|
| AC-2-01 | PLANNED compare-and-swap commit | Two commits resolving the same `expectedRevision` | PLANNED: exactly one succeeds; the other reports `conflict` with the winning revision | `node --test` storage-adapter test | PLANNED | #17 implements |
| AC-2-02 | PLANNED staged-write failure injection | Inject failure before and after each staging/publication step | PLANNED: previous complete revision stays readable; no mixed projection | `node --test` fault-injection | PLANNED | #17 implements |
| AC-2-03 | PLANNED corrupt/missing projection | Remove or corrupt one of actions/chat/events/game/world/colors | PLANNED: manifest cannot become/read as current; recovery selects last complete parent | `node --test` filesystem adapter | PLANNED | #17 implements |
| AC-2-04 | PLANNED coherent read under contention | Read repeatedly while a commit is paused at each step | PLANNED: every accepted read has one verified revision | `node --test` interleaving | PLANNED | #17 implements |
| AC-2-05 | PLANNED active-game switch isolation | Switch active game during in-flight commit | PLANNED: only the explicit target game changes | `node --test` multi-game | PLANNED | #17 implements |
| AC-2-06 | PLANNED legacy baseline import | Manifest-less save imported side-by-side | PLANNED: first revisioned write failing leaves the legacy baseline readable | `node --test` migration bridge | PLANNED | #17 implements |
| AC-2-07 | EXISTING `writeRuntimeJsonAsset` in `server/libraryStore.js` | Legacy per-asset write that races a revisioned write | Today: last-writer-wins. PLANNED: routed through the transaction helper and conflicts when stale | `node --test` server storage | PLANNED | #17 implements |
| AC-2-08 | PLANNED rollback crash safety | Crash before, during and after rollback publication | PLANNED: restart exposes pre-rollback or complete rollback with a valid restore path | `node --test` fault-injection | PLANNED | #17 implements |
| AC-2-09 | PLANNED retention pruning guard | Prune attempt against current, recovery-parent, UI-visible revision | PLANNED: prune forbidden; those revisions retained | `node --test` retention unit | PLANNED | #17 implements |
| AC-2-10 | PLANNED publication notification | `oh:turn-complete` and sync after durable commit | PLANNED: fires once after commit, never for conflicts or failed candidates | `node --test` notification spy | PLANNED | #17 implements |

The six-projection boundary in this row is `actions`, `chat`, `events`, `game`,
`world`, `colors` (`atomic-world-revision.md` section 1). It is not the deferred
economy/culture/religion/resources/mobilization/influence projections.

Validation wording (unchanged): every accepted turn commits under one world
revision; injected write failures leave the previous complete revision readable; no
date/map/action mismatch is observable after restart.

### AC-3 - Typed Authority

Source contract: [`consensus-spec.md`](consensus-spec.md) section 3 and principles; implementation #18 (strict TypeScript domain scaffold).

| Test ID | Production Boundary | Fixture/Precondition | Observable Expected Failure/Result | Runner/Discovery Path | Status | Owner vs. QA |
|---------|--------------------|----------------------|------------------------------------|-----------------------|--------|--------------|
| AC-3-01 | PLANNED stable-ID domain types | Generate entity identifiers (polity, region, event, command) | PLANNED: immutable, unique, not parseable for ordering | `node --test` domain-scaffold unit | PLANNED | #18 implements |
| AC-3-02 | EXISTING `applySimulationResult` in `src/Game/AI/gameplay.js` at the typed-command seam | Command/event payloads validated before deterministic resolution | PLANNED: malformed commands/events rejected; accepted shapes flow to resolution | `node --test` command validation | PLANNED | #18 implements |
| AC-3-03 | PLANNED protected state paths | AI output attempting to set a canonical total or overwrite an authored fact | PLANNED: direct write blocked; only validated commands and engine-computed effects apply | `node --test` protected-path unit | PLANNED | #18 implements |
| AC-3-04 | EXISTING authored-scenario fields (`simulationRules`, `countryAssignments`) | AI output attempting to overwrite an authored field | PLANNED: overwrite rejected; authored fact preserved | `node --test` scenario-authority unit | PLANNED | #18 implements |

Validation wording (unchanged): the vertical slice uses stable IDs, validated
commands/events and protected state paths. AI output cannot directly set canonical
totals or overwrite authored scenario facts.

### AC-4 - Deterministic Offline Scenario

Source contract: [`scenario-v2-integrity.md`](scenario-v2-integrity.md)
section 10 (#22 accepted); implementation #26, with the final dual-fixture proof
in #19.

| Test ID | Production Boundary | Fixture/Precondition | Observable Expected Failure/Result | Runner/Discovery Path | Status | Owner vs. QA |
|---------|--------------------|----------------------|------------------------------------|-----------------------|--------|--------------|
| AC-4-01 | EXISTING legacy build entry (`scripts/presets/build-preset.mjs`) plus PLANNED v2 builder | Pinned scenario, network disabled | PLANNED: builds and loads with zero LLM calls and no credentials | `node --test` offline build harness (not yet present) | PLANNED | #26 implements |
| AC-4-02 | PLANNED canonical checksum | Three builds from identical input | PLANNED: identical canonical checksums | `node --test` reproducibility harness (not yet present) | PLANNED | #26 implements |
| AC-4-03 | PLANNED zero-hidden-call instrumented build | Build run under the #37 instrumented `callAI` | PLANNED: zero invocations recorded | `node --test` against instrumented call | PLANNED | #37 + #26 |
| AC-4-04 | EXISTING deterministic resolution in `src/Game/AI/gameplay.js` | Same command + same world state | PLANNED: same resulting effect/revision | `node --test` determinism unit | PLANNED | #18/#19 owner |

Validation wording (unchanged): a pinned scenario builds and loads without network
access or LLM credentials; three builds from identical input produce identical
canonical checksums.

### AC-5 - Provenance and Missing Data

Source contract: [`scenario-v2-integrity.md`](scenario-v2-integrity.md)
sections 5-6 (#22 accepted); implementation #26.

| Test ID | Production Boundary | Fixture/Precondition | Observable Expected Failure/Result | Runner/Discovery Path | Status | Owner vs. QA |
|---------|--------------------|----------------------|------------------------------------|-----------------------|--------|--------------|
| AC-5-01 | PLANNED scenario-adapter validation | Historical number lacking units/date/source/confidence | PLANNED: rejected or marked low-fidelity, never silent | `node --test` adapter-validation unit | PLANNED | #26 implements |
| AC-5-02 | PLANNED required-field validation | Required gap in a scenario manifest | PLANNED: build-time error, not a hidden default | `node --test` adapter-validation unit | PLANNED | #26 implements |
| AC-5-03 | PLANNED explicit unknown/assumption markers | Optional field absent with a declared assumption | PLANNED: surfaced as explicit unknown or assumption | `node --test` fidelity-manifest unit | PLANNED | #26 implements |

Validation wording (unchanged): historical numbers carry units, date, source and
confidence; missing values are required errors, explicit unknowns or declared
assumptions - never hidden defaults.

### AC-6 - Pregame Facts

Source contract: [`scenario-v2-integrity.md`](scenario-v2-integrity.md)
section 8 (#22 accepted); implementation #26.

| Test ID | Production Boundary | Fixture/Precondition | Observable Expected Failure/Result | Runner/Discovery Path | Status | Owner vs. QA |
|---------|--------------------|----------------------|------------------------------------|-----------------------|--------|--------------|
| AC-6-01 | PLANNED `factsUsed[]` reference check | Generated pregame text whose `factsUsed[]` names an unknown `FactId` | PLANNED: deterministic validation fails | `node --test` pregame-validation unit | PLANNED | #26 implements |
| AC-6-02 | PLANNED contradiction detection | Pregame assertion contradicting a protected scenario starting value | PLANNED: deterministic validation rejects the Draft | `node --test` pregame-validation unit | PLANNED | #26 implements |

Validation wording (unchanged): generated pregame text references `factsUsed[]`;
unknown references and claims contradicting protected scenario fields fail
deterministic validation.

### AC-7 - World 1916 Wave-One Slice

Source contract: [`consensus-spec.md`](consensus-spec.md) section 10; implementation #19.

| Test ID | Production Boundary | Fixture/Precondition | Observable Expected Failure/Result | Runner/Discovery Path | Status | Owner vs. QA |
|---------|--------------------|----------------------|------------------------------------|-----------------------|--------|--------------|
| AC-7-01 | EXISTING load/command/resolve/save path via `src/Game/AI/gameplay.js` + PLANNED #17 commit | One sourced observation for Russia | PLANNED: observation travels load -> typed command -> deterministic resolve -> atomic save/replay -> causal narrative | `node --test` end-to-end slice (not yet present) | PLANNED | #19 implements |
| AC-7-02 | same boundary | One sourced observation for Germany | PLANNED: same pipeline | same harness | PLANNED | #19 implements |
| AC-7-03 | same boundary | One sourced observation for Britain | PLANNED: same pipeline | same harness | PLANNED | #19 implements |

Validation wording (unchanged): one sourced observation for each wave-one polity -
Russia, Germany and Britain - travels through scenario load, a typed player command,
deterministic resolution, atomic save/replay and a causal narrative explanation.

### AC-8 - World 1797 Compatibility

Source contract: [`consensus-spec.md`](consensus-spec.md) section 10; implementation #19.

| Test ID | Production Boundary | Fixture/Precondition | Observable Expected Failure/Result | Runner/Discovery Path | Status | Owner vs. QA |
|---------|--------------------|----------------------|------------------------------------|-----------------------|--------|--------------|
| AC-8-01 | EXISTING scenario load path + PLANNED #17 commit | Thin 1797 fixture | PLANNED: loads through the same contracts as 1916 | `node --test` slice harness (not yet present) | PLANNED | #19 implements |
| AC-8-02 | PLANNED era-assumption guard | 1797 fixture exposing a modern-era assumption | PLANNED: caught by the same validation, no separate engine code | `node --test` era-sensitivity unit | PLANNED | #19 implements |

Validation wording (unchanged): a thin 1797 fixture loads through the same contracts
and catches at least one modern-era assumption without requiring separate engine code.

### AC-9 - Migration Safety

Source contract: [`scenario-v2-integrity.md`](scenario-v2-integrity.md)
section 9 (#22 accepted); implementation #26.

| Test ID | Production Boundary | Fixture/Precondition | Observable Expected Failure/Result | Runner/Discovery Path | Status | Owner vs. QA |
|---------|--------------------|----------------------|------------------------------------|-----------------------|--------|--------------|
| AC-9-01 | EXISTING preset files under `scripts/presets/` | Migration run against the existing presets | PLANNED: source files remain untouched | `node --test` file-integrity harness (not yet present) | PLANNED | #26 implements |
| AC-9-02 | PLANNED side-by-side Draft path | v2 migration of one preset | PLANNED: produces a Draft plus validation report; no in-place rewrite | `node --test` adapter-migration unit | PLANNED | #26 implements |

Validation wording (unchanged): existing presets and saves remain untouched; any v2
migration produces a side-by-side Draft plus validation report.

---

## 2. Reverse Index (Test -> AC)

Every active test ID above maps back to exactly one AC. Any recovered case reused
later must re-enter this index under its own AC; nothing in this plan is left
orphaned.

| Test ID | AC |
|---------|----|
| AC-1-01 .. AC-1-09 | AC-1 |
| AC-2-01 .. AC-2-10 | AC-2 |
| AC-3-01 .. AC-3-04 | AC-3 |
| AC-4-01 .. AC-4-04 | AC-4 |
| AC-5-01 .. AC-5-03 | AC-5 |
| AC-6-01 .. AC-6-02 | AC-6 |
| AC-7-01 .. AC-7-03 | AC-7 |
| AC-8-01 .. AC-8-02 | AC-8 |
| AC-9-01 .. AC-9-02 | AC-9 |

Coverage: AC-1 (9 tests), AC-2 (10), AC-3 (4), AC-4 (4), AC-5 (3), AC-6 (2),
AC-7 (3), AC-8 (2), AC-9 (2). All nine criteria have at least one test; every test
maps to a criterion.

---

## 3. Repository Evidence: EXISTS NOW vs PLANNED

Repository evidence was reviewed against `private/main@c599ed3`. Searches ran with
`rg` against `src/`, `server/`, `scripts/` and `package.json`. A symbol that
appears only in the accepted spec documents or in this plan is recorded as PLANNED
(not yet implemented).

| Symbol / capability | EXISTS NOW (rg evidence) | PLANNED target / owning issue | Notes |
|---------------------|--------------------------|-------------------------------|-------|
| `callAI` | `src/Game/AI/main.jsx` `export async function callAI` | registry instrumentation (#37, #38, #39) | currently un-instrumented |
| `applySimulationResult` | `src/Game/AI/gameplay.js:1656` (referenced in `docs/audits/runtime-write-path-inventory.md`) | typed-command/atomic-commit seam (#17, #18) | currently six independent writes |
| `writeRuntimeJsonAsset` | `server/libraryStore.js:2315` | routed through revision transaction (#17) | currently last-writer-wins |
| `PROVIDER_OPTIONS` | `src/Game/AI/providerConfig.js` values: gemini, openai, anthropic, openai-compatible, anthropic-compatible | - | five provider families confirmed |
| `translationFilter` | `src/runtime/translationFilter.test.js` (filtering already-translated/static strings) | static localization path (#12), then lifecycle integration (#39) | NOT evidence of zero runtime calls |
| `diplomacyRouting` | `src/Game/AI/diplomacyRouting.js` exports normalize/c classify/merge plan, focused map context | deterministic 2-party speaker selection | speaker selection not yet present |
| `commitWorldRevision` | not found in `src/` `server/` `scripts/` | #17 | PLANNED |
| `selectNextSpeaker` | not found | #37/#39 | PLANNED |
| `factsUsed` / `inferredClaims` | not found in runtime; only accepted spec and recovered docs | scenario adapter (section 6) | PLANNED |
| `fullMapIncluded` | not found in runtime; only accepted contract | #37 context guard | PLANNED |
| scenario v2 adapter/schema helpers | not found as runtime modules | scenario adapter (section 7) | PLANNED |
| `ajv` | present only in `package-lock.json` and recovered docs | no runtime validation choice yet | not a Phase 1 accepted dependency |
| `.v2.spec` files | not found | migration Draft output (AC-9) | PLANNED |
| `npm test:phase1` / `phase1-tests` CI | not found | not planned here | no invented script or CI job |

---

## 4. Test Runner and Discovery

Current runner (from `package.json`):

```json
"test": "node --test \"server/**/*.test.js\" \"src/**/*.test.js\""
```

- `npm test` discovers only `server/**/*.test.js` and `src/**/*.test.js`.
- `scripts/test/**` is not a current discovery path. No `run-all.mjs`, CI job, or
  `test:phase1` script exists, and none is invented by this plan.
- Planned tests must be colocated with their module under `src/` or `server/` so the
  existing runner discovers them, or the owning implementation Issue must extend
  `package.json` as part of that Issue's owned work.

Every test row above records its intended runner as `node --test` with a colocated
path; harnesses that do not exist yet are marked `(not yet present)`.

---

## 5. Deferred Roadmap Material

> Preserved from the recovered artifact. These cases are explicitly out of Phase 1
> scope and are retained for later roadmap phases only.

- Economy, culture, religion, resources, mobilization, influence domain seeding and
  the modular JSON projections for those domains (recovered S3-*, S4-*, ST-*,
  GF-*). AC-2's accepted atomic boundary is the six runtime projections
  `actions/chat/events/game/world/colors`, not these deferred domain projections.
- Macro-region auto-generation and adjacency handling (recovered S2.5-*, E-MR-*).
- Full simulation mechanics including culture/religion diffusion and resource-total
  recalculation (recovered E-CR-*, E-PF-*, E-DI-*).
- Scenario Package v2 editor, distribution and advanced fidelity tooling beyond the
  minimal migration bridge AC-9 requires.

These are not mapped to any AC in this Phase 1 plan and must not be treated as
Phase 1 acceptance gates.

---

## 6. Residual Risks

- PLANNED boundaries are asserted against the accepted contracts and live Issue
  bodies; a contract or Issue changing later requires this matrix to be re-synced
  before the corresponding row is treated as satisfied.
- `translationFilter.test.js` proves static-string filtering only. Independent proof
  of zero runtime localization model calls lands in #40, not in this plan.
- No runtime test has been executed for this plan: it is executable-by-design, not
  yet implemented. Harness existence is recorded per row and in section 3.

# Current Open Historia architecture audit

## Scope

Inspected code is the personal branch at `94b62ac`, based on upstream `a6315c6`. The audit distinguishes upstream architecture from three local experiments: durable memory, translation filtering/non-blocking work and diplomacy routing.

## Current system in one picture

```text
React UI / MapLibre / OpenLayers
        |
        | fetch /api/*
        v
one of three storage implementations
  - Express + filesystem (desktop)
  - IndexedDB fetch interceptor (web)
  - embedded/local server path (mobile)

AI calls originate in the renderer
  -> provider adapter in src/Game/AI/main.jsx
  -> native or OpenAI-compatible endpoint
  -> JSON/tool output
  -> gameplay.js validation/salvage
  -> six or more independent JSON writes
  -> 5-second polling repaints UI/map
```

The repository has strong subsystem documentation and many careful bug fixes. Its structural problem is that those fixes accumulate around a world model and AI pipeline that were never designed as a durable simulation core.

## Strengths worth retaining

### Product and delivery

- A usable open-source, BYOK single-player application already exists.
- One React client supports desktop, web and mobile-oriented storage implementations.
- Electron packages a self-contained Mac application; no JVM or Xcode is needed for ordinary local development/building.
- MapLibre + PMTiles is a good fit for a global strategy map.
- The OpenLayers editor is already substantial and should not be discarded.
- Community scenarios, rollback, custom maps, units, markers, diplomacy and advisor are working product surfaces.

### AI robustness work

- Structured gameplay tasks have schemas and tool-call support.
- Provider adapters support Gemini, OpenAI, Anthropic and compatible gateways.
- The parser salvages JSON from providers without full tool support.
- Strict first-attempt validation and final-attempt salvage avoid losing a good narrative over a minor malformed field.
- Cancellation propagates to network calls in important paths.
- Region-name resolution, player-agency instructions, event de-duplication and map-truth checks address real field failures.
- The local durable-memory prototype uses evidence IDs and explicit upsert/resolve operations.

### Data/map work

- Stable region IDs exist in the map catalog.
- Runtime normalization protects many old saves from missing fields.
- Ownership overrides and disputed-region stripes already render.
- Rollback snapshots capture the main state surfaces.
- The editor has region/city import, split/merge, owner painting and export.

## Critical findings

## A. The canonical world is too thin

`WORLD_DEFAULTS` stores units, markers, ownership overrides, claimants, polity labels/tags, reputation, generated country stats, campaign summaries and narrative history. It does not formally store:

- bilateral relations;
- treaties, promises and obligations;
- wars, belligerents, war aims, fronts or ceasefires;
- strategic goals and red lines of non-player polities;
- recognized sovereignty versus effective control;
- occupation/annexation/de facto-state status;
- projects with progress and capacity costs;
- a modest economic/fiscal capacity model;
- internal factions, legitimacy and political constraints;
- causal links that mark which historical prerequisites no longer hold.

Consequences:

1. The model reconstructs these concepts from prose every call.
2. The same treaty may be “remembered” differently by simulation, advisor and diplomacy.
3. Difficulty becomes a tone directive rather than a rules modifier.
4. Historical railroading is hard to prevent because there is no causal dependency graph.
5. A better model improves prose but cannot make missing state authoritative.

## B. Display names are used as identifiers

Several maps are keyed by country name verbatim. Region transfers, polity changes and prompts rely on names such as `Russia` rather than stable polity IDs. Aliases, localization and regime renames therefore share a namespace with identity.

Risks already observed upstream include phantom countries, stale flags, wrong stat sheets and fuzzy region/country collisions. The code contains extensive normalization and prompt instructions to compensate.

Target: stable IDs everywhere; localized/display names only at boundaries.

## C. Prompt debt replaces missing domain rules

Static default prompt sizes before runtime context are approximately:

| Prompt | Characters |
|---|---:|
| jump forward | 27,944 |
| auto jump | 22,888 |
| catalyst creation | 18,377 |
| catalyst execution | 18,240 |
| leader diplomacy | 13,908 |
| advisor | 9,279 |

`gameplay.js` then appends more call-time blocks for player agency, map truth, new developments, place renaming, region/city capture, polity names, unit coordinates, reputation, durable memory and a large action reference.

This pattern has two causes:

- campaigns freeze a copy of `prompts.json`, so default prompt fixes do not reach existing saves;
- validation and domain rules are partly expressed as prose instructions rather than executable invariants.

Result: prompts are long, repetitive, hard to test and sensitive to instruction attention. Provider caching also suffers when dynamic text is interleaved with stable rules. Prompt changes need versioned composition, not copies per save.

## D. AI task configuration is global and leaky

The current provider selection is global. Each provider has one model and one raw custom-JSON field. A single global reasoning toggle is mapped to provider-specific fields. Local diplomacy routing adds `fast/balanced/deep`, but still calls the same configured provider/model; the optional planner is not inherently a cheaper model.

Missing:

- model per task/profile;
- separate key/provider for utilities or translation;
- capability discovery for tools, JSON schema, reasoning controls, streaming and token fields;
- per-task temperature, timeout, retry and token budgets;
- input-section selection and budget;
- cost ceilings and estimation;
- precedence rules between safe settings and raw provider parameters;
- a call ledger and prompt/context preview.

The global raw-parameter escape hatch is useful for experts, but it cannot be the product configuration model.

## E. Hidden utility calls multiply cost and latency

The user's Grok trace demonstrated:

- a next-speaker call with 1,344 prompt tokens to choose Russia when Russia was the only eligible participant;
- a leader reply with 8,815 prompt tokens, 8,418 reasoning tokens and only 72 completion tokens;
- a later translation call for an already-Russian UI string, with 779 prompt and 121 reasoning tokens.

The first should be deterministic. The third should not exist. The second needs relevant context, but not the current full prompt structure for every exchange.

Every AI entry point must be inventoried and shown to the player. No “small helper” call is exempt from observability.

## F. Translation is coupled to runtime DOM scanning

The current translator observes rendered text and can invoke the active gameplay model for unknown strings. This causes four architectural problems:

1. menu text is repeatedly discovered at runtime instead of shipped in a locale catalog;
2. the most expensive configured model may translate trivial labels;
3. gameplay can trigger background network work unrelated to the player's command;
4. script/brand mixtures and already translated text are hard to classify perfectly.

The local branch's target-script filter and non-blocking queue are useful containment, not the final design.

Target:

- static UI catalog at build time;
- country names from CLDR/`Intl.DisplayNames` plus curated overrides;
- region/city names from scenario language packs;
- generated prose requested directly in the player language;
- separate optional translation profile only for imported/incorrect-language content;
- content-addressed permanent translation cache.

## G. Turn persistence is not atomic

`applySimulationResult` computes next state and then writes actions, chats, events, game/date, colors and world in `Promise.all`. Each endpoint/file write is independent. Desktop writes use direct `fs.writeFileSync(target, JSON.stringify(...))` rather than temp-file + rename.

A crash or one failed request can persist only part of a turn. Rollback snapshots are created after the new state is written and are best effort, so they are not a transaction log.

The code has already needed special re-reads to avoid resurrecting chats modified while a long turn runs. This is evidence of snapshot/write races.

Target: one revision-checked turn commit with a journal and atomic publication.

## H. Polling and duplicate state ownership

Map state polls `world.json` every five seconds. Units maintain a separate five-second poll over the same world, plus their own in-memory store and staged override. Writes invalidate broad caches and cause catalog work.

For a single-player local app, an application store with explicit mutation notifications is simpler and more responsive. Polling can remain only as a cross-tab/external-edit fallback.

## I. Large modules and weak boundaries

Largest files include:

| File | Lines |
|---|---:|
| `server/libraryStore.js` | 2,770 |
| `src/Game/GameUI/libraryBar.jsx` | 2,590 |
| `src/Game/AI/gameplay.js` | 2,489 |
| `src/Game/GameUI/time.jsx` | 1,809 |
| `src/Game/AI/main.jsx` | 1,441 |
| `src/runtime/gameState.js` | 1,301 |
| `src/Game/Map/Nations.jsx` | 1,233 |

These files combine orchestration, policy, parsing, persistence and presentation. Bugs require patching distant concerns and encourage comment-driven rather than type-driven contracts.

## J. TypeScript is installed but the product source is JavaScript

The main source contains roughly 92 `.js` and 51 `.jsx` files, with TypeScript mainly in build configuration. Runtime schemas and TypeScript types are not generated from one definition.

This is the highest-value language change: incremental TypeScript at domain and boundary modules, not a JVM rewrite.

## K. The standard test command misses most tests

`npm test` runs only `server/**/*.test.js` (26 tests). Running server and source tests together executes 166 passing tests on the personal branch. Therefore CI can be green while AI routing, memory, event de-duplication and translation regress.

There are no browser component/E2E gates for a full turn, rollback, import or crash recovery. Exact-prose golden tests would be brittle; invariant-based model/replay tests are needed.

## L. Bundle/code splitting is incomplete

The production build succeeds but reports modules that are both statically and dynamically imported, preventing intended chunk movement. The main app chunk is ~1.14 MB minified, while MapLibre is ~1.02 MB and the editor ~634 kB. This is not the primary gameplay problem, but lazy boundaries need cleanup after correctness work.

## M. Territory semantics are inadequate

The renderer supports administrator + claimant stripes. The current active `default-2` scenario and campaign have empty `regionClaimants`, while the latest bundled default contains 22 entries including Crimea, Sevastopol and Abkhazia.

Even the bundled structure cannot represent:

- legal/recognized sovereign;
- de facto controller;
- occupier/security sponsor;
- claimant;
- partial control and front lines;
- validity interval and evidence source.

South Ossetia is not a separate polygon in the inspected map and is embedded in Shida Kartli. Whole-region coloring would be false precision. Similar issues exist for partial Donetsk/Luhansk control in 2016.

## N. Generated country statistics are not a simulation

Country stats are LLM-produced and persisted, which avoids drift on regeneration but does not create causal mechanics. GDP, population, stability or military capacity can change because prose says so, without constraints linking people, labour, budgets, production, trade, equipment, logistics, casualties, territory or time.

This is not a missing prompt; it is a missing game. The target needs a deterministic simulation core with measured stocks/flows, units, provenance, accounting/conservation rules and causal feedback. Normalized scores may summarize legitimacy or readiness, but they cannot be the authoritative population, economy or armed forces. See [the simulation-core specification](06-simulation-core.md).

## O. Leaders and reputation are AI-owned fields, not governed state

The current prompt tells the model to put a successor's display name into `polityChanges.stats.leader` when someone is overthrown, assassinated, dies, resigns or loses an election. `applyEventImpactsToWorld` then merges that partial stat sheet into `world.countryStats`. There is no stable person/office/term identity, eligibility, election, death evidence, constitutional succession or transition transaction.

International reputation is likewise one universal 0–100 scalar that the model writes through `polityChanges.reputation`; the runtime comments explicitly call the AI-set number authoritative. This conflates a country's treaty reliability and creditworthiness with a leader's popularity, personal trust and scandal, and it allows prose generation to create permanent diplomatic state without an evidence ledger.

The target must represent people, offices, terms, governments and polities separately; validate each form of leadership transition; derive audience-specific leader standing and bilateral polity reputation from recorded actions; and treat unsupported reports of death/removal as claims rather than state changes.

## P. Terrain is visual, remote and absent from gameplay state

The current map can render remote Terrarium elevation tiles as MapLibre terrain/hillshade and the editor can select an external terrain basemap. This improves appearance but supplies no canonical mountain, river, pass, road or crossing records to movement, economy, logistics or combat. The tile URL is runtime presentation infrastructure, not a pinned historical geodata pack, and no river/bridge barrier contract exists in world state.

The target must package immutable physical geography with the scenario/map, derive compact gameplay indexes from it and layer mutable engineered infrastructure above it. This keeps mountains and rivers stable while allowing dated bridges, tunnels, dams, canals, destruction and repair.

## Current local experiments: keep, replace or extend

| Experiment | Assessment | Target treatment |
|---|---|---|
| evidence-backed campaign memory | good safety improvement | extend into three-tier memory and derive known facts deterministically |
| diplomacy regex router | useful immediate cost control | replace with task-profile router + entity graph; keep deterministic-first principle |
| optional planner | useful only for ambiguity | assign to explicit utility profile and measure whether it saves net tokens |
| focused map context | strong direction | generalize to a budgeted context compiler |
| background translation queue | prevents UI blocking | remove runtime menu translation; retain for optional fallback content translation |

## Risk ranking

| Rank | Risk | Why first |
|---:|---|---|
| 1 | no authoritative simulation for population/economy/military | leaves the product as generated prose rather than strategy gameplay |
| 2 | narrative/state divergence and player-agency violations | breaks trust in the game |
| 3 | unbounded/opaque AI context and cost | directly blocks play and model experimentation |
| 4 | missing canonical relations/wars/control/leaders/reputation/physical logistics | causes memory and realism failures regardless of model |
| 5 | non-atomic state commits | can corrupt long campaigns |
| 6 | scenario/prompt version drift | fixes do not reach existing games |
| 7 | absent diagnostics/evals | every model/provider change is guesswork |
| 8 | map/runtime performance | important, but many observed costs are context and state problems first |
| 9 | broad language/runtime rewrite | high risk, low evidence of benefit |

# AI orchestration, context, memory and translation specification

## Objective

Make model quality, cost and latency controllable without sacrificing relevant state. The orchestrator must answer five questions for every call:

1. Why is an AI call needed instead of deterministic code?
2. Which task profile and model should handle it?
3. Which exact context sections are necessary?
4. Which structured result is accepted, repaired or rejected?
5. What did the call cost and change?

## AI call inventory

The first implementation task is a complete registry. Current and planned families:

| Task | Default treatment |
|---|---|
| choose next speaker, two-party chat | deterministic, no AI |
| choose next speaker, group chat | deterministic heuristic; utility model only when ambiguous |
| classify context/stakes/entities | deterministic rules/entity graph first; optional utility fallback |
| translate static menu | never AI at runtime |
| translate country names | local CLDR/curated table |
| translate imported/dynamic text | optional translation profile |
| improve player action | optional, cancellable utility/advisor profile |
| diplomacy reply | fast/balanced/deep diplomacy profile by stakes |
| advisor reply | advisor profile, retrieval scoped to question |
| action suggestions | advisor/utility profile |
| NPC strategic objectives for a time interval | simulation-planner profile; deterministic fallback exists |
| demographic/economic/production tick | deterministic engine, never AI |
| battle losses, budget, trade delivery, population change | deterministic engine, never AI |
| major-war/partition strategic planning | deep simulation-planner profile; mechanics adjudicate |
| narrative realization | narrative profile; may share main model in fast mode |
| memory compression | memory profile, background and atomic |
| country dossier | advisor profile; canonical stats before generated prose |
| leader death/removal claim | deterministic fact/action gate; no direct AI state change |
| succession strategy and reactions | deep planner only after a valid transition command |
| pregame history generation | scenario-authoring profile, never hidden at game start |

No registry entry means no production call.

## Provider and model profiles

### Configuration hierarchy

Lowest to highest precedence:

1. safe application defaults;
2. provider capability defaults;
3. global user profile;
4. scenario profile override;
5. task profile;
6. explicit one-call user override;
7. safety clamps and domain-required fields.

Raw provider JSON is merged before safety clamps. It cannot remove required tool/schema fields or silently increase a configured hard cost/token ceiling.

### Example

```json
{
  "profiles": {
    "utility": {
      "connection": "openrouter-cheap",
      "model": "chosen-cheap-model",
      "reasoning": "none",
      "temperature": 0,
      "maxOutputTokens": 512,
      "timeoutMs": 20000,
      "maxRetries": 1
    },
    "diplomacyFast": {
      "connection": "openrouter-main",
      "model": "chosen-fast-model",
      "reasoning": "low",
      "temperature": 0.7,
      "maxOutputTokens": 1200
    },
    "diplomacyDeep": {
      "connection": "openrouter-main",
      "model": "chosen-strong-model",
      "reasoning": "high",
      "maxOutputTokens": 5000
    },
    "simulation": {
      "connection": "openrouter-main",
      "model": "chosen-strong-model",
      "reasoning": "high",
      "maxOutputTokens": 12000,
      "hardCostUsd": 1.0
    },
    "translation": {
      "connection": "translation-key-or-local",
      "model": "chosen-free-or-cheap-model",
      "reasoning": "none",
      "temperature": 0,
      "maxOutputTokens": 4096,
      "background": true
    }
  }
}
```

Connections store provider, endpoint and credential reference. Profiles reference a connection; credentials are never copied into scenarios or logs.

### Capability model

Each adapter reports or is configured with:

- tools/function calling;
- strict JSON schema;
- streaming;
- reasoning parameter name and supported values;
- input/output/context limits;
- prompt/context caching behavior;
- token-usage and cost reporting;
- temperature/top-p support;
- cancellation behavior;
- model discovery;
- known incompatible parameter combinations.

Parameters are translated by adapter, not hardcoded for a brand such as Grok. Unknown OpenAI-compatible services can use an editable capability preset.

## Routing

### Deterministic-first rule

Do not call a cheap model merely because it is cheap. A preliminary call is worthwhile only when:

```text
expected main-call tokens saved * main token price
  > utility-call cost + added latency/risk
```

Deterministic routing uses:

- number of participants;
- explicit entity IDs/names and aliases;
- active agreement/conflict references;
- territorial/military/security/economic keywords in all supported UI languages;
- requested operation type;
- estimated affected-entity count;
- scenario module configuration.

Examples:

- One eligible next speaker: choose it without AI.
- Greeting/condolence: fast profile, thread + relationship + speaker voice; no region lists.
- Trade proposal: balanced, bilateral capacities/relations/agreements.
- Partition or border settlement: deep, relevant conflict, recognized/control geometry and exact regions.
- Ambiguous “divide it between us”: utility router resolves pronoun/entity scope, then deep call.

The utility router can increase stakes/scope but may not downgrade a deterministic high-stakes classification.

## Context compiler

### Context is a typed manifest

```ts
interface ContextManifest {
  task: TaskKind;
  profile: string;
  budget: TokenBudget;
  sections: ContextSectionRef[];
  omitted: OmissionNotice[];
  entityScope: EntityRef[];
  stablePrefixHash: string;
  stateRevision: number;
}
```

The compiler produces both model messages and a human-readable manifest. Sections have priority, estimated tokens, source revision and truncation policy.

### Stable ordering

1. application safety/domain contract;
2. task contract and output schema;
3. scenario rules/version;
4. stable entity definitions;
5. relevant current state;
6. active canonical facts/agreements/conflicts;
7. selected episode history;
8. exact current conversation/action;

Large stable prefixes remain byte-stable to improve provider caching where supported. Google explicitly recommends placing large common content at the beginning for implicit cache hits in its [context-caching guidance](https://ai.google.dev/gemini-api/docs/caching).

### Retrieval scope

Seed entities from:

- player and responding polity;
- chat participants;
- entities explicitly mentioned;
- target regions/features;
- queued action actors/targets.

Then expand only through relevant edges:

- active conflict side/front;
- active agreement/guarantee;
- claimant/controller/recognized owner;
- direct neighbor when the action affects a border;
- sponsor or alliance directly implicated;
- top globally important event if it materially changes the decision.

No unbounded world dump. Region lists are exact for the affected set and counts/summary-only elsewhere.

### Token budgets

Every task profile defines soft and hard input budgets. Packing order:

1. required safety/domain/schema sections;
2. active commitments and exact thread;
3. current relevant state;
4. relevant durable facts;
5. recent episodes;
6. optional background.

When material is omitted, the model sees an explicit typed notice, not a misleading impression that no older history exists.

The inspector shows estimated tokens before send and provider-reported tokens after completion.

## Diplomacy design

### Strategic intent

For substantive turns, produce or deterministically derive:

```ts
interface DiplomaticIntent {
  speaker: PolityId;
  objective: string;
  stance: "accept" | "reject" | "counter" | "probe" | "warn" | "close";
  offers: ProposalTerm[];
  demands: ProposalTerm[];
  redLines: string[];
  referencedAgreements: AgreementId[];
  referencedRegions: RegionId[];
  relationEffects?: RelationDelta[];
  shouldLeaveChat: boolean;
}
```

The reply is generated from this intent and the speaker's voice. It cannot invent an accepted agreement absent matching terms/status.

Leader identity is resolved from the current office term. A diplomatic model cannot kill, replace or incapacitate a leader in dialogue. Rumours and threats remain prose/facts with confidence until a verified historical record, resolved operation, constitutional event or explicit GM override authorizes the corresponding domain command.

### One-call versus two-call policy

- Fast: one prose call, intent derived from simple state/rules.
- Balanced: one structured tool result containing intent plus reply.
- Deep: planning/adjudication then language realization; second call can be a cheaper narrative model if it preserves IDs/terms.

This avoids doubling every conversation while retaining depth where it matters.

### Conversation memory

Store:

- exact thread transcript;
- structured proposals and their statuses;
- promises, threats and grievances with evidence message IDs;
- a compact closed-thread episode summary.

Do not repeatedly paste every other chat. Retrieve cross-chat facts by participant and subject.

## Simulation pipeline

### Plan output

The main simulation model emits compact strategic intent: objectives, priorities, diplomatic terms, policies, project proposals, operational missions and bounded shock proposals. It does not emit authoritative population, GDP, budget, production, equipment, supply or casualty values. The deterministic core described in [the simulation specification](06-simulation-core.md) computes those values.

The protected numeric state tree has no general-purpose AI write tool. The only accepted routes are:

- a policy or budget command whose effects are calculated by rules;
- a project, trade, mobilisation, production, movement or combat command with resource preconditions;
- a scenario-defined bounded shock whose severity maps to engine-owned modifiers;
- an explicit player-visible GM override stored separately from ordinary play.

If a narrative says “industrial production collapsed by 20%” but the accepted mechanics calculated 7.4%, the narrative is invalid and must be regenerated from the ledger. It never changes the ledger to match the prose.

### Validation sequence

1. parse and runtime-schema validation;
2. stable-ID resolution;
3. player-agency rules;
4. state preconditions and revision;
5. territorial/conflict/project and simulation-accounting invariants;
6. causal/historical-anchor consistency;
7. resource availability and policy/action legality;
8. execute deterministic ticks with pinned ruleset and seed;
9. validate population, fiscal, inventory, equipment and regional reconciliation;
10. construct pending transaction;
11. optional bounded repair of strategic intent with exact validation errors.

Salvage may drop an optional decorative marker. It may not silently drop the control transfer that makes the event true. If a core command is invalid, the related narrative event is removed or repaired as a unit.

### Narrative generation

Narrative receives accepted commands and relevant local facts. It does not decide new world changes. This guarantees prose/state consistency and lets a cheaper model handle style without authority.

## Memory architecture

### Tier 1: canonical state

Treaties, wars, control, projects, relations, population, economy, ledgers, inventories, logistics, armed forces and policies live in domain state. They are always current and never “summarized away”.

### Tier 2: durable fact ledger

Facts not represented by a dedicated entity—personal promises, humiliations, doctrine, secret knowledge, key divergence—use:

```ts
interface MemoryFact {
  id: string;
  kind: string;
  subjectIds: string[];
  regionIds: RegionId[];
  statement: string;
  status: "active" | "resolved" | "superseded";
  validFrom: GameDate;
  validUntil?: GameDate;
  evidenceIds: string[];
  confidence: number;
}
```

Known facts are written deterministically from accepted commands. An LLM extractor is used only for unstructured nuance and cannot overwrite a dedicated domain entity.

### Tier 3: episodic/archive memory

- recent exact events/messages;
- compact episode summaries with covered ranges;
- raw immutable archive on disk.

Retrieval initially uses entity IDs, dates, status, event kinds and local full-text/BM25 search. Embeddings are optional only after evaluation shows lexical/entity retrieval misses relevant facts.

### Compression safety

- prepare summary beside exact source;
- validate size, coverage metadata and evidence references;
- commit summary + covered range atomically;
- only then mark exact items archived;
- on failure, retain exact history;
- scene/private reasoning never enters campaign canon; only accepted outcomes do.

### Memory inspector

Player can view, search, correct, pin, resolve or restore facts. Manual edits are recorded as GM interventions and remain visible in diagnostics.

## Translation and localization

## Rule 1: static UI is never translated by an LLM at runtime

Menus, buttons, settings, errors and help use versioned locale catalogs. The
current supported set is deliberately limited to English (`en`) and Russian
(`ru`); additional UI locales are deferred until the playable slice is proven.
Missing Russian keys fall back to English and are reported in development/CI.
A build-time extraction command finds untranslated keys.

Do not crawl the rendered DOM and submit unknown labels to the active gameplay model.

## Rule 2: geographic names use local data

- countries: `Intl.DisplayNames`/CLDR plus curated historical and scenario overrides;
- regions/cities: scenario `localizedNames` tables;
- invented polities: scenario/local user translation or unchanged canonical name;
- identifiers never translate.

Translated names are cached by `(entityId, locale, scenarioVersion)`, not raw DOM text.

## Rule 3: generated messages are requested directly in the player language

The main diplomacy/simulation/advisor call receives a short output-language contract. Structured keys, IDs, dates and enums remain canonical; human-readable fields use the selected language.

This is normally cheaper and more faithful than generating English and translating every answer. It also preserves tone and prevents a translation model from altering diplomatic terms.

## Rule 4: a separate translation profile is an explicit fallback

Use it when:

- imported scenario/event text lacks the target locale;
- a provider ignored the output-language requirement;
- the player explicitly requests an alternate-language view;
- an author pre-generates a scenario language pack.

It may have its own provider, endpoint, API key and model, including a free or local model. Defaults:

- no reasoning;
- temperature 0;
- batch strings/messages;
- low output cap based on source length;
- background priority;
- cancellable;
- never blocks a completed gameplay turn;
- persistent content-addressed cache keyed by source hash, source/target locale and translation-policy version.

## Translation decision algorithm

1. Is this a static UI key? Use catalog.
2. Is this an entity name with localized data? Use local data.
3. Was dynamic prose generated in target language? Display unchanged.
4. Does language detection confidently show target language (allowing English brands/IDs)? Display unchanged.
5. Is a cached translation available? Use it.
6. Is auto-fallback translation enabled and configured? Queue on translation profile.
7. Otherwise display original with a “Translate” action.

Never translate strings consisting only of IDs, dates, numbers, emoji or known proper names. Never run high reasoning for translation.

## Observability and cost ledger

Persist redacted records:

```ts
interface AiCallRecord {
  id: string;
  task: TaskKind;
  profile: string;
  provider: string;
  model: string;
  stateRevision: number;
  contextManifest: ContextManifest;
  reasoning: string;
  requestedOutputLimit?: number;
  promptTokensEstimated: number;
  promptTokensActual?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs: number;
  retries: RetryRecord[];
  status: "success" | "cancelled" | "failed" | "fallback";
}
```

UI groups calls by player action/turn, so the user sees that one click caused routing, simulation, repair or translation. Keys and full private messages are redacted by default.

## Reliability

- deterministic idempotency key per accepted attempt;
- one bounded retry only for repairable provider/schema failures by default;
- retry is a visible new attempt with cost;
- timeouts and cancellation per profile;
- provider errors never masquerade as successful canned gameplay;
- fallback output is visibly marked and cannot apply high-impact world changes;
- state revision checked immediately before commit;
- model switch/fallback provider requires user-configured policy, not silent substitution.

## Evaluation suite

Use invariant scoring rather than exact prose:

- valid structured output;
- player-agency compliance;
- state/narrative agreement;
- agreement/war/control continuity;
- relevant-memory recall at 10/50/100 turns;
- causal divergence from real history;
- no irrelevant context sections;
- input, cached, reasoning and output tokens;
- latency and cost;
- subjective diplomacy voice/realism scored separately.

Required fixtures include World 1916/Russia before and after an authority crisis, World 1797 coalition and non-European trade diplomacy, a landless organization, a major partition negotiation, a long campaign and a fictional scenario. Run recorded provider responses in CI; run live model matrix evaluations manually or on a capped budget before changing defaults.

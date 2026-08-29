# Event Presentation Audit

## Scope and conclusion

This audit traces campaign events from prompt and structured output through
validation, normalization, persistence, world application, timeline reveal and
later country inspection. It is a repository audit; no runtime AI call was made.

The event lifecycle is implemented end to end. The principal information gap is
not absence of events or event UI. It is traceability: structured effects are
mostly applied to state but reduced to entity tags and a map-change count in the
timeline, and to title/date/truncated prose in country inspection. Cause and
actor are not first-class event fields, so their quality depends on prose.

The default scenario's `storage/events.json` is an empty `{}` seed. The runtime
normalizer accepts object-form legacy storage and maps this empty object to an
empty event list (`src/runtime/gameState.js:862-879`). That seed proves only that
the shipped campaign starts without stored events; it cannot prove that runtime
generation or persistence is absent.

## Available event information

The structured event schema requires `date`, `title` and `description`, and
allows `id`, `importance`, `kind`, `notable`, `playerRelated` and `impacts`
(`src/Game/AI/gameplaySchemas.js:457-478`). `additionalProperties: false` means
there are no first-class `actor`, `cause`, `confidence` or provenance fields in
provider output. Actor, cause and consequence must therefore be expressed in
`title`/`description` or nested effect notes.

`impacts` can contain (`src/Game/AI/gameplaySchemas.js:417-454`):

- declared resolved player `actionIds`;
- `createdChats`, including participants, purpose, initiating speaker and
  opening message (`src/Game/AI/gameplaySchemas.js:92-123`);
- `regionTransfers`, including old/new owner, region and reason
  (`src/Game/AI/gameplaySchemas.js:125-149`);
- `polityChanges`, including name, color, aliases, reputation, tags, note and
  nested national-stat updates (`src/Game/AI/gameplaySchemas.js:151-236`);
- `unitOps` for spawn/move/strength/remove operations
  (`src/Game/AI/gameplaySchemas.js:238-326`);
- `markerOps` for build/remove/rename operations
  (`src/Game/AI/gameplaySchemas.js:329-415`).

Normalization adds `createdAt` and `source`, supplies defaults, supports legacy
string events and aliases such as `headline`, `name`, `summary` and `text`, and
emits one canonical shape (`src/runtime/gameState.js:815-860`). These two
runtime-added fields are persisted but are not provider-schema fields.

## Boundary map and information loss

### Prompt and generation

The timeline prompt supplies prior events and tells the model to emit only new
developments (`src/Game/AI/gameplay.js:446-452`). Its appended capability
reference explicitly couples territorial, polity, unit, marker and diplomacy
narration to structured effects (`src/Game/AI/gameplay.js:385-433`). This is a
strong operational-effects prompt, but actor and causal chain remain prose-only.
The prompt therefore cannot guarantee that later code can identify them without
text interpretation.

The schema rejects unknown properties and malformed nested effect shapes rather
than preserving arbitrary model detail. Date validation also rejects malformed,
out-of-window or non-monotonic dates on the strict attempt; the salvage attempt
clamps them into the requested interval (`src/Game/AI/gameplay.js:128-213`).

### World-change validation and salvage

The strict attempt asks the model to correct unresolved transfers, capture prose
without transfers, invalid chat invitees/openers, stale unit identifiers and
malformed marker operations. On the salvage attempt, unresolved chats and unit
or marker operations are removed, while duplicate spawned-unit IDs may be
discarded and regenerated (`src/Game/AI/gameplay.js:1230-1347`). Thus a readable
event can survive while part of its structured effect no longer does. That is a
real generation-to-application loss boundary and should be measured separately
from UI hiding.

### Normalization and de-duplication

`normalizeEventEntry` drops non-object/non-string entries and objects without a
usable title; it canonicalizes only known fields (`src/runtime/gameState.js:815-860`).
Nested normalizers can filter malformed marker, polity, transfer and unit
operations (`src/runtime/gameState.js:777-812`).

Before application, generated events are de-duplicated against prior and same-
batch events (`src/Game/AI/gameplay.js:1548-1561`). The key contains only
normalized date, title and description (`src/runtime/eventDedup.js:15-34`), not
`impacts`, `source`, `importance` or flags. Two events with identical prose but
different effects therefore collide and the later event is discarded. The same
rule is enforced again for the whole stored log by `writeEventsState`
(`src/runtime/gameState.js:1159-1165`).

### Persistence and application

The canonical event array is normalized, de-duplicated and written through the
runtime event asset (`src/runtime/gameState.js:1156-1165`). For a turn,
`applySimulationResult` persists events alongside actions, chat, game, colors
and world (`src/Game/AI/gameplay.js:1656-1663`). Atomicity of that six-projection
write is a separate concern tracked by the accepted atomic-revision work.

Only fresh events apply effects. Region transfers and polity/stat/color changes
mutate the world projection, while unit and marker operations update their
respective world collections (`src/runtime/gameState.js:1192-1282`). Generated
event chats are materialized as chat threads before the turn write
(`src/Game/AI/gameplay.js:1609-1617`). These consequences can be visible in the
map, country sheet, unit/marker layers or chat UI even when the event card does
not explain the individual effect. `actionIds` are normalized and stored but
are not consumed in `applySimulationResult`; action resolution currently follows
the top-level `clearActions` flag (`src/Game/AI/gameplay.js:1567-1571`).

### Reveal-time timeline

`EventCard` renders formatted date, title, Markdown description, up to eight
entity tags, a combined region-transfer/polity-change count and a badge only
when `source === "fallback"` (`src/Game/GameUI/time.jsx:231-265` and
`src/Game/GameUI/time.jsx:638-701`). It does not render:

- `importance`, `kind`, `notable` or `playerRelated`;
- general `source` or `createdAt`;
- resolved `actionIds`;
- created-chat title, speaker or opening message;
- individual region-transfer/polity-change values and notes;
- unit and marker operations.

The latest turn reveals events sequentially and lets the player advance one
event or skip to the complete chain (`src/Game/GameUI/time.jsx:1174-1221`). The
map camera advances with the reveal state, so location and changed world state
provide indirect context, but no durable link explains which displayed state
value came from which effect. The timeline reloads game, events and world every
five seconds (`src/Game/GameUI/time.jsx:1345-1388`).

### Later country inspection

`CountryPanel` selects related events using polity changes, transfers, created-
chat participants and a title/description text fallback
(`src/Game/Selection/CountryPanel.jsx:60-67`). Unit/marker ownership and
`actionIds` do not participate in that relation test. The panel can search prose
and filter by importance (`src/Game/Selection/CountryPanel.jsx:135-143`), but
each result renders only title, date and description truncated at 220 characters
(`src/Game/Selection/CountryPanel.jsx:225-236`). It therefore offers persistent
retrieval, but less structured context than the reveal card.

## Representative repository samples and gaps

The repository contains two deterministic sample sources:

1. `fallbackJumpSimulation` creates player-action events with date, title,
   description, importance, kind, flags and optional `createdChats`; its no-
   action branch creates a world event (`src/Game/AI/gameplay.js:1376-1464`).
   These exercise prose and flags but not transfers, polity changes, units or
   markers.
2. `src/runtime/eventDedup.test.js:8-206` builds synthetic events around
   `1950-01-01 / War begins / The front opens` and varies identity and prose to
   test de-duplication. It is not a presentation or effect-rich fixture.

The default storage seed contains no representative stored event objects, and
repository search finds no checked-in event corpus for Russia, Germany and
Britain that crosses schema, normalization and both UIs. The default game names
Russia as the starting player, but that is campaign metadata, not event
evidence. Country-specific quality for all three calibration polities is
therefore unmeasured rather than absent or failed.

## Cause classification

| Observed gap | Primary boundary | Evidence |
| --- | --- | --- |
| Actor/cause cannot be queried structurally | Schema | They exist only in narrative or effect notes; `eventSchema` has no corresponding fields. |
| A generated effect can disappear while prose survives | Validation/normalization | Salvage and nested normalizers filter invalid operations. |
| A later same-prose event can lose distinct effects | De-duplication | Identity excludes `impacts` and metadata. |
| Stored metadata/effects are missing from the reveal card | UI hierarchy | `EventCard` projects only date/prose/tags/count/fallback. |
| Later inspection has less context and incomplete country linkage | Persistent UI | `CountryPanel` relation test and compact result card omit several effect families. |
| Russia/Germany/Britain quality cannot be compared | Fixture coverage | No checked-in cross-boundary corpus for those polities. |

## Measurable baseline for Issue #5

Build a versioned, deterministic corpus without making a product-display
decision in this audit. It should contain at least one case for each existing
effect family, one mixed-effect event, both fallback branches, a legacy string
event, malformed operations that enter salvage, and same-prose events with
different effects. Include Russia, Germany and Britain as actor, target and
third-party roles across the corpus; this is coverage allocation, not a demand
for fabricated scenario history.

For every case, record these boundary metrics:

1. **Structured acceptance:** accepted/rejected/salvaged, correction reason and
   the exact operations removed or changed.
2. **Field preservation:** input, canonical stored and re-read values for every
   schema/runtime field and nested effect; report per-field loss rather than one
   aggregate “completeness” percentage.
3. **Effect fidelity:** expected versus applied region, polity/stat/color, chat,
   unit, marker and action-resolution effects.
4. **Reveal traceability:** whether a reviewer can identify actor, cause and each
   applied effect from the reveal card plus staged map, scored separately.
5. **Later traceability:** whether the event is discoverable from every involved
   country and whether its cause/effects remain identifiable after the reveal.
6. **De-duplication safety:** whether intended restatements collapse and events
   with materially different effects remain distinct.

The current automated baseline covers only de-duplication behavior. Presentation
and cross-boundary preservation need fixture-driven tests or a documented manual
evaluation harness before Issue #5 can compare candidate UI treatments.

## Decisions left to Issue #5

This audit does not select a final card layout or require every stored field to
be displayed. Issue #5 must decide which metadata/effects belong in the primary
reveal, which can be progressive detail, how provenance should be communicated,
and whether actor/cause require schema fields or a narrative-quality rubric.
Those choices should be evaluated against the corpus and boundary metrics above.

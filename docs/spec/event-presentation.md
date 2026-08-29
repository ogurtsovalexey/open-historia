# Event Presentation Contract

Status: Accepted product contract for the first playable event slice

This contract turns accepted domain changes into readable campaign history. It
governs the current event UI and the richer typed events that will replace it.
The engine remains authoritative: prose explains accepted state; it never
creates state by implication.

## 1. Player outcome

After each revealed event, the player should be able to answer three questions
without opening JSON or a prompt:

1. What happened, to whom, and what triggered it?
2. What canonical values or map objects actually changed?
3. Why does the change matter now?

Persistent dashboards show current totals. Event cards show the dated change
and its cause. They must not repeat a full country sheet.

## 2. Information hierarchy

The reveal card has four layers, in this order:

1. **Identity:** date, severity, headline and involved polity/entity tags.
2. **Narrative:** a concise trigger → development → significance explanation.
3. **Accepted effects:** compact engine-derived chips for changes that were
   actually applied.
4. **Why / Details:** an optional expansion with every accepted effect, causal
   contributions, provenance and uncertainty that canonical data can support.

The collapsed card should normally fit on a narrow screen without hiding the
headline or first effects. It shows at most four effect chips, followed by
`+N more`; expansion shows the complete accepted list. Entity tags are filters,
not effects, and must not be styled as value changes.

The reveal timeline and later country history use the same event projection.
The compact country-history row may truncate narrative, but it must retain
severity, effect summary and access to the full shared card/details.

## 3. Severity

The first slice derives severity from existing canonical fields; it does not
ask a model to invent another label:

| UI tier | Current event fields | Behaviour |
|---|---|---|
| `routine` | `notable !== true` and `importance !== "major"` | Normal card; does not interrupt automatic advance. |
| `significant` | `importance === "major"` and `notable !== true` | Stronger hierarchy; remains in the normal reveal chain. |
| `critical` | `notable === true` | Highest hierarchy and may stop automatic advance. |

Comparison is case-insensitive. Unknown importance safely becomes `routine`.
`playerRelated` is a relevance accent, not severity: a routine domestic update
does not become a world crisis merely because it concerns the player.

## 4. Narrative contract and budget

Every description is written from inside the world and covers, in natural
order:

- **trigger:** the concrete decision, pressure, incident or prior development;
- **development:** the actors and what occurred during this event;
- **significance:** the immediate stakes or follow-on pressure justified by
  accepted state.

The headline is one specific news-style sentence. The body uses these default
budgets:

| Severity | Sentences | Words | Use |
|---|---:|---:|---|
| Routine | 2 | 30–55 | Ordinary policy, diplomatic or operational development. |
| Significant | 2–3 | 50–90 | Material turn, treaty, major policy shift or campaign development. |
| Critical | 3–4 | 80–140 | Rare regime, war, settlement or state-continuity turning point. |

These are evaluation bands, not permission to add filler. A shorter body is
valid when it completely answers the three questions. More than 140 words
requires a separate authored long-form artifact, not an oversized card.

Narrative must not:

- introduce a number, transfer, appointment, death, agreement or decision that
  is absent from accepted state/events;
- claim a rejected or salvaged-away operation occurred;
- make a binding decision for the player;
- use meta phrasing such as “because the player chose”;
- restate every chip in prose when the significance is already clear;
- add filler chronology or retrospective historical inevitability.

Narration should be generated with the main structured result where practical.
A second narrative-model call is not part of this slice. It requires measured
evidence that one-call quality is inadequate plus explicit approval of its
latency, token and cost budget.

## 5. Accepted-effect chips

Chips are deterministic projections of normalized effects that survived
validation and were applied. They are localized by checked-in UI strings; no
model call formats or translates them. An empty effect family produces no chip.

| Effect family | Primary chip content |
|---|---|
| Region transfer | Region and previous → new controller when both are known. |
| Polity change | Name/status change or exact reputation/stat delta when a pre/post value exists. |
| Unit operation | Formation spawn, movement, strength delta or removal. |
| Marker operation | Structure built, renamed or removed. |
| Created chat | Diplomatic contact opened and initiating polity. |
| Resolved action | Confirmed action title/ID resolved by this event. |

A chip must never turn an absolute value into a guessed delta. When the current
schema records only an operation, show the operation (“Rail depot built”), not
a fabricated `+1`. Color-only changes use an accessible text label in details
rather than a color swatch alone. Territory, casualties, money and quantities
always show their canonical unit/scope when available.

If narrative describes a canonical change for which no accepted effect exists,
the event fails state-agreement validation; the UI must not manufacture a chip
to hide that failure. Conversely, every material accepted effect must be
discoverable in the expanded details even when it is beyond the four-chip
collapsed limit.

## 6. Why, provenance and uncertainty

`Why / Details` is progressive disclosure, not another generated summary. It
may show only data present in canonical records:

- complete accepted effect list and effect notes;
- resolved action references and causal contribution entries;
- event ID/source and from/to world revisions when available;
- source references, effective dates, units and confidence/assumption markers;
- explicit fallback or unknown-data status.

Presentation distinguishes:

- **accepted fact/effect** — canonical event or state delta;
- **estimate/assumption** — canonical value explicitly carrying that status;
- **narrative explanation** — prose view of the accepted material.

The current event schema has no first-class actor, cause or confidence fields.
For the current-game 80/20 slice, actor and trigger quality are evaluated in the
narrative and cross-checked against effect entities and `actionIds`; confidence
is displayed only when an underlying canonical record supplies it. Adding new
authority-bearing event fields waits for the typed domain-event contract rather
than creating another legacy prose schema.

## 7. Fallbacks, salvage and de-duplication

Fallback events retain a visible `Fallback` badge. The badge describes source,
not severity or failure. Salvaged events display only operations that survived
validation. Removed operations belong in local diagnostics, never as applied
chips.

Two events with identical prose but materially different effects must not be
collapsed. Implementation of this contract must either include canonical
effect identity in de-duplication or prove that distinct accepted effects
cannot reach the current prose-only key. Intended prose restatements with the
same effective changes should still collapse deterministically.

## 8. Performance and accessibility budgets

- Rendering and expanding a card makes zero model calls and no network request.
- The first four chips render without loading a full map, dossier or event log.
- Expansion is keyboard accessible, exposes state to assistive technology and
  does not rely on colour alone.
- Long entity names, Russian text and 320-pixel layouts wrap without horizontal
  scrolling or hiding dates/effects.
- The event-quality report records generated word/output-token counts, model
  latency, parse/repair rate and state-agreement failures separately. It must
  not claim that longer prose is higher quality.

## 9. Acceptance matrix

Issue #14 supplies a deterministic corpus covering each effect family, a mixed
event, both fallback branches, a legacy event, salvage, and same-prose events
with different effects. Russia, Germany and Britain appear across actor, target
and third-party roles without inventing scenario history.

Issue #15 is accepted when tests and manual review prove:

1. severity derives exactly from the table above;
2. collapsed hierarchy and the four-chip limit work on desktop and mobile;
3. every chip is derived from an applied normalized effect;
4. every applied material effect remains available in details;
5. narrative/effect contradictions fail the corpus rubric;
6. reveal and later country inspection share the same projection;
7. distinct-effect de-duplication is safe;
8. fallback, unknown, assumption and narrative states are visually distinct;
9. opening/rendering/translating static chip UI makes zero model calls; and
10. no second narrative call is introduced.

This contract intentionally does not implement the future full economy,
combat, provenance dashboard or typed event catalog. It makes the current game
more informative while preserving the engine/AI authority boundary required by
Principles 1–3.

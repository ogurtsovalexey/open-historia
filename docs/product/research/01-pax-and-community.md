# Research: Pax Historia and community feedback

## Method and confidence

This review combines:

- official Pax Historia creator documentation;
- public Pax UI/prompt material and creator guides;
- Open Historia GitHub issues, pull requests and developer documentation;
- public Reddit reports from Pax players.

Official documentation and inspected source code are treated as facts. Reddit posts are anecdotal evidence: useful for recurring failure patterns, not proof of prevalence. Product decisions below are based on repeated patterns that also have a plausible technical cause.

## What Pax does well and should influence us

### 1. A clear “decisional pause” loop

The world is paused while the player reads events, writes actions and negotiates; a jump then adjudicates consequences. Pax additionally exposes save/intervene behavior during event reveal and rewind afterward. This gives the player a meaningful boundary between intent and consequence.

Adopt:

- generate a compact turn plan first;
- reveal and commit it event by event;
- allow intervention at the last revealed event;
- retain deterministic rollback checkpoints.

Do not copy the implementation failure where map changes can disappear or reappear after refresh. Reveal state must be derived from one committed transaction prefix.

### 2. Strategy-grounded diplomacy as a product goal

The most compelling Pax behavior is not fluent prose by itself. Players value countries reacting to their initiatives and previous deals. The relevant external design precedent is CICERO: a strategic planning engine determines intent, and a dialogue model realizes that intent in language. Meta describes this explicit coupling of strategic reasoning and controllable dialogue in its [CICERO architecture](https://ai.meta.com/blog/cicero-ai-negotiates-persuades-and-cooperates-with-people/).

Adopt a lightweight version:

- each polity has goals, red lines, posture, relations and active commitments;
- a diplomacy turn first resolves a `DiplomaticIntent`;
- prose must be consistent with that intent;
- a high-stakes negotiation may use a planning step, while small talk should not.

### 3. AI task slots instead of one global model setting

Pax creator docs expose opaque `utility`, `game` and `advisor` slots. A workflow chooses a purpose; the platform resolves provider, model and thinking policy. The same docs describe typed tools, normalized outcomes and explicit retry lineage: [AI Slots and Tools](https://www.paxhistoria.co/docs/workflows/ai-calls), [AI Failures and Retries](https://www.paxhistoria.co/docs/workflows/ai-failures-retries).

Adopt, but give a personal fork more control:

- named task profiles: utility, translation, diplomacy-fast, diplomacy-deep, simulation, advisor and memory;
- explicit model/provider selection per profile;
- capability-aware adapters;
- visible parameters and cost rather than opaque platform ownership.

### 4. Typed workflows and effect boundaries

Pax workflows are typed JavaScript generators that can yield only declared commands. Runtime validation occurs before dispatch, and model tool calls are data rather than automatic side effects. This is a strong boundary: [Workflow Quickstart](https://www.paxhistoria.co/docs/workflows).

Adopt the principle without copying the full sandbox:

- AI output proposes domain commands;
- validators and reducers own side effects;
- UI and scenario code cannot write arbitrary pieces of state through untyped objects;
- one source of schemas generates TypeScript types, runtime validation and LLM tool schemas.

### 5. Durable memory with atomic compression

Pax documents separate game and catalyst stacks, exact transcript retention until a threshold, atomic summary publication and failure behavior that leaves exact history intact. A catalyst contributes its public outcome, not its private reasoning transcript: [Jump Forward Agent Memory](https://www.paxhistoria.co/docs/workflows/compression).

Adopt:

- separate canonical facts, episode summaries and raw archive;
- isolate temporary scene memory;
- never delete represented history before a smaller validated summary is committed atomically;
- preserve evidence IDs.

Improve:

- structured domain facts should not depend on an LLM compression pass at all;
- compression is only for narrative/transcript material.

### 6. Scenario/version/community ergonomics

Pax supports copying presets, versions, collaborators, map feature tags, bulk editing, additional polity names and topology checks. These make content creation practical. The creator guide also stresses that world-before-start and simulation rules are separate concepts.

Adopt:

- versioned scenario manifests and update migrations;
- reusable map/entity packs;
- aliases as data attached to stable polity IDs;
- map validation for gaps, overlaps, invalid geometry and missing status sources;
- authoring diagnostics and a playtest checklist;
- community quality signals, but no assumption that popularity equals historical quality.

## What Pax users repeatedly dislike

| Pattern | Public evidence | Design response |
|---|---|---|
| High token cost and unpredictable drain | [token spending discussion](https://www.reddit.com/r/PaxHistoria/comments/1ulrooy/is_pax_historia_spending_a_lot_of_tokens/), [expensive diplomacy](https://www.reddit.com/r/PaxHistoria/comments/1vzvyor/why_does_the_diplomatic_chats_cost_so_much/) | Per-call ledger, budgets, model profiles, deterministic routing, no hidden utility calls |
| Slow generation | [slow game report](https://www.reddit.com/r/PaxHistoria/comments/1roqjey/this_game_has_a_lot_of_potential_but_god_it_is/) | Stream visible progress, eliminate needless calls, context budgets, cancellation |
| Model performs actions for the player | [player-agency complaint](https://www.reddit.com/r/PaxHistoria/comments/1ugrxf9/my_personal_rant_about_ai_and_pax_historia/) | Domain-level agency validator; proposals remain open until accepted |
| Historical railroading after divergence | [WWII events ignoring changed causes](https://www.reddit.com/r/PaxHistoria/comments/1vl8gmf/new_player_does_the_game_force_historicity_how_to/) | Causal facts and divergence ledger; historical schedule is advisory, never an event script |
| Short, generic, repetitive answers despite expensive models | [quality regression report](https://www.reddit.com/r/PaxHistoria/comments/1u7kpmd/why_are_the_ai_so_crap_now/) | Task-specific quality evals and output contracts; no “premium” label without measured behavior |
| Map-feature spam | [too many map features](https://www.reddit.com/r/PaxHistoria/comments/1scym7l/too_many_map_features/) | Deterministic feature policy and quotas; AI cannot emit a marker unless it serves a domain event |
| Territory/map changes reset or contradict narrative | [critical map/reset report](https://www.reddit.com/r/PaxHistoria/comments/1s03gqo/critical_ongoing_lag_and_critical_bug_along_with/) | Atomic turn transactions, domain invariants and event-state hashes |
| Scenario rules ignored or low-quality “AI slop” presets | [preset quality discussion](https://www.reddit.com/r/PaxHistoria/comments/1vgssf7/what_was_the_worst_preset_youve_ever_seen_so_far/) | Versioned schema, validator, source metadata, regression playtests and quality badge criteria |
| Large custom maps become unusable and costly | [4,685-region basemap discussion](https://www.reddit.com/r/PaxHistoria/comments/1vdf0je/thoughts_on_my_new_basemap/) | Spatial retrieval and level-of-detail; never serialize all regions into every prompt |
| Editor reliability and topology problems | [preset editor report](https://www.reddit.com/r/PaxHistoria/comments/1u00bha/preset_editing/) | Undo journal, topology validation and autosave revisions |

## Open Historia community signals

Open Historia's own issue history points to the same architectural seams:

- [#635](https://github.com/Open-Historia/open-historia/issues/635): users want to know what context the AI actually sees.
- [#633](https://github.com/Open-Historia/open-historia/issues/633): error/API logs are missing.
- [#624](https://github.com/Open-Historia/open-historia/issues/624): every paid/slow generation needs cancellation.
- [#541](https://github.com/Open-Historia/open-historia/issues/541): extreme RAM growth was observed.
- [#545](https://github.com/Open-Historia/open-historia/issues/545) and [#645](https://github.com/Open-Historia/open-historia/issues/645): territory state and display have repeatedly diverged.
- [#548](https://github.com/Open-Historia/open-historia/issues/548): country-shaped statistics do not fit landless factions or individuals.
- [#381](https://github.com/Open-Historia/open-historia/issues/381): players want entity details, tags, interactions and an explicit change breakdown.
- [#265](https://github.com/Open-Historia/open-historia/issues/265): mechanics need modular enable/disable support.
- [#156](https://github.com/Open-Historia/open-historia/issues/156): provider-specific parameters need a supported configuration surface.

One upstream fix is especially diagnostic. [PR #639](https://github.com/Open-Historia/open-historia/pull/639) reports a long campaign prompt of roughly 803,000 characters, around 700,000 of which were repeated resolved actions. This was not a “model context problem”; it was an absent context budget and duplicated prompt assembly.

## Product conclusions

1. Copy interaction patterns, not Pax's token economics or monolithic prompt style.
2. The best idea is a workflow/domain boundary; the worst is asking one model to reconstruct the whole game from prose each call.
3. A cheap preliminary model should be optional. A deterministic classifier can resolve most routes for free; a utility model is justified only when its small call prevents a much larger irrelevant context payload.
4. A “better model” cannot compensate for missing treaties, wars, control status and polity goals in canonical state.
5. Scenario depth comes from structured initial conditions, causal rules and tests—not prompt length.
6. Every convenience generation (translation, next speaker, action improvement) must be independently visible, cancellable and assignable to a cheap/local profile.

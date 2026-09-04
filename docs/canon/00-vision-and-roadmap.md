# 00 — Vision and roadmap (read first)

Status: accepted by the owner 2026-08-30. Supersedes the scope and ordering of
`docs/product/07-roadmap.md` (archived), whose dependency logic is kept and
whose ambition is deliberately cut. Read this before any planning.

> **2026-09-04 owner amendment:**
> [`22-living-world-program.md`](22-living-world-program.md) is the binding
> post-Strategic-V4 target and delivery sequence. This document remains the
> record of the completed P0–P8 path and its scope discipline, but canon 22
> supersedes its authored-only future catalogs, remaining roadmap and final
> playability gate where they conflict.

## What the finished game is

A **personal single-player grand strategy** game, played by its author, where a
deterministic numeric simulation is the base of reality and LLMs act on top of
it. Success = "I want to keep playing it", not downloads or revenue. Secondary
purpose: a polygon for a solo-dev + AI-agent-fleet methodology.

The player picks a country in a **bounded world** (one region/continent,
50–100 actively simulated countries, dozens to a few hundred regions), writes orders in free text,
chooses how far to advance time, and reads what the world did with the numbers
and why. Rival countries are played by an LLM that competes for real, reasoning
over the same numbers the player sees, with configurable difficulty.

**Non-negotiable division of authority** (`docs/principles.md` §2, canon 07):
the engine owns all formulas, totals and state transitions; the LLM interprets
intent, decides strategy and narrates. An LLM never invents a number.

## The four core systems

The game is "done enough to play" when all four exist at working depth:

1. **Economy and regions** — regional production chains, budget, investment,
   demography, trade. *(Slice shipped; see canon 04.)*
2. **Diplomacy and AI opponents** — relations, agreements, alliances, and an
   LLM playing rival countries competitively at selectable difficulty.
3. **Internal politics** — factions/estates whose satisfaction is driven by the
   economy numbers (raise taxes without placating the nobility → unrest),
   legitimacy, rulers, transfers of power.
4. **War and army** — forces, mobilization drawn from population, supply,
   aggregate combat resolution, territorial change feeding straight back into
   regional re-aggregation.

## The four later layers (all wanted, none blocking the first playable loop)

Confirmed by the owner as part of the finished game. Small enabling slices may
ship earlier than the full layer when they unlock interaction (for example,
bilateral trade contracts precede a full market simulation):

5. **Rulers and dynasties** — rulers/ministers as entities with traits and
   reputation, succession, transfers of power, personal relations.
6. **Culture and religion** (`societyAndIdentity`) — regional/group identity.
   **Static first**: identity comes from the scenario, mismatch with the state
   religion/language produces unrest and penalties and affects annexation.
   **Simple dynamics later**: assimilation, conversion and migration by plain,
   readable rules — deliberately not a Victoria-grade diffusion model.
7. **Technology and projects** — research as capabilities and efficiencies (not
   a linear tech year); construction/reform as projects with cost schedules,
   prerequisites and visible progress.
8. **Prices and full markets** — prices and shortages, currency/inflation,
   blockade as an economic weapon. Basic bilateral resource exchange ships in
   P3b and does not wait for this layer.

Out of scope for "finished" unless they emerge naturally: curated multi-scenario
historical content at scale, scenario authoring tools for third parties,
anything requiring global-map fidelity.

## Modular mechanics (accepted architecture decision)

Adopted from the archived domain spec: a scenario manifest **enables modules**
— `territorialControl` (required), `economy`, `publicFinance`,
`productionAndTrade`, `resourcesAndLogistics`, `demographics`, `diplomacy`,
`internalPolitics`, `societyAndIdentity`, `armedForces`, `combat`, `projects`,
`technology`, `campaign`.

A disabled module is absent from state, UI, **AI context and tool schemas**.
This is the mechanism that makes staged growth safe and keeps token spend
proportional to the scenario: a peacetime economic scenario never carries
military mechanics into a prompt. Adopt the pattern while the engine is small;
retrofitting module boundaries later is expensive. Every new subsystem declares
its module id and its position in the fixed tick order (canon 03).

## Why the world is bounded

The single biggest cost driver. A bounded world keeps every polity honestly
simulated (no fake "baseline fidelity" tiers), keeps AI-opponent token spend
affordable (a brief per country per turn is small), keeps performance a
non-issue, and makes balance actually tunable by one person. The engine must
not hardcode the bound — scenarios declare their own size — but no roadmap item
is justified by "it must scale to the whole globe".

## Roadmap

Ordering principle, changed from the archived roadmap: **prove the loop is fun
before adding depth.** The archived version put competitive AI at milestone 6,
after three XL war/logistics subsystems — that risks building for months before
learning whether the core is interesting. Here the full loop (text orders → AI
opponent → deterministic consequences) comes second.

| Phase | Delivers | Status |
|---|---|---|
| **P0 — Deterministic economy core** | Headless slice (originally 2 countries × 5 regions; superseded as a playtest target by the four-polity Central Europe scenario, kept as a regression fixture), monthly tick, ledger, report with causes, atomic run dirs, byte-identical replay, golden tests | **Done** (canon 04) |
| **P1 — Headless bench** | UI-free playtest surface for fast checks: region table, national totals, "why changed" from the ledger, resource flows, investment order, advance one/twelve months, reset, turn report. Zero model calls (`npm run play:engine`). A test bench, not the product. | **Done** |
| **P2 — The engine inside the game** | The Central Europe scenario (4 polities, 47 real regions) visible on the map; clicking a region selects it; the `Economy` drawer tab shows region + controller numbers and "why changed" from the ledger; advancing time runs the engine, not a model. Date, round, ownership and economy publish as one game-scoped session revision. Zero model calls. | **Done** |
| **P3a — Economic agent loop** | Free-text economy orders → typed commands; bounded opponent briefs, scheduling, difficulty and atomic agent turns | **Done** (canon 09) |
| **P3b — Playable diplomacy and trade** | Six-polity Central Europe (add metropolitan France and Poland), two-tier AI orchestration, relations, proposals/counters, four agreement types, calls to arms and bilateral resource/treasury contracts | **Done** (canon 11) |
| **P3c — Statecraft tools** | Tax burden, budget priorities, debt/default; unified projects for construction/reform/research/mobilization/intelligence; evidence-backed country knowledge | **Done** (canon 12) |
| **P4 — Politics and characters** | Scenario-defined factions, legitimacy/stability/unrest, escalation to coups/rebellions; rulers, heirs, appointments, succession and significant personal relations | **Done** (canon 13) |
| **P5 — War and peace** | Formations and commanders, mobilization, connected supply, fronts, deterministic aggregate combat, occupation and validated free-form peace bargaining | **Done** (canon 14) |
| **P6 — Capabilities and identity** | Non-linear capabilities; culture/religion mismatch, accepted identities and slow causal policy-driven change | **Done** (canon 15) |
| **P7 — Campaign and balance** | Adaptive goals, generated crises, soft horizon and multidimensional legacy; tune the complete diplomacy → economy → politics → war loop for replayable campaigns | **Done** (canon 16) |
| **P8 — World and deeper markets** | Grow toward the bounded target only after the loop is fun; full markets/prices, optional simple migration and other proven depth | |
| **P9 — Optional** | One curated historical scenario; anything else | Optional |

The decision-complete implementation sequence and minimum acceptance scenario
for each remaining slice are binding in
[`10-playable-game-next-steps.md`](10-playable-game-next-steps.md). It refines
the former coarse P3–P8 ordering without reopening completed P0–P3a contracts.

**Gates** (a phase is passable, not a calendar promise):

- **Gate A — interactive loop**: P0-P3b. A campaign of ≥12 months can be played
  end to end with orders in prose, rival countries that negotiate and trade,
  and every numeric change explainable from the ledger.
- **Gate B — core four**: +P3c+P4+P5. All four core systems interact; a war
  changes the economy, which changes politics, which constrains the war.
- **Gate C — full campaign**: +P6+P7. Identity, people, capabilities, crises
  and legacy all feed the same canonical state and complete campaign loop.
- **Gate D — playable-for-real**: balance work in P7, then optional P8 depth.
  The game is balanced enough that the author chooses
  to play it for its own sake. This is "finished".
- Optional Gate E: a curated historical scenario on top, if wanted.

## The inherited application IS our game shell (owner clarification 2026-08-31)

The game stays what it is visually: **a map-based grand strategy game**. The
inherited React application, its MapLibre map, its panels and its drawer are
the shell we keep and extend. Our work replaces the *numeric core* and adds
panels; it does not replace the presentation.

Concretely:

- **The map is the primary interface.** Selecting a region means clicking it on
  the map, not picking it from a list.
- **Our economy view is a drawer tab inside the game**, not a separate page.
  `regional-resource-economy.md` §6 already fixes this contract: the right
  drawer's first tab is `Economy` (open by default), then `Advisor`, then
  `Stats`; a map click selects a region; the region section sits above its
  current controller's section.
- **`packages/engine` is the authority for numbers**; the app renders what the
  engine computed and explains it from the contribution ledger. The legacy
  path where a model writes `impacts` into `world.json` is what goes away.
- The standalone playtest server (`npm run play:engine`) is a **headless test
  bench**, not the product surface. It stays useful for fast, UI-free checks.

What is dropped is the legacy *content and semantics*, not the application:
its scenarios are not our playtest target, and a model never again invents a
numeric outcome. Because we do ship this application, its token hygiene is our
problem: static EN+RU locales, no runtime model translation, bounded prompt
context, every model call through the call registry/ledger (canon 07), and a
Playwright smoke suite over our own screens (canon 08).

Audit findings on the inherited code are recorded in `docs/audits/` and are
directly actionable now that this app is the shell. The most important one:
prompt bloat does **not** come from the map (the map rule is honoured) but from
`consolidatedHistory` and `campaignMemory`, which are appended forever and
rendered into the prompt in full — the same bug class already fixed once for
action history and not fixed for its replacements.

## What is explicitly NOT the plan

Dropped or deferred from the archived roadmap, with reasons:

- **Global coverage / every polity in the world** — replaced by the bounded
  world above.
- **Two mandatory historical scenarios (World 1916 + World 1797–1815)** and the
  curated multi-wave source program — moved to optional P9; a fictional world
  with historically plausible magnitudes is the driver instead. (The research
  already done, `docs/research/world-1916-*`, stays as reference.)
- **Scenario platform, authoring tools, Pax import boundary** (archived M8) —
  no third-party content producers exist for a personal game.
- **Build-versus-buy evaluation** (archived M-1) — already decided: build.
- **Rewriting in another language** — ADR-001 stands; TypeScript.
- **Detailed combat before economy/population/supply** — same prohibition as
  the archived roadmap, still binding.

## Working rules that make this feasible solo

The methodology is part of the product (canon 08): contract-first specs, hard
machine-checked Definition of Done, golden/determinism tests as the safety net,
small whitelisted tasks for bounded worker agents, and the strong model
reserved for architecture, specs and review. A phase is not started without a
feature spec in this directory using the fixed sections: Preconditions,
Deliverables, Tasks, Acceptance criteria, Not doing, Open questions.

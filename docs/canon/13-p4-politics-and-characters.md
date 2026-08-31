# 13 — P4 internal politics and characters

Status: accepted implementation contract, 2026-09-01. This implements stage 4
of canon 10 after the accepted P3c slice.

## Preconditions

- Canon 00–12 remain binding and their fixtures remain replay-compatible.
- `politics` is optional. A scenario without it carries no political state,
  commands, UI or model context.
- Authored factions and characters are starting truth. Models choose only
  listed commands and qualitative bands; the engine owns all numeric effects.

## Deliverables

- Each participating polity has three to six factions, legitimacy, stability,
  unrest, succession law, ruler and heir. Factions have stable ids, power,
  support, an economic preference, a foreign-policy preference and one
  scenario-authored leader.
- Characters have a stable id, name, polity, faction, office, starting and
  experience traits, loyalty, ambition and a bounded list of significant
  relations. Offices are unique inside a polity.
- The monthly engine derives faction support from effective taxes, budget
  priorities, matching active projects and diplomatic agreements. Weighted
  dissatisfaction derives unrest; legitimacy and stability respond gradually.
- Escalation is deterministic and moves at most one step per month through
  `calm → demands → protest → strike → coup → rebellion`. Every transition and
  numeric cause is recorded in the ledger.
- Typed actions allow concession, repression or refusal of an active faction,
  appointment to a key office, abdication to the lawful heir and creation of a
  historical or fictional runtime character from qualitative bands. Commands never set
  support, loyalty, ambition, legitimacy or unrest directly.
- A successful coup installs the authored faction leader, removes the former
  ruler from office and keeps the polity playable. Lawful abdication installs
  the heir and deterministically selects the next eligible heir.

## Tasks

1. Add scenario, state, command and ledger schemas plus semantic reference
   validation and lazy compatibility for older saves.
2. Resolve political commands before the economy and monthly political drift
   after finance/projects, so policy consequences use the committed month.
3. Add public/player projections and a bounded strategic brief containing only
   the acting polity's political state and engine-allowed responses.
4. Add an existing-shell Politics panel for faction demands, responses,
   appointments, ruler/succession and runtime fictional characters.
5. Ship a six-polity authored seed and a mocked vertical crisis/coup smoke.

## Acceptance criteria

- Changing tax/budget or signing an agreement produces an explainable faction
  delta and identical state/ledger under replay.
- Invalid faction, character, office, succession and stale-revision commands
  reject without partial mutation. One office cannot have two holders.
- Concession spends conserved treasury; repression/refusal creates explicit
  trade-offs; a low-support faction reaches and resolves a coup through the
  deterministic chain while a valid successor keeps the campaign alive.
- The player can view factions and characters, respond to a crisis, appoint an
  official, create a historical or fictional official and observe a transfer of power.
- Opponent prompts contain no full map, private intelligence catalog or other
  polity's character detail; a required failed strategic call cannot advance.
- Root tests, typecheck, lint, goldens, determinism guard and Playwright remain
  green.

## Not doing

- Parliamentary seat simulation, elections, family trees, fertility, mortality
  or hundreds of courtiers.
- Tactical rebel armies, civil-war fronts or assassination operations before
  P5 supplies the war contract.
- Model-authored historical characters or numeric traits at runtime.

## Open questions

None.

# Napoleonic Europe 1805 — ten-turn UI playtest

Date: 2026-09-06  
Scenario: `scenario:napoleonic-europe-1805`  
Player: French Empire (`polity:france`)  
Difficulty: Medium  
Save: `napoleonic-europe-january-1805-session-2`

## Result

The campaign was created via the visible scenario picker and played entirely
through the living-world UI. It advanced from `1805-01-01` to `1807-07-01`:
ten player decisions and thirty deterministic monthly boundaries. Each normal
advance used **Advance three months** and settled visibly at `3 / 3 monthly
boundaries resolved`; no direct gameplay API, filesystem edit, cheat, or
strategic-skip action was used.

The first French order was deliberately non-numeric: request a bounded reserve
from current recruitment for national readiness. The configured provider
resolved it as `military.mobilize`; the confirmation preview then derived 337
personnel, its Paris-and-Seine origin, and the equal civilian-workforce cost.
After confirmation, the engine retained the formation and its
`personnel-mobilize` evidence through the full campaign. This demonstrates the
required boundary: neither user prose nor AI authored the troop count, region,
formation identity, or economic impact.

The audit export records sanitized Utility and Strategic provenance
(`codex-subscription`, `gpt-5.6-luna`, low effort) with no raw provider
prompts or responses.

The post-loop Orders test claimed that France had destroyed the British fleet
at Trafalgar the preceding year and owned Bohemia. The shell never invented a
fleet fact (the aggregate scenario has no fleet-state predicate) and explicitly
contradicted the Bohemia control claim with 13 grounded sources. Confirmation
created no process, mobilization or proposal; the audit retained the date,
turn, decision index and world revision in the table below.

## Independent audit

Run:

```text
npm run playtest:audit -- --game napoleonic-europe-january-1805-session-2 \
  --data-dir .local-playtests/live-data --output /tmp/napoleonic-wp15-audit.json
```

| Field | Value |
| --- | --- |
| Date / engine turn | `1807-07-01` / `30` |
| Player decision index | `10` |
| World revision | `sha256:a97bc7337d68ebcedadf096a42e0358396935e39706a9c1972cc0415ff156d5d` |
| Replay checksum | `sha256:86a0775e4519d36f8dc610b14703d2055859b5072aac83d61e1e7601d077063a` |
| Audit checksum | `sha256:acb52fb690e45559fd3ba20d77d7655d1b39a3c731450a66485e7533a33be81e` |

## Scope and remaining coverage

This is a fresh, model-mediated, replay-audited ten-turn Napoleonic run and
demonstrates population/workforce-bound mobilization without turning the game
into a parameter console. It did not force combat, occupation, peace, or a
territorial transfer. Those are separate legal-pressure and cross-scenario
coverage tasks; absence of a valid trigger is recorded rather than filled with
a scripted historical outcome.

## Persistent-store rerun

On 2026-09-06 the visible UI run was repeated from a fresh persistent-store
campaign as the French Empire on Medium. It completed ten three-month
decisions and thirty monthly boundaries from `1805-01-01` to `1807-07-01`.
The first order created a bounded reserve of `337` people from Paris and Seine
with the matching civilian-workforce cost. One later strategic response was
rejected by its typed contract (`hold is required exactly when no material
decision is proposed`); the UI exposed **Retry**, and retrying advanced the
same turn without changing world state through an unvalidated decision.

| Field | Persistent rerun value |
| --- | --- |
| Date / engine turn / decisions | `1807-07-01` / `30` / `10` |
| World revision | `sha256:a66606a4f84599072ad864ffa691295d93b5a836add072dac55373a1ea33cef6` |
| Population / workforce / fielded personnel | `30,100,000` / `14,455,456` / `293,337` |
| Available manpower / supply capacity | `3,222,659` / `117,994` |
| Replay checksum | `sha256:7da72415b9d7677dd6da9070fab1026ff4fb66d7548ff09ea523e6f12662c089` |
| Audit checksum | `sha256:32c884d5599a2af5ff54215c46420361741bd7105fe6eae240c77bdad4c25e78` |

```text
npm run playtest:audit -- --game napoleonic-europe-january-1805-session \
  --data-dir .local-playtests/live-data --output /tmp/nap-persistent-ui-audit.json
```

### Post-run territorial proposal boundary

The same completed French campaign then tested the legal territory path through
the visible Orders UI. A proposal about Hanover was rejected because France
did not own and actually control it. A proposal to cede the actually controlled
Paris-and-Seine region to Prussia was instead shown as a frozen, pending offer:
the preview explicitly said that no territorial control changes before the
addressed recipient accepts. After confirmation, audit transition
`player-intent-confirmed` recorded
`proposal:128d26ba1350af11c6a9d4bf12863c29` at world revision
`sha256:a5129bd2fa3a4ae433846208a9d1a5baa45578dd222eb96f28b7af9b0e7d3d43`.
The proposal is `pending`, addressed only to `polity:prussia`, while
Paris-and-Seine remains both legally owned and actually controlled by
`polity:france`. No player sentence or confirmation transferred the region.

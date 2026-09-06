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

## Independent audit

Run:

```text
npm run playtest:audit -- --game napoleonic-europe-january-1805-session-2 \
  --data-dir test-results/live-playtest-data --output /tmp/napoleonic-wp15-audit.json
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

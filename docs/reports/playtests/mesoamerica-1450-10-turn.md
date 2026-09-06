# Central Mesoamerica 1450 — ten-turn UI playtest

Date: 2026-09-06  
Scenario: `scenario:central-mesoamerica-1450`  
Player: Mexico-Tenochtitlan (`polity:tenochtitlan`)  
Difficulty: Medium  
Save: `central-mesoamerica-1450-session-2`

## Result

The campaign was created through the scenario picker and played only through
the visible living-world UI. It advanced from `1450-01-01` to `1452-07-01`:
ten player decisions and thirty deterministic monthly boundaries. Every normal
advance used the visible **Advance three months** control and settled with
`3 / 3 monthly boundaries resolved`; no cheat, gameplay API, filesystem edit,
or strategic-skip control was used.

The first player intention was entered through Orders and interpreted by the
configured Codex-subscription provider as a typed, multi-stage tribute-route
and collection process. Its confirmation preview committed an
engine-derived 32 treasury and stated the institutional opportunity cost; it
did not accept player-authored numerical effects. A broader first phrasing
that targeted unproven concepts was visibly blocked and revised before any
confirmation, which confirms that semantic grounding remains fail-closed.

The final Briefing **Why?** disclosure showed a causal time-advance record
with 24 grounded sources. Read-only audit export confirms sanitized Utility and
Strategic provenance (`codex-subscription`, `gpt-5.6-luna`, low effort) and
contains no raw prompts or responses.

## Independent audit

Run:

```text
npm run playtest:audit -- --game central-mesoamerica-1450-session-2 \
  --data-dir test-results/live-playtest-data --output /tmp/meso-wp15-audit.json
```

Final canonical state:

| Field | Value |
| --- | --- |
| Date / engine turn | `1452-07-01` / `30` |
| Player decision index | `10` |
| World revision | `sha256:f295e1ed878f99c8eb0b6294f8790d84caad27153d22c1f21a709b06152f42bd` |
| Replay checksum | `sha256:bb8fa11061fdb26f494e385c017352dc79db26b696972c7f1f5f86f9bc63be86` |
| Audit checksum | `sha256:ab888018ce0cedc351c412d324772f85ae7a6bbb10834bc7b6466a5199c724ac` |

## Scope and remaining coverage

This is valid ten-turn, model-mediated and replay-audited evidence for the
Mesoamerican scenario. It demonstrates a bounded state/economic process,
grounded refusal of an unsupported concept target, monthly tribute settlement,
and causal UI inspection. It deliberately did not force war, occupation or a
territorial transfer; those paths require a separately legal scenario pressure
and remain cross-scenario acceptance coverage rather than an invented outcome.

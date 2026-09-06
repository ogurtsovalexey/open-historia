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

After the ten-turn loop, the Orders UI also received the scripted false claim
that Chalco had permanently accepted tribute ten cycles earlier and transferred
all warriors. It was shown as an unverified prior-world-state claim with no
ledger-grounded record and an explicit warning that free text cannot rewrite
history. Confirmation created no process, mobilization or diplomatic proposal;
the independent audit preserved `1452-07-01`, turn `30`, decision index `10`,
and its original world revision below.

## Independent audit

Run:

```text
npm run playtest:audit -- --game central-mesoamerica-1450-session-2 \
  --data-dir .local-playtests/live-data --output /tmp/meso-wp15-audit.json
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

## Persistent-store rerun

On 2026-09-06 the visible UI run was repeated in the persistent store from a
fresh campaign as Mexico-Tenochtitlan on Medium. It completed ten
three-month decisions and thirty resolved monthly boundaries from
`1450-01-01` to `1452-07-01`. The first decision deliberately claimed that
Chalco had permanently accepted tribute ten cycles earlier and transferred
all warriors. The preview classified it as an unverified claim about prior
world state, found no ledger record, and created no material commitment.

| Field | Persistent rerun value |
| --- | --- |
| Date / engine turn / decisions | `1452-07-01` / `30` / `10` |
| World revision | `sha256:928211b6a080c3765444e3eea3c3b96a3698c43b9d5b9b0ef073f51157d0792a` |
| Population / workforce / fielded personnel | `160,000` / `86,080` / `1,920` |
| Available manpower / supply capacity | `14,080` / `2,000` |
| Replay checksum | `sha256:39f9f5af3f03e3316f522ed452182652e57996b305e05cfe9ae0e26e94281381` |
| Audit checksum | `sha256:6fa5b0b274ee8fb2de418f597bc5ed324f7b57fc9fb95c3de95cfc3d4d6fa7eb` |

```text
npm run playtest:audit -- --game central-mesoamerica-1450-session \
  --data-dir .local-playtests/live-data --output /tmp/meso-persistent-ui-audit.json
```

## Post-loop economy process evidence

On 2026-09-06, after the completed ten-decision run, the same persistent
campaign was reopened through the visible **Orders** UI. The player entered
`Start a bounded chinampa and canoe-route maintenance process using current
Mesoamerican capacity.` The interpreted preview committed exactly `32` initial
treasury, described the action as multi-stage, and named its institutional
opportunity cost before the player could confirm it. No player-entered numeric
effect was accepted.

After confirmation, the visible **Advance three months** control completed all
three monthly boundaries. The persisted world records an active process
`process:67c7c53bd99aed92edd1faf2` for Mexico-Tenochtitlan: `32` funding,
`86` institutional capacity, `1,500 bp` progress, `5,100 bp` resistance, and
only the conservative `capacity.modify` and `supply-capacity.modify` effect
families. It is therefore evidence of a grounded, historically local economic
intention becoming a bounded engine process—not an immediate player-authored
economic result.

| Field | Post-loop value |
| --- | --- |
| Date / engine turn / decisions | `1452-10-01` / `33` / `11` |
| World revision | `sha256:764be9c34da063b5b0c29a65a09f6f77aa4db9041bbce3d1ba91ab833d135ecc` |
| Replay checksum | `sha256:0bd0503752547f8bb61b2695b09b8980ef6ff7f53b6c096bb5529ec177a52816` |
| Audit checksum | `sha256:8867fe7cb1108f23a6ff88c0307117cdb2aa1bfe331794459d275d84325d1480` |

```text
npm run playtest:audit -- --game central-mesoamerica-1450-session \
  --data-dir .local-playtests/live-data --output /tmp/mesoamerica-process-audit.json
```

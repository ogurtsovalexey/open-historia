# Living World — cross-scenario UI assessment

Date: 2026-09-06. Three fresh medium-difficulty browser campaigns completed
without UI bypasses. Each ran ten player decisions and thirty monthly
boundaries using the configured Codex-subscription provider. The latest reruns
are retained in the ignored `.local-playtests/live-data` store rather than the
test-cleared scratch location.

| Scenario / player | End | Core live evidence | Replay checksum |
| --- | --- | --- | --- |
| Central Mesoamerica 1450 / Mexico-Tenochtitlan | `1452-07-01` | prior-world tribute claim rejected; numeric canonical state retained | `sha256:39f9f5af3f03e3316f522ed452182652e57996b305e05cfe9ae0e26e94281381` |
| Napoleonic Europe 1805 / French Empire | `1807-07-01` | 337-person population/workforce-bound mobilization; invalid strategic response safely retried | `sha256:7da72415b9d7677dd6da9070fab1026ff4fb66d7548ff09ea523e6f12662c089` |
| Europe 1935 / Poland | `1937-07-01` | 440-cost electricity process; false territorial/army claim rejected; 461-person reserve | `sha256:9183f68bf30ff968e52df0bf625485afe907bc289319ab7ce63d639af426c955` |

All three independent audit exports retained only sanitized provider metadata
and canonical revisions. The reports are [Mesoamerica](./mesoamerica-1450-10-turn.md),
[Napoleonic Europe](./napoleonic-1805-10-turn.md), and
[Europe 1935](./europe-1935-10-turn.md).

Post-loop UI checks added three safe historical-claim boundaries: Poland's
East Prussia/two-million-soldier claim was separately contradicted; Tenochtitlan's
claim of permanent Chalco tribute and all warriors was rejected as unverified;
and France's Bohemia claim was contradicted while the unsupported Trafalgar
fleet assertion remained non-material. None created a process, proposal,
mobilization, control transfer, or change to the audited world revision. Poland
also created an Electricity investigation only as a proposed, funded,
multi-stage process with engine-derived commitment and resistance.

This demonstrates the normal player loop across industrial, Napoleonic and
tribute-centred worlds. It does not claim that these peaceful, bounded runs
forced every possible war, occupation, combat, peace, or territorial-transfer
path; those remain covered by the dedicated deterministic and cross-era tests,
not fabricated UI outcomes.

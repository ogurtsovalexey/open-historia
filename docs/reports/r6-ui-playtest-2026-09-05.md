# R6 local UI playtest — 2026-09-05

Environment: isolated `test-results/playwright-data` server store, opened in the
real browser UI at `http://127.0.0.1:3101`. No game state was changed through
an API, cheat or filesystem edit.

## Completed deterministic UI runs

| Scenario / player | Start | End | Player decisions | Monthly boundaries |
| --- | --- | --- | ---: | ---: |
| Napoleonic Europe 1805 / French Empire | 1805-01-01 | 1807-07-01 | 10 | 30 |
| Central Mesoamerica 1450 / Mexico-Tenochtitlan | 1450-01-01 | 1452-07-01 | 10 | 30 |
| Europe 1935 benchmark / Poland | 1935-01-01 | 1937-07-01 | 10 | 30 |

For every decision the visible control was `Continue for three months`; after
settlement the shell displayed `3 / 3 monthly boundaries resolved`. The first
Napoleonic run also exposed the Country surface after decision five, showing
engine-derived population, workforce, treasury, productive capacity, fielded
personnel, recruitable population and supply capacity rather than model-made
statistics.

## Honest limitation

The local browser had no configured AI provider/API key. An authored Russian
intent therefore produced the visible provider setup error, and each advance
stopped at the visible strategic checkpoint. The explicit `Continue without
this decision` action was used to verify the fail-closed recovery path; no
model action, fallback narrative, or fabricated strategic decision was
accepted. Consequently this report is evidence for the UI and deterministic
three-month loop, **not** completion evidence for WP15's model-mediated
intent, diplomacy, counterfactual-concept and territorial-pressure coverage.

To close WP15, repeat these three runs with a configured production provider,
record the preview and revision before each decision, and execute the scripted
intent coverage in canon 23 section 20. Do not bypass the checkpoint or add a
test-only provider to a production playtest.

## Model-mediated smoke test (subsequent run)

After enabling the desktop Codex-subscription provider in both strategic and
utility roles (GPT-5.6-Luna, low effort), schema preflight passed for both
contracts. In a fresh French 1805 game, the Russian order
“Сосредоточить действующую армию на Рейне и подготовить дипломатическое
давление на Австрию, не начиная войну без подтверждённого преимущества.”
was sent through the real Orders UI.

The model returned two typed actions, affected France and Austria, and an
engine-derived initial commitment of 1,757 with an explicit resistance risk.
The user-facing confirmation initially exposed a validation defect for a
non-Latin semantic name; it was fixed in `8a98c30` and the same already
model-verified interpretation then confirmed through the UI. The engine
created the long-running French process and committed its resources.

Advancing the real UI once then completed three monthly boundaries
(`1805-01-01` → `1805-04-01`), with the process visibly progressing from 0% to
9%. The UI waited for strategic resolution rather than using the explicit skip
recovery. This proves one end-to-end model-mediated player intent and one
strategic settlement, but it does **not** replace the three 10-decision runs or
complete the remaining diplomacy, counterfactual-concept and territorial
pressure cases required by WP15.

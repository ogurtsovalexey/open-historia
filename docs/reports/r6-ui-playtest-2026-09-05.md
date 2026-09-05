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

# Europe 1935 Campaign Lab

Completed matrix cells: 21/21.

Execution mode: mock. The committed matrix is a deterministic infrastructure baseline; it does not stand in for the pending live Gemini experiment.

| Player | Strategy | Mode | Final month | Calls |
|---|---|---:|---:|---:|
| polity:austria | alternative | mock | 1940-07-01 | 0 |
| polity:austria | free | mock | 1940-07-01 | 0 |
| polity:austria | historical | mock | 1940-07-01 | 0 |
| polity:czechoslovakia | alternative | mock | 1940-07-01 | 0 |
| polity:czechoslovakia | free | mock | 1940-07-01 | 0 |
| polity:czechoslovakia | historical | mock | 1940-07-01 | 0 |
| polity:france | alternative | mock | 1940-07-01 | 0 |
| polity:france | free | mock | 1940-07-01 | 0 |
| polity:france | historical | mock | 1940-07-01 | 0 |
| polity:germany | alternative | mock | 1940-07-01 | 0 |
| polity:germany | free | mock | 1940-07-01 | 0 |
| polity:germany | historical | mock | 1940-07-01 | 0 |
| polity:italy | alternative | mock | 1940-07-01 | 0 |
| polity:italy | free | mock | 1940-07-01 | 0 |
| polity:italy | historical | mock | 1940-07-01 | 0 |
| polity:poland | alternative | mock | 1940-07-01 | 0 |
| polity:poland | free | mock | 1940-07-01 | 0 |
| polity:poland | historical | mock | 1940-07-01 | 0 |
| polity:united-kingdom | alternative | mock | 1940-07-01 | 0 |
| polity:united-kingdom | free | mock | 1940-07-01 | 0 |
| polity:united-kingdom | historical | mock | 1940-07-01 | 0 |

## Final player-country cards

| Player | Strategy | Territory controlled/legal | Treasury | Mobilized | Casualties | Goals | Historical score |
|---|---|---:|---:|---:|---:|---:|---:|
| polity:austria | alternative | 1/1 | 59640 | 0 | 0 | 0 | 0/100 |
| polity:austria | free | 1/1 | 59640 | 0 | 0 | 0 | 0/100 |
| polity:austria | historical | 1/1 | 59640 | 0 | 0 | 0 | 0/100 |
| polity:czechoslovakia | alternative | 1/1 | 382018 | 0 | 0 | 0 | 0/100 |
| polity:czechoslovakia | free | 1/1 | 382018 | 0 | 0 | 0 | 0/100 |
| polity:czechoslovakia | historical | 1/1 | 382018 | 0 | 0 | 0 | 0/100 |
| polity:france | alternative | 1/1 | 981712 | 0 | 0 | 0 | 0/100 |
| polity:france | free | 1/1 | 981712 | 0 | 0 | 0 | 0/100 |
| polity:france | historical | 1/1 | 981712 | 0 | 0 | 0 | 0/100 |
| polity:germany | alternative | 1/1 | 594000 | 0 | 0 | 0 | 0/100 |
| polity:germany | free | 1/1 | 594000 | 0 | 0 | 0 | 0/100 |
| polity:germany | historical | 1/1 | 594000 | 0 | 0 | 0 | 0/100 |
| polity:italy | alternative | 1/1 | 90690 | 0 | 0 | 0 | 0/100 |
| polity:italy | free | 1/1 | 90690 | 0 | 0 | 0 | 0/100 |
| polity:italy | historical | 1/1 | 90690 | 0 | 0 | 0 | 0/100 |
| polity:poland | alternative | 1/1 | 75114 | 0 | 0 | 0 | 0/100 |
| polity:poland | free | 1/1 | 75114 | 0 | 0 | 0 | 0/100 |
| polity:poland | historical | 1/1 | 75114 | 0 | 0 | 0 | 0/100 |
| polity:united-kingdom | alternative | 1/1 | 907624 | 0 | 0 | 0 | 0/100 |
| polity:united-kingdom | free | 1/1 | 907624 | 0 | 0 | 0 | 0/100 |
| polity:united-kingdom | historical | 1/1 | 907624 | 0 | 0 | 0 | 0/100 |

All 21 mock lines retained their initial legal and actual territory, entered no wars or agreements, mobilized no formations, and achieved no campaign goals. Government and debt are `null` because those optional modules are intentionally disabled in this benchmark projection.

## Event frequency

- alert: 1218

## Major chronology

No wars, revolutions, coups, territorial changes or occupations occurred under the deterministic hold controller. Monthly resource alerts account for all material records.

## Repeated causal chains

The only repeated chain in mocked mode was monthly economy resolution → resource alert → unchanged strategic hold. It is an engine/telemetry observation, not a historical or AI-behaviour conclusion.

## AI response quality

Mock controllers only: no claim about Gemini quality is made.

## Historical, alternative and free comparison

All three labels intentionally converge in the mock baseline because both player and opponents hold. This proves matrix scheduling and frozen-state comparability, but cannot test strategy quality or the median historical-score target.

## Balance and initial-data influence

Across the matrix: 0 model calls, 1386 monthly engine resolutions, 0 final war records and 0 final occupations. Per-polity population, treasury, resources, deficits, military strength and relations are retained in the aggregate dataset for later live comparison.

## Missing mechanics and data

- Regional 1935 allocations remain low-confidence macro estimates.
- Colonies, fleets and distant theatres remain abstract capabilities.
- Government/debt fields are null when their optional scenario modules are disabled.

## Recommendations for the next scenario

- Keep ScenarioV2, authoring controls and engine projection separate and checksum-bound.
- Complete a dedicated regional population/industry/resource research pass before Curated fidelity.
- Preserve conditional anchors with explicit invalidators; never script milestones as events.

## Interpretation

Complete deterministic mock matrix; historical score targets and strategic conclusions are not evaluated.


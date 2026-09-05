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

After `6d3d57a`, the same UI campaign advanced one further real strategic
three-month decision (`1805-04-01` → `1805-07-01`). The read-only command
`npm run playtest:audit -- --data-dir test-results/playwright-data --game
napoleonic-europe-january-1805-session-2` validated the immutable revision
chain and recorded sanitized provenance `codex-subscription / gpt-5.6-luna /
low`, with replay checksum
`sha256:041303e7f3fed85b52cd9d59b5f8014e9c1b1a521ffe0b0d6f80d5fe12e507a5`
and audit checksum
`sha256:28aa8822f5a7ffb2a23bcd67bf7b35ca9272094e7e02b5265b12e1e66cb38c2f`.
The exporter contains no raw prompts, responses, API keys or endpoints; its
`rawPromptsOrResponsesIncluded` field is explicitly `false`.

The corrected Utility-AI route was then exercised with a bounded Russian
counterfactual research request. The model supplied invalid source spans, so
the PlayerInputV2 boundary marked both the typed action and proposed initiative
as `blocked: invalid-source-span`; no process, technology, number or historical
fact was created. The interpretation was explicitly revised away in the UI.
This is an open **AI-contract/model-quality defect**, not a successful
counterfactual WP15 case, but demonstrates the required fail-closed behavior.
The later audit contains both `strategic` and `utility` provenance records for
the same `codex-subscription / gpt-5.6-luna / low` configuration.

## Utility-AI source-span repair (subsequent run)

`2eb7b52` repaired a narrowly defined recoverable model defect at the
PlayerInputV2 boundary. An invalid model offset is repaired only when its
verbatim source text occurs exactly once in the original player message;
ambiguous or non-verbatim spans remain blocked. This preserves the boundary's
fail-closed rule: the repair cannot turn a paraphrase into an authorization or
expand a player's order.

The live Utility-AI UI was then re-run with the exact one-sentence Russian
input “Исследовать электрические явления.” The model interpretation appeared
as a proposed process, was explicitly confirmed, and Details showed
“Исследование электрических явлений” as `develop / proposed`, at 0% progress,
with a 1,740 initial treasury commitment and `scientific theory: 14,455` as a
grounded input. It was not granted as an instant technology or historical fact.
This is a successful bounded counterfactual-concept smoke case with a real
provider; it still does not satisfy the ten-decision, three-scenario WP15
release gate.

## Bounded-context confirmation regression (subsequent run)

During the next French smoke attempt, accumulated visible entities made the
old 50 kB context guard throw while composing the post-confirmation response.
The material change had already been committed, so the UI misleadingly showed
an error and retrying could create a duplicate proposal. `a746a7a` replaces
that brittle all-or-nothing guard with a deterministic semantic index: capped
entity/evidence lists, bounded labels, and priority for the player's owned or
controlled regions. It does not make omitted targets legal; normal entity and
evidence validation remains authoritative.

A new French UI game then submitted “Начать предложенный процесс снабжения
армии на Рейне через склады и маршруты провианта.” through the real Utility
provider. Confirmation returned normally, and Details showed exactly one
`develop / proposed` process at 0%, with engine-derived funding 1,757 and a
doctrine input. The read-only audit for this clean game has three revisions,
sanitized Utility provenance only, no raw model traffic, and replay checksum
`sha256:5f4f5a38b1c21715351f5a79423711cb13b7076751de13a4df3886d4eba09aa3`.

## Mirrored process-proposal regression (subsequent run)

One live French run exposed a distinct Utility-AI integration defect: the same
single source sentence was emitted as both a typed `process.propose` action
and a richer proposed initiative. The old materializer treated these two views
as two authorizations, creating two separately funded optical-communications
processes. `c610bad` preserves source spans in the pending interpretation and
deduplicates material candidates by their exact player source span, preferring
the richer initiative. Different player fragments remain independent.

In a fresh French UI game, the real provider again returned both forms for
“Предложить стандартизированную гражданско-военную оптическую службу связи;
начать только как предлагаемый процесс.” The preview now showed one 1,757
commitment (not a summed duplicate), and confirmation produced exactly one
`develop / proposed` optical-communications process at 0%. Its read-only
audit has three revisions, Utility provenance only, no raw traffic, and replay
checksum `sha256:3f7c9da24a05fbb0239ac11f5dd3b9b21eec532ef3ab08605f26fba4ac1028cb`.

## Strategic-checkpoint map regression (subsequent run)

A live strategic retry then exposed a client-only failure: one opponent provider
call returned `Failed to fetch`, which correctly left the world at its frozen
revision and displayed Retry/explicit Skip, but the old `react-map-gl 8.1.0`
adapter could dereference a temporarily null MapLibre style (`_loaded`) and
take down the whole world view. `7201b41` upgrades it to 8.1.3, whose style
component update is null-safe.

After restart, the same saved French checkpoint rendered normally with its
precise provider error and retry action. Retrying through the real UI completed
`1805-01-01` → `1805-04-01` with all three monthly boundaries resolved and no
map/UI crash. The read-only audit records Utility and Strategic provenance,
excludes raw traffic, and has replay checksum
`sha256:4ebebb95b97a2bb0b134ad73dbc171cbe7d943f1ca1b92c585749584e3f9c390`.

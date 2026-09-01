# 16 — P7 campaign goals, crises and legacy

Status: accepted implementation contract, 2026-09-01.

## Scope and principles

- Canon 00–15 remain binding. `campaign` is an optional scenario module and is
  absent from old states byte-for-byte.
- Goals are durable directions, never victory conditions. Achieving or missing
  one does not stop play.
- The engine owns goal progress, crisis triggers, tension and legacy scores.
  AI may choose only an engine-advertised goal or crisis position and may
  explain the resulting report.
- A soft horizon only unlocks a closing assessment. The player may request
  interim assessments and may continue after the horizon.
- No defeat ends play while the controlled polity or a valid political
  successor remains. This slice never deletes polities, so it never ends a
  campaign automatically.

## Authored contract

`campaign` contains a first-of-month `softHorizonMonth`, a goal catalog, crisis
templates and one six-dimensional legacy baseline per polity. IDs are stable.

Goals use four engine-resolved kinds: `secure-alliance`, `unlock-capability`,
`control-region`, and `stabilize-government`. Each goal belongs to one polity,
is either initially active or an adaptive candidate, and names exactly the
target required by its kind. Thresholds are authored, integer and bounded.

Crisis templates use deterministic conditions: `identity-pressure`,
`debt-distress`, `war-escalation`, or `political-escalation`. They identify a
subject polity where applicable, a threshold and the allowed participant set.
A template may trigger once. Scenario validation rejects unknown IDs,
duplicates, invalid cross-module references and starting goals whose required
module is disabled.

## Runtime state and commands

The state embeds the authored catalog/templates/baselines plus:

- goal status (`candidate | active | achieved`), progress basis points,
  adoption and achievement month;
- crises (`active | escalated | resolved`), trigger evidence, participants and
  each participant's public position;
- immutable legacy snapshots with six 0–10000 scores and deltas from baseline.

Typed commands are:

- `campaign.adopt-goal(goalId)` — owner adopts one advertised candidate;
- `crisis.set-position(crisisId, position)` — a participant chooses
  `compromise | status-quo | press | escalate`;
- `campaign.assess-legacy(assessmentId)` — records an interim or closing
  assessment for the actor. IDs are unique and all normal revision/month/actor
  validation applies.

Position pressure is respectively 0/1000/2000/3000. An active crisis resolves
when every participant has a position and all choose compromise/status quo. It
escalates at average pressure 2000 or greater. No position automatically starts
a war or changes ownership.

## Deterministic resolution

Goal progress is recalculated after all monthly domain resolution. Alliance,
capability and control goals are binary. Government progress is the minimum of
legitimacy and stability relative to its authored threshold. Achievement is
persistent and emits a causal ledger row.

Triggers run after domain resolution in template-ID order. Evidence contains
only the exact canonical values used by the predicate. Crisis IDs derive from
the template ID, so replay cannot allocate a different ID.

Legacy has six equal, engine-owned dimensions:

- prosperity: treasury relative to the authored baseline;
- security: controlled-region share and absence of occupation;
- stability: mean legitimacy/stability with unrest inverted;
- diplomacy: mean trust in authored relations;
- capability: unlocked-capability share;
- pluralism: identity tax/recruitment acceptance effects.

Unavailable optional inputs contribute the authored baseline, not an invented
penalty. Integer arithmetic, stable sorting and clamping make reports
byte-identical. The AI brief exposes only the actor's goals, crises in which it
participates, allowed candidate/position IDs and numeric legacy output; no full
map, regional identity composition or hidden intelligence is included.

## UI and acceptance

The existing shell gains a Campaign panel showing horizon, actor goals, public
crises/positions and legacy snapshots. Material commands remain queued drafts
until explicit player confirmation.

P7 is accepted when unit and mocked browser tests prove deterministic triggers,
invalid-ID rejection, non-terminal horizon continuation, divergent goal/crisis
outcomes from the same start, bounded prompts, and the complete path: deal →
alliance → crisis → mobilization → war → occupation → peace → political
consequence → legacy.

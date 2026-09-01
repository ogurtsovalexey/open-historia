# 21 — Autonomous strategic tools V2

Status: implemented contract, 2026-09-01.

## Boundary

- Principles 1–4 and canon 07/18 remain binding. A model chooses objectives,
  partners, qualitative scale, sequencing and contingencies. It does not emit
  engine commands, technical ids or authoritative numeric effects.
- `StrategicBriefV2` is an engine-built projection containing monthly resource
  production, consumption, balance and runway; macro output; public relations,
  obligations and bounded memory; available entity ids; enabled generic tools;
  and deterministic previews. It contains no geometry or full regional catalog.
- `StrategicDecisionV2` contains one objective, at most three compatible
  material actions, a longer conditional plan, contingency and rationale. A
  no-action decision carries a typed hold reason, revisit deadline and early
  triggers.
- The deterministic materializer validates every reference and enabled module,
  chooses exact amounts, creates stable technical ids, dry-runs the complete
  command set and returns either one compatible package or no commands plus
  typed rejection evidence. A supported subset may proceed while an
  `unsupportedResidual` records effects the engine cannot represent. Narrative
  must never describe such residuals as completed events.

## Generic tools

The catalog is filtered by enabled scenario modules and current state:

`invest`, `reallocate-production`, `conserve`, `negotiate-trade`,
`external-import`, `propose-agreement`, `apply-diplomatic-pressure`,
`respond-proposal`, `change-policy`, `respond-faction`, `start-project`,
`mobilize`, `declare-war`, `issue-order`, and `negotiate-peace`.

Complex intentions are multi-checkpoint combinations of these mechanics. There
are no historical one-click commands. Coercive intentions use the existing
policy, faction, acceptance and budget systems; the engine does not fabricate
demographic consequences.

## Economy compatibility

- A region may use `activities[]`, whose integer allocation basis points sum to
  10,000. A legacy `activity` remains the byte-compatible representation of one
  activity at 100%.
- `economy.reallocate-production` preserves the authored activity catalog and
  changes only allocations. Unknown activities, stale revisions, foreign
  regions and incompatible command sets reject before state mutation.
- The strategic economy projection reports a real-output proxy and an index,
  with contributions from regional production, shortages and optional
  scenario-authored background productivity. The engine applies that
  background deterministically; observed history is an evaluation range, not a
  forced trajectory.
- Deficit responses use domestic reallocation, bilateral trade, authored-route
  external imports, then natural output contraction when inputs remain absent.

## Campaign Lab pilot

- Campaign Lab V2 writes a private `player-brief.json`; only that file contains
  the player's historical/alternative/free doctrine. Opponent prompts receive
  public actions and consequences only.
- V1 hold runs are diagnostic artifacts and cannot resume under this revision.
  The live `free10-autonomy-v2` profile contains exactly Germany historical,
  alternative and free. No Poland, France or United Kingdom player cells may
  start before owner review of the three German checkpoint reports.
- Live execution still requires canon 18 preflight, quota controls, a clean
  private feature branch and all canon 08 gates.

## Acceptance

Tests cover schemas, typed holds, bounded prompts, deterministic ids, stale
revision rejection, incompatible actions, unsupported residuals, iron runway,
trade materialization, production reallocation, old activity compatibility and
the mock brief → plan → materializer → engine revision loop. Live probes and the
three-cell pilot remain credentialed evaluation actions and are never
fabricated when no key is available.

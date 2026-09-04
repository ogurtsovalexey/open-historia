# 21 — Autonomous strategic tools V2 output and V4 decision boundary

Status: V2/V3 retained only for frozen diagnostics; V4 boundary owner-approved 2026-09-02.

## 2026-09-02 V4 replacement

The production boundary is `StrategicBriefV4+StrategicDecisionV3`. V3 briefs
and V2 decisions remain readable only by their frozen diagnostic runners; they
cannot resume or validate a V4 run.

- One fresh private session controls exactly one country and states its actor,
  current decision authority, invocation reason, success criterion and ordered
  decision hierarchy. Six-actor batches are transport-only fixtures.
- The brief carries mandatory triggers, goals/red lines, at most three current
  political constraints, public state, own evidence, durable plan and changes
  since the previous decision. `politicalIdentity` is bounded authored prose,
  never an engine coefficient. Historical leader knowledge is a soft
  pre-scenario prior subordinate to the authored card; fictional leaders are
  `scenario-only`.
- The candidate audit records every tool family and why it was published or
  excluded. Every independently legal choice receives a revision-stable
  `choiceId`; the model returns IDs only. The application rechecks actor,
  revision, trigger compatibility and the complete engine dry run. Each frozen
  preview also receives a stable evidence ID; invented evidence and duplicate
  trigger coverage are terminal validation failures, while missing mandatory
  coverage alone becomes the diagnostic hold.
- A caller-supplied relevance list is a floor, never a ceiling: compatible
  mandatory-trigger families, active-goal families, checkpoint-specific
  responses and material shortage responses are added deterministically. A
  durable plan exposes the complete bounded legal surface. No required family
  can disappear because a transport caller omitted it.
- Normal capacity is five material choices. Mandatory overflow permits at most
  one covered choice per trigger and ten total; optional choices cannot consume
  expanded slots. Mandatory triggers receive exact, unique coverage. An
  uncovered response becomes a typed hold without a semantic retry.
- Preview evidence is the delta between an action run and a no-op run from the
  same snapshot over the same month. Ordinary tick effects are not attributed
  to the action.
- Incoming proposal choices retain bounded, named terms, including transfer
  direction and regions, alongside the engine preview. Mobilization is offered
  as three application-built plans over at most three controlled regions,
  ranked by active-war adjacency, friendly supply distance, existing forces,
  infrastructure and stable ids. The model chooses a plan; the application
  derives exact manpower from the authored ceiling and identity-adjusted pool,
  enforces scale-specific equipment coverage, apportions formations, and
  computes readiness. A bounded front summary exposes supply capacity and
  qualitative local force bands, never geometry or the full supply graph.
- The complete prompt is limited to 8,000 input tokens. Missing choices are
  never silently truncated. Schema/normalization/semantic failures terminalize
  the attempt; provider failure or staleness produces a visible hold and keeps
  its trigger pending.
- One production serializer emits the ordered task, checkpoint, goals/red
  lines, leadership, public/own evidence, durable plan, frozen choices,
  candidate audit and output sections. Provider calls and prompt-lab snapshots
  must use that serializer; copied prompt strings are not a valid test fixture.
- Scheduled decisions are quarterly. Material war, proposal, crisis,
  government, occupation/peace and default checkpoints are immediate. At most
  four country sessions run concurrently and accepted packages commit in
  stable polity-id order.

## 2026-09-02 correction

Principles 1–4 are normative. `StrategicDecisionV2` and
`StrategicDecisionBatchV2` remain the strict model output contract, but
`StrategicBriefV2` and `StrategicBatchV2` are frozen legacy Gemini diagnostic
inputs. They cannot resume or validate a V3 or Codex run. The current frozen
boundary is `StrategicBriefV3+StrategicDecisionV2`; the matrix profile version
is independent of that brief version.

`StrategicBriefV3` publishes a discriminated `affordances[]` union. Options
couple their parameters and carry deterministic engine dry-run previews. The
application publishes only choices that independently materialize at the
brief's exact month and revision. `conserve` is always present; every other
tool is absent when it has no executable choice. Referenced public entities
carry both canonical ids and display names. Interests, threats, obligations,
red lines, causal anchors and at most twelve bounded memory facts reach the
brief instead of being computed and discarded.

The application compiles candidates, maps actions to commands without policy
judgement, dry-runs candidates, freezes the resulting affordances, matches
model actions exactly against that frozen set, and performs a final package
dry run. A non-hold decision must yield an engine command. One decision may use
each tool and each exclusive target at most once; negotiation/trade/pressure
cannot accompany war against the same polity. Batch validation rejects
duplicate or reciprocal declarations. These checks happen before campaign
state mutation (Principles 1 and 2).

The V3 catalog contains only meaningful, executable candidates: controlled
regions below their investment ceiling; authored activity priorities with a
positive conserved reallocation; priced import proposals over authored routes
and a non-zero treasury; non-duplicate, non-contradictory agreements; partner-
controlled territorial pressure and non-duplicate military access; incoming
proposal terms and legal responses; relative finance policy choices; active
unanswered factions; prerequisite-safe and correctly targeted projects;
identity-adjusted positive mobilization; evidence-backed war reasons; active
formations with supplied adjacent enemy advance targets; and leader-only peace
packages backed by occupations. External suppliers are explicit profile input,
never inferred from names. Policy-change pressure is unavailable until an
engine command supports it. No hidden fact ids, private characters, geometry,
full region catalog, or player doctrine enters opponent briefs (Principles 1–3).

Regional and foreign project-target candidates are capped at eight, diplomatic/trade partners at twelve,
proposals/factions/projects/wars at eight, and formations/advance targets at
six. Ranking and serialization are deterministic. Batch sizing measures the
complete application system text plus serialized payload and stays strictly
below 40,000 characters by reducing actor count, never by cutting an
affordance into an invalid shape.

Codex uses its own flat named-field superset wire because its output-schema
transport does not accept the Zod union's `oneOf`. Unused fields carry explicit
empty sentinels; normalization occurs exactly once into the unchanged strict
V2 decision schema, followed by frozen V3 affordance matching. The generic
Gemini `target/counterpart/subject/choice/intensity` wire is legacy-only.
Prompts require supplied public ids, forbid invented technical ids/effects/
facts/doctrine, explain that listed affordances are executable and omitted
tools unavailable, and distinguish future intentions from completed outcomes
(Principles 1, 2 and 4).

## Legacy V2 diagnostic contract

### Boundary

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

### Generic tools

The catalog is filtered by enabled scenario modules and current state:

`invest`, `reallocate-production`, `conserve`, `negotiate-trade`,
`external-import`, `propose-agreement`, `apply-diplomatic-pressure`,
`respond-proposal`, `change-policy`, `respond-faction`, `start-project`,
`mobilize`, `declare-war`, `issue-order`, and `negotiate-peace`.

Complex intentions are multi-checkpoint combinations of these mechanics. There
are no historical one-click commands. Coercive intentions use the existing
policy, faction, acceptance and budget systems; the engine does not fabricate
demographic consequences.

### Economy compatibility

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

### Campaign Lab pilot

- Campaign Lab V2 writes a private `player-brief.json`; only that file contains
  the player's historical/alternative/free doctrine. Opponent prompts receive
  public actions and consequences only.
- V1 hold runs are diagnostic artifacts and cannot resume under this revision.
  The live `free10-autonomy-v2` profile contains exactly Germany historical,
  alternative and free. No Poland, France or United Kingdom player cells may
  start before owner review of the three German checkpoint reports.
- Live execution still requires canon 18 preflight, quota controls, a clean
  private feature branch and all canon 08 gates.

### Acceptance

Tests cover schemas, typed holds, bounded prompts, deterministic ids, stale
revision rejection, incompatible actions, unsupported residuals, iron runway,
trade materialization, production reallocation, old activity compatibility and
the mock brief → plan → materializer → engine revision loop. Live probes and the
three-cell pilot remain credentialed evaluation actions and are never
fabricated when no key is available.

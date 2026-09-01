# 14 — P5 war, occupation and peace

Status: accepted implementation contract, 2026-09-01. This implements stage 5
of canon 10 after the accepted P4 slice.

## Preconditions

- Canon 00–13 remain binding. `armedForces` and `combat` are optional scenario
  modules; absent modules add no state, commands, prompt or UI.
- Scenario-authored supply links replace geometry inside the engine and AI
  context. The full map and adjacency catalog never enter a model prompt.
- Engine integers, revision binding, atomic commits and player confirmation
  remain unchanged.

## Deliverables

- Each polity has a population-derived recruitable manpower pool, mobilized and
  casualty totals, an equipment reserve, formations and commanders. Formation
  split/merge and mobilization conserve manpower and equipment exactly.
- Mobilization creates a delayed reserve formation at a controlled region.
  Era-authored ceilings bound recruitable manpower. Formations have location,
  posture, morale, equipment, commander and accumulated familiarity.
- Wars have stable ids, belligerents, a declared reason, fronts, occupations
  and peace offers. A `none` reason is legal but applies explicit diplomatic,
  legitimacy and stability penalties.
- Orders choose `hold`, `defend`, `advance` or `withdraw` and one bounded target
  region. A front exists only over an authored supply link. Supply capacity and
  friendly actual control determine the supplied fraction.
- Aggregate combat is deterministic. The scenario combat seed plus war, month
  and front ids produce one recorded integer variation from SHA-256; this is a
  pure keyed function, not mutable or wall-clock RNG. Manpower, equipment,
  morale, posture, commander skill and familiarity determine power and losses.
- Victory may create occupation (`actualControllerId`) without changing the
  region's legal `controllerId`. Only an accepted peace offer may transfer
  ownership and reparations; region economics re-aggregate in that revision.
- Peace terms are bargained as typed offers over engine-supplied occupied or
  claimed region candidates. The engine validates parties, ownership,
  occupation and affordable reparations; the player explicitly accepts.

## Resolution order

1. Validate declaration, mobilization, formation and order/peace commands
   against the opening revision. Apply accepted peace transfers first.
2. Resolve diplomacy/trade, economy, projects/finance and politics as before.
3. Activate due mobilizations, compute supply, resolve fronts in stable id
   order, apply losses/occupation and update commander/formation familiarity.
4. Record military conservation, actual-control and combat-seed causes in the
   contribution ledger; build one next revision and persist atomically.

## Acceptance criteria

- Mobilize, split, merge, combat losses and demobilization never create or
  destroy unexplained manpower/equipment. Same inputs replay byte-identically.
- A reasonless war records penalties. Invalid enemy/ally, stale revision,
  disconnected target, illegal peace region and unaffordable reparations reject
  without partial mutation.
- A supplied front beats the same unsupplied formation under the same inputs;
  combat exposes every multiplier and keyed seed. Occupation differs from
  ownership until accepted peace.
- The existing shell can mobilize, declare war, issue a bounded front order,
  inspect supply/combat/occupation and offer/respond to peace.
- Strategic opponents receive only their formations, public belligerents and
  at most six relevant front/peace region candidates. Character detail, hidden
  intelligence, geometry and the full supply graph fail the prompt gate.
- A mocked vertical smoke executes mobilization → supplied combat → occupation
  → peace → ownership/economy re-aggregation while a failed strategic call
  still cannot advance time.
- Root tests, typecheck, lint, goldens, determinism guard and Playwright remain
  green.

## Not doing

- Naval warfare, convoys, air warfare, tactical tiles or division-level OOB.
- Probabilistic battle simulation, fog-of-war unit catalogs or model-generated
  numeric combat effects.
- War-score currency, scripted peace conferences or automatic player calls to
  arms.

## Open questions

None.

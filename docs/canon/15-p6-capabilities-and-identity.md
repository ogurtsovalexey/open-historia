# 15 — P6 capabilities and identity

Status: implemented and verified, 2026-09-01. This implements stage 6
of canon 10 after the accepted P5 slice.

> **Supersession note (2026-09-04):** the implemented P6 contract remains a
> frozen regression, but its authored-only capability catalog is not the
> product target. Canon 22 replaces it with starting concepts plus validated
> runtime concept creation, staged processes and engine-compiled effects.

## Preconditions

- Canon 00–14 remain binding. `technology` and `societyAndIdentity` are
  optional modules; an older scenario or save without them gains no state,
  command, prompt or UI surface.
- Capabilities reuse the P3c Project budget/capacity/progress contract. There
  is no universal year, linear tree or model-authored numeric research effect.
- Culture and religion are two separate scenario-authored layers. The engine
  owns shares, acceptance, mismatch, policy effects and gradual change.

## Deliverables

- A scenario-authored capability catalog defines stable ids, prerequisites and
  one bounded modifier: extraction output, processing output, project capacity
  or land-supply capacity. Polities hold an explicit unlocked set with source
  project and month.
- Research project templates may unlock one catalog capability. Starting a
  project requires every prerequisite, rejects an already unlocked or already
  researched target and still competes for science, treasury and budget.
  Completion unlocks the capability; its modifier applies from the following
  month and is recorded in the contribution ledger.
- Every region has a primary culture and religion plus sorted minority shares;
  each layer conserves exactly 10,000 basis points. Every polity has one
  official identity, a bounded accepted set and independent culture/religion
  policies: `tolerance`, `privilege`, `integration` or `coercion`.
- Typed commands change a policy or accept/revoke an identity present in the
  polity's controlled regions. The official identity cannot be revoked.
- Unaccepted population deterministically reduces regional tax and available
  recruitable manpower. Tolerance sacrifices more extraction/recruitment for
  low unrest; privilege preserves revenue/recruitment with higher unrest;
  integration gradually shifts 25 bp/month with moderate trade-offs; coercion
  shifts 75 bp/month with the highest unrest. Accepted groups have no mismatch
  penalty.
- Identity pressure feeds the existing political unrest state. Integration
  and coercion move shares only from the largest unaccepted group toward the
  official group, with stable-id tie breaks, exact conservation and explicit
  per-region ledger rows. Migration remains absent.

## Resolution order

1. Validate identity commands against the opening revision and apply policy or
   acceptance changes. Validate other commands as before; identity-adjusted
   recruitment bounds mobilization.
2. Resolve economy with opening unlocked capability modifiers and per-region
   identity tax multipliers.
3. Resolve projects. A completed research project appends its capability but
   does not retroactively change this month's production or supply.
4. Resolve politics with aggregate identity unrest pressure, then combat with
   opening capability supply modifiers.
5. Apply slow identity shifts, write capability/identity causes and all
   conservation checks, then commit one next revision atomically.

## Acceptance criteria

- Prerequisites, duplicate research, unknown ids, foreign acceptance targets,
  stale revisions and disabled modules reject without partial mutation.
- The same research and identity commands replay byte-identically. Capability
  effects start on the next month and never stack through duplicate unlocks.
- Each regional culture/religion layer remains exactly 10,000 bp. Integration
  is slower and less destabilising than coercion; tolerance, privilege and
  acceptance produce visibly different tax, unrest and recruitment outcomes.
- Region transfer keeps demographics attached to the region and immediately
  recalculates mismatch under the new state's official/accepted identities.
- The existing shell exposes capability prerequisites/projects and identity
  composition, acceptance, policies and last-month causes. Player material
  actions remain queued for explicit confirmation.
- Strategic briefs contain only the acting polity's unlocked capabilities,
  aggregate identity effects and at most six present identity candidates; no
  full regional composition catalog, geometry, hidden intelligence or other
  polity detail enters the prompt.
- A mocked vertical smoke revokes acceptance, changes policy, observes tax and
  unrest/recruitment trade-offs, completes a capability project and observes
  its next-month modifier. Failed strategic calls still cannot advance time.
- Root tests, typecheck, lint, goldens, determinism guard and Playwright remain
  green.

## Not doing

- Linear technology years, ahead-of-time penalties, patents or technology
  diffusion between states.
- Migration, births/deaths by identity, language-family simulation, estates
  per identity or Victoria-grade demographic diffusion.
- Model-authored identity groups, shares, capability ids, prerequisites or
  numeric effects.

## Open questions

None.

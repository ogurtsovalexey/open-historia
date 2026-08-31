# 11 — P3b playable diplomacy and bilateral trade

Status: accepted implementation contract, 2026-08-31. This is the next
vertical slice after canon 09 and implements stages 1–2 of canon 10.

## Preconditions

- P0–P3a and their goldens remain byte-identical.
- Canon 10 is binding: the engine owns effects; models return bounded intent.
- The four-polity Central Europe fixture is replaced as the product playtest
  target by a six-polity fixture, while remaining readable as a regression
  input during migration.

## Deliverables

- Metropolitan France and Poland join Austria, Czechia, Germany and Slovakia
  as scenario-authored GADM admin-1 regions with synthetic economy inputs.
- AI tasks declare `utility` or `strategic` role. Utility dispatch has a shared
  concurrency limit of six and content-addressed result caching. Alliances and
  other material decisions cannot fall back to utility; strategic failure
  leaves a resumable draft and does not advance time.
- Canonical relations store opinion, trust and threat for authored polity
  pairs. Negotiation is proposal → optional counterproposal → accept/reject.
- Accepted terms create non-aggression, defensive-alliance, guarantee,
  military-access or trade agreements. Contact is public; private terms are
  exposed only to participants until another mechanic reveals them.
- Trade moves resources and/or treasury through authored abstract routes.
  One-off and fixed-term recurring contracts use base-plus-scarcity reference
  values. Insufficient supply or route capacity delivers proportionally,
  records a breach and reduces trust. Early cancellation pays the bounded
  authored penalty as far as available treasury permits.
- A Diplomacy drawer surface lists relations, pending proposals, agreements and
  trade deliveries, and lets the player accept, reject and counter material
  proposals with explicit confirmation.

## Contracts and resolution order

- `diplomacy` and `trade` are optional scenario modules. If absent, their state,
  commands, prompt fields and UI are absent and old revisions serialize exactly
  as before.
- Every diplomatic command carries command id, actor, effective month and
  expected revision. References must name current scenario polities and active
  proposals/agreements; stale or unauthorized commands are typed rejections.
- A relation is an unordered polity pair; opinion is `-10000..10000`, trust and
  threat are `0..10000`. Directional meaning belongs to agreement terms, not
  duplicated relation records.
- Trade terms contain two bounded legs, each either a resource quantity,
  treasury quantity or none. A trade must move non-zero value in both
  directions. Recurring duration is 2–120 months; one-off duration is one.
- Monthly order is: validate revision/month → resolve negotiations and
  cancellations → settle active trade through route capacity → existing
  investment/transfer validation → population → production → consumption →
  tax → ledger/invariants/revision. Imports therefore may feed same-month
  production and consumption; tax is still only on regional production.
- Partial settlement applies one common fulfillment ratio to both legs, so one
  side never receives a larger fraction than it pays. Every stock and treasury
  movement is conserved exactly across both counterparties.
- Calls to arms become executable with P5 conflicts. P3b persists defensive
  obligations and refusal policy but does not invent a war solely to exercise
  them.

## Tasks

1. Ship and validate the six-polity map/economy fixture and deterministic
   twelve-month smoke.
2. Add role-aware AI profiles, cache and concurrency tests; keep all model calls
   in the registry ledger.
3. Add scenario/state/command schemas and failing diplomacy/trade tests before
   the reducer implementation.
4. Implement negotiation, settlement, conservation ledger and persistence
   compatibility.
5. Extend bounded briefs/interpreter and add the Diplomacy drawer path with
   mocked provider tests.

## Acceptance criteria

- Six polities and every linked GADM region render and tick for twelve months;
  repeated execution produces identical revisions and reports.
- Identical utility briefs dispatch once, at most six distinct utility calls
  execute concurrently, and strategic material-task failure preserves the
  exact draft/session revision.
- Proposal, counter, accept, reject, authorization, stale-reference and unknown
  id paths have state-based tests.
- One-off, recurring, partial, unavailable-route, breach and cancellation flows
  conserve resources and treasury and replay byte-identically.
- A mocked Playwright flow negotiates and settles a trade without full-map or
  private-term leakage.
- Root tests, typecheck, lint, goldens, determinism guard and UI smoke are green.

## Not doing

- No war resolution, automatic territorial transfer or executable call to arms.
- No global market, currencies, inflation, convoys or naval blockade.
- No secret-intelligence network; private-term discovery belongs to P3c.

## Open questions

None.

# 12 — P3c statecraft: finance, projects and intelligence

Status: accepted implementation contract, 2026-09-01. This implements stage 3
of canon 10 after the accepted P3b slice.

## Boundary

- The engine owns tax receipts, debt, interest, default, project spending,
  capacity allocation, progress, completion effects and knowledge visibility.
- Models may choose only typed policy/project actions from bounded briefs. They
  cannot invent money, templates, facts, effects, evidence, confidence or
  project progress.
- `finance`, `projects` and `intelligence` remain optional modules. Older state
  without their projections parses unchanged; defaults are materialised only
  when a scenario starts with the module or a real command first uses it.
- This slice has no currencies, inflation, global capital market, free-form
  research tree or detailed spy network.

## Finance

- Every participating polity has a tax-burden multiplier, exemption share,
  five budget priorities, debt principal, annual interest rate, credit limit,
  debt-service remainder and visible default history.
- Budget priorities are administration, science, industry, security and
  military and sum to 10,000 basis points. They constrain project funding;
  they do not create treasury.
- A policy command changes tax burden, exemptions and priorities for the
  current month. Effective tax is the existing deterministic regional tax
  multiplied by burden and then by the non-exempt share.
- Bond issuance transfers principal into treasury up to remaining credit.
  Interest accrues monthly with carried integer remainder and is paid after
  tax. If treasury cannot cover it, an automatic restructuring consumes the
  treasury, applies a 20% principal haircut, cuts the credit limit by 25%,
  records a default and reduces diplomatic trust with every counterparty.
- Voluntary restructuring is a material command: it applies a smaller 10%
  haircut, cuts the credit limit by 10%, records the event and avoids an
  unbounded negative treasury.

## Unified projects

- Scenario-authored templates have a stable id, kind (`construction`,
  `reform`, `research`, `mobilization`, `intelligence`, `deception`), budget
  category, total cost, duration, monthly capacity demand and one validated
  effect. Core fallback templates keep older module-enabled saves usable.
- A project has actor, optional target polity/region/fact, funding ceiling,
  priority, status, cost/month progress, familiarity discount and evidence of
  every monthly allocation. Start, reprioritise/fund and cancel are typed
  commands bound to month and revision.
- Administration, science and industry are shared expandable monthly
  capacities. Active projects resolve by priority then stable id. A project
  advances only when its capacity demand and a positive treasury allocation
  fit. Spending is capped by its funding ceiling, remaining effective cost and
  the selected budget priority's share of opening treasury.
- Familiarity is per template. Completion raises it and reduces future
  effective cost by at most 25%. Cancellation never refunds spent treasury.
- Effects in this slice are bounded infrastructure gain, permanent capacity
  gain, credit-limit gain or revelation of one authored intelligence fact.

## Intelligence and visibility

- Authored intelligence facts are immutable truths with stable id, subject,
  domain, summary and evidence id. They are canonical but never included in
  player/model projections unless known.
- `knowledgeSeeds` create per-polity known facts with confidence, observation
  month, source/evidence and staleness horizon. Intelligence project completion
  may reveal only its template/command-selected authored fact.
- Known facts remain evidence-backed records. Staleness is derived
  deterministically from engine month; it does not erase the fact. Deception
  may only publish an authored cover fact, never model-authored truth.
- The statecraft API/UI returns the player's finance, projects, capacities and
  known facts. Opponent briefs receive only the acting polity's equivalent
  projection plus public aggregates; hidden truths and other countries'
  knowledge fail the prompt gate.

## Resolution order

1. Validate month/revision and materialise a missing optional projection only
   for a valid statecraft command.
2. Apply finance policy, bond issuance, project start/update/cancel commands.
3. Resolve diplomacy/trade, then existing economy production/consumption/tax.
4. Apply effective tax multiplier, allocate and spend on projects, complete
   effects, then accrue/pay debt interest or restructure.
5. Write contribution ledger, check treasury/project/capacity conservation,
   derive the next revision and atomically persist all state.

## Acceptance criteria

- Tax changes affect receipts through one auditable multiplier; issuance,
  service, voluntary restructuring and automatic default conserve treasury and
  debt and replay byte-identically.
- Competing projects deterministically share budget/capacity, expose
  opportunity cost, complete bounded effects and never overspend or exceed
  capacity. Familiarity changes only later instances.
- A seeded fact is visible only to its observer. A completed intelligence
  project reveals exactly one evidence-backed fact; stale/unknown/private fact
  paths are rejected and no hidden catalog enters a model prompt.
- The existing-shell Statecraft path can change policy, issue debt, start and
  fund/cancel a project, and display default, capacity, progress and knowledge.
- A mocked vertical smoke funds a project with bonds, completes an intelligence
  operation and observes a default/opportunity-cost path without advancing on
  a failed material strategic call.
- Root tests, typecheck, lint, goldens, determinism guard and Playwright gates
  remain green.

## Not doing

- Inflation, currencies, exchange rates, lenders or bond trading.
- Free-form project effects, technologies or intelligence claims.
- Spy agents, networks, tactical operations or probabilistic discovery.
- P4 political consequences, P5 mobilisation effects and P6 capability unlocks
  beyond storing their project-ready typed hooks.

## Open questions

None.

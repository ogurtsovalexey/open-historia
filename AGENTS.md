# AGENTS.md — AI Agent Instructions for Open Historia

> **Canonical reference:** [`docs/principles.md`](docs/principles.md)
> All principles defined there are binding. This file is the agent-facing summary.

## Before Any Work

1. **Read `docs/principles.md`.** It is the source of truth for architecture
   and design constraints.
2. **Read [`docs/canon/22-living-world-program.md`](docs/canon/22-living-world-program.md)**
   for all post-Strategic-V4 product work and
   [`docs/canon/23-living-world-execution-backlog.md`](docs/canon/23-living-world-execution-backlog.md)
   for its required implementation order, then read the relevant doc in
   [`docs/canon/`](docs/canon/README.md) — the
   compressed, binding spec set (the old `docs/spec/` + `docs/product/` corpus
   is archived reference). Never guess schemas, formulas or contracts.
3. For parallel work, claim a ready GitHub Issue and follow
   `docs/agent-workflow.md` in a separate worktree.
4. Do not edit files outside the issue's owned paths.
5. Check that your change does not violate a principle; escalate if it does.
6. Reference principle numbers and acceptance criteria in reviews.

## Agent Roles

| Role | Artifacts | Focus |
|------|-----------|-------|
| **PO** (Product Owner) | Vision Doc, User Stories, Acceptance Criteria | What, why, priorities, boundaries |
| **Analyst** | Research Doc, Best Practices | EU4/CK/Victoria mechanics research |
| **Developer** | Technical Spec, Data Contracts | Architecture, engine, components, performance |
| **AI Engineer** | Prompt Spec, Schema Spec, Model Matrix | Prompts, JSON schemas, validation, model selection |
| **QA** | Test Plan, Edge Cases, Acceptance Report | Scenario-law checks, regression, performance |

## Development Cycle

Each phase follows this sequence:

1. **DISCOVERY** — PO + Analyst (parallel, then synchronize)
2. **DESIGN** — Developer + AI Engineer (joint session, consensus required before advancing)
3. **REVIEW** — PO + QA (parallel; all agents cross-review each other's specs)
4. **IMPLEMENT** — Developer + AI Engineer (parallel, continuous sync)
5. **VERIFY** — QA (test plan execution; fix → re-test cycle)

## Key Rules (violating these = rejected spec)

### Scenario is Law
- Authored scenario facts are immutable starting truth.
- A scenario is not a closed catalog of the future: canon 22 permits validated
  runtime concepts and processes grounded in current state and evidence.
- AI authoring output remains Draft until reviewed.
- QA tests overwrites, provenance gaps and `factsUsed[]` references.

### Map Does NOT Go Into AI
- Full map never travels into AI prompts
- Use `mapSemantics` → deterministic resolution → optional utility fallback
- QA MUST verify: AI context size < reasonable threshold

### Application = Engine, AI = Brain
- Formulas, storage, recalculation → application code
- Strategy, semantic direction, qualitative process pace and explanations →
  AI; feasibility, exact quantities and final effects → engine
- Developer + AI Engineer MUST agree on the engine/modifier contract

### Consensus or Escalate
- Developer and AI Engineer must reach consensus on every data contract
- Deadlock → escalate to project owner with 2-3 concrete options
- OpenCode/DeepSeek cannot finalize architecture, domain, persistence, security,
  historical-assumption or accepted-scope decisions; mark them `DECISION NEEDED`
  for GPT integration review.

## Definition of Done (gate — see `docs/canon/08-testing-gates.md`)

Work is done ONLY when all of these hold, and the closing message lists each
item's actual value (a bare "Done!" is a violation):

1. Root `npm test` green; 2. `npm run typecheck` green; 3. `npm run lint`
zero new violations; 4. golden tests green (goldens never regenerated in CI);
5. determinism guard green; 6. `git status` clean; 7. no file outside the
task's declared whitelist touched.

Bounded workers take only tasks whose DoD is verifiable by `npm test` without
a human; the integration owner writes types and failing tests FIRST, the
worker makes them green and escalates after 5 red runs.

## Tech Stack

- **Language:** TypeScript (new code) / JavaScript (existing)
- **Storage:** atomic versioned state with modular JSON projections during migration
- **Platforms:** single codebase → desktop, web, Android
- **Computations:** browser/WebView, Web Workers for heavy tasks (culture diffusion)

## Files to Know

| File | Purpose |
|------|---------|
| `docs/principles.md` | Canonical architectural principles |
| `docs/canon/00-vision-and-roadmap.md` | **Start here:** what the finished game is, phase order, what is explicitly not the plan |
| `docs/canon/` | Numbered binding spec set (architecture, simulation core, economy slice, AI boundary, testing gates) |
| `packages/engine/` | Deterministic economy engine (headless slice, CLI, golden tests) |
| `docs/product/README.md` | Global product specification and roadmap |
| `docs/spec/consensus-spec.md` | Accepted Phase 1 contract |
| `docs/spec/acceptance-criteria.md` | Phase 1 completion gates |
| `docs/agent-workflow.md` | Parallel worktree and handoff protocol |
| `docs/architecture.md` | System architecture overview |
| `docs/ai-overview.md` | AI system (providers, tasks, schemas) |
| `docs/ai-schemas.md` | JSON schemas for AI tasks |
| `docs/world-state.md` | World data model and turn loop |
| `docs/game-map.md` | Map rendering architecture |
| `docs/map-editor.md` | Map editor and scenario export |
| `docs/conventions.md` | Contributing rules and identifiers |
| `scripts/presets/` | Scenario spec format and build tooling |

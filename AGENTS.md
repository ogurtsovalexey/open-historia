# AGENTS.md — AI Agent Instructions for Open Historia

> **Canonical reference:** [`docs/principles.md`](docs/principles.md)
> All principles defined there are binding. This file is the agent-facing summary.

## Before Any Work

1. **Read `docs/principles.md`.** It is the source of truth for architecture,
   data contracts, and design constraints.
2. Check that your change does not violate any principle. If it does, escalate.
3. Reference specific principle numbers in your specs and reviews.

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
- Spec `.spec.mjs` fields are immutable ground truth
- AI-generated changes are validated against `simulationRules`
- QA MUST test: "did AI overwrite a spec field?"

### Map Does NOT Go Into AI
- Full map never travels into AI prompts
- Use `mapSemantics` (~1-3 KB) → cheap model → region annotations
- QA MUST verify: AI context size < reasonable threshold

### Application = Engine, AI = Brain
- Formulas, storage, recalculation → application code
- What changes, by how much, why → AI
- Developer + AI Engineer MUST agree on the engine/modifier contract

### Consensus or Escalate
- Developer and AI Engineer must reach consensus on every data contract
- Deadlock → escalate to project owner with 2-3 concrete options

## Tech Stack

- **Language:** TypeScript (new code) / JavaScript (existing)
- **Storage:** modular JSON files (world.json, economy.json, culture.json, etc.)
- **Platforms:** single codebase → desktop, web, Android
- **Computations:** browser/WebView, Web Workers for heavy tasks (culture diffusion)

## Files to Know

| File | Purpose |
|------|---------|
| `docs/principles.md` | Canonical architectural principles |
| `docs/architecture.md` | System architecture overview |
| `docs/ai-overview.md` | AI system (providers, tasks, schemas) |
| `docs/ai-schemas.md` | JSON schemas for AI tasks |
| `docs/world-state.md` | World data model and turn loop |
| `docs/game-map.md` | Map rendering architecture |
| `docs/map-editor.md` | Map editor and scenario export |
| `docs/conventions.md` | Contributing rules and identifiers |
| `scripts/presets/` | Scenario spec format and build tooling |

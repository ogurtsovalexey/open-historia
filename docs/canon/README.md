# Canon — the numbered source of truth

Status: active. Prepared 2026-08-30.

This directory is the **compressed, binding distillation** of the Phase 1
spec corpus (`docs/spec/`, `docs/product/` — now archived reference material).
Rule for every agent: **read the relevant canon doc BEFORE implementing a
feature. Do not guess schemas, formulas or contracts.** If canon and an
archived doc disagree, canon wins. If canon and code disagree, that is a bug —
escalate, do not silently "fix" either side.

| # | Doc | Covers |
|---|-----|--------|
| **00** | [`00-vision-and-roadmap.md`](00-vision-and-roadmap.md) | **What the finished game is and the phase order to get there. Read first.** |
| 01 | [`../principles.md`](../principles.md) | Architectural principles (Scenario is Law, Engine+Brain, Map not into AI). Kept in place — already canonical. |
| 02 | [`02-target-architecture.md`](02-target-architecture.md) | Target architecture, the three world models and which one is SSOT |
| 03 | [`03-simulation-core.md`](03-simulation-core.md) | Numeric types, determinism rules, time model |
| 04 | [`04-economy-slice.md`](04-economy-slice.md) | The 2×5 headless economy slice: feature spec + accepted decisions |
| 05 | [`05-scenario-format.md`](05-scenario-format.md) | Scenario formats: engine dev-fixture vs ScenarioV2 |
| 06 | [`06-persistence.md`](06-persistence.md) | Revisions, run directories, the legacy six-projection contract |
| 07 | [`07-ai-boundary.md`](07-ai-boundary.md) | Where LLMs plug in; what they may and may not do |
| 08 | [`08-testing-gates.md`](08-testing-gates.md) | Definition of Done, golden fixtures, worker task rules |

Sources of each doc are cited inline. The full archived corpus stays under
`docs/spec/` and `docs/product/` for provenance; their READMEs carry a
superseded banner.

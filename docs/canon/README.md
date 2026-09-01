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
| 09 | [`09-p3-economic-agent-loop.md`](09-p3-economic-agent-loop.md) | P3a free-text economy orders, scalable opponent scheduling and atomic agent turns |
| 10 | [`10-playable-game-next-steps.md`](10-playable-game-next-steps.md) | Binding minimal sequence from P3a to a complete playable campaign |
| 11 | [`11-p3b-diplomacy-and-trade.md`](11-p3b-diplomacy-and-trade.md) | P3b six-polity world, two-tier AI routing, diplomacy and bilateral trade |
| 12 | [`12-p3c-statecraft.md`](12-p3c-statecraft.md) | P3c finance, unified projects and evidence-backed intelligence |
| 13 | [`13-p4-politics-and-characters.md`](13-p4-politics-and-characters.md) | P4 factions, political escalation, rulers, appointments and succession |
| 14 | [`14-p5-war-and-peace.md`](14-p5-war-and-peace.md) | P5 mobilization, formations, supply, combat, occupation and peace |
| 15 | [`15-p6-capabilities-and-identity.md`](15-p6-capabilities-and-identity.md) | P6 project-unlocked capabilities and culture/religion identity policy |

Sources of each doc are cited inline. The full archived corpus stays under
`docs/spec/` and `docs/product/` for provenance; their READMEs carry a
superseded banner.

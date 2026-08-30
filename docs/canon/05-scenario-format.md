# 05 — Scenario formats

Sources: `docs/spec/scenario-v2-integrity.md`, `docs/product/05-territories-and-scenarios.md`.

## Two formats, two purposes

| Format | Schema | Purpose |
|---|---|---|
| **Engine dev fixture** | `packages/engine/src/scenario.ts` (`open-historia-engine-scenario/1`) | Synthetic, hand-authored test scenarios for the deterministic engine. Small, strict, zero provenance ceremony. Must carry `label: "development-test"`. |
| **ScenarioV2** | `packages/data-packs/src/schemas.ts` | Historically sourced scenario bundles (World 1916 program): provenance, facts, assumptions, macro-regions, content-addressed assets. |

Shared rules across both:

- IDs use the domain brand schemas (`polity:<slug>`, `region:<dataset>:<id>`,
  `scenario:<slug>`) — `packages/domain/src/ids.ts`.
- Unknown catalog resource IDs fail validation; a scenario may disable catalog
  entries but never invent runtime IDs (resource catalog lives in
  `packages/engine/src/scenario.ts#RESOURCE_CATALOG`, per
  `regional-resource-economy.md` §2).
- All starting numbers are authored; nothing is generated at load time; a
  missing activity or coefficient is a blocking validation error.
- English and Russian display names are checked in (`{en, ru}`).

## Deferred / open

- **Merging the dev-fixture format into ScenarioV2** (as a profile without the
  provenance requirements) — open question; revisit when the first historical
  scenario needs the engine. Until then the two formats stay separate and
  neither imports the other's schema.
- Provenance machinery (facts, assumptions, sources) applies only to
  historical scenarios; dev fixtures mark everything `scenario_choice` by
  construction.

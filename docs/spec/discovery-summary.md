# Phase 1 Discovery Summary

> Historical discovery artifact. The accepted 80/20 scope is defined in
> `consensus-spec.md`; several mechanics below are now deferred roadmap items.

## PO (Mencius) — Vision Doc

### Goal
Redesign scenario architecture: `.spec.mjs` becomes a self-contained, machine-validatable definition of an entire world at time zero — economy, culture, religion, resources, mobilization, influence, and era constraints as structured data. AI fills gaps without contradicting spec.

### User Stories
1. Era constraints as typed fields, engine-enforced everywhere
2. Per-country starting economy in spec, seeds `economy.json`
3. Culture and religion per-region, seeds `culture.json`/`religion.json`
4. Resources per region, engine totals follow ownership
5. Mobilization tuned per era in structured fields
6. Influence relationships seeded in spec
7. PregameHistory respects spec facts

### Key Decisions
- All new fields optional (AI fills gaps)
- `eraNarrative` preserves existing prose string
- Editor export pipeline is the integration point
- Each mechanic seeds its own runtime JSON asset
- Migration utility is a deliverable, not afterthought

---

## Analyst (Halley) — Research Doc

### Top Recommendations
1. **Scenario assembly pipeline** — explicit order (paraphrase of Vic3's init pipeline)
2. **Structured `SimulationRules`** — replace string with typed object
3. **Date-keyed `regionHistory`** — per-region dated entries serve multiple scenarios (EU4 pattern)
4. **Per-region development** — agricultural/industrial/manpower values
5. **Culture/Religion definitions** — groups + per-region assignment
6. **`allianceBlocks` + `activeWars`** as structured arrays
7. **Scenario-level JSON Schema** with `additionalProperties: false`
8. **Three-layer validation**: schema → world-aware → assembly

### Key Rejections
- Do NOT adopt Vic3's per-pop economic model (too granular)
- Stick with EU4-style per-region development + engine-computed aggregates

### Region Merging (Cossacks 2 + Paradox Research)
- Two-tier model: GID_1 (map truth) + MacroRegion (gameplay decisions)
- 100-500 macro-regions per scenario, scenario-defined or auto-generated
- Economy, culture, religion, resources, infrastructure → at macro-region level
- Ownership, borders, cities, units → at GID_1 level
- Macro-regions split when enough GID_1 regions change hands

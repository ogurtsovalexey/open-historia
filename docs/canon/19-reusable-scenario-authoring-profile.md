# 19 — Reusable historical scenario authoring profile

Status: accepted implementation contract, 2026-09-01.

## Purpose

This profile resolves canon 05's deferred historical-scenario bridge without
merging its two schemas. ScenarioV2 remains the authored source of truth;
`engine/scenario.json` is a deterministic, checked projection contained in the
same package. The ordinary development-test fixture contract is unchanged.

## Required package

A playable historical package contains `manifest.json`, `scenario.json`,
`sources.json`, `authoring.json`, `engine/scenario.json` and, when rendered,
`engine/map-link.json`. `authoring.json` binds every national and regional
estimate to `sourceRefs`, a calculation method, `high | medium | low`
confidence and a refinement TODO.

The authoring pass must cover, per polity: population, workforce,
mobilization ceiling, treasury/economic power, resource stocks, production,
industry and infrastructure. Regional population, production and resource
allocations must exactly sum to declared national controls. Approximation is
allowed only when named as an assumption; missing provenance is not.

## Compiler contract

The compiler validates ScenarioV2 first, then validates the engine projection,
then rejects:

- scenario, polity, region or resource ids not shared by the relevant inputs;
- an engine controller differing from `regionAssignments`;
- national totals differing from the authored control totals;
- a map link that is incomplete, ambiguous or references unknown ids.

Compilation is pure and canonical: identical package bytes produce identical
projection bytes and checksum. No historical estimate is generated at runtime.

Map-link v2 permits one engine macro-region to bind to multiple map polygons.
Every map polygon belongs to exactly one engine region; map geometry remains an
application asset and never enters AI context.

## Release gate

Before a scenario is called curated, its population, industrial and regional
resource estimates receive a dedicated research/review pass. Until then the
fidelity manifest and TODOs must expose the gap honestly.


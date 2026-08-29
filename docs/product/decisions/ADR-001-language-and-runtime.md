# ADR-001: language and runtime choice

Status: accepted for roadmap v1
Date: 2026-08-29

## Context

The application is mostly JavaScript/JSX with React, Vite, MapLibre, OpenLayers, Express and Electron. It ships a browser build and desktop app, and contains alternative storage paths. The user is willing to change languages if this materially improves performance, maintainability or development speed.

Observed bottlenecks/failures are:

- AI latency, reasoning tokens and context volume;
- missing canonical simulation state;
- giant prompt/orchestration modules;
- non-atomic JSON persistence;
- map memory/rendering and geometry detail;
- weak type/boundary guarantees;
- incomplete test/diagnostic coverage.

There is no evidence that Node compute throughput is a primary gameplay bottleneck.

## Decision

Keep the current runtime and migrate incrementally to TypeScript.

- UI: React + TypeScript.
- Map: MapLibre/OpenLayers retained.
- Desktop: Electron retained for now.
- Local backend: Node + Express retained initially.
- Domain: pure TypeScript modules with no React/Express dependency.
- Schemas: one runtime-schema source that also provides TypeScript types and LLM JSON schemas.
- Optional native module: Rust only for a profiling-proven hotspot that cannot be solved adequately in TypeScript/Web Workers/MapLibre data layout.

Do not rewrite the product in Kotlin/Java. Do not migrate to Tauri/Rust as part of the correctness roadmap.

## Why TypeScript

- smallest migration risk;
- shares types across UI, domain, AI schema and Node server;
- preserves all existing map/editor code;
- avoids IPC duplication between a JVM backend and browser renderer;
- supports incremental conversion file by file;
- keeps upstream changes easier to merge;
- local Mac development remains possible without Xcode for normal Electron builds;
- the performance-critical work is mostly provider I/O, WebGL/map data and context selection.

## Why not Kotlin/Java

Potential benefits:

- strong static typing;
- mature concurrency/persistence libraries;
- good server architecture tooling.

Costs here:

- React/MapLibre frontend still remains JavaScript/TypeScript;
- a second runtime and IPC/API boundary is introduced;
- the entire storage/AI server is rewritten with no improvement to LLM latency or prompt tokens;
- desktop package size/complexity grows;
- web build cannot reuse the JVM backend;
- upstream merges become much harder.

The JVM would be justified for a substantial shared server or multiplayer service, neither of which is in scope.

## Why not full Rust/Tauri now

Potential benefits:

- lower shell memory and binary size;
- excellent type and memory safety;
- strong performance for GIS/topology/search.

Costs:

- Electron shell, local server and storage need replacement;
- platform build/signing complexity increases;
- application correctness still depends on redesigning domain state and AI orchestration;
- map rendering remains a web/WebGL workload;
- the current code and upstream path are disrupted.

Reconsider Tauri only after the domain and storage boundaries are clean and Electron overhead is measured as a top user problem.

## Rust escape hatch

Rust may be introduced behind a narrow interface for:

- heavy geometry validation/splitting;
- control-zone topology operations;
- very large local spatial indexes;
- local full-text/vector retrieval if profiling warrants it.

Conditions:

1. reproducible benchmark;
2. TypeScript/Web Worker/data-layout optimization attempted;
3. at least 2x meaningful user-visible improvement;
4. portable fallback or supported binaries for target platforms;
5. interface remains domain-neutral.

## Migration order

1. enable `checkJs`/strict JSDoc at boundaries;
2. convert new domain/schema modules to `.ts` first;
3. convert AI provider contracts and orchestrator;
4. convert storage transaction interfaces;
5. convert React components when touched;
6. progressively enable stricter compiler flags;
7. remove duplicate manual validators only after generated/runtime schemas cover them.

Avoid a flag-day rename of every file. Functionality and tests move with each bounded module.

## Consequences

Positive:

- fastest path to stable IDs, typed commands and configurable AI;
- preserves the working app and editor;
- no unnecessary platform rewrite;
- native optimization remains available later.

Negative:

- Electron's baseline RAM footprint remains;
- browser/Node storage adapters still need deliberate consistency work;
- mixed JS/TS exists during migration;
- discipline is required to prevent `any` and unvalidated JSON from defeating the change.

## Revisit triggers

- Electron itself accounts for a dominant, measured portion of unacceptable RAM/CPU after map fixes;
- a backend becomes shared/multi-user;
- geometry/simulation CPU blocks UI despite worker/native experiments;
- web support is intentionally dropped and a native desktop UI becomes a product goal.

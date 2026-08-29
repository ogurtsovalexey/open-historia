# Phase 1 Acceptance Criteria

## Blocking Criteria

### AC-1 — Observable AI

Every production model call has a registered task, selected profile, context
manifest, token budget, latency, usage/cost record and accepted state effect.
Two-party speaker selection and static localization make no model call.

The required fields, accounting levels, redaction boundary, migration path and
automated checks are defined by the accepted
[AI Call Registry Contract](ai-call-registry.md).

### AC-2 — Atomic State

Every accepted turn commits under one world revision. Injected write failures
leave the previous complete revision readable; no date/map/action mismatch is
observable after restart.

The transaction boundary, manifest and compare-and-swap semantics, coherent
reads, compatibility migration, rollback behavior and fault-injection matrix
are defined by the accepted
[Atomic World Revision Contract](atomic-world-revision.md).

### AC-3 — Typed Authority

The vertical slice uses stable IDs, validated commands/events and protected
state paths. AI output cannot directly set canonical totals or overwrite
authored scenario facts.

### AC-4 — Deterministic Offline Scenario

A pinned scenario builds and loads without network access or LLM credentials.
Three builds from identical input produce identical canonical checksums.

### AC-5 — Provenance and Missing Data

Historical numbers carry units, date, source and confidence. Missing values are
required errors, explicit unknowns or declared assumptions—never hidden defaults.

### AC-6 — Pregame Facts

Generated pregame text references `factsUsed[]`. Unknown references and claims
contradicting protected scenario fields fail deterministic validation.

### AC-7 — World 1916 Wave-One Slice

One sourced observation for each wave-one polity—Russia, Germany and Britain—
travels through scenario load, a typed player command, deterministic resolution,
atomic save/replay and a causal narrative explanation.

### AC-8 — World 1797 Compatibility

A thin 1797 fixture loads through the same contracts and catches at least one
modern-era assumption without requiring separate engine code.

### AC-9 — Migration Safety

Existing presets and saves remain untouched. Any v2 migration produces a
side-by-side Draft plus validation report.

## Success Metrics

1. Zero hidden model calls in offline scenario build/load.
2. 100% rejection of protected-field overwrite mutation tests.
3. 100% rollback safety across injected atomic-write failures.
4. 100% detection of unknown entity/source/`factsUsed` references.
5. One-call maximum for a normal bilateral greeting.
6. Every optional AI report exposes model, tokens, latency and cost.
7. Both 1916 and 1797 fixtures pass the same domain/schema test harness.

# Scenario V2 Adapter Implementation

## Overview

This package implements the minimal strict TypeScript/Zod Scenario V2 adapter as specified in the Phase 1 consensus specification and the Scenario V2 Integrity Contract. It provides:

1. **Type-safe schemas** for all Scenario V2 entities using Zod
2. **Deterministic validation** with comprehensive reference checking
3. **Canonical checksum calculation** for offline builds
4. **Protected-fact contradiction detection**
5. **Legacy migration adapter** for `.spec.mjs` files
6. **Side-by-side migration** preserving original files

## Architecture

### Core Schemas (`src/ids.ts`, `src/facts.ts`, `src/scenario.ts`)
- **Stable IDs**: All entity IDs follow the grammar from `scenario-v2-integrity.md`
- **Fact provenance**: Complete fact/value/provenance schemas with units, confidence, transformations
- **Scenario structure**: Manifest, scenario, sources, assets, fidelity manifests
- **Draft artifacts**: Pregame narrative and draft patch schemas

### Validator (`src/validator.ts`)
- **Schema validation**: Zod-based schema validation with detailed diagnostics
- **Reference validation**: Checks all entity references (polities, regions, sources, facts, assumptions)
- **Integrity validation**: Validates consistency, uniqueness, and coverage rules
- **World-aware validation**: Checks dates, ranges, and scenario-specific constraints

### Builder (`src/builder.ts`)
- **Deterministic builds**: RFC 8785/JCS canonical JSON serialization
- **Canonical checksums**: SHA-256 checksums for input bundles and artifacts
- **Runtime projections**: Builds simplified runtime state from validated scenarios
- **Contradiction checking**: Protected fact comparison with assertion operators

### Migration Adapter (`src/migration.ts`)
- **Legacy `.spec.mjs` conversion**: Converts legacy specs to Draft V2 format
- **Loss/gap reporting**: Explicit reporting of what cannot be automatically converted
- **Side-by-side operation**: Never modifies original files
- **Deterministic output**: Same input produces identical Draft output

### Authority Protection (`src/authority.ts`)
- **Protected paths**: Implementation of protected path families from integrity contract
- **Mutation validation**: Checks if operations are allowed based on authority level
- **Scenario is Law**: Authored scenario facts are immutable starting truth

## Key Features

### Deterministic Offline Builds
- Zero network/LLM calls during build/load
- Three builds from identical input produce identical checksums
- Canonical JSON serialization with sorted keys

### Provenance and Missing Data
- Required gaps fail validation
- Optional gaps require explicit fidelity metadata
- All numbers carry units, dates, sources, and confidence
- `unknown` values are data, not hidden defaults

### Protected Authored Truth
- Authored scenario fields are immutable after game creation
- Runtime commands cannot target protected scenario paths
- AI proposals are validated against protected facts

### Pregame Narrative Integrity
- `factsUsed[]` references are validated
- Contradictions with protected facts fail validation
- Narrative color segments cannot contain factual assertions

### Migration Safety
- Existing presets and saves remain untouched
- Migration produces side-by-side Draft plus validation report
- Repeat migration produces byte-identical output

## Usage Examples

### Validating a Scenario Bundle
```typescript
import { ScenarioV2Validator } from '@open-historia/domain';

const validator = new ScenarioV2Validator();
const result = validator.validateBundle(bundle);

if (result.valid) {
  console.log('Bundle is valid');
  const validatedBundle = result.data;
} else {
  console.error('Validation errors:', result.errors);
}
```

### Building with Checksums
```typescript
import { ScenarioV2Builder } from '@open-historia/domain';

const builder = new ScenarioV2Builder();
const buildResult = builder.build(bundle);

if (buildResult.success) {
  console.log('Input checksum:', buildResult.inputChecksum);
  console.log('Artifact checksums:', buildResult.artifactChecksums);
} else {
  console.error('Build errors:', buildResult.errors);
}
```

### Migrating Legacy Specs
```typescript
import { LegacySpecMigration } from '@open-historia/domain';

const migration = new LegacySpecMigration();
const spec = await import('./roman-117.spec.mjs');
const result = migration.migrateSpecToDraft(spec.default, './roman-117.spec.mjs');

if (result.success) {
  console.log('Migration report:', result.migrationReport);
  console.log('Draft checksum:', result.inputChecksum);
} else {
  console.error('Migration errors:', result.errors);
}
```

### Checking Protected Fact Contradictions
```typescript
import { ProtectedFactChecker } from '@open-historia/domain';

const checker = new ProtectedFactChecker();
const contradictions = checker.checkContradictions(
  inferredClaims,
  protectedFacts
);

if (contradictions.length > 0) {
  console.error('Contradictions found:', contradictions);
}
```

## Validation Categories

### Blocking Errors (fail build)
- Schema violations (invalid types, missing required fields)
- Unknown references (entities, sources, facts, assumptions)
- ID mismatches (manifest vs scenario, wrong scenario prefix)
- Integrity violations (duplicate members, missing provenance)
- Protected path mutations
- Fact contradictions in pregame narratives

### Warnings (report but allow)
- Semantic review findings (advisory AI review)
- Migration gaps (missing region mapping, prose rules)
- Fidelity coverage notes

## Compliance with Phase 1 Acceptance Criteria

### AC-4: Deterministic Offline Scenario
✅ Pinned scenario builds without network/LLM calls  
✅ Three builds produce identical canonical checksums  
✅ Builder uses RFC 8785/JCS canonicalization

### AC-5: Provenance and Missing Data
✅ All numbers carry units, dates, sources, confidence  
✅ Required gaps fail validation  
✅ Optional gaps require explicit fidelity metadata  
✅ `unknown` values never coerced to defaults

### AC-6: Pregame Facts
✅ `factsUsed[]` references validated  
✅ Unknown references fail validation  
✅ Contradictions with protected facts fail  
✅ Narrative color segments cannot contain facts

### AC-9: Migration Safety
✅ Existing presets/saves untouched  
✅ Side-by-side Draft plus loss/gap report  
✅ Repeat migration produces identical output  
✅ No auto-application of Draft patches

## Implementation Notes

### TypeScript Strictness
- All schemas use strict object validation
- Discriminated unions for fact values
- Branded types for ID safety
- No implicit any types

### Deterministic Behavior
- No time/locale/randomness in builds
- Sorted diagnostics by path/code/ID
- Stable error reporting
- Content-addressed assets

### Extensibility
- Diagnostic codes follow stable families
- JSON Schema export utilities
- Modular validation layers
- Pluggable authority rules

## Limitations (Phase 1 Scope)

### Not Implemented (Deferred)
- Full economy/culture/religion simulation
- Dynamic macro-region splitting
- AI authoring assistants
- Detailed scenario editor UI
- World 1853/1690 content production

### Simplified for MVP
- Region mapping (requires GID dataset integration)
- Asset content store (local file system only)
- Runtime projection format (simplified for tests)
- Unit conversion/comparison (basic equality only)

## Testing

Run the test suite:
```bash
npm run test:domain
```

Type checking:
```bash
npm run typecheck:domain
```

Cycle detection:
```bash
npm run check:cycles
```

## References

- `docs/principles.md` - Architectural principles
- `docs/spec/consensus-spec.md` - Phase 1 consensus
- `docs/spec/scenario-v2-integrity.md` - Integrity contract
- `docs/spec/acceptance-criteria.md` - Acceptance criteria
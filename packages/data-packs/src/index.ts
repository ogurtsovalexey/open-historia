export * from './schemas.js';
export { ScenarioV2Validator } from './validator.js';
export type { Diagnostic, ScenarioBundle } from './validator.js';
export { ScenarioV2Builder, calculateInputChecksum, canonicalStringify, BUILDER_CONTRACT_VERSION } from './builder.js';
export type { BuildDirectoryOptions, BuildOptions, BuildResult, WorldProjection } from './builder.js';
export { LegacySpecAdapter, slugify } from './legacy-adapter.js';
export type {
  LegacyLoss,
  LegacyWarning,
  CollisionEntry,
  LegacyMigrationReport,
  LegacyMigrationResult,
  WrittenLegacyMigration,
} from './legacy-adapter.js';

/** Explicit authoring boundary while Scenario V2 remains available for replay. */
export * as scenarioV3 from './v3/index.js';

import { scenarioV3 } from '@open-historia/data-packs';
import { z } from 'zod';
import type { RegionalControl, WorldStateV2 } from './schema.js';

export const WORLD_SEED_V2_SCHEMA_VERSION = 'open-historia-world-seed/2' as const;

export const worldSeedV2Schema = scenarioV3.scenarioV3Schema
  .omit({ schemaVersion: true })
  .extend({
    schemaVersion: z.literal(WORLD_SEED_V2_SCHEMA_VERSION),
    sourceSchemaVersion: z.literal(scenarioV3.SCENARIO_V3_SCHEMA_VERSION),
  })
  .strict();

export type ValidatedScenarioV3 = NonNullable<
  ReturnType<typeof scenarioV3.validateScenarioV3>['scenario']
>;
type ScenarioRegionDefinition = ValidatedScenarioV3['geography']['regions'][
  keyof ValidatedScenarioV3['geography']['regions']
];
type ScenarioAssetDefinition = ValidatedScenarioV3['geography']['assets'][
  keyof ValidatedScenarioV3['geography']['assets']
];

/**
 * Lossless, immutable compiled input. Live WorldStateV2 is a projection of this
 * seed, so ScenarioV3 data that is not yet mutable remains available without
 * becoming a second writable authority.
 */
export type WorldSeedV2 = z.output<typeof worldSeedV2Schema>;

export interface RuntimePolityProjection {
  polityId: WorldStateV2['polities'][number]['id'];
  displayName: WorldStateV2['polities'][number]['displayName'];
  color: string;
  playerEligible: boolean;
}

export interface RuntimeRegionProjection {
  regionId: WorldStateV2['regions'][number]['regionId'];
  displayName: WorldStateV2['regions'][number]['displayName'];
  control: RegionalControl;
  geography: ScenarioRegionDefinition['link'];
  adjacentRegionIds: WorldStateV2['regions'][number]['regionId'][];
}

export interface RuntimeScenarioProjectionV2 {
  scenarioId: ValidatedScenarioV3['id'];
  profile: ValidatedScenarioV3['profile'];
  title: ValidatedScenarioV3['metadata']['title'];
  description?: ValidatedScenarioV3['metadata']['description'];
  startDate: ValidatedScenarioV3['game']['startDate'];
  defaultPlayerPolityId: ValidatedScenarioV3['game']['defaultPlayerPolityId'];
  playerEligiblePolityIds: ValidatedScenarioV3['game']['playerEligiblePolityIds'];
  polities: RuntimePolityProjection[];
  regions: RuntimeRegionProjection[];
  assets: ScenarioAssetDefinition[];
}

export interface ScenarioV3CompilationDiagnostic {
  code: string;
  path: string;
  message: string;
  refs?: string[];
}

export interface CompiledScenarioV3 {
  bundleChecksum: `sha256:${string}`;
  seed: WorldSeedV2;
  seedChecksum: `sha256:${string}`;
  initialState: WorldStateV2;
  runtimeProjection: RuntimeScenarioProjectionV2;
  runtimeProjectionChecksum: `sha256:${string}`;
  diagnostics: ScenarioV3CompilationDiagnostic[];
}

export class ScenarioV3CompilationError extends Error {
  readonly diagnostics: ScenarioV3CompilationDiagnostic[];

  constructor(diagnostics: ScenarioV3CompilationDiagnostic[]) {
    super(`ScenarioV3 compilation failed:\n${diagnostics.map((entry) => `- ${entry.path}: ${entry.message}`).join('\n')}`);
    this.name = 'ScenarioV3CompilationError';
    this.diagnostics = diagnostics;
  }
}

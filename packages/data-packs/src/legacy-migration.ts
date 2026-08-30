export class LegacySpecMigration {
  migrateSpecToDraft(spec: any, specPath: string): MigrationResult {
    const errors: MigrationError[] = [];
    const warnings: MigrationWarning[] = [];

    // Generate scenario ID from spec path
    const specName = specPath.split('/').pop()?.replace('.spec.mjs', '') || 'unknown';
    const scenarioId = `scenario:${specName}`;

    // Convert polities
    const polities: Record<string, any> = {};
    const polityIdMap = new Map<string, string>();

    if (spec.polities && typeof spec.polities === 'object') {
      Object.entries(spec.polities).forEach(([code, polity]: [string, any]) => {
        const polityId = `polity:${specName}:${code.toLowerCase()}`;
        polityIdMap.set(code, polityId);

        polities[polityId] = {
          id: polityId,
          name: polity.name || code,
          aliases: Array.isArray(polity.aliases) ? polity.aliases : [],
          color: polity.color || '#000000'
        };
      });
    }

    // Build Draft bundle
    const draftBundle = {
      manifest: {
        schemaVersion: 2,
        id: scenarioId,
        contentVersion: '0.1.0-migrated',
        engineRange: '>=0.1.0 <1.0.0',
        defaultLocale: 'en',
        scenarioPath: 'scenario.json',
        sourcesPath: 'sources.json',
        assets: []
      },
      scenario: {
        schemaVersion: 2,
        id: scenarioId,
        meta: {
          title: spec.meta?.name || specName,
          description: spec.meta?.description
        },
        game: {
          startDate: spec.game?.startDate || '0001-01-01',
          defaultPlayer: polityIdMap.get(spec.game?.country || '') || 'polity:unknown'
        },
        polities,
        regions: [],
        simulationRules: {
          era: 'unknown-era',
          aiHistoryMode: 'conditional',
          constraints: {},
          technologyLevel: { era: 'unknown' }
        },
        historicalFacts: [],
        assumptions: [],
        macroRegions: [],
        fidelity: {
          intendedUse: 'development-scenario',
          polityLevels: Object.fromEntries(Object.keys(polities).map(id => [id, 'Baseline'])),
          gaps: [
            {
              path: '/scenario/regions',
              disposition: 'unknown',
              reason: 'Region mapping from legacy country codes to GID region IDs required'
            },
            {
              path: '/scenario/regionAssignments',
              disposition: 'unknown',
              reason: 'Cannot convert countryAssignments without region mapping'
            },
            {
              path: '/scenario/historicalFacts',
              disposition: 'unknown',
              reason: 'Legacy spec lacks structured historical facts with provenance'
            }
          ]
        }
      },
      sources: []
    };

    // Calculate checksum
    const inputChecksum = this.calculateChecksum(draftBundle);

    // Test idempotency
    const secondResult = this.migrateSpecToDraft(spec, specPath);
    const isIdempotent = secondResult.inputChecksum === inputChecksum;

    if (!isIdempotent) {
      errors.push({
        code: 'migration.non-idempotent',
        path: '',
        message: 'Migration is not idempotent'
      });
    }

    return {
      success: errors.length === 0,
      draftBundle,
      inputChecksum,
      errors,
      warnings,
      migrationReport: {
        specPath,
        originalId: spec.id,
        convertedPolities: Object.keys(polities).length,
        isIdempotent
      }
    };
  }

  private calculateChecksum(bundle: any): string {
    const canonical = JSON.stringify(bundle, (_key, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value).sort().reduce((acc: any, k) => {
          acc[k] = value[k];
          return acc;
        }, {});
      }
      return value;
    });
    
    // Simple hash for demonstration
    let hash = 0;
    for (let i = 0; i < canonical.length; i++) {
      hash = ((hash << 5) - hash) + canonical.charCodeAt(i);
      hash = hash & hash;
    }
    return `sha256:${Math.abs(hash).toString(16).padStart(64, '0').slice(0, 64)}`;
  }
}

export interface MigrationResult {
  success: boolean;
  draftBundle: any;
  inputChecksum: string;
  errors: MigrationError[];
  warnings: MigrationWarning[];
  migrationReport: MigrationReport;
}

export interface MigrationError {
  code: string;
  path: string;
  message: string;
}

export interface MigrationWarning {
  code: string;
  path: string;
  message: string;
}

export interface MigrationReport {
  specPath: string;
  originalId: string;
  convertedPolities: number;
  isIdempotent: boolean;
}
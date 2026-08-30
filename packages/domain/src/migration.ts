import crypto from 'crypto';
import { ScenarioBundle } from './validator.js';
import { deterministicHash } from './utils.js';

/**
 * Legacy .spec.mjs migration adapter
 */
export class LegacySpecMigration {
  /**
   * Migrate legacy .spec.mjs to Scenario V2 Draft format
   */
  migrateSpecToDraft(spec: any, specPath: string): MigrationResult {
    const errors: MigrationError[] = [];
    const warnings: MigrationWarning[] = [];
    const gaps: FidelityGap[] = [];
    
    // Generate deterministic scenario ID from spec path
    const specName = specPath.split('/').pop()?.replace('.spec.mjs', '') || 'unknown';
    const scenarioId = `scenario:${specName}`;
    
    // Convert polities
    const polities: Record<string, any> = {};
    const polityIdMap = new Map<string, string>();
    
    if (spec.polities) {
      Object.entries(spec.polities).forEach(([code, polity]: [string, any]) => {
        const polityId = `polity:${scenarioId.replace('scenario:', '')}:${code.toLowerCase()}`;
        polityIdMap.set(code, polityId);
        
        polities[polityId] = {
          id: polityId,
          name: polity.name || code,
          aliases: Array.isArray(polity.aliases) ? polity.aliases : [],
          color: polity.color || '#000000'
        };
      });
    } else {
      errors.push({
        code: 'migration.missing-polities',
        path: '/polities',
        message: 'Legacy spec missing polities definition'
      });
    }
    
    // Convert country assignments to region assignments
    // Note: This is a simplified conversion - legacy uses country codes,
    // while V2 uses region IDs. This would need actual region mapping.
    const regionAssignments: Record<string, string> = {};
    
    if (spec.countryAssignments) {
      warnings.push({
        code: 'migration.country-assignments-unsupported',
        path: '/countryAssignments',
        message: 'Country assignments cannot be automatically converted to region assignments without region mapping',
        detail: 'Region assignments will be empty in Draft'
      });
      gaps.push({
        path: '/scenario/regionAssignments',
        disposition: 'unknown',
        reason: 'Legacy country assignments require manual region mapping'
      });
    }
    
    // Convert cities (simplified)
    const cities: any[] = [];
    if (spec.cities && Array.isArray(spec.cities)) {
      spec.cities.forEach((city: any, index: number) => {
        // Legacy format: [name, location, tier, population]
        // This is a simplified conversion
        cities.push({
          id: `city:${scenarioId.replace('scenario:', '')}:${index}`,
          name: city[0] || `City ${index}`,
          regionId: 'region:unknown:unknown', // Would need actual mapping
          population: city[3] || undefined,
          note: 'Migrated from legacy spec'
        });
      });
    }
    
    // Convert simulation rules
    let simulationRules: any;
    if (typeof spec.simulationRules === 'string') {
      // Legacy prose rules become narrative rules
      simulationRules = {
        era: 'unknown-era',
        aiHistoryMode: 'conditional',
        constraints: {
          narrativeRules: [spec.simulationRules]
        },
        technologyLevel: {
          era: 'unknown'
        }
      };
      warnings.push({
        code: 'migration.prose-rules',
        path: '/simulationRules',
        message: 'Legacy prose simulation rules converted to narrativeRules only',
        detail: 'Mechanical capabilities (noAirPower, etc.) require manual review'
      });
      gaps.push({
        path: '/scenario/simulationRules/constraints',
        disposition: 'unknown',
        reason: 'Legacy prose rules lack structured mechanical capability flags'
      });
    } else {
      simulationRules = {
        era: 'unknown-era',
        aiHistoryMode: 'conditional',
        constraints: {},
        technologyLevel: { era: 'unknown' }
      };
    }
    
    // Add allowedUnitTypes as constraints if present
    if (spec.allowedUnitTypes && Array.isArray(spec.allowedUnitTypes)) {
      simulationRules.constraints.noAirPower = !spec.allowedUnitTypes.includes('air');
      simulationRules.constraints.noNaval = !spec.allowedUnitTypes.includes('naval');
      // Other unit type mappings would be needed
    }
    
    // Build Draft scenario
    const draftScenario = {
      schemaVersion: 2,
      id: scenarioId,
      meta: {
        title: spec.meta?.name || specName,
        description: spec.meta?.description,
        locales: spec.meta?.name ? {
          en: {
            title: spec.meta.name,
            description: spec.meta.description
          }
        } : undefined
      },
      game: {
        startDate: spec.game?.startDate || '0001-01-01',
        defaultPlayer: polityIdMap.get(spec.game?.country || '') || 'polity:unknown'
      },
      polities,
      regions: [], // Would need actual region mapping
      regionAssignments: Object.keys(regionAssignments).length > 0 ? regionAssignments : undefined,
      cities: cities.length > 0 ? cities : undefined,
      simulationRules,
      historicalFacts: [], // No facts in legacy spec
      assumptions: [], // No assumptions in legacy spec
      macroRegions: [], // No macro regions in legacy spec
      fidelity: {
        intendedUse: 'development-scenario',
        polityLevels: Object.fromEntries(
          Object.keys(polities).map(id => [id, 'Baseline'])
        ),
        gaps
      }
    };
    
    // Build manifest
    const draftManifest = {
      schemaVersion: 2,
      id: scenarioId,
      contentVersion: '0.1.0-migrated',
      engineRange: '>=0.1.0 <1.0.0',
      defaultLocale: 'en',
      scenarioPath: 'scenario.json',
      sourcesPath: 'sources.json',
      assets: []
    };
    
    const draftBundle = {
      manifest: draftManifest,
      scenario: draftScenario,
      sources: []
    };
    
    // Calculate input checksum (simplified)
    const inputChecksum = this.calculateDraftChecksum(draftBundle);
    
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
        convertedCities: cities.length,
        missingRegions: true, // Flag that region mapping is missing
        missingFacts: true, // Flag that facts are missing
        missingProvenance: true // Flag that provenance is missing
      }
    };
  }
  
  /**
   * Calculate checksum for Draft bundle
   */
  private calculateDraftChecksum(bundle: any): string {
    const canonicalData = {
      manifest: this.canonicalize(bundle.manifest),
      scenario: this.canonicalize(bundle.scenario),
      sources: this.canonicalize(bundle.sources),
      migrationVersion: '1.0.0'
    };
    
    const canonicalJson = JSON.stringify(canonicalData, this.canonicalReplacer);
    const hash = crypto.createHash('sha256');
    hash.update(canonicalJson);
    return `sha256:${hash.digest('hex')}`;
  }
  
  /**
   * Canonicalize data for deterministic hashing
   */
  private canonicalize(data: unknown): unknown {
    return JSON.parse(JSON.stringify(data, this.canonicalReplacer));
  }
  
  private canonicalReplacer(key: string, value: unknown) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Sort object keys for deterministic output
      return Object.keys(value).sort().reduce((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {} as Record<string, unknown>);
    }
    return value;
  }
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  draftBundle: any;
  inputChecksum: string;
  errors: MigrationError[];
  warnings: MigrationWarning[];
  migrationReport: MigrationReport;
}

/**
 * Migration error
 */
export interface MigrationError {
  code: string;
  path: string;
  message: string;
  detail?: string;
}

/**
 * Migration warning
 */
export interface MigrationWarning {
  code: string;
  path: string;
  message: string;
  detail?: string;
}

/**
 * Migration report
 */
export interface MigrationReport {
  specPath: string;
  originalId: string;
  convertedPolities: number;
  convertedCities: number;
  missingRegions: boolean;
  missingFacts: boolean;
  missingProvenance: boolean;
}

/**
 * Fidelity gap for migration
 */
interface FidelityGap {
  path: string;
  disposition: 'unknown' | 'assumption' | 'not-applicable';
  reason: string;
}
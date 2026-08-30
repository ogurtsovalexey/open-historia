import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ScenarioV2Validator } from '../src/validator.js';
import { scenarioManifestSchema, scenarioV2Schema } from '../src/scenario.js';

describe('Scenario V2 Validator', () => {
  const validator = new ScenarioV2Validator();

  describe('Minimal valid bundle', () => {
    const minimalBundle = {
      manifest: {
        schemaVersion: 2,
        id: 'scenario:world-1797-contract-test',
        contentVersion: '0.1.0',
        engineRange: '>=0.1.0 <1.0.0',
        defaultLocale: 'en',
        scenarioPath: 'scenario.json',
        sourcesPath: 'sources.json',
        assets: []
      },
      scenario: {
        schemaVersion: 2,
        id: 'scenario:world-1797-contract-test',
        meta: {
          title: 'World 1797 contract test',
          locales: { en: { title: 'World 1797 contract test' } }
        },
        game: {
          startDate: '1797-01-01',
          defaultPlayer: 'polity:kingdom-of-prussia'
        },
        polities: {
          'polity:kingdom-of-prussia': {
            id: 'polity:kingdom-of-prussia',
            name: 'Kingdom of Prussia',
            aliases: [],
            color: '#334455'
          }
        },
        regions: [{
          id: 'region:gadm-4-1:DEU.1_1',
          dataset: 'gadm',
          datasetVersion: '4.1',
          nativeId: 'DEU.1_1'
        }],
        regionAssignments: {
          'region:gadm-4-1:DEU.1_1': 'polity:kingdom-of-prussia'
        },
        simulationRules: {
          era: 'revolutionary-and-napoleonic',
          aiHistoryMode: 'conditional',
          constraints: {
            noAirPower: true,
            narrativeRules: []
          },
          technologyLevel: {
            era: 'early-industrial',
            notable: []
          }
        },
        historicalFacts: [{
          id: 'fact:world-1797-contract-test:prussia-road-capacity-unknown',
          role: 'starting-value',
          subjectRefs: ['polity:kingdom-of-prussia'],
          predicate: 'transport.road-capacity',
          effectiveRange: { from: '1797-01-01' },
          value: {
            kind: 'unknown',
            expectedKind: 'quantity',
            reason: 'No reconciled source has been selected for this contract fixture.'
          },
          sourceRefs: [],
          assumptionRefs: [],
          confidence: 'low',
          transformation: []
        }],
        assumptions: [],
        macroRegions: [{
          id: 'macro-region:world-1797-contract-test:prussia-contract-test',
          name: 'Prussia contract test area',
          members: ['region:gadm-4-1:DEU.1_1'],
          purpose: 'fixture'
        }],
        fidelity: {
          intendedUse: 'test-fixture',
          polityLevels: {
            'polity:kingdom-of-prussia': 'Baseline'
          },
          gaps: [{
            path: '/historicalFacts/0/value',
            disposition: 'unknown',
            reason: 'This schema fixture deliberately has no road-capacity estimate.'
          }]
        }
      },
      sources: []
    };

    it('should validate minimal valid bundle', () => {
      const result = validator.validateBundle(minimalBundle);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject bundle with mismatched scenario IDs', () => {
      const invalidBundle = {
        ...minimalBundle,
        manifest: {
          ...minimalBundle.manifest,
          id: 'scenario:different-scenario'
        }
      };
      const result = validator.validateBundle(invalidBundle);
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.code === 'reference.id-mismatch'));
    });

    it('should reject bundle with invalid region assignment', () => {
      const invalidBundle = {
        ...minimalBundle,
        scenario: {
          ...minimalBundle.scenario,
          regionAssignments: {
            'region:gadm-4-1:NONEXISTENT': 'polity:kingdom-of-prussia'
          }
        }
      };
      const result = validator.validateBundle(invalidBundle);
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.code === 'reference.unknown-region'));
    });

    it('should reject bundle with invalid polity in assignment', () => {
      const invalidBundle = {
        ...minimalBundle,
        scenario: {
          ...minimalBundle.scenario,
          regionAssignments: {
            'region:gadm-4-1:DEU.1_1': 'polity:nonexistent-polity'
          }
        }
      };
      const result = validator.validateBundle(invalidBundle);
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.code === 'reference.unknown-polity'));
    });

    it('should reject fact with unknown source reference', () => {
      const invalidBundle = {
        ...minimalBundle,
        scenario: {
          ...minimalBundle.scenario,
          historicalFacts: [{
            ...minimalBundle.scenario.historicalFacts[0],
            sourceRefs: ['source:world-1797-contract-test:nonexistent']
          }]
        }
      };
      const result = validator.validateBundle(invalidBundle);
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.code === 'reference.unknown-source'));
    });
  });

  describe('Schema validation', () => {
    it('should reject invalid manifest schema', () => {
      const invalidManifest = {
        schemaVersion: 2,
        id: 'scenario:test',
        contentVersion: 'invalid-version', // Should be SemVer
        engineRange: '>=0.1.0 <1.0.0',
        defaultLocale: 'en',
        scenarioPath: 'scenario.json',
        sourcesPath: 'sources.json',
        assets: []
      };

      const result = scenarioManifestSchema.safeParse(invalidManifest);
      assert(!result.success);
    });

    it('should reject invalid scenario schema', () => {
      const invalidScenario = {
        schemaVersion: 2,
        id: 'scenario:test',
        meta: { title: 'Test' },
        game: {
          startDate: 'invalid-date', // Invalid date
          defaultPlayer: 'polity:test'
        },
        polities: {},
        regions: [],
        simulationRules: {
          era: 'test',
          aiHistoryMode: 'conditional',
          constraints: {},
          technologyLevel: { era: 'test' }
        },
        historicalFacts: [],
        assumptions: [],
        macroRegions: [],
        fidelity: {
          intendedUse: 'test-fixture',
          polityLevels: {},
          gaps: []
        }
      };

      const result = scenarioV2Schema.safeParse(invalidScenario);
      assert(!result.success);
    });
  });

  describe('ID validation', () => {
    it('should reject fact with wrong scenario prefix', () => {
      const bundle = {
        manifest: {
          schemaVersion: 2,
          id: 'scenario:world-1797-contract-test',
          contentVersion: '0.1.0',
          engineRange: '>=0.1.0 <1.0.0',
          defaultLocale: 'en',
          scenarioPath: 'scenario.json',
          sourcesPath: 'sources.json',
          assets: []
        },
        scenario: {
          schemaVersion: 2,
          id: 'scenario:world-1797-contract-test',
          meta: { title: 'Test' },
          game: {
            startDate: '1797-01-01',
            defaultPlayer: 'polity:test'
          },
          polities: {
            'polity:test': {
              id: 'polity:test',
              name: 'Test',
              color: '#000000'
            }
          },
          regions: [],
          simulationRules: {
            era: 'test',
            aiHistoryMode: 'conditional',
            constraints: {},
            technologyLevel: { era: 'test' }
          },
          historicalFacts: [{
            id: 'fact:different-scenario:test-fact', // Wrong scenario prefix
            role: 'starting-value',
            subjectRefs: ['polity:test'],
            predicate: 'test',
            effectiveRange: { from: '1797-01-01' },
            value: { kind: 'unknown', expectedKind: 'quantity', reason: 'test' },
            sourceRefs: [],
            assumptionRefs: [],
            confidence: 'low',
            transformation: []
          }],
          assumptions: [],
          macroRegions: [],
          fidelity: {
            intendedUse: 'test-fixture',
            polityLevels: { 'polity:test': 'Baseline' },
            gaps: []
          }
        },
        sources: []
      };

      const result = validator.validateBundle(bundle);
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.code === 'reference.wrong-scenario'));
    });
  });
});
import { describe, it } from 'node:test';
import assert from 'node:assert';
// After build, these will be in dist
import { ScenarioV2Validator } from '../dist/validator.js';
import { ScenarioV2Builder } from '../dist/builder.js';

describe('Scenario V2 Implementation', () => {
  describe('Validator', () => {
    const validator = new ScenarioV2Validator();

    it('should validate minimal valid bundle', () => {
      const bundle = {
        manifest: {
          schemaVersion: 2,
          id: 'scenario:test',
          contentVersion: '0.1.0',
          engineRange: '>=0.1.0 <1.0.0',
          defaultLocale: 'en',
          scenarioPath: 'scenario.json',
          sourcesPath: 'sources.json',
          assets: []
        },
        scenario: {
          schemaVersion: 2,
          id: 'scenario:test',
          meta: { title: 'Test Scenario' },
          game: {
            startDate: '1916-01 01',
            defaultPlayer: 'polity:test-polity'
          },
          polities: {
            'polity:test-polity': {
              id: 'polity:test-polity',
              name: 'Test Polity',
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
          historicalFacts: [],
          assumptions: [],
          macroRegions: [],
          fidelity: {
            intendedUse: 'test-fixture',
            polityLevels: { 'polity:test-polity': 'Baseline' },
            gaps: []
          }
        },
        sources: []
      };

      const result = validator.validateBundle(bundle);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject bundle with mismatched scenario IDs', () => {
      const bundle = {
        manifest: { id: 'scenario:manifest-id' },
        scenario: { id: 'scenario:different-id' },
        sources: []
      };

      const result = validator.validateBundle(bundle);
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.code === 'reference.id-mismatch'));
    });

    it('should reject fact with wrong scenario prefix', () => {
      const bundle = {
        manifest: { id: 'scenario:test-scenario' },
        scenario: {
          id: 'scenario:test-scenario',
          historicalFacts: [
            { id: 'fact:wrong-scenario:test-fact' }
          ]
        },
        sources: []
      };

      const result = validator.validateBundle(bundle);
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.code === 'reference.wrong-scenario'));
    });

    it('should reject unknown entity reference', () => {
      const bundle = {
        manifest: { id: 'scenario:test' },
        scenario: {
          id: 'scenario:test',
          polities: {
            'polity:known': { id: 'polity:known', name: 'Known', color: '#000000' }
          },
          historicalFacts: [
            {
              id: 'fact:test:test-fact',
              subjectRefs: ['polity:unknown']
            }
          ]
        },
        sources: []
      };

      const result = validator.validateBundle(bundle);
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.code === 'reference.unknown-entity'));
    });
  });

  describe('Builder', () => {
    const builder = new ScenarioV2Builder();

    it('should build valid bundle with checksum', () => {
      const bundle = {
        manifest: {
          schemaVersion: 2,
          id: 'scenario:test',
          contentVersion: '0.1.0',
          engineRange: '>=0.1.0 <1.0.0',
          defaultLocale: 'en',
          scenarioPath: 'scenario.json',
          sourcesPath: 'sources.json',
          assets: []
        },
        scenario: {
          schemaVersion: 2,
          id: 'scenario:test',
          meta: { title: 'Test' },
          game: {
            startDate: '1916-01-01',
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
          historicalFacts: [],
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

      const result = builder.build(bundle);
      assert.strictEqual(result.success, true);
      assert.strictEqual(typeof result.inputChecksum, 'string');
      assert(result.inputChecksum!.startsWith('sha256:'));
    });

    it('should verify deterministic builds', () => {
      const bundle = {
        manifest: { id: 'scenario:test' },
        scenario: { id: 'scenario:test' },
        sources: []
      };

      const verification = builder.verifyDeterministicBuild(bundle);
      assert.strictEqual(verification.deterministic, true);
      assert.strictEqual(verification.checksums.length, 3);
      assert(verification.checksums[0].startsWith('sha256:'));
    });
  });
});
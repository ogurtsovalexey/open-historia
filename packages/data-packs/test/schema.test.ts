import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  scenarioV2Schema,
  scenarioManifestSchema,
  contentVersionSchema,
  assetRefSchema,
  simulationRulesSchema,
} from '../src/schemas.js';

describe('Scenario V2 schemas', () => {
  it('rejects a prose-only simulationRules string', () => {
    const result = simulationRulesSchema.safeParse('no air power in 117 AD');
    assert.strictEqual(result.success, false);
  });

  it('accepts structured simulation rules', () => {
    const result = simulationRulesSchema.safeParse({
      era: 'classical',
      aiHistoryMode: 'conditional',
      constraints: { noAirPower: true, narrativeRules: ['classical warfare'] },
      technologyLevel: { era: 'pre-industrial' },
    });
    assert.strictEqual(result.success, true);
  });

  it('rejects a content version with a leading v', () => {
    assert.strictEqual(contentVersionSchema.safeParse('v1.0.0').success, false);
    assert.strictEqual(contentVersionSchema.safeParse('1.0.0').success, true);
  });

  it('rejects a malformed asset content address', () => {
    const result = assetRefSchema.safeParse({
      id: 'asset:world-1916:regions',
      kind: 'regions',
      mediaType: 'application/json',
      required: true,
      contentAddress: 'not-a-hash',
    });
    assert.strictEqual(result.success, false);
  });

  it('rejects a manifest with a non-2 schema version', () => {
    const result = scenarioManifestSchema.safeParse({
      schemaVersion: 1,
      id: 'scenario:world-1916',
      contentVersion: '0.1.0',
      engineRange: '>=0.1.0 <1.0.0',
      defaultLocale: 'en',
      scenarioPath: 'scenario.json',
      sourcesPath: 'sources.json',
      assets: [],
    });
    assert.strictEqual(result.success, false);
  });

  it('requires every known fact value to be constrained by the discriminated union', () => {
    const result = scenarioV2Schema.safeParse({
      schemaVersion: 2,
      id: 'scenario:world-1916',
      meta: { title: 'x' },
      game: { startDate: '1916-01-01', defaultPlayer: 'polity:russian-empire' },
      polities: { 'polity:russian-empire': { id: 'polity:russian-empire', name: 'Russian Empire', color: '#1a4f2b' } },
      regions: [],
      simulationRules: { era: 'world-war-i', aiHistoryMode: 'conditional', constraints: {}, technologyLevel: { era: 'industrial' } },
      historicalFacts: [],
      assumptions: [],
      macroRegions: [],
      fidelity: { intendedUse: 'test-fixture', polityLevels: { 'polity:russian-empire': 'Baseline' }, gaps: [] },
    });
    assert.strictEqual(result.success, true);
  });
});
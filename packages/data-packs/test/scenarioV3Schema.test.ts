import { describe, it } from 'node:test';
import assert from 'node:assert';
import { scenarioV3Schema } from '../src/v3/schemas.js';
import { scenarioV3 } from '../src/index.js';
import { minimalScenarioV3 } from './scenarioV3Fixtures.js';

describe('ScenarioV3 authoring schema', () => {
  it('is exposed through an explicit public version namespace', () => {
    assert.strictEqual(scenarioV3.SCENARIO_V3_SCHEMA_VERSION, 'open-historia-scenario/3');
    assert.strictEqual(scenarioV3.scenarioV3Schema, scenarioV3Schema);
  });

  it('accepts the strict open-historia-scenario/3 root contract', () => {
    assert.strictEqual(scenarioV3Schema.parse(minimalScenarioV3()).schemaVersion, 'open-historia-scenario/3');
  });

  it('rejects old/future versions, unknown fields and malformed record keys', () => {
    assert.strictEqual(scenarioV3Schema.safeParse({ ...minimalScenarioV3(), schemaVersion: 'open-historia-scenario/2' }).success, false);
    assert.strictEqual(scenarioV3Schema.safeParse({ ...minimalScenarioV3(), extra: true }).success, false);
    const malformed = minimalScenarioV3() as ScenarioV3Mutable;
    malformed.startingState.polities.bad = malformed.startingState.polities['polity:alpha']!;
    assert.strictEqual(scenarioV3Schema.safeParse(malformed).success, false);
  });

  it('leaves record key/value identity equality to semantic validation', () => {
    const input = minimalScenarioV3();
    input.startingState.polities['polity:alpha']!.id = 'polity:beta';
    assert.strictEqual(scenarioV3Schema.safeParse(input).success, true, 'shape parsing precedes semantic key equality validation');
  });
});

type ScenarioV3Mutable = ReturnType<typeof minimalScenarioV3> & {
  startingState: { polities: Record<string, ReturnType<typeof minimalScenarioV3>['startingState']['polities'][string]> };
};

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { econScenarioSchema } from '../src/scenario.js';
import { loadScenarioRaw } from './helpers.js';

function scenarioWith(mutate: (raw: Record<string, unknown>) => void): unknown {
  const raw = structuredClone(loadScenarioRaw()) as Record<string, unknown>;
  mutate(raw);
  return raw;
}

describe('scenario schema', () => {
  it('accepts the checked-in dev fixture', () => {
    const result = econScenarioSchema.safeParse(loadScenarioRaw());
    assert.strictEqual(result.success, true, JSON.stringify(result.success ? [] : result.error.issues, null, 2));
  });

  it('rejects a region with a missing authored coefficient', () => {
    const raw = scenarioWith((scenario) => {
      const regions = scenario.regions as Array<Record<string, unknown>>;
      delete regions[0].workforceRateBp;
    });
    assert.strictEqual(econScenarioSchema.safeParse(raw).success, false);
  });

  it('rejects an active resource without accounting value / tax rate', () => {
    const raw = scenarioWith((scenario) => {
      (scenario.activeResources as string[]).push('stone');
    });
    const result = econScenarioSchema.safeParse(raw);
    assert.strictEqual(result.success, false);
    assert.ok(result.error!.issues.some((issue) => issue.message.includes('stone')));
  });

  it('rejects a region controlled by an unknown polity', () => {
    const raw = scenarioWith((scenario) => {
      (scenario.regions as Array<Record<string, unknown>>)[0].controllerId = 'polity:nobody';
    });
    assert.strictEqual(econScenarioSchema.safeParse(raw).success, false);
  });

  it('rejects duplicate region ids', () => {
    const raw = scenarioWith((scenario) => {
      const regions = scenario.regions as Array<Record<string, unknown>>;
      regions[1].regionId = regions[0].regionId;
    });
    assert.strictEqual(econScenarioSchema.safeParse(raw).success, false);
  });

  it('rejects a startMonth that is not the first day of a month', () => {
    const raw = scenarioWith((scenario) => {
      scenario.startMonth = '1900-01-15';
    });
    assert.strictEqual(econScenarioSchema.safeParse(raw).success, false);
  });

  it('rejects an unknown catalog resource id', () => {
    const raw = scenarioWith((scenario) => {
      (scenario.regions as Array<Record<string, unknown>>)[0].activity = {
        kind: 'extraction',
        resource: 'unobtainium',
      };
    });
    assert.strictEqual(econScenarioSchema.safeParse(raw).success, false);
  });
});

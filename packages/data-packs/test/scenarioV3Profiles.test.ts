import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateScenarioV3 } from '../src/v3/validator.js';
import { minimalScenarioV3 } from './scenarioV3Fixtures.js';

describe('ScenarioV3 provenance profiles', () => {
  for (const profile of ['historical', 'fictional', 'development'] as const) {
    it(`accepts evidence authored for the ${profile} profile`, () => {
      assert.deepStrictEqual(validateScenarioV3(minimalScenarioV3(profile)).errors, []);
    });
  }

  it('rejects evidence from a different profile at its exact basis path', () => {
    const input = minimalScenarioV3('historical');
    input.provenance.evidence['evidence:polity-alpha']!.basis = { kind: 'development', synthetic: true };
    const result = validateScenarioV3(input);
    assert.ok(result.errors.some((error) => error.path === '/provenance/evidence/evidence:polity-alpha/basis/kind'));
  });

  it('rejects an unknown historical source at its array position', () => {
    const input = minimalScenarioV3('historical');
    const basis = input.provenance.evidence['evidence:polity-alpha']!.basis;
    if (basis.kind !== 'historical') throw new Error('fixture bug');
    basis.sourceIds[0] = 'source:test:missing';
    const result = validateScenarioV3(input);
    assert.ok(result.errors.some((error) => error.path === '/provenance/evidence/evidence:polity-alpha/basis/sourceIds/0'));
  });
});

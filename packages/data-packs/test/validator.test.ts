import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ScenarioV2Validator } from '../src/validator.js';
import type { ScenarioBundle } from '../src/validator.js';
import { calculateInputChecksum } from '../src/builder.js';
import {
  SCENARIO_ID,
  POLITY_RU,
  POLITY_DE,
  FACT_REVENUE,
  ASSUMPTION_TERRITORY,
  makeBundle,
  makeFact,
  makeSource,
} from './fixtures.js';

function parseValid(input: unknown): ScenarioBundle {
  const validator = new ScenarioV2Validator();
  const result = validator.validateBundle(input);
  assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
  return result.bundle!;
}

function revenueBundle(): Record<string, unknown> {
  return makeBundle({
    scenario: { historicalFacts: [makeFact()] },
    sources: [makeSource()],
  });
}

describe('ScenarioV2Validator — references', () => {
  const validator = new ScenarioV2Validator();

  it('accepts a minimal valid bundle', () => {
    const result = validator.validateBundle(makeBundle());
    assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
  });

  it('rejects a manifest/scenario id mismatch', () => {
    const result = validator.validateBundle(
      makeBundle({ manifest: { id: 'scenario:world-1797' } }),
    );
    assert.strictEqual(result.valid, false);
    assert(result.errors.some((e) => e.code === 'reference.id-mismatch'));
  });

  it('rejects an unknown source reference on a fact', () => {
    const result = validator.validateBundle(
      makeBundle({
        scenario: {
          historicalFacts: [makeFact({ sourceRefs: ['source:world-1916:nope'] })],
        },
        sources: [],
      }),
    );
    assert.strictEqual(result.valid, false);
    assert(result.errors.some((e) => e.code === 'reference.unknown-source'));
  });

  it('rejects an unknown entity reference in a fact subject', () => {
    const result = validator.validateBundle(
      makeBundle({
        scenario: {
          historicalFacts: [makeFact({ subjectRefs: ['polity:unknown-empire'] })],
        },
      }),
    );
    assert.strictEqual(result.valid, false);
    assert(result.errors.some((e) => e.code === 'reference.unknown-entity'));
  });

  it('rejects an unknown region in a region assignment', () => {
    const result = validator.validateBundle(
      makeBundle({
        scenario: {
          regionAssignments: { 'region:gadm-4-1:XXX.9_9': POLITY_RU },
        },
      }),
    );
    assert.strictEqual(result.valid, false);
    assert(result.errors.some((e) => e.code === 'reference.unknown-region'));
  });

  it('rejects a fact not scenario-qualified by ID prefix', () => {
    const result = validator.validateBundle(
      makeBundle({
        scenario: {
          historicalFacts: [makeFact({ id: 'fact:world-1797:russia-revenue-001' })],
        },
        sources: [makeSource()],
      }),
    );
    assert.strictEqual(result.valid, false);
    assert(result.errors.some((e) => e.code === 'reference.wrong-scenario'));
  });

  it('rejects missing/extra bundle documents and duplicate typed IDs', () => {
    const missing = validator.validateBundle({ manifest: {}, scenario: {} });
    assert(missing.errors.some((e) => e.code === 'schema.missing-document' && e.path === '/sources'));

    const extra = validator.validateBundle({ ...makeBundle(), surprise: true });
    assert(extra.errors.some((e) => e.code === 'schema.unrecognized_keys'));

    const duplicate = validator.validateBundle(makeBundle({ sources: [makeSource(), makeSource()] }));
    assert(duplicate.errors.some((e) => e.code === 'reference.duplicate-source'));
  });

  it('rejects polity key, region identity and default-locale mismatches', () => {
    const polityMismatch = validator.validateBundle(makeBundle({
      scenario: { polities: { [POLITY_RU]: { id: POLITY_DE, name: 'Wrong', color: '#112233' } } },
    }));
    assert(polityMismatch.errors.some((e) => e.code === 'reference.polity-key-mismatch'));

    const regionMismatch = validator.validateBundle(makeBundle({
      scenario: { regions: [{ id: 'region:gadm-4-1:RUS.33_1', dataset: 'other', datasetVersion: '4.1', nativeId: 'RUS.33_1' }] },
    }));
    assert(regionMismatch.errors.some((e) => e.code === 'reference.region-id-mismatch'));

    const localeMismatch = validator.validateBundle(makeBundle({
      scenario: { meta: { title: 'Fixture', locales: { ru: { title: 'Тест' } } } },
    }));
    assert(localeMismatch.errors.some((e) => e.code === 'reference.unknown-default-locale'));
  });
});

describe('ScenarioV2Validator — provenance', () => {
  const validator = new ScenarioV2Validator();

  it('rejects a known value without source or assumption', () => {
    const result = validator.validateBundle(
      makeBundle({
        scenario: {
          historicalFacts: [makeFact({ sourceRefs: [], assumptionRefs: [] })],
        },
      }),
    );
    assert.strictEqual(result.valid, false);
    assert(result.errors.some((e) => e.code === 'provenance.missing-source-or-assumption'));
  });

  it('rejects confidence "assumption" without an assumption reference', () => {
    const result = validator.validateBundle(
      makeBundle({
        scenario: {
          historicalFacts: [
            makeFact({ confidence: 'assumption', assumptionRefs: [] }),
          ],
        },
        sources: [makeSource()],
      }),
    );
    assert.strictEqual(result.valid, false);
    assert(result.errors.some((e) => e.code === 'provenance.assumption-confidence-missing-ref'));
  });

  it('requires explicit fidelity linkage for unknown and assumption-backed facts', () => {
    const unknown = validator.validateBundle(makeBundle({
      scenario: { historicalFacts: [makeFact({
        value: { kind: 'unknown', expectedKind: 'quantity', reason: 'Search completed without a reconciled value.' },
        sourceRefs: [],
        transformation: [],
      })] },
    }));
    assert(unknown.errors.some((e) => e.code === 'provenance.unknown-gap-missing'));

    const assumption = {
      id: ASSUMPTION_TERRITORY,
      statement: 'Synthetic fixture choice',
      rationale: 'Required only for the test',
      affectedPaths: ['/different/path'],
      sourceRefs: [],
      status: 'authored',
    };
    const assumed = validator.validateBundle(makeBundle({
      scenario: {
        historicalFacts: [makeFact({
          sourceRefs: [],
          assumptionRefs: [ASSUMPTION_TERRITORY],
          confidence: 'assumption',
          transformation: [{ operation: 'scenario-choice', description: 'fixture choice', inputSourceRefs: [] }],
        })],
        assumptions: [assumption],
        fidelity: {
          intendedUse: 'test-fixture',
          polityLevels: { [POLITY_RU]: 'Baseline', [POLITY_DE]: 'Baseline' },
          gaps: [{ path: '/different/path', disposition: 'assumption', reason: 'fixture choice', assumptionRef: ASSUMPTION_TERRITORY }],
        },
      },
    }));
    assert(assumed.errors.some((e) => e.code === 'provenance.assumption-path-mismatch'));
    assert(assumed.errors.some((e) => e.code === 'provenance.assumption-gap-missing'));
  });
});

describe('ScenarioV2Validator — pregame narrative', () => {
  const bundle = parseValid(revenueBundle());
  const checksum = calculateInputChecksum(bundle);
  const validator = new ScenarioV2Validator();

  function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schemaVersion: 1,
      scenarioId: SCENARIO_ID,
      baseInputChecksum: checksum,
      segments: [
        { text: 'Revenue was reported at two million.', kind: 'inference', factRefs: [], claimRefs: ['claim-1'] },
      ],
      factsUsed: [FACT_REVENUE],
      inferredClaims: [
        {
          id: 'claim-1',
          claim: 'revenue equals 2000000',
          evidenceRefs: [FACT_REVENUE],
          confidence: 'low',
          assertion: {
            subjectRef: POLITY_RU,
            predicate: 'fixture.monthly-revenue',
            operator: 'equals',
            value: { kind: 'quantity', amount: '2000000', unit: 'RUB-1913' },
          },
        },
      ],
      ...overrides,
    };
  }

  it('rejects an unknown fact in factsUsed', () => {
    const result = validator.validatePregameNarrative(
      { ...draft(), factsUsed: ['fact:world-1916:nope'] },
      checksum,
      bundle,
    );
    assert.strictEqual(result.valid, false);
    assert(result.errors.some((e) => e.code === 'reference.unknown-fact'));
  });

  it('rejects factsUsed that is not the referenced union', () => {
    const result = validator.validatePregameNarrative(
      { ...draft(), factsUsed: [] },
      checksum,
      bundle,
    );
    assert.strictEqual(result.valid, false);
    assert(result.errors.some((e) => e.code === 'integrity.facts-used-mismatch'));
  });

  it('rejects a claim that contradicts a protected starting-value', () => {
    const result = validator.validatePregameNarrative(draft(), checksum, bundle);
    assert.strictEqual(result.valid, false);
    assert(result.errors.some((e) => e.code === 'integrity.claim-contradiction'));
  });

  it('accepts a claim that matches the protected starting-value', () => {
    const consistent = draft();
    (consistent.inferredClaims as Array<{ assertion: { value: { amount: string } } }>)[0].assertion.value.amount = '1000000';
    const result = validator.validatePregameNarrative(consistent, checksum, bundle);
    assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
  });

  it('evaluates numeric bounds against the authored fact value', () => {
    const consistent = draft();
    const assertion = (consistent.inferredClaims as Array<{ assertion: { operator: string; value: { amount: string } } }>)[0].assertion;
    assertion.operator = 'less-than';
    assertion.value.amount = '2000000';
    const accepted = validator.validatePregameNarrative(consistent, checksum, bundle);
    assert.strictEqual(accepted.valid, true, JSON.stringify(accepted.errors));

    assertion.value.amount = '500000';
    const rejected = validator.validatePregameNarrative(consistent, checksum, bundle);
    assert(rejected.errors.some((e) => e.code === 'integrity.claim-contradiction'));
  });

  it('rejects unknown claim references in narrative segments', () => {
    const input = draft();
    (input.segments as Array<{ claimRefs: string[] }>)[0].claimRefs = ['missing-claim'];
    const result = validator.validatePregameNarrative(input, checksum, bundle);
    assert(result.errors.some((e) => e.code === 'reference.unknown-claim'));
  });
});

describe('ScenarioV2Validator — draft patch protection', () => {
  const bundle = parseValid(makeBundle());
  const checksum = calculateInputChecksum(bundle);
  const validator = new ScenarioV2Validator();

  function patch(path: string): Record<string, unknown> {
    return {
      schemaVersion: 1,
      id: 'draft-patch:world-1916:gap-001',
      status: 'draft',
      base: { scenarioId: SCENARIO_ID, contentVersion: '0.1.0', inputChecksum: checksum },
      operations: [
        {
          op: 'replace',
          path,
          value: 'X',
          sourceRefs: [],
          assumptionRefs: [],
          rationale: 'test',
        },
      ],
    };
  }

  it('rejects a patch targeting a protected path', () => {
    const result = validator.validateDraftPatch(patch('/scenario/game/startDate'), checksum, bundle);
    assert.strictEqual(result.valid, false);
    assert(result.errors.some((e) => e.code === 'integrity.protected-path-mutation'));
  });

  it('accepts a patch on an unprotected path', () => {
    const result = validator.validateDraftPatch(patch('/scenario/meta/description'), checksum, bundle);
    assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
  });

  it('rejects descendants of protected authored collections', () => {
    const result = validator.validateDraftPatch(patch('/scenario/historicalFacts/0/value'), checksum, bundle);
    assert(result.errors.some((e) => e.code === 'integrity.protected-path-mutation'));
  });
});

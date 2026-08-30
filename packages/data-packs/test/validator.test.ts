import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ScenarioV2Validator } from '../src/validator.js';
import type { ScenarioBundle } from '../src/validator.js';
import { calculateInputChecksum } from '../src/builder.js';
import {
  SCENARIO_ID,
  POLITY_RU,
  FACT_REVENUE,
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
});
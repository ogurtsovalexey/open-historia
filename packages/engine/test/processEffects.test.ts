import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  applyPermanentEffect,
  assertEffectFamilyMaterializable,
  materializePermanentEffect,
  UnsupportedEffectMaterializationError,
} from '../src/processes/effects.js';
import { stampWorldStateRevision } from '../src/world/revision.js';
import type { WorldStateV2Input } from '../src/world/schema.js';

const SEED = `sha256:${'3'.repeat(64)}`;

function stateInput(): WorldStateV2Input {
  return {
    schemaVersion: 'open-historia-world/2', scenarioId: 'scenario:effect-test', month: '1500-01-01', turn: 0,
    revisionLineage: { seedRevision: SEED, ancestorRevisions: [] },
    worldRules: {
      physicalModel: 'physical-model:test', knowledgeBaseline: [], communicationModel: 'communication-model:test',
      governmentModel: 'government-model:test', militaryModel: 'military-model:test', hardProhibitions: [], plausibilityContext: [],
    },
    modules: { enabled: [] },
    catalogs: {
      modules: [], worldModels: [
        { modelId: 'physical-model:test', kind: 'physical' },
        { modelId: 'communication-model:test', kind: 'communication' },
        { modelId: 'government-model:test', kind: 'government' },
        { modelId: 'military-model:test', kind: 'military' },
      ], commodities: [], controlProfiles: [{
        controlProfileId: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000,
        extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
      }], formationArchetypes: [], equipmentClasses: [], routeClasses: [],
    },
    polities: [{ id: 'polity:test', displayName: { en: 'Test' }, treasury: 0, stockpiles: [], evidenceIds: ['evidence:source'] }],
    regions: [{
      regionId: 'region:test:capital', displayName: { en: 'Capital' },
      control: {
        legalOwnerPolityId: 'polity:test', actualControllerPolityId: 'polity:test', kind: 'sovereign',
        controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000,
        extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
      }, fiscalBase: 10, productiveCapacity: 100, supplyCapacity: 20, resourceDeposits: [], evidenceIds: ['evidence:source'],
    }],
    populationCohorts: [], formations: [], routes: [], characters: [], groups: [], institutions: [], concepts: [], processes: [],
    relationships: [], knowledge: { records: [] }, events: [], evidence: [{
      evidenceId: 'evidence:source', revision: SEED, kind: 'authored', entityRefs: ['region:test:capital'],
      eventRefs: [], canonicalPointers: [], visibility: 'public',
    }],
  };
}

describe('strict process effects', () => {
  it('applies one bounded permanent delta to its canonical selector input', () => {
    const state = stampWorldStateRevision(stateInput());
    const effect = materializePermanentEffect({
      kind: 'capacity.modify', targetEntityRef: 'region:test:capital', parameter: 'productiveCapacity',
      duration: 'permanent', stacking: 'additive', sourceProcessId: 'process:test', sourceEvidenceIds: ['evidence:source'],
      lowerBound: 0, upperBound: 105, delta: 20,
    });
    const result = applyPermanentEffect(state, effect);
    assert.strictEqual(state.regions[0]!.productiveCapacity, 100);
    assert.strictEqual(result.state.regions[0]!.productiveCapacity, 105);
    assert.deepStrictEqual({ before: result.applied.before, after: result.applied.after }, { before: 100, after: 105 });
  });

  it('fails closed for temporary, arbitrary and not-yet-materializable effect families', () => {
    assert.throws(() => materializePermanentEffect({
      kind: 'capacity.modify', targetEntityRef: 'region:test:capital', parameter: 'productiveCapacity',
      duration: 'temporary', stacking: 'additive', sourceProcessId: 'process:test', sourceEvidenceIds: ['evidence:source'],
      lowerBound: 0, upperBound: 200, delta: 20,
    }), /Invalid input/);
    assert.throws(() => materializePermanentEffect({
      kind: 'capacity.modify', targetEntityRef: 'region:test:capital', parameter: 'productiveCapacity',
      duration: 'permanent', stacking: 'multiply', multiplier: 1000, sourceProcessId: 'process:test', sourceEvidenceIds: ['evidence:source'],
      lowerBound: 0, upperBound: 200, delta: 20,
    }), /Invalid input|unrecognized key/i);
    assert.throws(
      () => assertEffectFamilyMaterializable('group-support.shift'),
      (error: unknown) => error instanceof UnsupportedEffectMaterializationError,
    );
  });
});

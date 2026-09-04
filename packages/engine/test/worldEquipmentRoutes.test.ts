import { describe, it } from 'node:test';
import assert from 'node:assert';
import { stampWorldStateRevision } from '../src/world/revision.js';
import type { WorldStateV2Input } from '../src/world/schema.js';
import { derivePolitySnapshot, deriveRouteSnapshot, routesThroughRegion } from '../src/world/selectors.js';

const SEED = `sha256:${'1'.repeat(64)}`;

function input(): WorldStateV2Input {
  return {
    schemaVersion: 'open-historia-world/2', scenarioId: 'scenario:equipment-routes', month: '1900-01-01', turn: 0,
    revisionLineage: { seedRevision: SEED, ancestorRevisions: [] },
    worldRules: {
      physicalModel: 'world-model:physical', knowledgeBaseline: [], communicationModel: 'world-model:communication',
      governmentModel: 'world-model:government', militaryModel: 'world-model:military', hardProhibitions: [], plausibilityContext: [],
    },
    modules: { enabled: [] },
    catalogs: {
      modules: [],
      worldModels: [
        { modelId: 'world-model:physical', kind: 'physical' },
        { modelId: 'world-model:communication', kind: 'communication' },
        { modelId: 'world-model:government', kind: 'government' },
        { modelId: 'world-model:military', kind: 'military' },
      ],
      commodities: [{ commodityId: 'commodity:food', usage: 'both' }],
      controlProfiles: [{
        controlProfileId: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000,
        extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
      }],
      formationArchetypes: [{ formationArchetypeId: 'formation-archetype:levy', equipmentClassIds: ['equipment-class:arms'] }],
      equipmentClasses: [{ equipmentClassId: 'equipment-class:arms' }],
      routeClasses: [{ routeClassId: 'route-class:land' }],
    },
    polities: [{ id: 'polity:alpha', displayName: { en: 'Alpha' }, treasury: 0, stockpiles: [], evidenceIds: ['evidence:alpha'] }],
    regions: [{
      regionId: 'region:test:A', displayName: { en: 'A' },
      control: {
        legalOwnerPolityId: 'polity:alpha', actualControllerPolityId: 'polity:alpha', kind: 'sovereign',
        controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000,
        extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
      },
      fiscalBase: 0, productiveCapacity: 0, supplyCapacity: 0, resourceDeposits: [], evidenceIds: ['evidence:region-a'],
    }],
    populationCohorts: [{
      cohortId: 'cohort:alpha', regionId: 'region:test:A', population: 10,
      workforceParticipationBp: 0, recruitmentEligibilityBp: 0, evidenceIds: ['evidence:cohort-alpha'],
    }],
    formations: [{
      formationId: 'formation:alpha', polityId: 'polity:alpha', archetypeId: 'formation-archetype:levy', manpower: 1,
      personnelOrigins: [{ regionId: 'region:test:A', personnel: 1 }],
      equipment: [{ equipmentClassId: 'equipment-class:arms', quantity: 2 }], evidenceIds: ['evidence:formation-alpha'],
    }],
    routes: [{
      routeId: 'route:land-a', classId: 'route-class:land', regionIds: ['region:test:A'],
      allowedCommodityIds: ['commodity:food'], evidenceIds: ['evidence:route-a'],
    }],
    characters: [], groups: [], institutions: [], concepts: [], processes: [], relationships: [], knowledge: { records: [] }, events: [],
    evidence: ['alpha', 'region-a', 'cohort-alpha', 'formation-alpha', 'route-a'].map((id) => ({
      evidenceId: `evidence:${id}`, revision: SEED, kind: 'authored', entityRefs: [], eventRefs: [],
      canonicalPointers: [], visibility: 'public' as const,
    })),
  };
}

describe('WorldStateV2 formation equipment and routes', () => {
  it('keeps live equipment and routes canonical and selector-visible', () => {
    const state = stampWorldStateRevision(input());
    assert.deepStrictEqual(derivePolitySnapshot(state, 'polity:alpha').value.equipment, [
      { equipmentClassId: 'equipment-class:arms', quantity: 2 },
    ]);
    assert.deepStrictEqual(deriveRouteSnapshot(state, 'route:land-a').value.regionIds, ['region:test:A']);
    assert.deepStrictEqual(routesThroughRegion(state, 'region:test:A'), ['route:land-a']);
  });

  it('rejects unknown/disallowed equipment and broken route references', () => {
    const disallowed = input();
    disallowed.formations[0]!.equipment[0]!.equipmentClassId = 'equipment-class:horses';
    assert.throws(() => stampWorldStateRevision(disallowed), /unknown equipment class|not allowed by archetype/i);

    const badRouteClass = input();
    badRouteClass.routes[0]!.classId = 'route-class:sea';
    assert.throws(() => stampWorldStateRevision(badRouteClass), /unknown route class/i);

    const badRegion = input();
    badRegion.routes[0]!.regionIds[0] = 'region:test:missing';
    assert.throws(() => stampWorldStateRevision(badRegion), /route .*unknown region/i);

    const badCommodity = input();
    badCommodity.routes[0]!.allowedCommodityIds[0] = 'commodity:missing';
    assert.throws(() => stampWorldStateRevision(badCommodity), /route .*unknown commodity/i);
  });

  it('rejects duplicate equipment/route rows and unsafe equipment aggregates', () => {
    const duplicate = input();
    duplicate.formations[0]!.equipment.push({ ...duplicate.formations[0]!.equipment[0]! });
    assert.throws(() => stampWorldStateRevision(duplicate), /duplicate equipment/i);

    const overflow = input();
    overflow.catalogs.equipmentClasses.push({ equipmentClassId: 'equipment-class:transport' });
    overflow.catalogs.formationArchetypes[0]!.equipmentClassIds.push('equipment-class:transport');
    overflow.formations[0]!.equipment = [
      { equipmentClassId: 'equipment-class:arms', quantity: Number.MAX_SAFE_INTEGER },
      { equipmentClassId: 'equipment-class:transport', quantity: 1 },
    ];
    assert.throws(() => stampWorldStateRevision(overflow), /equipment aggregate.*safe integer/i);

    const collectiveOverflow = input();
    collectiveOverflow.formations[0]!.equipment[0]!.quantity = Number.MAX_SAFE_INTEGER;
    collectiveOverflow.formations.push({
      formationId: 'formation:alpha-second', polityId: 'polity:alpha', archetypeId: 'formation-archetype:levy', manpower: 1,
      personnelOrigins: [{ regionId: 'region:test:A', personnel: 1 }],
      equipment: [{ equipmentClassId: 'equipment-class:arms', quantity: 1 }], evidenceIds: ['evidence:formation-alpha'],
    });
    assert.throws(() => stampWorldStateRevision(collectiveOverflow), /world equipment .*safe integer/i);
  });

  it('canonicalizes catalog, equipment, route and allowed-commodity permutations', () => {
    const first = stampWorldStateRevision(input());
    const permuted = input();
    permuted.catalogs.formationArchetypes.reverse();
    permuted.catalogs.equipmentClasses.reverse();
    permuted.catalogs.routeClasses.reverse();
    permuted.formations[0]!.equipment.reverse();
    permuted.routes.reverse();
    permuted.routes[0]!.allowedCommodityIds.reverse();
    const second = stampWorldStateRevision(permuted);
    assert.strictEqual(second.revision, first.revision);
    assert.deepStrictEqual(second, first);
  });
});

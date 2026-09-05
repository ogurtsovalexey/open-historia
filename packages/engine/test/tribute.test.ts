import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  applyTributeDelivery,
  derivePolitySnapshot,
  deriveRegionSnapshot,
  stampWorldStateRevision,
  type WorldStateV2Input,
} from '../src/world/index.js';

const SEED = `sha256:${'8'.repeat(64)}`;

function input(): WorldStateV2Input {
  const polity = (id: 'alpha' | 'beta' | 'gamma', maize: number) => ({
    id: `polity:${id}` as const,
    displayName: { en: id },
    treasury: 100,
    stockpiles: maize > 0 ? [{ commodityId: 'commodity:maize', quantity: maize }] : [],
    evidenceIds: [`evidence:${id}` as const],
  });
  return {
    schemaVersion: 'open-historia-world/2', scenarioId: 'scenario:tribute-test', month: '1450-01-01', turn: 0,
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
      commodities: [{ commodityId: 'commodity:maize', usage: 'both' }],
      controlProfiles: [{
        controlProfileId: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000,
        extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
      }],
      formationArchetypes: [{ formationArchetypeId: 'formation-archetype:levy', equipmentClassIds: [] }],
      equipmentClasses: [], routeClasses: [{ routeClassId: 'route-class:porter' }],
    },
    polities: [polity('alpha', 70), polity('beta', 0), polity('gamma', 0)],
    regions: [{
      regionId: 'region:test:alpha', displayName: { en: 'Alpha source' },
      control: {
        legalOwnerPolityId: 'polity:alpha', actualControllerPolityId: 'polity:alpha', kind: 'sovereign',
        controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000,
        extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
      },
      fiscalBase: 100, productiveCapacity: 100, supplyCapacity: 100, resourceDeposits: [], evidenceIds: ['evidence:region'],
    }],
    populationCohorts: [{
      cohortId: 'cohort:alpha', regionId: 'region:test:alpha', population: 1000,
      workforceParticipationBp: 5000, recruitmentEligibilityBp: 4000, evidenceIds: ['evidence:cohort'],
    }],
    formations: [{
      formationId: 'formation:alpha-levy', polityId: 'polity:alpha', archetypeId: 'formation-archetype:levy', manpower: 100,
      personnelOrigins: [{ regionId: 'region:test:alpha', personnel: 100 }], equipment: [], evidenceIds: ['evidence:formation'],
    }],
    routes: [{
      routeId: 'route:porter-road', classId: 'route-class:porter', regionIds: ['region:test:alpha'],
      allowedCommodityIds: ['commodity:maize'], evidenceIds: ['evidence:route'],
    }],
    characters: [], groups: [], institutions: [], concepts: [], processes: [], relationships: [],
    tributeObligations: [{
      obligationId: 'obligation:alpha-tribute', payerPolityIds: ['polity:alpha'], sourceRegionIds: ['region:test:alpha'],
      beneficiaries: [{ polityId: 'polity:beta', shareBp: 6000 }, { polityId: 'polity:gamma', shareBp: 4000 }],
      deliveries: [{ commodityId: 'commodity:maize', quantity: 100 }], laborService: { people: 50 },
      militaryService: { personnel: 30 }, routeIds: ['route:porter-road'], cadence: 'monthly', arrears: [],
      complianceBp: 8000, enforcementBasisId: 'relationship:test-tribute', evidenceIds: ['evidence:obligation'],
    }],
    knowledge: { records: [] }, events: [],
    evidence: [
      ['alpha', 'polity:alpha'], ['beta', 'polity:beta'], ['gamma', 'polity:gamma'],
      ['region', 'region:test:alpha'], ['cohort', 'cohort:alpha'], ['formation', 'formation:alpha-levy'],
      ['route', 'route:porter-road'], ['obligation', 'obligation:alpha-tribute'],
    ].map(([name, entity]) => ({
      evidenceId: `evidence:${name}`, revision: SEED, kind: 'authored', entityRefs: [entity], eventRefs: [],
      canonicalPointers: [], visibility: 'public' as const,
    })),
  };
}

describe('conserved tribute contract', () => {
  it('conserves partial goods deliveries, allocates exact shares, records arrears and never changes control', () => {
    const before = stampWorldStateRevision(input());
    const controls = before.regions.map((region) => structuredClone(region.control));
    const result = applyTributeDelivery(before, {
      obligationId: 'obligation:alpha-tribute', expectedRevision: before.revision,
    });
    const [row] = result.rows;
    assert.deepStrictEqual(row, {
      commodityId: 'commodity:maize', due: 100, delivered: 70, arrearsAdded: 30,
      payerDebits: [{ polityId: 'polity:alpha', quantity: 70 }],
      beneficiaryCredits: [{ polityId: 'polity:beta', quantity: 42 }, { polityId: 'polity:gamma', quantity: 28 }],
    });
    assert.equal(row!.payerDebits.reduce((sum, debit) => sum + debit.quantity, 0), row!.beneficiaryCredits.reduce((sum, credit) => sum + credit.quantity, 0));
    assert.equal(result.state.polities.find((entry) => entry.id === 'polity:alpha')!.stockpiles[0]!.quantity, 0);
    assert.equal(result.state.polities.find((entry) => entry.id === 'polity:beta')!.stockpiles[0]!.quantity, 42);
    assert.equal(result.state.polities.find((entry) => entry.id === 'polity:gamma')!.stockpiles[0]!.quantity, 28);
    assert.deepStrictEqual(result.state.tributeObligations[0]!.arrears, [{ commodityId: 'commodity:maize', quantity: 30 }]);
    assert.deepStrictEqual(result.state.regions.map((region) => region.control), controls);
    assert.equal(result.controlChanged, false);
    assert.throws(() => applyTributeDelivery(result.state, {
      obligationId: 'obligation:alpha-tribute', expectedRevision: before.revision,
    }), /stale world revision/i);
  });

  it('reserves compliant labor and military service without double-counting them as free capacity', () => {
    const state = stampWorldStateRevision(input());
    const region = deriveRegionSnapshot(state, 'region:test:alpha').value;
    assert.equal(region.potentialWorkforce, 500);
    assert.equal(region.mobilizedPersonnel, 100);
    assert.equal(region.obligatedLabor, 40);
    assert.equal(region.obligatedMilitaryService, 24);
    assert.equal(region.workforce, 336);
    const polity = derivePolitySnapshot(state, 'polity:alpha').value;
    assert.equal(polity.recruitablePopulation, 400);
    assert.equal(polity.availableManpower, 276);
  });

  it('rejects invalid shares, payer control, commodity and route declarations', () => {
    const shares = input();
    shares.tributeObligations![0]!.beneficiaries[0]!.shareBp = 5000;
    assert.throws(() => stampWorldStateRevision(shares), /beneficiary shares sum/i);

    const control = input();
    control.tributeObligations![0]!.payerPolityIds = ['polity:beta'];
    assert.throws(() => stampWorldStateRevision(control), /outside its payers' actual control/i);

    const commodity = input();
    commodity.tributeObligations![0]!.deliveries[0]!.commodityId = 'commodity:cacao';
    assert.throws(() => stampWorldStateRevision(commodity), /unknown commodity/i);

    const route = input();
    route.routes[0]!.allowedCommodityIds = [];
    assert.throws(() => stampWorldStateRevision(route), /no declared route for commodity/i);
  });
});

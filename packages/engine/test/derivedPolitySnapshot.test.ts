import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  controlOf,
  derivePolitySnapshot,
  deriveRegionSnapshot,
  deriveRegionalRecruitmentAvailability,
  deriveWorldPopulationIdentity,
  regionsActuallyControlledBy,
  regionsLegallyOwnedBy,
} from '../src/world/selectors.js';
import { stampWorldStateRevision } from '../src/world/revision.js';
import type { WorldStateV2Input } from '../src/world/schema.js';

const SEED_REVISION = `sha256:${'1'.repeat(64)}`;

function fixtureInput(): WorldStateV2Input {
  const evidenceNames = [
    'alpha', 'beta', 'region-a', 'region-b', 'region-c', 'region-d',
    'cohort-a', 'cohort-b', 'cohort-c', 'cohort-d', 'formation-alpha', 'formation-beta',
  ];
  return {
    schemaVersion: 'open-historia-world/2',
    scenarioId: 'scenario:selector-test',
    month: '1900-03-01',
    turn: 2,
    revisionLineage: { seedRevision: SEED_REVISION, ancestorRevisions: [] },
    worldRules: {
      physicalModel: 'physical-model:test',
      knowledgeBaseline: [],
      communicationModel: 'communication-model:test',
      governmentModel: 'government-model:test',
      militaryModel: 'military-model:test',
      hardProhibitions: [],
      plausibilityContext: [],
    },
    modules: { enabled: ['module:economy', 'module:military'] },
    catalogs: {
      modules: [{ moduleId: 'module:economy' }, { moduleId: 'module:military' }],
      worldModels: [
        { modelId: 'physical-model:test', kind: 'physical' },
        { modelId: 'communication-model:test', kind: 'communication' },
        { modelId: 'government-model:test', kind: 'government' },
        { modelId: 'military-model:test', kind: 'military' },
      ],
      commodities: [
        { commodityId: 'commodity:grain', usage: 'both' },
        { commodityId: 'resource:grain', usage: 'regional' },
        { commodityId: 'resource:timber', usage: 'regional' },
      ],
      controlProfiles: [
        {
          controlProfileId: 'control-profile:sovereign', kind: 'sovereign',
          administrationAccessBp: 10000, extractionAccessBp: 10000,
          recruitmentAccessBp: 10000, integrationBp: 10000,
        },
        {
          controlProfileId: 'control-profile:occupation', kind: 'occupation',
          administrationAccessBp: 2500, extractionAccessBp: 5000,
          recruitmentAccessBp: 1000, integrationBp: 0,
        },
        {
          controlProfileId: 'control-profile:autonomy', kind: 'autonomy',
          administrationAccessBp: 6000, extractionAccessBp: 7000,
          recruitmentAccessBp: 5000, integrationBp: 4000,
        },
        {
          controlProfileId: 'control-profile:indirect', kind: 'indirect',
          administrationAccessBp: 3000, extractionAccessBp: 4000,
          recruitmentAccessBp: 2000, integrationBp: 2500,
        },
      ],
      formationArchetypes: [{ formationArchetypeId: 'formation-archetype:generic', equipmentClassIds: [] }],
      equipmentClasses: [],
      routeClasses: [],
    },
    polities: [
      {
        id: 'polity:beta', displayName: { en: 'Beta' }, treasury: 700,
        stockpiles: [{ commodityId: 'commodity:grain', quantity: 70 }], evidenceIds: ['evidence:beta'],
      },
      {
        id: 'polity:alpha', displayName: { en: 'Alpha' }, treasury: 300,
        stockpiles: [{ commodityId: 'commodity:grain', quantity: 30 }], evidenceIds: ['evidence:alpha'],
      },
    ],
    regions: [
      {
        regionId: 'region:test:D', displayName: { en: 'Indirect D' },
        control: {
          legalOwnerPolityId: 'polity:beta', actualControllerPolityId: 'polity:beta', kind: 'indirect',
          controlProfileId: 'control-profile:indirect', administrationAccessBp: 3000,
          extractionAccessBp: 4000, recruitmentAccessBp: 2000, integrationBp: 2500,
        },
        fiscalBase: 400, productiveCapacity: 800, supplyCapacity: 1000,
        resourceDeposits: [{ resourceId: 'resource:timber', amount: 80 }], evidenceIds: ['evidence:region-d'],
      },
      {
        regionId: 'region:test:B', displayName: { en: 'Occupied B' },
        control: {
          legalOwnerPolityId: 'polity:beta', actualControllerPolityId: 'polity:alpha', kind: 'occupation',
          controlProfileId: 'control-profile:occupation', administrationAccessBp: 2500,
          extractionAccessBp: 5000, recruitmentAccessBp: 1000, integrationBp: 0,
        },
        fiscalBase: 200, productiveCapacity: 300, supplyCapacity: 500,
        resourceDeposits: [{ resourceId: 'resource:grain', amount: 100 }], evidenceIds: ['evidence:region-b'],
      },
      {
        regionId: 'region:test:A', displayName: { en: 'Sovereign A' },
        control: {
          legalOwnerPolityId: 'polity:alpha', actualControllerPolityId: 'polity:alpha', kind: 'sovereign',
          controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000,
          extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
        },
        fiscalBase: 100, productiveCapacity: 200, supplyCapacity: 300,
        resourceDeposits: [{ resourceId: 'resource:grain', amount: 40 }], evidenceIds: ['evidence:region-a'],
      },
      {
        regionId: 'region:test:C', displayName: { en: 'Autonomous C' },
        control: {
          legalOwnerPolityId: 'polity:beta', actualControllerPolityId: 'polity:beta', kind: 'autonomy',
          controlProfileId: 'control-profile:autonomy', administrationAccessBp: 6000,
          extractionAccessBp: 7000, recruitmentAccessBp: 5000, integrationBp: 4000,
        },
        fiscalBase: 300, productiveCapacity: 600, supplyCapacity: 700,
        resourceDeposits: [{ resourceId: 'resource:grain', amount: 60 }], evidenceIds: ['evidence:region-c'],
      },
    ],
    populationCohorts: [
      { cohortId: 'cohort:d', regionId: 'region:test:D', population: 4000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 2000, evidenceIds: ['evidence:cohort-d'] },
      { cohortId: 'cohort:b', regionId: 'region:test:B', population: 2000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 2000, evidenceIds: ['evidence:cohort-b'] },
      { cohortId: 'cohort:a', regionId: 'region:test:A', population: 1000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 2000, evidenceIds: ['evidence:cohort-a'] },
      { cohortId: 'cohort:c', regionId: 'region:test:C', population: 3000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 2000, evidenceIds: ['evidence:cohort-c'] },
    ],
    formations: [
      { formationId: 'formation:beta', polityId: 'polity:beta', archetypeId: 'formation-archetype:generic', manpower: 200, personnelOrigins: [{ regionId: 'region:test:B', personnel: 200 }], equipment: [], evidenceIds: ['evidence:formation-beta'] },
      { formationId: 'formation:alpha', polityId: 'polity:alpha', archetypeId: 'formation-archetype:generic', manpower: 100, personnelOrigins: [{ regionId: 'region:test:A', personnel: 100 }], equipment: [], evidenceIds: ['evidence:formation-alpha'] },
    ],
    routes: [],
    characters: [], groups: [], institutions: [], concepts: [], processes: [], relationships: [],
    knowledge: { records: [] }, events: [],
    evidence: evidenceNames.map((name) => ({
      evidenceId: `evidence:${name}`,
      revision: SEED_REVISION,
      kind: 'authored',
      entityRefs: [],
      eventRefs: [],
      canonicalPointers: [],
      visibility: 'public' as const,
    })),
  };
}

describe('WorldStateV2 authoritative selectors', () => {
  it('separates legal, actual and administered territory including occupation, autonomy and indirect control', () => {
    const state = stampWorldStateRevision(fixtureInput());
    assert.deepStrictEqual(regionsLegallyOwnedBy(state, 'polity:alpha'), ['region:test:A']);
    assert.deepStrictEqual(regionsActuallyControlledBy(state, 'polity:alpha'), ['region:test:A', 'region:test:B']);
    assert.strictEqual(controlOf(state, 'region:test:B').kind, 'occupation');

    const alpha = derivePolitySnapshot(state, 'polity:alpha');
    assert.strictEqual(alpha.value.legalPopulation, 1000);
    assert.strictEqual(alpha.value.controlledPopulation, 3000);
    assert.strictEqual(alpha.value.administeredPopulation, 1500);
    assert.deepStrictEqual(alpha.value.contributions.map((row) => row.regionId), ['region:test:A', 'region:test:B']);

    const beta = derivePolitySnapshot(state, 'polity:beta');
    assert.strictEqual(beta.value.legalPopulation, 9000);
    assert.strictEqual(beta.value.controlledPopulation, 7000);
    assert.strictEqual(beta.value.administeredPopulation, 3000);
    assert.deepStrictEqual(beta.value.contributions.map((row) => [row.regionId, row.controlKind]), [
      ['region:test:B', 'occupation'],
      ['region:test:C', 'autonomy'],
      ['region:test:D', 'indirect'],
    ]);
  });

  it('reconciles every population, workforce, fiscal, output and recruitment total to contribution rows', () => {
    const state = stampWorldStateRevision(fixtureInput());
    for (const polityId of ['polity:alpha', 'polity:beta'] as const) {
      const value = derivePolitySnapshot(state, polityId).value;
      for (const field of [
        'legalPopulation', 'controlledPopulation', 'administeredPopulation', 'workforce', 'taxBase',
        'recruitablePopulation', 'unmobilizedRecruitablePopulation', 'regionalOutput', 'supplyCapacity',
      ] as const) {
        assert.strictEqual(value[field], value.contributions.reduce((sum, row) => sum + row[field], 0), `${polityId} ${field}`);
      }
      for (const resource of value.resourceAccess) {
        const rows = value.contributions.flatMap((row) => row.resourceAccess).filter((row) => row.resourceId === resource.resourceId);
        assert.strictEqual(resource.amount, rows.reduce((sum, row) => sum + row.amount, 0));
      }
    }
  });

  it('subtracts formation origins from regional workforce and recruitment without moving the formation', () => {
    const state = stampWorldStateRevision(fixtureInput());
    const a = deriveRegionSnapshot(state, 'region:test:A').value;
    assert.strictEqual(a.population, 1000);
    assert.strictEqual(a.potentialWorkforce, 500);
    assert.strictEqual(a.mobilizedPersonnel, 100);
    assert.strictEqual(a.workforce, 400);

    const occupiedForAlpha = deriveRegionalRecruitmentAvailability(state, 'region:test:B', 'polity:alpha').value;
    assert.deepStrictEqual(occupiedForAlpha, {
      regionId: 'region:test:B', polityId: 'polity:alpha', actualControllerPolityId: 'polity:alpha',
      hasControl: true, recruitmentAccessBp: 1000, eligiblePopulation: 400,
      mobilizedPersonnel: 200, obligatedMilitaryService: 0, recruitablePopulation: 40,
      unmobilizedRecruitablePopulation: 0,
      mobilizationCeiling: 40,
      availableManpower: 0,
    });
    const occupiedForLegalOwner = deriveRegionalRecruitmentAvailability(state, 'region:test:B', 'polity:beta').value;
    assert.strictEqual(occupiedForLegalOwner.hasControl, false);
    assert.strictEqual(occupiedForLegalOwner.recruitablePopulation, 0);
    assert.strictEqual(occupiedForLegalOwner.unmobilizedRecruitablePopulation, 0);
    assert.strictEqual(derivePolitySnapshot(state, 'polity:beta').value.fieldedPersonnel, 200);
  });

  it('keeps legitimate polity treasury and stockpiles out of territorial access calculations', () => {
    const state = stampWorldStateRevision(fixtureInput());
    const beta = derivePolitySnapshot(state, 'polity:beta').value;
    assert.strictEqual(beta.treasury, 700);
    assert.deepStrictEqual(beta.stockpiles, [{ commodityId: 'commodity:grain', quantity: 70 }]);
    assert.deepStrictEqual(beta.resourceAccess, [
      { resourceId: 'resource:grain', amount: 42 },
      { resourceId: 'resource:timber', amount: 32 },
    ]);
  });

  it('derives current recruitment capacity while leaving unavailable identity pressure explicit', () => {
    const state = stampWorldStateRevision(fixtureInput());
    const alpha = derivePolitySnapshot(state, 'polity:alpha').value;
    assert.strictEqual(alpha.recruitablePopulation, 240);
    assert.strictEqual(alpha.unmobilizedRecruitablePopulation, 100);
    assert.strictEqual(alpha.mobilizationCeiling, 240); // sum of current access-adjusted regional eligibility
    assert.strictEqual(alpha.availableManpower, 100); // regional capacity after all living mobilized origins
    assert.strictEqual(alpha.overmobilizedBy, 0); // Alpha fields 100 personnel against current capacity 240
    assert.deepStrictEqual(alpha.identityPressure, {
      status: 'unavailable',
      reason: 'requires identity-model inputs not present in WorldStateV2',
    });
    assert.ok(alpha.contributions.every((row) => !('identityPressure' in row)));
    assert.ok(alpha.contributions.every((row) => !('mobilizationCeiling' in row)));
    assert.ok(alpha.contributions.every((row) => !('availableManpower' in row)));
  });

  it('explains the conserved world population identity by deterministic region rows', () => {
    const state = stampWorldStateRevision(fixtureInput());
    const identity = deriveWorldPopulationIdentity(state);
    assert.strictEqual(identity.value.population, 10000);
    assert.strictEqual(identity.value.mobilizedPersonnel, 300);
    assert.strictEqual(identity.value.civilianPopulation, 9700);
    assert.strictEqual(identity.value.population, identity.value.civilianPopulation + identity.value.mobilizedPersonnel);
    assert.deepStrictEqual(identity.value.contributions.map((row) => row.regionId), [
      'region:test:A', 'region:test:B', 'region:test:C', 'region:test:D',
    ]);
  });

  it('is stable under set-like input permutations and emits sorted evidence', () => {
    const first = stampWorldStateRevision(fixtureInput());
    const permutedInput = fixtureInput();
    permutedInput.regions.reverse();
    permutedInput.populationCohorts.reverse();
    permutedInput.formations.reverse();
    permutedInput.evidence.reverse();
    permutedInput.catalogs.modules.reverse();
    permutedInput.catalogs.worldModels.reverse();
    permutedInput.catalogs.commodities.reverse();
    permutedInput.catalogs.controlProfiles.reverse();
    const second = stampWorldStateRevision(permutedInput);
    assert.deepStrictEqual(derivePolitySnapshot(first, 'polity:alpha'), derivePolitySnapshot(second, 'polity:alpha'));
    const evidenceIds = derivePolitySnapshot(first, 'polity:alpha').evidenceIds;
    assert.deepStrictEqual(evidenceIds, [...evidenceIds].sort());
  });

  it('fails closed for missing polity and region IDs', () => {
    const state = stampWorldStateRevision(fixtureInput());
    assert.throws(() => controlOf(state, 'region:test:missing'), /unknown region/i);
    assert.throws(() => deriveRegionSnapshot(state, 'region:test:missing'), /unknown region/i);
    assert.throws(() => regionsLegallyOwnedBy(state, 'polity:missing'), /unknown polity/i);
    assert.throws(() => regionsActuallyControlledBy(state, 'polity:missing'), /unknown polity/i);
    assert.throws(() => derivePolitySnapshot(state, 'polity:missing'), /unknown polity/i);
    assert.throws(
      () => deriveRegionalRecruitmentAvailability(state, 'region:test:A', 'polity:missing'),
      /unknown polity/i,
    );
  });
});

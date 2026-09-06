import { describe, it } from 'node:test';
import assert from 'node:assert';
import { regionIdSchema } from '@open-historia/domain';
import {
  allocatePersonnelByLargestRemainder,
  applyDemobilization,
  deriveMobilizationPreview,
  applyMobilization,
} from '../src/world/personnel.js';
import { stampWorldStateRevision } from '../src/world/revision.js';
import type { WorldStateV2Input } from '../src/world/schema.js';
import { derivePolitySnapshot, deriveWorldPopulationIdentity } from '../src/world/selectors.js';

const SEED = `sha256:${'1'.repeat(64)}` as const;

function input(): WorldStateV2Input {
  return {
    schemaVersion: 'open-historia-world/2', scenarioId: 'scenario:personnel-test',
    month: '1900-01-01', turn: 0, revisionLineage: { seedRevision: SEED, ancestorRevisions: [] },
    worldRules: {
      physicalModel: 'physical-model:test', knowledgeBaseline: [], communicationModel: 'communication-model:test',
      governmentModel: 'government-model:test', militaryModel: 'military-model:test', hardProhibitions: [], plausibilityContext: [],
    },
    modules: { enabled: ['module:military'] },
    catalogs: {
      modules: [{ moduleId: 'module:military' }],
      worldModels: [
        { modelId: 'physical-model:test', kind: 'physical' },
        { modelId: 'communication-model:test', kind: 'communication' },
        { modelId: 'government-model:test', kind: 'government' },
        { modelId: 'military-model:test', kind: 'military' },
      ], commodities: [],
      controlProfiles: [{ controlProfileId: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000, extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000 }],
      formationArchetypes: [{ formationArchetypeId: 'formation-archetype:army', equipmentClassIds: [] }],
      equipmentClasses: [], routeClasses: [],
    },
    polities: [{ id: 'polity:alpha', displayName: { en: 'Alpha' }, treasury: 0, stockpiles: [], evidenceIds: [] }],
    regions: ['A', 'B'].map((suffix) => ({
      regionId: `region:test:${suffix}` as `region:${string}`, displayName: { en: suffix },
      control: { legalOwnerPolityId: 'polity:alpha', actualControllerPolityId: 'polity:alpha', kind: 'sovereign' as const, controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000, extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000 },
      fiscalBase: 0, productiveCapacity: 0, supplyCapacity: 0, resourceDeposits: [], evidenceIds: [],
    })),
    populationCohorts: [
      { cohortId: 'cohort:a', regionId: 'region:test:A', population: 10_000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 10000, evidenceIds: [] },
      { cohortId: 'cohort:b', regionId: 'region:test:B', population: 10_000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 10000, evidenceIds: [] },
    ],
    formations: [{ formationId: 'formation:army', polityId: 'polity:alpha', archetypeId: 'formation-archetype:army', manpower: 1_000, personnelOrigins: [{ regionId: 'region:test:B', personnel: 400 }, { regionId: 'region:test:A', personnel: 600 }], equipment: [], evidenceIds: [] }],
    routes: [], characters: [], groups: [], institutions: [], concepts: [], processes: [], relationships: [],
    knowledge: { records: [] }, events: [], evidence: [],
  };
}

describe('personnel origins', () => {
  it('uses deterministic largest remainder allocation with stable regionId ties', () => {
    assert.deepStrictEqual(allocatePersonnelByLargestRemainder(1, [
      { regionId: regionIdSchema.parse('region:test:B'), personnel: 1 },
      { regionId: regionIdSchema.parse('region:test:A'), personnel: 1 },
    ]), [
      { regionId: 'region:test:A', personnel: 1 },
      { regionId: 'region:test:B', personnel: 0 },
    ]);
    assert.deepStrictEqual(allocatePersonnelByLargestRemainder(2, [
      { regionId: regionIdSchema.parse('region:test:B'), personnel: 1 },
      { regionId: regionIdSchema.parse('region:test:A'), personnel: 3 },
    ]), [
      { regionId: 'region:test:A', personnel: 2 },
      { regionId: 'region:test:B', personnel: 0 },
    ]);
  });

  it('demobilizes origin rows, restores workforce automatically and never adds population', () => {
    const before = stampWorldStateRevision(input());
    const populationBefore = deriveWorldPopulationIdentity(before).value.population;
    const workforceBefore = derivePolitySnapshot(before, 'polity:alpha').value.workforce;
    const result = applyDemobilization(before, {
      transitionId: 'personnel-transition:demobilize-test', formationId: 'formation:army', personnel: 250,
      expectedRevision: before.revision, authority: { orderId: 'order:demobilize-test' },
    });

    assert.strictEqual(result.state.formations[0]!.manpower, 750);
    assert.deepStrictEqual(result.ledgerRecord.originChanges, [
      { regionId: 'region:test:A', personnel: 150 },
      { regionId: 'region:test:B', personnel: 100 },
    ]);
    assert.deepStrictEqual(result.ledgerRecord.authority, { kind: 'order', orderId: 'order:demobilize-test' });
    assert.strictEqual(derivePolitySnapshot(result.state, 'polity:alpha').value.workforce, workforceBefore + 250);
    assert.strictEqual(deriveWorldPopulationIdentity(result.state).value.population, populationBefore);
    assert.ok(!('populationCausality' in result.state.events.at(-1)!));
  });

  it('mobilizes a bounded reserve from the best controlled recruitment region without changing population', () => {
    const before = stampWorldStateRevision(input());
    const populationBefore = deriveWorldPopulationIdentity(before).value.population;
    const workforceBefore = derivePolitySnapshot(before, 'polity:alpha').value.workforce;
    const result = applyMobilization(before, {
      transitionId: 'personnel-transition:mobilize-test', polityId: 'polity:alpha', expectedRevision: before.revision,
      authority: { orderId: 'order:mobilize-test' },
    });
    assert.deepStrictEqual(deriveMobilizationPreview(before, 'polity:alpha'), {
      polityId: 'polity:alpha', originRegionId: 'region:test:B', personnel: 100, archetypeId: 'formation-archetype:army',
    });
    assert.equal(result.originRegionId, 'region:test:B', 'the least-mobilized controlled region has more available recruits');
    assert.equal(result.personnel, 100, 'the reducer applies its bounded minimum rather than accepting a model number');
    assert.equal(result.state.formations.at(-1)?.personnelOrigins[0]?.personnel, 100);
    assert.equal(derivePolitySnapshot(result.state, 'polity:alpha').value.workforce, workforceBefore - 100);
    assert.equal(deriveWorldPopulationIdentity(result.state).value.population, populationBefore);
    assert.equal(result.state.events.at(-1)?.kind, 'personnel-mobilization');
  });
});

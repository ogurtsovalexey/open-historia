import { describe, it } from 'node:test';
import assert from 'node:assert';
import { applyCombatPersonnelLosses } from '../src/world/personnel.js';
import { parseWorldStateV2, type WorldStateV2Input } from '../src/world/schema.js';
import { stampWorldStateRevision } from '../src/world/revision.js';
import { deriveWorldPopulationIdentity } from '../src/world/selectors.js';

const SEED = `sha256:${'2'.repeat(64)}` as const;

function input(): WorldStateV2Input {
  const control = { legalOwnerPolityId: 'polity:alpha' as const, actualControllerPolityId: 'polity:alpha' as const, kind: 'sovereign' as const, controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000, extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000 };
  return {
    schemaVersion: 'open-historia-world/2', scenarioId: 'scenario:combat-causality', month: '1900-02-01', turn: 1,
    revisionLineage: { seedRevision: SEED, ancestorRevisions: [] },
    worldRules: { physicalModel: 'physical-model:test', knowledgeBaseline: [], communicationModel: 'communication-model:test', governmentModel: 'government-model:test', militaryModel: 'military-model:test', hardProhibitions: [], plausibilityContext: [] },
    modules: { enabled: ['module:military'] },
    catalogs: {
      modules: [{ moduleId: 'module:military' }],
      worldModels: [{ modelId: 'physical-model:test', kind: 'physical' }, { modelId: 'communication-model:test', kind: 'communication' }, { modelId: 'government-model:test', kind: 'government' }, { modelId: 'military-model:test', kind: 'military' }],
      commodities: [], controlProfiles: [{ controlProfileId: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000, extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000 }],
      formationArchetypes: [{ formationArchetypeId: 'formation-archetype:army', equipmentClassIds: [] }], equipmentClasses: [], routeClasses: [],
    },
    polities: [{ id: 'polity:alpha', displayName: { en: 'Alpha' }, treasury: 0, stockpiles: [], evidenceIds: [] }],
    regions: ['A', 'B'].map((suffix) => ({ regionId: `region:test:${suffix}` as `region:${string}`, displayName: { en: suffix }, control, fiscalBase: 0, productiveCapacity: 0, supplyCapacity: 0, resourceDeposits: [], evidenceIds: [] })),
    populationCohorts: [
      { cohortId: 'cohort:a-civil', regionId: 'region:test:A', population: 60_000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 10000, evidenceIds: [] },
      { cohortId: 'cohort:a-rural', regionId: 'region:test:A', population: 40_000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 10000, evidenceIds: [] },
      { cohortId: 'cohort:b-civil', regionId: 'region:test:B', population: 50_000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 10000, evidenceIds: [] },
      { cohortId: 'cohort:b-rural', regionId: 'region:test:B', population: 50_000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 10000, evidenceIds: [] },
    ],
    formations: [{ formationId: 'formation:army', polityId: 'polity:alpha', archetypeId: 'formation-archetype:army', manpower: 12_000, personnelOrigins: [{ regionId: 'region:test:A', personnel: 7_000 }, { regionId: 'region:test:B', personnel: 5_000 }], equipment: [], evidenceIds: [] }],
    routes: [], characters: [], groups: [], institutions: [], concepts: [], processes: [], relationships: [], knowledge: { records: [] }, events: [], evidence: [],
  };
}

describe('combat losses are population causality', () => {
  it('reduces formation, origins and living cohorts exactly once with distinct death columns', () => {
    const before = stampWorldStateRevision(input());
    const populationBefore = deriveWorldPopulationIdentity(before).value.population;
    const result = applyCombatPersonnelLosses(before, {
      transitionId: 'personnel-transition:battle-test', formationId: 'formation:army', combatDeaths: 10_000,
      expectedRevision: before.revision, authority: { warId: 'war:test', battleId: 'battle:test' },
    });

    assert.strictEqual(result.state.formations[0]!.manpower, 2_000);
    assert.deepStrictEqual(result.ledgerRecord.originChanges, [
      { regionId: 'region:test:A', personnel: 5_833 },
      { regionId: 'region:test:B', personnel: 4_167 },
    ]);
    assert.strictEqual(deriveWorldPopulationIdentity(result.state).value.population, populationBefore - 10_000);
    assert.strictEqual(result.state.populationCohorts.reduce((sum, cohort) => sum + cohort.population, 0), populationBefore - 10_000);
    assert.deepStrictEqual(result.state.populationCohorts.map(({ cohortId, population }) => ({ cohortId, population })), [
      { cohortId: 'cohort:a-civil', population: 56_500 },
      { cohortId: 'cohort:a-rural', population: 37_667 },
      { cohortId: 'cohort:b-civil', population: 47_916 },
      { cohortId: 'cohort:b-rural', population: 47_917 },
    ]);

    const event = result.state.events.at(-1)!;
    assert.deepStrictEqual(event.populationCausality?.totals, {
      births: 0, naturalDeaths: 0, combatDeaths: 10_000, migrationNet: 0, populationDelta: -10_000,
    });
    assert.strictEqual(event.populationCausality?.regions.reduce((sum, row) => sum + row.totals.combatDeaths, 0), 10_000);
    assert.strictEqual(event.populationCausality?.regions.flatMap((row) => row.cohorts).reduce((sum, row) => sum + row.combatDeaths, 0), 10_000);
    assert.deepStrictEqual(result.ledgerRecord.populationCausality, event.populationCausality);
    assert.deepStrictEqual(result.ledgerRecord.authority, { kind: 'combat', warId: 'war:test', battleId: 'battle:test' });
    assert.strictEqual(event.revision, before.revision);
    assert.deepStrictEqual(event.evidenceIds, result.ledgerRecord.evidenceIds);
    assert.strictEqual(result.ledgerRecord.revisionAfter, result.state.revision);
    assert.deepStrictEqual(parseWorldStateV2(structuredClone(result.state)), result.state);
  });
});

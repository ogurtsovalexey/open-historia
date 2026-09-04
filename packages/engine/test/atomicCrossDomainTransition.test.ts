import { describe, it } from 'node:test';
import assert from 'node:assert';
import { applyCombatPersonnelLosses } from '../src/world/personnel.js';
import { stampWorldStateRevision } from '../src/world/revision.js';
import type { WorldStateV2Input } from '../src/world/schema.js';
import { derivePolitySnapshot, deriveRegionSnapshot } from '../src/world/selectors.js';

const SEED = `sha256:${'4'.repeat(64)}` as const;

function input(): WorldStateV2Input {
  return {
    schemaVersion: 'open-historia-world/2', scenarioId: 'scenario:atomic-personnel', month: '1900-03-01', turn: 2,
    revisionLineage: { seedRevision: SEED, ancestorRevisions: [] },
    worldRules: { physicalModel: 'physical-model:test', knowledgeBaseline: [], communicationModel: 'communication-model:test', governmentModel: 'government-model:test', militaryModel: 'military-model:test', hardProhibitions: [], plausibilityContext: [] },
    modules: { enabled: ['module:military'] }, catalogs: {
      modules: [{ moduleId: 'module:military' }], worldModels: [{ modelId: 'physical-model:test', kind: 'physical' }, { modelId: 'communication-model:test', kind: 'communication' }, { modelId: 'government-model:test', kind: 'government' }, { modelId: 'military-model:test', kind: 'military' }], commodities: [],
      controlProfiles: [{ controlProfileId: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000, extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000 }], formationArchetypes: [{ formationArchetypeId: 'formation-archetype:army', equipmentClassIds: [] }], equipmentClasses: [], routeClasses: [],
    },
    polities: [{ id: 'polity:alpha', displayName: { en: 'Alpha' }, treasury: 0, stockpiles: [], evidenceIds: [] }],
    regions: [{ regionId: 'region:test:A', displayName: { en: 'A' }, control: { legalOwnerPolityId: 'polity:alpha', actualControllerPolityId: 'polity:alpha', kind: 'sovereign', controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000, extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000 }, fiscalBase: 100, productiveCapacity: 200, supplyCapacity: 300, resourceDeposits: [], evidenceIds: [] }],
    populationCohorts: [{ cohortId: 'cohort:a', regionId: 'region:test:A', population: 10_000, workforceParticipationBp: 10000, recruitmentEligibilityBp: 1000, evidenceIds: [] }],
    formations: [{ formationId: 'formation:army', polityId: 'polity:alpha', archetypeId: 'formation-archetype:army', manpower: 800, personnelOrigins: [{ regionId: 'region:test:A', personnel: 800 }], equipment: [], evidenceIds: [] }],
    routes: [], characters: [], groups: [], institutions: [], concepts: [], processes: [], relationships: [], knowledge: { records: [] }, events: [], evidence: [],
  };
}

describe('atomic cross-domain personnel transition', () => {
  it('commits military, cohort, workforce, recruitment, event and evidence under one revision', () => {
    const before = stampWorldStateRevision(input());
    const result = applyCombatPersonnelLosses(before, {
      transitionId: 'personnel-transition:atomic-loss', formationId: 'formation:army', combatDeaths: 300,
      authority: { warId: 'war:test', battleId: 'battle:atomic' }, expectedRevision: before.revision,
    });
    const region = deriveRegionSnapshot(result.state, 'region:test:A');
    const polity = derivePolitySnapshot(result.state, 'polity:alpha');

    assert.notStrictEqual(result.state.revision, before.revision);
    assert.deepStrictEqual(result.state.revisionLineage.ancestorRevisions, [before.revision]);
    assert.strictEqual(result.state.formations[0]!.manpower, 500);
    assert.strictEqual(result.state.populationCohorts[0]!.population, 9_700);
    assert.strictEqual(region.revision, result.state.revision);
    assert.strictEqual(polity.revision, result.state.revision);
    assert.strictEqual(region.value.workforce, 9_200); // deaths remove already-mobilized people, not another civilian worker
    assert.strictEqual(polity.value.mobilizationCeiling, 970); // current population eligibility, not an authored ceiling
    assert.strictEqual(polity.value.availableManpower, 470);
    assert.strictEqual(result.state.events.length, 1);
    assert.strictEqual(result.state.evidence.length, 1);
    assert.deepStrictEqual(result.state.events[0]!.evidenceIds, [result.state.evidence[0]!.evidenceId]);
  });

  it('rejects stale or impossible losses without mutating the input', () => {
    const state = stampWorldStateRevision(input());
    const snapshot = structuredClone(state);
    assert.throws(() => applyCombatPersonnelLosses(state, {
      transitionId: 'personnel-transition:stale', formationId: 'formation:army', combatDeaths: 1,
      authority: { warId: 'war:test', battleId: 'battle:stale' }, expectedRevision: SEED,
    }), /stale world revision/i);
    assert.deepStrictEqual(state, snapshot);
    assert.throws(() => applyCombatPersonnelLosses(state, {
      transitionId: 'personnel-transition:impossible', formationId: 'formation:army', combatDeaths: 801,
      authority: { warId: 'war:test', battleId: 'battle:impossible' }, expectedRevision: state.revision,
    }), /exceed formation manpower/i);
    assert.deepStrictEqual(state, snapshot);
  });
});

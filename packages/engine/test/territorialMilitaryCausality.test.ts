import { describe, it } from 'node:test';
import assert from 'node:assert';
import { polityIdSchema, regionIdSchema } from '@open-historia/domain';
import { applyTerritorialTransition } from '../src/world/control.js';
import { stampWorldStateRevision } from '../src/world/revision.js';
import type { WorldStateV2Input } from '../src/world/schema.js';
import { derivePolitySnapshot } from '../src/world/selectors.js';

const SEED = `sha256:${'3'.repeat(64)}` as const;
const ALPHA = polityIdSchema.parse('polity:alpha');
const BETA = polityIdSchema.parse('polity:beta');
const REGION_A = regionIdSchema.parse('region:test:A');
const REGION_B = regionIdSchema.parse('region:test:B');

function input(): WorldStateV2Input {
  const sovereign = (polityId: typeof ALPHA | typeof BETA) => ({ legalOwnerPolityId: polityId, actualControllerPolityId: polityId, kind: 'sovereign' as const, controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000, extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000 });
  return {
    schemaVersion: 'open-historia-world/2', scenarioId: 'scenario:territorial-military', month: '1900-01-01', turn: 0,
    revisionLineage: { seedRevision: SEED, ancestorRevisions: [] },
    worldRules: { physicalModel: 'physical-model:test', knowledgeBaseline: [], communicationModel: 'communication-model:test', governmentModel: 'government-model:test', militaryModel: 'military-model:test', hardProhibitions: [], plausibilityContext: [] },
    modules: { enabled: ['module:military'] }, catalogs: {
      modules: [{ moduleId: 'module:military' }], worldModels: [{ modelId: 'physical-model:test', kind: 'physical' }, { modelId: 'communication-model:test', kind: 'communication' }, { modelId: 'government-model:test', kind: 'government' }, { modelId: 'military-model:test', kind: 'military' }], commodities: [],
      controlProfiles: [{ controlProfileId: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000, extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000 }],
      formationArchetypes: [{ formationArchetypeId: 'formation-archetype:army', equipmentClassIds: [] }], equipmentClasses: [], routeClasses: [],
    },
    polities: [{ id: ALPHA, displayName: { en: 'Alpha' }, treasury: 0, stockpiles: [], evidenceIds: [] }, { id: BETA, displayName: { en: 'Beta' }, treasury: 0, stockpiles: [], evidenceIds: [] }],
    regions: [{ regionId: REGION_A, displayName: { en: 'A' }, control: sovereign(ALPHA), fiscalBase: 0, productiveCapacity: 0, supplyCapacity: 0, resourceDeposits: [], evidenceIds: [] }, { regionId: REGION_B, displayName: { en: 'B' }, control: sovereign(BETA), fiscalBase: 0, productiveCapacity: 0, supplyCapacity: 0, resourceDeposits: [], evidenceIds: [] }],
    populationCohorts: [{ cohortId: 'cohort:a', regionId: REGION_A, population: 1_000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 1000, evidenceIds: [] }, { cohortId: 'cohort:b', regionId: REGION_B, population: 2_000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 1000, evidenceIds: [] }],
    formations: [{ formationId: 'formation:alpha-army', polityId: ALPHA, archetypeId: 'formation-archetype:army', manpower: 100, personnelOrigins: [{ regionId: REGION_A, personnel: 100 }], equipment: [], evidenceIds: [] }],
    routes: [], characters: [], groups: [], institutions: [], concepts: [], processes: [], relationships: [], knowledge: { records: [] }, events: [], evidence: [],
  };
}

describe('territory and existing formations remain separate facts', () => {
  it('keeps a deployed formation with its polity and derives overmobilization from current control', () => {
    const before = stampWorldStateRevision(input());
    const controlBefore = before.regions[0]!.control;
    const result = applyTerritorialTransition(before, {
      transitionId: 'transition:loss-of-origin', regionId: REGION_A, kind: 'cede', expectedControl: controlBefore,
      targetControlProfileId: 'control-profile:sovereign', legalOwnerPolityId: BETA, actualControllerPolityId: BETA,
      authority: { kind: 'agreement', agreementId: 'agreement:cession' }, effectivePhase: 'opening', expectedRevision: before.revision,
    });
    const alpha = derivePolitySnapshot(result.state, 'polity:alpha').value;
    const beta = derivePolitySnapshot(result.state, 'polity:beta').value;

    assert.deepStrictEqual(result.state.formations, before.formations);
    assert.strictEqual(alpha.fieldedPersonnel, 100);
    assert.strictEqual(alpha.mobilizationCeiling, 0);
    assert.strictEqual(alpha.availableManpower, 0);
    assert.strictEqual(alpha.overmobilizedBy, 100);
    assert.strictEqual(beta.mobilizationCeiling, 300);
    assert.strictEqual(beta.availableManpower, 200);
    assert.strictEqual(beta.overmobilizedBy, 0);
  });
});

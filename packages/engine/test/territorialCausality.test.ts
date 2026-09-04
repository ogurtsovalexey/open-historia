import { describe, it } from 'node:test';
import assert from 'node:assert';
import { polityIdSchema, regionIdSchema, type PolityId } from '@open-historia/domain';
import { applyTerritorialTransition, type TerritorialTransition } from '../src/world/control.js';
import { stampWorldStateRevision } from '../src/world/revision.js';
import type { RegionalControl, WorldStateV2, WorldStateV2Input } from '../src/world/schema.js';
import {
  derivePolitySnapshot,
  regionsActuallyControlledBy,
  regionsLegallyOwnedBy,
} from '../src/world/selectors.js';

const SEED_REVISION = `sha256:${'1'.repeat(64)}` as const;
const ALPHA = polityIdSchema.parse('polity:alpha');
const BETA = polityIdSchema.parse('polity:beta');
const GAMMA = polityIdSchema.parse('polity:gamma');
const REGION_A = regionIdSchema.parse('region:test:A');

function fixtureInput(): WorldStateV2Input {
  return {
    schemaVersion: 'open-historia-world/2',
    scenarioId: 'scenario:territorial-causality',
    month: '1900-04-01',
    turn: 3,
    revisionLineage: { seedRevision: SEED_REVISION, ancestorRevisions: [] },
    worldRules: {
      physicalModel: 'physical-model:test', knowledgeBaseline: [],
      communicationModel: 'communication-model:test', governmentModel: 'government-model:test',
      militaryModel: 'military-model:test', hardProhibitions: [], plausibilityContext: [],
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
      commodities: [{ commodityId: 'commodity:grain', usage: 'regional' }],
      controlProfiles: [
        {
          controlProfileId: 'control-profile:occupation', kind: 'occupation',
          administrationAccessBp: 2500, extractionAccessBp: 4000,
          recruitmentAccessBp: 500, integrationBp: 0,
        },
        {
          controlProfileId: 'control-profile:sovereign', kind: 'sovereign',
          administrationAccessBp: 10000, extractionAccessBp: 10000,
          recruitmentAccessBp: 8000, integrationBp: 10000,
        },
      ],
      formationArchetypes: [{ formationArchetypeId: 'formation-archetype:generic', equipmentClassIds: [] }],
      equipmentClasses: [], routeClasses: [],
    },
    polities: [
      { id: 'polity:alpha', displayName: { en: 'Alpha' }, treasury: 100, stockpiles: [], evidenceIds: [] },
      { id: 'polity:beta', displayName: { en: 'Beta' }, treasury: 200, stockpiles: [], evidenceIds: [] },
      { id: 'polity:gamma', displayName: { en: 'Gamma' }, treasury: 300, stockpiles: [], evidenceIds: [] },
    ],
    regions: [
      {
        regionId: 'region:test:A', displayName: { en: 'A' },
        control: sovereignControl(ALPHA),
        fiscalBase: 1_000_000, productiveCapacity: 2_000_000, supplyCapacity: 500_000,
        resourceDeposits: [{ resourceId: 'commodity:grain', amount: 400_000 }], evidenceIds: [],
      },
      {
        regionId: 'region:test:B', displayName: { en: 'B' },
        control: sovereignControl(BETA),
        fiscalBase: 200_000, productiveCapacity: 300_000, supplyCapacity: 100_000,
        resourceDeposits: [{ resourceId: 'commodity:grain', amount: 50_000 }], evidenceIds: [],
      },
    ],
    populationCohorts: [
      {
        cohortId: 'cohort:a-residents', regionId: 'region:test:A', population: 10_000_000,
        workforceParticipationBp: 5000, recruitmentEligibilityBp: 1000, evidenceIds: [],
      },
      {
        cohortId: 'cohort:b-residents', regionId: 'region:test:B', population: 2_000_000,
        workforceParticipationBp: 5000, recruitmentEligibilityBp: 1000, evidenceIds: [],
      },
    ],
    formations: [{
      formationId: 'formation:alpha-field', polityId: 'polity:alpha', archetypeId: 'formation-archetype:generic', manpower: 100_000,
      personnelOrigins: [{ regionId: 'region:test:A', personnel: 100_000 }], equipment: [], evidenceIds: [],
    }],
    routes: [],
    characters: [], groups: [], institutions: [], concepts: [], processes: [], relationships: [],
    knowledge: { records: [] }, events: [], evidence: [],
  };
}

function sovereignControl(polityId: PolityId): RegionalControl {
  return {
    legalOwnerPolityId: polityId,
    actualControllerPolityId: polityId,
    kind: 'sovereign',
    controlProfileId: 'control-profile:sovereign',
    administrationAccessBp: 10000,
    extractionAccessBp: 10000,
    recruitmentAccessBp: 8000,
    integrationBp: 10000,
  };
}

function transition(
  state: WorldStateV2,
  overrides: Partial<TerritorialTransition> = {},
): TerritorialTransition {
  return {
    transitionId: 'transition:test-1',
    regionId: REGION_A,
    kind: 'cede',
    expectedControl: { ...state.regions.find((region) => region.regionId === 'region:test:A')!.control },
    targetControlProfileId: 'control-profile:sovereign',
    legalOwnerPolityId: BETA,
    actualControllerPolityId: BETA,
    authority: { kind: 'agreement', agreementId: 'agreement:test-cession' },
    effectivePhase: 'opening',
    expectedRevision: state.revision,
    ...overrides,
  };
}

function localRegionState(state: WorldStateV2) {
  const region = state.regions.find((entry) => entry.regionId === 'region:test:A')!;
  const { control: _control, ...local } = region;
  void _control;
  return local;
}

describe('territorial causality', () => {
  it('moves a ten-million-person region between legal and actual selector projections in one revision', () => {
    const before = stampWorldStateRevision(fixtureInput());
    const cohortsBefore = structuredClone(before.populationCohorts);
    const localBefore = localRegionState(before);
    const result = applyTerritorialTransition(before, transition(before));

    assert.notStrictEqual(result.state.revision, before.revision);
    assert.deepStrictEqual(regionsLegallyOwnedBy(result.state, 'polity:alpha'), []);
    assert.deepStrictEqual(regionsActuallyControlledBy(result.state, 'polity:alpha'), []);
    assert.deepStrictEqual(regionsLegallyOwnedBy(result.state, 'polity:beta'), ['region:test:A', 'region:test:B']);
    assert.deepStrictEqual(regionsActuallyControlledBy(result.state, 'polity:beta'), ['region:test:A', 'region:test:B']);
    assert.strictEqual(derivePolitySnapshot(before, 'polity:alpha').value.legalPopulation, 10_000_000);
    assert.strictEqual(derivePolitySnapshot(result.state, 'polity:alpha').value.legalPopulation, 0);
    assert.strictEqual(derivePolitySnapshot(before, 'polity:beta').value.legalPopulation, 2_000_000);
    assert.strictEqual(derivePolitySnapshot(result.state, 'polity:beta').value.legalPopulation, 12_000_000);
    assert.deepStrictEqual(result.state.populationCohorts, cohortsBefore);
    assert.deepStrictEqual(localRegionState(result.state), localBefore);
    assert.deepStrictEqual(result.affectedPolityIds, ['polity:alpha', 'polity:beta']);
  });

  it('distinguishes occupation from annexation and copies access only from declared profiles', () => {
    const initial = stampWorldStateRevision(fixtureInput());
    const occupied = applyTerritorialTransition(initial, transition(initial, {
      kind: 'occupy', legalOwnerPolityId: undefined, actualControllerPolityId: BETA,
      targetControlProfileId: 'control-profile:occupation',
      authority: { kind: 'combat', warId: 'war:test', frontId: 'front:test-a' }, effectivePhase: 'closing',
    }));
    const occupation = occupied.state.regions.find((region) => region.regionId === 'region:test:A')!.control;
    assert.deepStrictEqual(occupation, {
      legalOwnerPolityId: 'polity:alpha', actualControllerPolityId: 'polity:beta',
      kind: 'occupation', controlProfileId: 'control-profile:occupation',
      administrationAccessBp: 2500, extractionAccessBp: 4000, recruitmentAccessBp: 500, integrationBp: 0,
    });
    assert.strictEqual(derivePolitySnapshot(occupied.state, 'polity:alpha').value.legalPopulation, 10_000_000);
    assert.strictEqual(derivePolitySnapshot(occupied.state, 'polity:beta').value.controlledPopulation, 12_000_000);
    assert.strictEqual(derivePolitySnapshot(occupied.state, 'polity:beta').value.administeredPopulation, 4_500_000);

    const annexed = applyTerritorialTransition(initial, transition(initial, {
      kind: 'annex', authority: { kind: 'peace', offerId: 'offer:test-annexation' },
    }));
    const annexControl = annexed.state.regions.find((region) => region.regionId === 'region:test:A')!.control;
    assert.deepStrictEqual(annexControl, sovereignControl(BETA));
    assert.strictEqual(derivePolitySnapshot(annexed.state, 'polity:alpha').value.legalPopulation, 0);
    assert.strictEqual(derivePolitySnapshot(annexed.state, 'polity:beta').value.administeredPopulation, 12_000_000);
  });

  it('round-trips control without rewinding or changing region-local state', () => {
    const initial = stampWorldStateRevision(fixtureInput());
    const ceded = applyTerritorialTransition(initial, transition(initial)).state;
    const returned = applyTerritorialTransition(ceded, transition(ceded, {
      transitionId: 'transition:test-return', legalOwnerPolityId: ALPHA, actualControllerPolityId: ALPHA,
    })).state;
    assert.deepStrictEqual(returned.regions.find((region) => region.regionId === 'region:test:A')!.control, sovereignControl(ALPHA));
    assert.deepStrictEqual(localRegionState(returned), localRegionState(initial));
    assert.deepStrictEqual(returned.populationCohorts, initial.populationCohorts);
    assert.notStrictEqual(returned.revision, initial.revision);
    assert.ok(returned.revisionLineage.ancestorRevisions.includes(initial.revision));
    assert.ok(returned.revisionLineage.ancestorRevisions.includes(ceded.revision));
  });

  it('supports explicit GM control and restores legal control through liberation', () => {
    const initial = stampWorldStateRevision(fixtureInput());
    const editorOccupation = applyTerritorialTransition(initial, transition(initial, {
      kind: 'set-control', legalOwnerPolityId: undefined, actualControllerPolityId: BETA,
      targetControlProfileId: 'control-profile:occupation',
      authority: { kind: 'gm', interventionId: 'intervention:test-control' }, effectivePhase: 'opening',
    }));
    assert.strictEqual(editorOccupation.state.regions.find((region) => region.regionId === REGION_A)!.control.kind, 'occupation');

    const liberated = applyTerritorialTransition(editorOccupation.state, transition(editorOccupation.state, {
      transitionId: 'transition:test-liberate', kind: 'liberate',
      legalOwnerPolityId: undefined, actualControllerPolityId: ALPHA,
      authority: { kind: 'combat', warId: 'war:test', frontId: 'front:test-a' }, effectivePhase: 'closing',
    }));
    assert.deepStrictEqual(liberated.state.regions.find((region) => region.regionId === REGION_A)!.control, sovereignControl(ALPHA));
  });

  it('records authority, phase, before/after controls and both canonical revisions', () => {
    const state = stampWorldStateRevision(fixtureInput());
    const result = applyTerritorialTransition(state, transition(state));
    assert.deepStrictEqual(result.ledgerRecord.authority, { kind: 'agreement', agreementId: 'agreement:test-cession' });
    assert.strictEqual(result.ledgerRecord.effectivePhase, 'opening');
    assert.strictEqual(result.ledgerRecord.revisionBefore, state.revision);
    assert.strictEqual(result.ledgerRecord.revisionAfter, result.state.revision);
    assert.deepStrictEqual(result.ledgerRecord.controlBefore, sovereignControl(ALPHA));
    assert.deepStrictEqual(result.ledgerRecord.controlAfter, sovereignControl(BETA));
    assert.deepStrictEqual(result.ledgerRecord.evidenceIds, ['evidence:territorial-test-1']);
    assert.deepStrictEqual(result.state.events.at(-1), {
      eventId: 'event:territorial-test-1', revision: state.revision, kind: 'territorial-transition',
      entityRefs: ['polity:alpha', 'polity:beta', 'region:test:A'],
      evidenceIds: ['evidence:territorial-test-1'],
    });
    assert.deepStrictEqual(result.state.evidence.at(-1), {
      evidenceId: 'evidence:territorial-test-1', revision: state.revision, kind: 'territorial-transition',
      entityRefs: ['polity:alpha', 'polity:beta', 'region:test:A'],
      eventRefs: ['event:territorial-test-1'], canonicalPointers: ['/regions/0/control'], visibility: 'public',
    });
  });

  it('cedes legal sovereignty explicitly without erasing a third-party occupation', () => {
    const initial = stampWorldStateRevision(fixtureInput());
    const occupied = applyTerritorialTransition(initial, transition(initial, {
      transitionId: 'transition:third-party-occupation',
      kind: 'occupy', legalOwnerPolityId: undefined, actualControllerPolityId: BETA,
      targetControlProfileId: 'control-profile:occupation',
      authority: { kind: 'combat', warId: 'war:test', frontId: 'front:test-a' }, effectivePhase: 'closing',
    })).state;
    const ceded = applyTerritorialTransition(occupied, transition(occupied, {
      transitionId: 'transition:sovereignty-under-occupation',
      legalOwnerPolityId: GAMMA, actualControllerPolityId: BETA,
      targetControlProfileId: 'control-profile:occupation',
      authority: { kind: 'agreement', agreementId: 'agreement:test-sovereignty' }, effectivePhase: 'opening',
    }));
    assert.deepStrictEqual(ceded.state.regions.find((region) => region.regionId === REGION_A)!.control, {
      legalOwnerPolityId: GAMMA, actualControllerPolityId: BETA,
      kind: 'occupation', controlProfileId: 'control-profile:occupation',
      administrationAccessBp: 2500, extractionAccessBp: 4000, recruitmentAccessBp: 500, integrationBp: 0,
    });
    assert.deepStrictEqual(ceded.affectedPolityIds, ['polity:alpha', 'polity:beta', 'polity:gamma']);
  });

  it('rejects stale revisions, stale controls, undeclared profiles and contradictory semantics', () => {
    const state = stampWorldStateRevision(fixtureInput());
    assert.throws(() => applyTerritorialTransition(state, transition(state, {
      expectedRevision: SEED_REVISION,
    })), /stale world revision/i);
    assert.throws(() => applyTerritorialTransition(state, transition(state, {
      expectedControl: sovereignControl(BETA),
    })), /stale expected control/i);
    assert.throws(() => applyTerritorialTransition(state, transition(state, {
      targetControlProfileId: 'control-profile:invented',
    })), /undeclared control profile/i);
    assert.throws(() => applyTerritorialTransition(state, transition(state, {
      kind: 'occupy', legalOwnerPolityId: undefined, actualControllerPolityId: BETA,
      targetControlProfileId: 'control-profile:occupation',
      authority: { kind: 'combat', warId: 'war:test', frontId: 'front:test' }, effectivePhase: 'opening',
    })), /combat authority must take effect at closing/i);
    assert.throws(() => applyTerritorialTransition(state, transition(state, {
      kind: 'occupy', legalOwnerPolityId: undefined, actualControllerPolityId: BETA,
      targetControlProfileId: 'control-profile:sovereign',
      authority: { kind: 'combat', warId: 'war:test', frontId: 'front:test' }, effectivePhase: 'closing',
    })), /occupation control profile/i);
    assert.throws(() => applyTerritorialTransition(state, transition(state, {
      authority: { kind: 'combat', warId: '', frontId: 'front:test' } as never,
      effectivePhase: 'closing',
    })), /authority has invalid stable IDs/i);
    assert.throws(() => applyTerritorialTransition(state, transition(state, {
      transitionId: 'not-stable',
    })), /transitionId has invalid stable ID format/i);
    assert.throws(() => applyTerritorialTransition(state, transition(state, {
      actualControllerPolityId: undefined,
    })), /cede requires explicit actualControllerPolityId/i);
  });

  it('does not transfer formations when their origin region changes owner or controller', () => {
    const state = stampWorldStateRevision(fixtureInput());
    const formationBefore = structuredClone(state.formations[0]);
    const ceded = applyTerritorialTransition(state, transition(state)).state;
    assert.deepStrictEqual(ceded.formations[0], formationBefore);
    assert.strictEqual(derivePolitySnapshot(ceded, 'polity:alpha').value.fieldedPersonnel, 100_000);
    assert.strictEqual(derivePolitySnapshot(ceded, 'polity:beta').value.fieldedPersonnel, 0);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  canonicalWorldState,
  canonicalWorldStateText,
  nextRevisionLineage,
  stampWorldStateRevision,
  worldStateChecksum,
} from '../src/world/revision.js';
import { parseWorldStateV2, type WorldStateV2Input } from '../src/world/schema.js';
import { assertWorldStateV2Invariants } from '../src/world/invariants.js';
import { worldV2 } from '../src/index.js';

function worldInput(): WorldStateV2Input {
  const seedRevision = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
  return {
    schemaVersion: 'open-historia-world/2',
    scenarioId: 'scenario:world-v2-test',
    month: '1900-01-01',
    turn: 0,
    revisionLineage: { seedRevision, ancestorRevisions: [] },
    worldRules: {
      physicalModel: 'physical-model:test',
      knowledgeBaseline: ['concept:writing'],
      communicationModel: 'communication-model:test',
      governmentModel: 'government-model:test',
      militaryModel: 'military-model:test',
      hardProhibitions: [],
      plausibilityContext: ['development fixture'],
    },
    modules: { enabled: ['module:economy', 'module:military'] },
    catalogs: {
      modules: [{ moduleId: 'module:military' }, { moduleId: 'module:economy' }],
      worldModels: [
        { modelId: 'physical-model:test', kind: 'physical' },
        { modelId: 'communication-model:test', kind: 'communication' },
        { modelId: 'government-model:test', kind: 'government' },
        { modelId: 'military-model:test', kind: 'military' },
      ],
      commodities: [{ commodityId: 'commodity:grain', usage: 'both' }],
      controlProfiles: [
        {
          controlProfileId: 'control-profile:sovereign', kind: 'sovereign',
          administrationAccessBp: 10000, extractionAccessBp: 10000,
          recruitmentAccessBp: 10000, integrationBp: 10000,
        },
      ],
    },
    polities: [
      {
        id: 'polity:beta',
        displayName: { en: 'Beta' },
        treasury: 200,
        stockpiles: [{ commodityId: 'commodity:grain', quantity: 20 }],
        evidenceIds: ['evidence:polity-beta'],
      },
      {
        id: 'polity:alpha',
        displayName: { en: 'Alpha' },
        treasury: 100,
        stockpiles: [{ commodityId: 'commodity:grain', quantity: 10 }],
        evidenceIds: ['evidence:polity-alpha'],
      },
    ],
    regions: [
      {
        regionId: 'region:test:B',
        displayName: { en: 'B' },
        control: {
          legalOwnerPolityId: 'polity:beta',
          actualControllerPolityId: 'polity:beta',
          kind: 'sovereign',
          controlProfileId: 'control-profile:sovereign',
          administrationAccessBp: 10000,
          extractionAccessBp: 10000,
          recruitmentAccessBp: 10000,
          integrationBp: 10000,
        },
        fiscalBase: 200,
        productiveCapacity: 300,
        supplyCapacity: 400,
        resourceDeposits: [{ resourceId: 'commodity:grain', amount: 20 }],
        evidenceIds: ['evidence:region-b'],
      },
      {
        regionId: 'region:test:A',
        displayName: { en: 'A' },
        control: {
          legalOwnerPolityId: 'polity:alpha',
          actualControllerPolityId: 'polity:alpha',
          kind: 'sovereign',
          controlProfileId: 'control-profile:sovereign',
          administrationAccessBp: 10000,
          extractionAccessBp: 10000,
          recruitmentAccessBp: 10000,
          integrationBp: 10000,
        },
        fiscalBase: 100,
        productiveCapacity: 150,
        supplyCapacity: 250,
        resourceDeposits: [{ resourceId: 'commodity:grain', amount: 10 }],
        evidenceIds: ['evidence:region-a'],
      },
    ],
    populationCohorts: [
      { cohortId: 'cohort:b-workers', regionId: 'region:test:B', population: 2000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 1000, evidenceIds: ['evidence:cohort-b'] },
      { cohortId: 'cohort:a-workers', regionId: 'region:test:A', population: 1000, workforceParticipationBp: 5000, recruitmentEligibilityBp: 1000, evidenceIds: ['evidence:cohort-a'] },
    ],
    formations: [{ formationId: 'formation:alpha-first', polityId: 'polity:alpha', manpower: 100, personnelOrigins: [{ regionId: 'region:test:A', personnel: 100 }], evidenceIds: ['evidence:formation-alpha'] }],
    characters: [],
    groups: [],
    institutions: [],
    concepts: [{ conceptId: 'concept:writing', kind: 'practice', evidenceIds: ['evidence:concept-writing'] }],
    processes: [],
    relationships: [{ relationshipId: 'relationship:alpha-beta', kind: 'neutral', participantPolityIds: ['polity:beta', 'polity:alpha'], evidenceIds: ['evidence:relationship'] }],
    knowledge: { records: [{ polityId: 'polity:alpha', conceptId: 'concept:writing', evidenceIds: ['evidence:knowledge-alpha'] }] },
    events: [{ eventId: 'event:world-created', revision: seedRevision, kind: 'world-created', entityRefs: ['polity:alpha'], evidenceIds: ['evidence:event-world-created'] }],
    evidence: [
      ...['polity-alpha', 'polity-beta', 'region-a', 'region-b', 'cohort-a', 'cohort-b', 'formation-alpha', 'concept-writing', 'relationship', 'knowledge-alpha'].map((id) => ({ evidenceId: `evidence:${id}`, revision: seedRevision, kind: 'authored', entityRefs: [], eventRefs: [], canonicalPointers: [], visibility: 'public' as const })),
      { evidenceId: 'evidence:event-world-created', revision: seedRevision, kind: 'event', entityRefs: ['polity:alpha'], eventRefs: ['event:world-created'], canonicalPointers: ['/polities/0'], visibility: 'public' },
    ],
  };
}

describe('WorldStateV2 shell', () => {
  it('is exposed through an explicit public version namespace', () => {
    assert.strictEqual(worldV2.WORLD_STATE_V2_SCHEMA_VERSION, 'open-historia-world/2');
    assert.strictEqual(worldV2.WORLD_SEED_V2_SCHEMA_VERSION, 'open-historia-world-seed/2');
    assert.strictEqual(worldV2.parseWorldStateV2, parseWorldStateV2);
    assert.strictEqual(worldV2.stampWorldStateRevision, stampWorldStateRevision);
  });

  it('accepts only open-historia-world/2 and verifies its content-addressed revision', () => {
    const state = stampWorldStateRevision(worldInput());
    assert.deepStrictEqual(parseWorldStateV2(state), canonicalWorldState(state));
    assert.match(state.revision, /^sha256:[0-9a-f]{64}$/);

    assert.throws(() => parseWorldStateV2({ ...state, schemaVersion: 'open-historia-world/1' }), /schemaVersion|Invalid input/);
    assert.throws(() => parseWorldStateV2({ ...state, schemaVersion: 'open-historia-engine-econ/1' }), /schemaVersion|Invalid input/);
    assert.throws(() => parseWorldStateV2({ ...state, turn: 1 }), /revision mismatch/);
  });

  it('rejects writable duplicated national aggregates', () => {
    for (const forbidden of ['population', 'armySize', 'workforce', 'taxBase', 'manpowerPool']) {
      const input = worldInput() as WorldStateV2Input & { polities: Array<Record<string, unknown>> };
      input.polities[0]![forbidden] = 123;
      assert.throws(() => stampWorldStateRevision(input), /unrecognized key/i);
    }
  });

  it('canonicalizes every set-like collection independent of input order', () => {
    const first = stampWorldStateRevision(worldInput());
    const permuted = structuredClone(worldInput());
    permuted.polities.reverse();
    permuted.regions.reverse();
    permuted.populationCohorts.reverse();
    permuted.relationships[0]!.participantPolityIds.reverse();
    permuted.catalogs.modules.reverse();
    permuted.catalogs.worldModels.reverse();
    permuted.modules.enabled.reverse();
    permuted.evidence.reverse();
    const second = stampWorldStateRevision(permuted);

    assert.strictEqual(canonicalWorldStateText(first), canonicalWorldStateText(second));
    assert.strictEqual(worldStateChecksum(first), worldStateChecksum(second));
    assert.deepStrictEqual(canonicalWorldState(first), canonicalWorldState(second));
  });

  it('preserves causal lineage chronology instead of sorting revision hashes', () => {
    const input = worldInput();
    input.revisionLineage.ancestorRevisions = [
      `sha256:${'f'.repeat(64)}`,
      `sha256:${'2'.repeat(64)}`,
    ];
    const state = stampWorldStateRevision(input);

    assert.deepStrictEqual(state.revisionLineage.ancestorRevisions, input.revisionLineage.ancestorRevisions);
    assert.deepStrictEqual(nextRevisionLineage(state).ancestorRevisions, [
      ...input.revisionLineage.ancestorRevisions,
      state.revision,
    ]);
  });

  it('rejects duplicate IDs, malformed IDs, dangling references and inconsistent personnel origins', () => {
    const duplicate = worldInput();
    duplicate.regions.push(structuredClone(duplicate.regions[0]!));
    assert.throws(() => stampWorldStateRevision(duplicate), /duplicate region/i);

    const malformed = worldInput();
    malformed.populationCohorts[0]!.cohortId = 'not a cohort id';
    assert.throws(() => stampWorldStateRevision(malformed), /cohort/i);

    const dangling = worldInput();
    dangling.regions[0]!.control.actualControllerPolityId = 'polity:missing';
    assert.throws(() => stampWorldStateRevision(dangling), /unknown polity/i);

    const inconsistent = worldInput();
    inconsistent.formations[0]!.personnelOrigins[0]!.personnel = 99;
    assert.throws(() => stampWorldStateRevision(inconsistent), /personnel origins.*manpower/i);
  });

  it('exposes invariant checks separately for commit boundaries', () => {
    const state = stampWorldStateRevision(worldInput());
    assert.doesNotThrow(() => assertWorldStateV2Invariants(state));
  });

  it('fails catalog closure for undeclared modules, world models, resources and control profiles', () => {
    const undeclaredModule = worldInput();
    undeclaredModule.modules.enabled.push('module:politics');
    assert.throws(() => stampWorldStateRevision(undeclaredModule), /unknown module/i);

    const undeclaredModel = worldInput();
    undeclaredModel.worldRules.physicalModel = 'physical-model:invented';
    assert.throws(() => stampWorldStateRevision(undeclaredModel), /physical model/i);

    const wrongModelKind = worldInput();
    wrongModelKind.catalogs.worldModels.find((entry) => entry.modelId === 'physical-model:test')!.kind = 'government';
    assert.throws(() => stampWorldStateRevision(wrongModelKind), /not declared with kind physical/i);

    const undeclaredResource = worldInput();
    undeclaredResource.regions[0]!.resourceDeposits.push({ resourceId: 'resource:coal', amount: 1 });
    assert.throws(() => stampWorldStateRevision(undeclaredResource), /unknown regional commodity.*coal/i);

    const wrongCommodityKind = worldInput();
    wrongCommodityKind.catalogs.commodities[0]!.usage = 'stockpile';
    assert.throws(() => stampWorldStateRevision(wrongCommodityKind), /unknown regional commodity.*grain/i);

    const undeclaredProfile = worldInput();
    undeclaredProfile.regions[0]!.control.controlProfileId = 'control-profile:invented';
    assert.throws(() => stampWorldStateRevision(undeclaredProfile), /unknown control profile/i);
  });

  it('makes control profiles authoritative and rejects contradictory control semantics', () => {
    const mismatch = worldInput();
    mismatch.regions[0]!.control.recruitmentAccessBp = 9999;
    assert.throws(() => stampWorldStateRevision(mismatch), /does not match control profile/i);

    const contradictorySovereignty = worldInput();
    contradictorySovereignty.regions[1]!.control.actualControllerPolityId = 'polity:beta';
    assert.throws(() => stampWorldStateRevision(contradictorySovereignty), /sovereign control requires owner and controller to match/i);

    const contradictoryOccupation = worldInput();
    contradictoryOccupation.catalogs.controlProfiles[0]!.kind = 'occupation';
    contradictoryOccupation.regions[0]!.control.kind = 'occupation';
    contradictoryOccupation.regions[1]!.control.kind = 'occupation';
    assert.throws(() => stampWorldStateRevision(contradictoryOccupation), /occupation requires different owner and controller/i);
  });

  it('accepts evidence only from explicit nonzero causal lineage', () => {
    const invented = worldInput();
    invented.evidence[0]!.revision = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
    assert.throws(() => stampWorldStateRevision(invented), /revision is not in world lineage/i);

    const staleEvent = worldInput();
    staleEvent.events[0]!.revision = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';
    assert.throws(() => stampWorldStateRevision(staleEvent), /revision is not in world lineage/i);

    const zeroSeed = worldInput();
    zeroSeed.revisionLineage.seedRevision = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    assert.throws(() => stampWorldStateRevision(zeroSeed), /nonzero/i);

    const zeroEvidence = worldInput();
    zeroEvidence.evidence[0]!.revision = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    assert.throws(() => stampWorldStateRevision(zeroEvidence), /nonzero/i);
  });

  it('rejects selector-relevant aggregate overflow and unresolved canonical pointers', () => {
    const overflow = worldInput();
    overflow.populationCohorts[0]!.population = Number.MAX_SAFE_INTEGER;
    assert.throws(() => stampWorldStateRevision(overflow), /world population.*safe integer/i);

    const missingPointer = worldInput();
    missingPointer.evidence[0]!.canonicalPointers = ['/missing'];
    assert.throws(() => stampWorldStateRevision(missingPointer), /canonical pointer.*does not resolve/i);
  });

  it('rejects collectively overmobilized origins even when each formation is internally valid', () => {
    const input = worldInput();
    input.populationCohorts[1]!.population = 100;
    input.formations[0]!.manpower = 60;
    input.formations[0]!.personnelOrigins = [{ regionId: 'region:test:A', personnel: 60 }];
    input.formations.push({
      formationId: 'formation:alpha-second',
      polityId: 'polity:alpha',
      manpower: 60,
      personnelOrigins: [{ regionId: 'region:test:A', personnel: 60 }],
      evidenceIds: ['evidence:formation-alpha'],
    });
    assert.throws(() => stampWorldStateRevision(input), /personnel origins 120 exceed population 100/i);
  });
});

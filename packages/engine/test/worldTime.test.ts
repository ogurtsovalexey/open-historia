import { describe, it } from 'node:test';
import assert from 'node:assert';
import { advanceWorldMonth } from '../src/world/time.js';
import { stampWorldStateRevision, type WorldStateV2Input } from '../src/world/index.js';

function input(month = '1900-01-31'): WorldStateV2Input {
  const seed = `sha256:${'1'.repeat(64)}`;
  return {
    schemaVersion: 'open-historia-world/2', scenarioId: 'scenario:clock-test', month, turn: 0,
    revisionLineage: { seedRevision: seed, ancestorRevisions: [] },
    worldRules: {
      physicalModel: 'physical-model:test', knowledgeBaseline: [],
      communicationModel: 'communication-model:test', governmentModel: 'government-model:test',
      militaryModel: 'military-model:test', hardProhibitions: [], plausibilityContext: ['test'],
    },
    modules: { enabled: [] },
    catalogs: {
      modules: [],
      worldModels: [
        { modelId: 'physical-model:test', kind: 'physical' },
        { modelId: 'communication-model:test', kind: 'communication' },
        { modelId: 'government-model:test', kind: 'government' },
        { modelId: 'military-model:test', kind: 'military' },
      ],
      commodities: [], controlProfiles: [{
        controlProfileId: 'control-profile:sovereign', kind: 'sovereign',
        administrationAccessBp: 10000, extractionAccessBp: 10000,
        recruitmentAccessBp: 10000, integrationBp: 10000,
      }], formationArchetypes: [], equipmentClasses: [], routeClasses: [],
    },
    polities: [{ id: 'polity:alpha', displayName: { en: 'Alpha' }, treasury: 100, stockpiles: [], evidenceIds: ['evidence:alpha'] }],
    regions: [{
      regionId: 'region:test:alpha', displayName: { en: 'Alpha' },
      control: {
        legalOwnerPolityId: 'polity:alpha', actualControllerPolityId: 'polity:alpha', kind: 'sovereign',
        controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000,
        extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
      }, fiscalBase: 10, productiveCapacity: 20, supplyCapacity: 30, resourceDeposits: [], evidenceIds: ['evidence:region'],
    }],
    populationCohorts: [], formations: [], routes: [], characters: [], groups: [], institutions: [], concepts: [], processes: [], relationships: [],
    knowledge: { records: [] }, events: [], evidence: [
      { evidenceId: 'evidence:alpha', revision: seed, kind: 'authored', entityRefs: ['polity:alpha'], eventRefs: [], canonicalPointers: ['/polities/0'], visibility: 'public' },
      { evidenceId: 'evidence:region', revision: seed, kind: 'authored', entityRefs: ['region:test:alpha'], eventRefs: [], canonicalPointers: ['/regions/0'], visibility: 'public' },
    ],
  };
}

describe('WorldStateV2 clock', () => {
  it('advances one calendar month and records exact causal evidence without changing material values', () => {
    const before = stampWorldStateRevision(input());
    const result = advanceWorldMonth(before, { expectedRevision: before.revision });
    assert.equal(result.state.month, '1900-02-28');
    assert.equal(result.state.turn, 1);
    assert.equal(result.state.polities[0]?.treasury, 100);
    assert.equal(result.state.regions[0]?.productiveCapacity, 20);
    assert.deepEqual(result.state.revisionLineage.ancestorRevisions, [before.revision]);
    assert.equal(result.state.events.find((entry) => entry.eventId === result.eventId)?.kind, 'time-advanced');
    assert.equal(result.state.evidence.find((entry) => entry.evidenceId === result.evidenceId)?.kind, 'clock-transition');
  });

  it('handles year and leap boundaries deterministically and refuses stale commands', () => {
    const december = stampWorldStateRevision(input('1999-12-31'));
    const january = advanceWorldMonth(december, { expectedRevision: december.revision }).state;
    assert.equal(january.month, '2000-01-31');
    const february = advanceWorldMonth(january, { expectedRevision: january.revision }).state;
    assert.equal(february.month, '2000-02-29');
    assert.throws(() => advanceWorldMonth(february, { expectedRevision: january.revision }), /stale world revision/i);
  });
});

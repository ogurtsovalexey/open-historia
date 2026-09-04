import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  selectCausalBrief,
  selectEvidenceRegistry,
  validateEvidenceIdsForPolity,
} from '../src/world/evidence.js';
import { stampWorldStateRevision } from '../src/world/revision.js';
import type { WorldStateV2Input } from '../src/world/schema.js';

const SEED = `sha256:${'1'.repeat(64)}`;
const ANCESTOR = `sha256:${'2'.repeat(64)}`;

function input(): WorldStateV2Input {
  return {
    schemaVersion: 'open-historia-world/2',
    scenarioId: 'scenario:evidence-test',
    month: '1900-02-01',
    turn: 1,
    revisionLineage: { seedRevision: SEED, ancestorRevisions: [ANCESTOR] },
    worldRules: {
      physicalModel: 'physical-model:test', knowledgeBaseline: [],
      communicationModel: 'communication-model:test', governmentModel: 'government-model:test',
      militaryModel: 'military-model:test', hardProhibitions: [], plausibilityContext: [],
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
      commodities: [],
      controlProfiles: [{
        controlProfileId: 'control-profile:sovereign', kind: 'sovereign',
        administrationAccessBp: 10000, extractionAccessBp: 10000,
        recruitmentAccessBp: 10000, integrationBp: 10000,
      }],
    },
    polities: [
      { id: 'polity:beta', displayName: { en: 'Beta' }, treasury: 0, stockpiles: [], evidenceIds: ['evidence:beta'] },
      { id: 'polity:alpha', displayName: { en: 'Alpha' }, treasury: 0, stockpiles: [], evidenceIds: ['evidence:alpha'] },
    ],
    regions: [{
      regionId: 'region:test:A', displayName: { en: 'A' },
      control: {
        legalOwnerPolityId: 'polity:alpha', actualControllerPolityId: 'polity:alpha', kind: 'sovereign',
        controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000,
        extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
      },
      fiscalBase: 0, productiveCapacity: 0, supplyCapacity: 0, resourceDeposits: [],
      evidenceIds: ['evidence:public'],
    }],
    populationCohorts: [], formations: [], characters: [], groups: [], institutions: [], concepts: [],
    processes: [], relationships: [], knowledge: { records: [] },
    events: [
      { eventId: 'event:beta', revision: ANCESTOR, kind: 'beta-only', entityRefs: ['polity:beta'], evidenceIds: ['evidence:beta'] },
      { eventId: 'event:private', revision: ANCESTOR, kind: 'private-alpha', entityRefs: ['polity:alpha'], evidenceIds: ['evidence:private'] },
      { eventId: 'event:alpha', revision: ANCESTOR, kind: 'alpha-only', entityRefs: ['polity:alpha'], evidenceIds: ['evidence:alpha'] },
      { eventId: 'event:public', revision: SEED, kind: 'public-alpha', entityRefs: ['polity:alpha'], evidenceIds: ['evidence:public'] },
    ],
    evidence: [
      {
        evidenceId: 'evidence:private', revision: ANCESTOR, kind: 'private', entityRefs: ['polity:alpha'],
        eventRefs: ['event:private'], canonicalPointers: ['/polities/0'], visibility: 'private',
        visibleToPolityIds: ['polity:alpha'],
      },
      {
        evidenceId: 'evidence:editor', revision: ANCESTOR, kind: 'editor', entityRefs: ['polity:alpha'],
        eventRefs: [], canonicalPointers: [], visibility: 'editor', visibleToPolityIds: [],
      },
      {
        evidenceId: 'evidence:beta', revision: ANCESTOR, kind: 'owned', entityRefs: ['polity:beta'],
        eventRefs: ['event:beta'], canonicalPointers: ['/polities/1'], visibility: 'polity',
        visibleToPolityIds: ['polity:beta'],
      },
      {
        evidenceId: 'evidence:alpha', revision: ANCESTOR, kind: 'owned', entityRefs: ['polity:alpha'],
        eventRefs: ['event:alpha'], canonicalPointers: ['/polities/0'], visibility: 'polity',
        visibleToPolityIds: ['polity:beta', 'polity:alpha'],
      },
      {
        evidenceId: 'evidence:public', revision: SEED, kind: 'public', entityRefs: ['region:test:A'],
        eventRefs: ['event:public'], canonicalPointers: ['/regions/0'], visibility: 'public', visibleToPolityIds: [],
      },
    ],
  };
}

describe('WorldStateV2 evidence registry', () => {
  it('exposes only public and explicitly polity-visible evidence to a normal actor', () => {
    const state = stampWorldStateRevision(input());
    const registry = selectEvidenceRegistry(state, 'polity:alpha');
    assert.deepStrictEqual(registry.value.entries.map((entry) => entry.evidenceId), ['evidence:alpha', 'evidence:public']);
    assert.deepStrictEqual(registry.evidenceIds, ['evidence:alpha', 'evidence:public']);
  });

  it('rejects stale, unknown, cross-polity, private and editor evidence without accepting a subset silently', () => {
    const state = stampWorldStateRevision(input());
    const stale = validateEvidenceIdsForPolity(state, {
      polityId: 'polity:alpha', expectedRevision: ANCESTOR, evidenceIds: ['evidence:public'],
    });
    assert.strictEqual(stale.value.valid, false);
    assert.deepStrictEqual(stale.value.rejected, [{ evidenceId: 'evidence:public', reason: 'stale-revision' }]);

    const scoped = validateEvidenceIdsForPolity(state, {
      polityId: 'polity:alpha', expectedRevision: state.revision,
      evidenceIds: ['evidence:public', 'evidence:beta', 'evidence:private', 'evidence:editor', 'evidence:missing'],
    });
    assert.strictEqual(scoped.value.valid, false);
    assert.deepStrictEqual(scoped.value.acceptedEvidenceIds, ['evidence:public']);
    assert.deepStrictEqual(scoped.value.rejected, [
      { evidenceId: 'evidence:beta', reason: 'not-visible' },
      { evidenceId: 'evidence:editor', reason: 'not-visible' },
      { evidenceId: 'evidence:missing', reason: 'unknown-evidence' },
      { evidenceId: 'evidence:private', reason: 'not-visible' },
    ]);
  });

  it('accepts exact-revision public and owned evidence in deterministic ID order', () => {
    const state = stampWorldStateRevision(input());
    const result = validateEvidenceIdsForPolity(state, {
      polityId: 'polity:alpha', expectedRevision: state.revision,
      evidenceIds: ['evidence:public', 'evidence:alpha'],
    });
    assert.strictEqual(result.value.valid, true);
    assert.deepStrictEqual(result.value.acceptedEvidenceIds, ['evidence:alpha', 'evidence:public']);
    assert.deepStrictEqual(result.value.rejected, []);
  });

  it('builds a grounded, polity-relevant causal brief from a lineage revision', () => {
    const state = stampWorldStateRevision(input());
    const brief = selectCausalBrief(state, 'polity:alpha', SEED);
    assert.deepStrictEqual(brief.value.events.map((event) => event.eventId), ['event:public', 'event:alpha']);
    assert.deepStrictEqual(brief.value.evidence.map((entry) => entry.evidenceId), ['evidence:alpha', 'evidence:public']);
    assert.deepStrictEqual(brief.evidenceIds, ['evidence:alpha', 'evidence:public']);

    const current = selectCausalBrief(state, 'polity:alpha', state.revision);
    assert.deepStrictEqual(current.value.events, []);
    assert.deepStrictEqual(current.value.evidence, []);
    assert.throws(() => selectCausalBrief(state, 'polity:alpha', `sha256:${'9'.repeat(64)}`), /not in world lineage/i);
  });

  it('is byte-stable when events, evidence and visibility scopes arrive permuted', () => {
    const first = stampWorldStateRevision(input());
    const permuted = input();
    permuted.events.reverse();
    permuted.evidence.reverse();
    const alphaEvidence = permuted.evidence.find((entry) => entry.evidenceId === 'evidence:alpha')!;
    alphaEvidence.visibleToPolityIds = [...(alphaEvidence.visibleToPolityIds ?? [])].reverse();
    const second = stampWorldStateRevision(permuted);
    assert.deepStrictEqual(selectEvidenceRegistry(first, 'polity:alpha'), selectEvidenceRegistry(second, 'polity:alpha'));
    assert.deepStrictEqual(selectCausalBrief(first, 'polity:alpha', SEED), selectCausalBrief(second, 'polity:alpha', SEED));
  });

  it('rejects ambiguous visibility declarations at the state boundary', () => {
    const publicScoped = input();
    publicScoped.evidence.find((entry) => entry.evidenceId === 'evidence:public')!.visibleToPolityIds = ['polity:alpha'];
    assert.throws(() => stampWorldStateRevision(publicScoped), /public evidence.*must not declare polity visibility/i);

    const unowned = input();
    unowned.evidence.find((entry) => entry.evidenceId === 'evidence:alpha')!.visibleToPolityIds = [];
    assert.throws(() => stampWorldStateRevision(unowned), /polity evidence.*must declare at least one visible polity/i);
  });
});

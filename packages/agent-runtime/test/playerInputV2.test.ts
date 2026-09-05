import { describe, it } from 'node:test';
import assert from 'node:assert';
import { worldV2 } from '@open-historia/engine';
import {
  claimV2ModelSchema,
  interpretPlayerInputV2,
  requestedActionV2ModelSchema,
  type PlayerInputV2ModelInput,
} from '../src/playerInputV2.js';

const SEED = `sha256:${'1'.repeat(64)}`;

function state(): worldV2.WorldStateV2 {
  return worldV2.stampWorldStateRevision({
    schemaVersion: 'open-historia-world/2', scenarioId: 'scenario:input-v2-test', month: '1900-01-01', turn: 12,
    revisionLineage: { seedRevision: SEED, ancestorRevisions: [] },
    worldRules: {
      physicalModel: 'physical-model:test', knowledgeBaseline: [], communicationModel: 'communication-model:test',
      governmentModel: 'government-model:test', militaryModel: 'military-model:test',
      hardProhibitions: [], plausibilityContext: [],
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
      formationArchetypes: [],
      equipmentClasses: [],
      routeClasses: [],
      controlProfiles: [{
        controlProfileId: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000,
        extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
      }],
    },
    polities: [
      { id: 'polity:alpha', displayName: { en: 'Alpha' }, treasury: 100, stockpiles: [], evidenceIds: ['evidence:public'] },
      { id: 'polity:beta', displayName: { en: 'Beta' }, treasury: 100, stockpiles: [], evidenceIds: ['evidence:beta'] },
    ],
    regions: [
      {
        regionId: 'region:test:A', displayName: { en: 'A' },
        control: {
          legalOwnerPolityId: 'polity:alpha', actualControllerPolityId: 'polity:alpha', kind: 'sovereign',
          controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000,
          extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
        },
        fiscalBase: 10, productiveCapacity: 10, supplyCapacity: 10, resourceDeposits: [], evidenceIds: ['evidence:public'],
      },
      {
        regionId: 'region:test:B', displayName: { en: 'B' },
        control: {
          legalOwnerPolityId: 'polity:beta', actualControllerPolityId: 'polity:beta', kind: 'sovereign',
          controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000,
          extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
        },
        fiscalBase: 10, productiveCapacity: 10, supplyCapacity: 10, resourceDeposits: [], evidenceIds: ['evidence:beta'],
      },
    ],
    populationCohorts: [], formations: [], routes: [], characters: [], groups: [], institutions: [], concepts: [], processes: [],
    relationships: [], knowledge: { records: [] }, events: [],
    evidence: [
      {
        evidenceId: 'evidence:public', revision: SEED, kind: 'authored', entityRefs: ['polity:alpha', 'region:test:A'],
        eventRefs: [], canonicalPointers: ['/regions/0/control'], visibility: 'public',
      },
      {
        evidenceId: 'evidence:beta', revision: SEED, kind: 'authored', entityRefs: ['polity:beta', 'region:test:B'],
        eventRefs: [], canonicalPointers: ['/regions/1/control'], visibility: 'polity', visibleToPolityIds: ['polity:beta'],
      },
    ],
  });
}

const span = (source: string, text: string) => {
  const start = source.indexOf(text);
  return { start, end: start + text.length, text };
};

function baseOutput(revision: string): PlayerInputV2ModelInput {
  return { revision, questions: [], claims: [], requestedActions: [], proposedInitiatives: [] };
}

describe('PlayerInputInterpretationV2', () => {
  it('contradicts a fabricated old conquest and blocks recruitment that depends on it', () => {
    const world = state();
    const playerText = 'Ten turns ago I conquered B; recruit there now.';
    const output = baseOutput(world.revision);
    output.claims.push({
      claimId: 'claim:conquest', subject: 'polity:alpha', predicate: 'conquered-region',
      proposedValue: 'region:test:B', proposedTime: 'ten turns ago', sourceSpan: span(playerText, 'Ten turns ago I conquered B'),
      grounding: 'supported', evidenceIds: [],
    });
    output.requestedActions.push({
      actionId: 'action:recruit-b', domain: 'military', scope: 'domestic', intent: 'recruit in B',
      pace: 'slow', effectFamilies: ['recruitment-access.modify'],
      targetEntityIds: ['region:test:B'], claimRefs: ['claim:conquest'], evidenceIds: [],
      sourceSpan: span(playerText, 'recruit there now'),
    });

    const result = interpretPlayerInputV2(world, { actorPolityId: 'polity:alpha', playerText, modelOutput: output });
    assert.strictEqual(result.value.claims[0]!.grounding, 'contradicted');
    assert.strictEqual(result.value.requestedActions[0]!.status, 'blocked');
    assert.ok(result.value.requestedActions[0]!.reasons.includes('contradicted-claim:claim:conquest'));
    assert.strictEqual('command' in result.value.requestedActions[0]!, false);
  });

  it('treats an invented fifty-million-soldier assertion only as a contradicted claim and does not mutate state', () => {
    const world = state();
    const before = JSON.stringify(world);
    const playerText = 'I have 50 million soldiers.';
    const output = baseOutput(world.revision);
    output.claims.push({
      claimId: 'claim:army', subject: 'polity:alpha', predicate: 'fielded-personnel', proposedValue: 50_000_000,
      proposedTime: null, sourceSpan: span(playerText, playerText), grounding: 'supported', evidenceIds: [],
    });
    const result = interpretPlayerInputV2(world, { actorPolityId: 'polity:alpha', playerText, modelOutput: output });
    assert.strictEqual(result.value.claims[0]!.grounding, 'contradicted');
    assert.deepStrictEqual(result.value.requestedActions, []);
    assert.strictEqual(JSON.stringify(world), before);
  });

  it('rejects an unverifiable free-form claim predicate at the model boundary', () => {
    assert.throws(() => claimV2ModelSchema.parse({
      claimId: 'claim:fleet', subject: 'polity:alpha', predicate: 'destroyed-british-fleet-at-trafalgar',
      proposedValue: true, proposedTime: 'last year', sourceSpan: { start: 0, end: 1, text: 'x' },
      grounding: 'supported', evidenceIds: [],
    }), /invalid input/i);
  });

  it('requires a canonical region ID instead of a display name for territorial claims', () => {
    assert.throws(() => claimV2ModelSchema.parse({
      claimId: 'claim:malta', subject: 'polity:alpha', predicate: 'controls-region',
      proposedValue: 'Malta', proposedTime: null, sourceSpan: { start: 0, end: 1, text: 'x' },
      grounding: 'supported', evidenceIds: [],
    }), /invalid string/i);
  });

  it('rejects a false premise while preserving a separate valid domestic investment intention', () => {
    const world = state();
    const playerText = 'I conquered B. Invest in A.';
    const output = baseOutput(world.revision);
    output.claims.push({
      claimId: 'claim:false', subject: 'polity:alpha', predicate: 'controls-region', proposedValue: 'region:test:B',
      proposedTime: null, sourceSpan: span(playerText, 'I conquered B'), grounding: 'supported', evidenceIds: [],
    });
    output.requestedActions.push({
      actionId: 'action:invest-a', domain: 'economy', scope: 'domestic', intent: 'invest in A',
      pace: 'steady', effectFamilies: ['capacity.modify'],
      targetEntityIds: ['region:test:A'], claimRefs: [], evidenceIds: ['evidence:public'],
      sourceSpan: span(playerText, 'Invest in A'),
    });
    const result = interpretPlayerInputV2(world, { actorPolityId: 'polity:alpha', playerText, modelOutput: output });
    assert.strictEqual(result.value.claims[0]!.grounding, 'contradicted');
    assert.strictEqual(result.value.requestedActions[0]!.status, 'grounded');
    assert.deepStrictEqual(result.value.requestedActions[0]!.evidenceIds, ['evidence:public']);
  });

  it('fails closed on stale revision, unknown entities and cross-polity evidence', () => {
    const world = state();
    const stale = baseOutput(SEED);
    assert.throws(
      () => interpretPlayerInputV2(world, { actorPolityId: 'polity:alpha', playerText: '', modelOutput: stale }),
      /stale interpretation revision/i,
    );

    const playerText = 'Invest somewhere.';
    const output = baseOutput(world.revision);
    output.requestedActions.push({
      actionId: 'action:bad', domain: 'economy', scope: 'domestic', intent: 'invest somewhere',
      pace: 'steady', effectFamilies: ['capacity.modify'],
      targetEntityIds: ['region:test:missing'], claimRefs: [], evidenceIds: ['evidence:beta'],
      sourceSpan: span(playerText, playerText),
    });
    const result = interpretPlayerInputV2(world, { actorPolityId: 'polity:alpha', playerText, modelOutput: output });
    assert.strictEqual(result.value.requestedActions[0]!.status, 'blocked');
    assert.deepStrictEqual(result.value.requestedActions[0]!.reasons, [
      'evidence-not-visible:evidence:beta', 'unknown-entity:region:test:missing',
    ]);
  });

  it('grounds a typed territorial offer but rejects model-authored numeric access and undeclared relationship types', () => {
    const world = state();
    const playerText = 'Offer A to Beta.';
    const output = baseOutput(world.revision);
    output.requestedActions.push({
      actionId: 'action:offer-a', domain: 'diplomacy', scope: 'external', intent: 'offer A to Beta',
      pace: 'slow', effectFamilies: ['relation.modify'], targetEntityIds: ['region:test:A', 'polity:beta'], claimRefs: [], evidenceIds: ['evidence:public'],
      operation: { kind: 'territory.offer', recipientPolityId: 'polity:beta', regionId: 'region:test:A' }, sourceSpan: span(playerText, playerText),
    });
    const result = interpretPlayerInputV2(world, { actorPolityId: 'polity:alpha', playerText, modelOutput: output });
    assert.strictEqual(result.value.requestedActions[0]!.status, 'grounded');
    assert.throws(() => requestedActionV2ModelSchema.parse({
      ...output.requestedActions[0], operation: { kind: 'territory.offer', recipientPolityId: 'polity:beta', regionId: 'region:test:A', administrationAccessBp: 10000 },
    }), /unrecognized key/i);
    const invalidRelationship = structuredClone(output);
    invalidRelationship.requestedActions[0]!.operation = { kind: 'diplomacy.propose', recipientPolityIds: ['polity:beta'], relationshipTypeId: 'relationship-type:invented' };
    const blocked = interpretPlayerInputV2(world, { actorPolityId: 'polity:alpha', playerText, modelOutput: invalidRelationship });
    assert.ok(blocked.value.requestedActions[0]!.reasons.includes('undeclared-relationship-type:relationship-type:invented'));
  });

  it('repairs only an unambiguous verbatim source span with model-miscalculated offsets', () => {
    const world = state();
    const playerText = 'Investigate electrical phenomena.';
    const output = baseOutput(world.revision);
    output.requestedActions.push({
      actionId: 'action:electricity', domain: 'science', scope: 'domestic', intent: playerText,
      pace: 'slow', effectFamilies: ['knowledge.reveal'], targetEntityIds: ['polity:alpha'], claimRefs: [], evidenceIds: ['evidence:public'],
      // The literal clause is right, but these offsets are intentionally wrong.
      sourceSpan: { start: 4, end: playerText.length + 4, text: playerText },
    });
    const repaired = interpretPlayerInputV2(world, { actorPolityId: 'polity:alpha', playerText, modelOutput: output });
    assert.equal(repaired.value.requestedActions[0]!.status, 'grounded');
    assert.deepEqual(repaired.value.requestedActions[0]!.sourceSpan, { start: 0, end: playerText.length, text: playerText });

    const repeatedText = 'Investigate. Investigate.';
    const repeated = structuredClone(output);
    repeated.requestedActions[0]!.sourceSpan = { start: 9, end: 20, text: 'Investigate' };
    const blocked = interpretPlayerInputV2(world, { actorPolityId: 'polity:alpha', playerText: repeatedText, modelOutput: repeated });
    assert.ok(blocked.value.requestedActions[0]!.reasons.includes('invalid-source-span'));
  });
});

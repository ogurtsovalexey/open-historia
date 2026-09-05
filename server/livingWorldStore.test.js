import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { parseIntentFirstProjection } from '../src/Game/GameUI/intentFirstProjection.js';

let temporary;
let library;
let living;
let gameId;
let mesoGameId;

before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-living-store-'));
  process.env.OH_DATA_DIR = temporary;
  library = await import('./libraryStore.js');
  living = await import('./livingWorldStore.js');
  gameId = library.createGame({
    scenarioId: 'scenario:napoleonic-europe-1805',
    playerPolityId: 'polity:france',
    name: 'Living store test',
  }).game.id;
  mesoGameId = library.createGame({
    scenarioId: 'scenario:central-mesoamerica-1450',
    playerPolityId: 'polity:tenochtitlan',
    name: 'Living tribute test',
  }).game.id;
});

after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
  delete process.env.OH_DATA_DIR;
});

describe('living-world command store', () => {
  it('serves a strict intent-first projection derived from canonical state', () => {
    const view = living.readLivingWorld(gameId);
    const parsed = parseIntentFirstProjection(view.projection);
    assert.equal(parsed.playerPolity.polityId, 'polity:france');
    assert.equal(parsed.asOf, '1805-01-01');
    assert.ok(parsed.facts.some((entry) => entry.factId === 'fact:controlled-population' && entry.authority === 'derived'));
    assert.ok(parsed.facts.some((entry) => entry.factId === 'fact:fielded-personnel' && entry.authority === 'derived'));
  });

  it('projects scenario-local tribute obligations and their conserved-service opportunity cost', () => {
    const view = living.readLivingWorld(mesoGameId);
    const parsed = parseIntentFirstProjection(view.projection);
    assert.equal(parsed.playerPolity.polityId, 'polity:tenochtitlan');
    assert.ok(parsed.facts.some((entry) => entry.factId === 'fact:tribute-incoming' && /maize/i.test(entry.value)));
    assert.ok(parsed.diplomacy.commitments.some((entry) => /obligation-xochimilco-triple-alliance/.test(entry.commitmentId)));
    assert.ok(view.interpretationContext.entities.some((entry) => entry.entityId === 'obligation:xochimilco-triple-alliance' && entry.kind === 'tribute-obligation'));
    assert.doesNotMatch(JSON.stringify(parsed).toLowerCase(), /(?:^|[^a-z])(gdp|bonds?|unemployment)(?:[^a-z]|$)/);
  });

  it('keeps untrusted past claims out of canonical history and requires confirmation', () => {
    const before = living.readLivingWorld(gameId);
    const playerText = 'I conquered Hanover ten turns ago\nDevelop electricity';
    const firstLine = 'I conquered Hanover ten turns ago';
    const secondLine = 'Develop electricity';
    const hanover = before.interpretationContext.entities.find((entry) => entry.kind === 'region' && /hanover/i.test(entry.label));
    const actorEvidence = before.interpretationContext.entities.find((entry) => entry.entityId === 'polity:france').evidenceIds[0];
    assert.ok(hanover);
    assert.ok(actorEvidence);
    const submitted = living.submitLivingWorldIntent(gameId, {
      revision: before.projection.revision,
      sessionRevision: before.sessionRevision,
      intentions: playerText.split('\n'),
      modelOutput: {
        revision: before.projection.revision,
        questions: [],
        claims: [{
          claimId: 'claim:old-conquest',
          subject: 'polity:france',
          predicate: 'conquered-region',
          proposedValue: hanover.entityId,
          proposedTime: 'ten turns ago',
          sourceSpan: { start: 0, end: firstLine.length, text: firstLine },
          grounding: 'supported',
          evidenceIds: hanover.evidenceIds,
        }],
        requestedActions: [],
        proposedInitiatives: [{
          initiativeId: 'initiative:electricity',
          kind: 'technology',
          name: 'Electricity',
          description: 'Investigate controlled electrical phenomena.',
          pace: 'steady',
          effectFamilies: ['capacity.modify'],
          targetEntityIds: ['polity:france'],
          evidenceIds: [actorEvidence],
          sourceSpan: {
            start: firstLine.length + 1,
            end: playerText.length,
            text: secondLine,
          },
        }],
      },
    });
    const parsed = parseIntentFirstProjection(submitted.projection);
    assert.equal(parsed.revision, before.projection.revision);
    assert.equal(parsed.interpretation.confirmationRequired, true);
    assert.equal(parsed.interpretation.claims[0].status, 'contradicted');
    assert.match(parsed.interpretation.claims[0].explanation, /contradicts/i);
    assert.equal(parsed.interpretation.proposedInitiatives[0].material, true);
    assert.throws(() => living.advanceLivingWorld(gameId, {
      revision: submitted.projection.revision,
      sessionRevision: submitted.sessionRevision,
      optionId: 'advance-one-month',
    }), /confirm or revise/i);
  });

  it('advances one canonical month after confirmation and rejects stale sessions', () => {
    const pending = living.readLivingWorld(gameId);
    const confirmed = living.confirmLivingWorldIntent(gameId, {
      revision: pending.projection.revision,
      sessionRevision: pending.sessionRevision,
      interpretationId: pending.projection.interpretation.interpretationId,
    });
    assert.notEqual(confirmed.projection.revision, pending.projection.revision);
    assert.equal(confirmed.projection.processes.length, 1);
    assert.equal(confirmed.projection.processes[0].name, 'Electricity');
    assert.equal(confirmed.projection.processes[0].pace, 'steady');
    assert.match(confirmed.projection.facts.find((entry) => entry.factId === 'fact:treasury').value, /^[0-9,]+$/u);
    const advanced = living.advanceLivingWorld(gameId, {
      revision: confirmed.projection.revision,
      sessionRevision: confirmed.sessionRevision,
      optionId: 'advance-one-month',
    });
    const parsed = parseIntentFirstProjection(advanced.projection);
    assert.equal(parsed.asOf, '1805-02-01');
    assert.equal(parsed.interpretation, null);
    assert.equal(parsed.briefing.changes[0].authority, 'canonical');
    assert.throws(() => living.advanceLivingWorld(gameId, {
      revision: confirmed.projection.revision,
      sessionRevision: confirmed.sessionRevision,
      optionId: 'advance-one-month',
    }), /stale/i);
  });
});

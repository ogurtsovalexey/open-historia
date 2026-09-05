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

function hold(task) {
  const evidenceId = task.brief.evidence[0].evidenceId;
  return {
    taskKey: task.taskKey,
    status: 'succeeded',
    modelOutput: {
      polityId: task.actorPolityId,
      revision: task.brief.revision,
      selectedChoiceIds: [], processDecisions: [], initiativeProposals: [],
      durablePlan: { objective: `Preserve ${task.brief.actor.name}.`, goals: [], commitments: [], revisit: 'Review when material conditions change.' },
      evidenceIds: [evidenceId],
      hold: { reason: 'no-legal-action', detail: 'No legal material action is needed.', revisit: 'when-blocker-changes' },
    },
  };
}

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

  it('blocks a failed required strategy at the same world revision, then retries atomically', () => {
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
    const failedTask = confirmed.strategicTasks[0];
    assert.ok(failedTask);
    const blocked = living.advanceLivingWorld(gameId, {
      revision: confirmed.projection.revision,
      sessionRevision: confirmed.sessionRevision,
      optionId: 'advance-one-month',
      strategicAttempts: confirmed.strategicTasks.map((task) => task.taskKey === failedTask.taskKey
        ? { taskKey: task.taskKey, status: 'failed', message: 'temporary provider failure' }
        : hold(task)),
    });
    assert.equal(blocked.projection.revision, confirmed.projection.revision);
    assert.equal(blocked.projection.asOf, confirmed.projection.asOf);
    assert.equal(blocked.projection.strategicCheckpoint.blockedTasks[0].taskKey, failedTask.taskKey);
    const advanced = living.advanceLivingWorld(gameId, {
      revision: blocked.projection.revision,
      sessionRevision: blocked.sessionRevision,
      optionId: 'advance-one-month',
      strategicAttempts: blocked.strategicTasks.map(hold),
    });
    const parsed = parseIntentFirstProjection(advanced.projection);
    assert.equal(parsed.asOf, '1805-02-01');
    assert.equal(parsed.strategicCheckpoint, null);
    assert.equal(parsed.interpretation, null);
    assert.equal(parsed.briefing.changes[0].authority, 'canonical');
    assert.throws(() => living.advanceLivingWorld(gameId, {
      revision: confirmed.projection.revision,
      sessionRevision: confirmed.sessionRevision,
      optionId: 'advance-one-month',
    }), /stale/i);
  });

  it('creates a territory offer without immediate transfer and lets only its recipient accept the frozen choice', () => {
    const before = living.readLivingWorld(gameId);
    const region = before.interpretationContext.entities.find((entry) => entry.kind === 'region' && entry.legalOwnerPolityId === 'polity:france' && entry.actualControllerPolityId === 'polity:france');
    const evidenceId = before.interpretationContext.entities.find((entry) => entry.entityId === 'polity:france').evidenceIds[0];
    assert.ok(region && evidenceId);
    const text = `Offer ${region.label} to Austria.`;
    const submitted = living.submitLivingWorldIntent(gameId, {
      revision: before.projection.revision, sessionRevision: before.sessionRevision, intentions: [text],
      modelOutput: {
        revision: before.projection.revision, questions: [], claims: [], proposedInitiatives: [],
        requestedActions: [{
          actionId: 'action:offer-region', domain: 'diplomacy', scope: 'external', intent: text, pace: 'slow',
          effectFamilies: ['relation.modify'], targetEntityIds: [region.entityId, 'polity:austria'], claimRefs: [], evidenceIds: [evidenceId],
          operation: { kind: 'territory.offer', recipientPolityId: 'polity:austria', regionId: region.entityId },
          sourceSpan: { start: 0, end: text.length, text },
        }],
      },
    });
    const confirmed = living.confirmLivingWorldIntent(gameId, {
      revision: submitted.projection.revision, sessionRevision: submitted.sessionRevision,
      interpretationId: submitted.projection.interpretation.interpretationId,
    });
    assert.equal(confirmed.interpretationContext.entities.find((entry) => entry.entityId === region.entityId).legalOwnerPolityId, 'polity:france');
    const austriaTask = confirmed.strategicTasks.find((task) => task.actorPolityId === 'polity:austria');
    assert.ok(austriaTask);
    const acceptChoice = austriaTask.brief.frozenChoices.find((choice) => choice.choiceId.startsWith('choice:proposal-accept-'));
    assert.ok(acceptChoice);
    const advanced = living.advanceLivingWorld(gameId, {
      revision: confirmed.projection.revision, sessionRevision: confirmed.sessionRevision, optionId: 'advance-one-month',
      strategicAttempts: confirmed.strategicTasks.map((task) => task.taskKey === austriaTask.taskKey ? {
        taskKey: task.taskKey, status: 'succeeded', modelOutput: {
          polityId: task.actorPolityId, revision: task.brief.revision, selectedChoiceIds: [acceptChoice.choiceId], processDecisions: [], initiativeProposals: [],
          durablePlan: { objective: 'Answer the published proposal.', goals: [], commitments: [], revisit: 'Review changed conditions.' },
          evidenceIds: [acceptChoice.factsUsed[0]], hold: null,
        },
      } : hold(task)),
    });
    assert.equal(advanced.interpretationContext.entities.find((entry) => entry.entityId === region.entityId).legalOwnerPolityId, 'polity:austria');
  });
});

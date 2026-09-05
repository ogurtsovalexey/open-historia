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
let mesoLongGameId;
let skippedStrategyGameId;
let russianIntentGameId;
let duplicateCandidateGameId;
let resolveLivingWorldSubmonths;
let readEngineSession;
let buildPlayerIntentContext;

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
  ({ resolveLivingWorldSubmonths } = living);
  ({ readEngineSession } = await import('./engineSessionStore.js'));
  ({ buildPlayerIntentContext } = await import('./livingWorldProjection.js'));
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
  mesoLongGameId = library.createGame({
    scenarioId: 'scenario:central-mesoamerica-1450',
    playerPolityId: 'polity:tenochtitlan',
    name: 'Living thirty-month test',
  }).game.id;
  skippedStrategyGameId = library.createGame({
    scenarioId: 'scenario:napoleonic-europe-1805',
    playerPolityId: 'polity:france',
    name: 'Living explicit strategy skip test',
  }).game.id;
  russianIntentGameId = library.createGame({
    scenarioId: 'scenario:napoleonic-europe-1805',
    playerPolityId: 'polity:france',
    name: 'Living Russian intent test',
  }).game.id;
  duplicateCandidateGameId = library.createGame({
    scenarioId: 'scenario:napoleonic-europe-1805',
    playerPolityId: 'polity:france',
    name: 'Living duplicate candidate test',
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

  it('keeps a growing player semantic index bounded without dropping actor-owned regions', () => {
    const session = readEngineSession(library.getGameDirectory(gameId));
    const expanded = structuredClone(session);
    const evidenceId = expanded.state.polities.find((entry) => entry.id === 'polity:france').evidenceIds[0];
    for (let index = 0; index < 80; index += 1) {
      expanded.state.processes.push({
        processId: `process:test-context-${String(index).padStart(3, '0')}`,
        sponsorEntityRefs: ['polity:france'],
        kind: 'project',
        status: 'proposed',
        evidenceIds: [evidenceId],
      });
    }
    const context = buildPlayerIntentContext({ session: expanded, playerPolityId: 'polity:france' });
    assert.ok(JSON.stringify(context).length < 50_000);
    assert.equal(context.entities.filter((entry) => entry.kind === 'process').length, 24);
    assert.ok(context.entities.some((entry) => entry.entityId === 'polity:france'));
    assert.ok(context.entities.some((entry) => (
      entry.kind === 'region' && entry.actualControllerPolityId === 'polity:france'
    )));
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

  it('advances one player decision through three atomic monthly tribute settlements', () => {
    const before = living.readLivingWorld(mesoGameId);
    assert.equal(before.projection.time.options[0].optionId, 'advance-three-months');
    assert.equal(before.playerDecisionIndex, 0);
    const advanced = living.advanceLivingWorld(mesoGameId, {
      revision: before.projection.revision, sessionRevision: before.sessionRevision,
      optionId: 'advance-three-months', strategicAttempts: before.strategicTasks.map(hold),
      strategicModelMetadata: { provider: 'codex-subscription', model: 'gpt-5.6-luna', effort: 'low', apiKey: 'not-persisted' },
    });
    assert.equal(advanced.projection.asOf, '1450-04-01');
    assert.equal(advanced.playerDecisionIndex, 1);
    assert.equal(advanced.lastTransition.submonths.length, 3);
    assert.deepEqual(advanced.projection.time.completedSubmonths, 3);
    assert.equal(advanced.lastTransition.submonths.flatMap((month) => month.tributeSettlements).length, 3);
    assert.deepStrictEqual(advanced.lastTransition.submonths.map((month) => month.monthAfter), ['1450-02-01', '1450-03-01', '1450-04-01']);
    assert.deepEqual(advanced.lastTransition.modelMetadata, {
      role: 'strategic', provider: 'codex-subscription', model: 'gpt-5.6-luna', effort: 'low',
    });
  });

  it('reaches thirty deterministic monthly boundaries after ten player decisions', () => {
    let view = living.readLivingWorld(mesoLongGameId);
    const startRevision = view.projection.revision;
    for (let decision = 0; decision < 10; decision += 1) {
      view = living.advanceLivingWorld(mesoLongGameId, {
        revision: view.projection.revision, sessionRevision: view.sessionRevision,
        optionId: 'advance-three-months', strategicAttempts: view.strategicTasks.map(hold),
      });
    }
    assert.notEqual(view.projection.revision, startRevision);
    assert.equal(view.projection.asOf, '1452-07-01');
    assert.equal(view.playerDecisionIndex, 10);
    assert.equal(view.lastTransition.submonths.length, 3);
  });

  it('requires an explicit strategic skip and records no hidden model decision', () => {
    const initial = living.readLivingWorld(skippedStrategyGameId);
    const blocked = living.advanceLivingWorld(skippedStrategyGameId, {
      revision: initial.projection.revision,
      sessionRevision: initial.sessionRevision,
      optionId: 'advance-three-months',
      strategicAttempts: [],
    });
    assert.equal(blocked.projection.asOf, initial.projection.asOf);
    assert.ok(blocked.projection.strategicCheckpoint?.blockedTasks.length > 0);
    const resumed = living.advanceLivingWorld(skippedStrategyGameId, {
      revision: blocked.projection.revision,
      sessionRevision: blocked.sessionRevision,
      optionId: 'advance-three-months',
      strategicDisposition: 'continue-without-decisions',
    });
    assert.equal(resumed.projection.asOf, '1805-04-01');
    assert.equal(resumed.playerDecisionIndex, 1);
    assert.equal(resumed.lastTransition.strategicRecords.every((record) => record.status === 'skipped'), true);
    assert.equal(resumed.lastTransition.strategicRecords.every((record) => record.materializedProcessIds.length === 0), true);
    assert.equal(resumed.lastTransition.strategicRecords.every((record) =>
      record.errors.includes('Explicitly continued without this required strategic decision.')), true);
  });

  it('does not expose a partial local batch when its second monthly settlement fails', () => {
    const before = living.readLivingWorld(mesoGameId);
    const state = readEngineSession(library.getGameDirectory(mesoGameId)).state;
    let calls = 0;
    assert.throws(() => resolveLivingWorldSubmonths(state, 3, (input) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated month two failure');
      return { state: input, record: { monthBefore: input.month, monthAfter: input.month, revisionBefore: input.revision, revisionAfter: input.revision } };
    }), /month two failure/i);
    assert.equal(calls, 2);
    assert.equal(readEngineSession(library.getGameDirectory(mesoGameId)).state.revision, before.projection.revision);
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
      modelMetadata: { provider: 'codex-subscription', model: 'gpt-5.6-luna', effort: 'low', endpoint: 'not-persisted' },
    });
    const parsed = parseIntentFirstProjection(submitted.projection);
    assert.equal(parsed.revision, before.projection.revision);
    assert.equal(parsed.interpretation.confirmationRequired, true);
    assert.equal(parsed.interpretation.claims[0].status, 'contradicted');
    assert.match(parsed.interpretation.claims[0].explanation, /contradicts/i);
    assert.equal(parsed.interpretation.proposedInitiatives[0].material, true);
    assert.deepEqual(readEngineSession(library.getGameDirectory(gameId)).playerIntent.modelMetadata, {
      role: 'utility', provider: 'codex-subscription', model: 'gpt-5.6-luna', effort: 'low',
    });
    assert.throws(() => living.advanceLivingWorld(gameId, {
      revision: submitted.projection.revision,
      sessionRevision: submitted.sessionRevision,
      optionId: 'advance-one-month',
    }), /confirm or revise/i);
  });

  it('materializes a Russian-language proposal without requiring the model to invent an English semantic key', () => {
    const before = living.readLivingWorld(russianIntentGameId);
    const actorEvidence = before.interpretationContext.entities.find((entry) => entry.entityId === 'polity:france').evidenceIds[0];
    const text = 'Сосредоточить действующую армию на Рейне.';
    const submitted = living.submitLivingWorldIntent(russianIntentGameId, {
      revision: before.projection.revision,
      sessionRevision: before.sessionRevision,
      intentions: [text],
      modelOutput: {
        revision: before.projection.revision, questions: [], claims: [], proposedInitiatives: [],
        requestedActions: [{
          actionId: 'action:concentrate-rhine', domain: 'military', scope: 'domestic', intent: text, pace: 'steady',
          effectFamilies: ['capacity.modify'], targetEntityIds: ['polity:france'], claimRefs: [], evidenceIds: [actorEvidence],
          operation: { kind: 'process.propose' }, sourceSpan: { start: 0, end: text.length, text },
        }],
      },
    });
    const confirmed = living.confirmLivingWorldIntent(russianIntentGameId, {
      revision: submitted.projection.revision,
      sessionRevision: submitted.sessionRevision,
      interpretationId: submitted.projection.interpretation.interpretationId,
    });
    const concept = readEngineSession(library.getGameDirectory(russianIntentGameId)).state.concepts.find((entry) => entry.displayName.ru === 'Сосредоточить действующую армию на Рейне.');
    assert.ok(concept);
    assert.match(concept.semanticKey, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(confirmed.projection.processes[0].name, 'sosredotochit-deistvuyushchuyu-armiyu-na-reine');
    assert.equal(confirmed.projection.processes[0].nameRu, 'Сосредоточить действующую армию на Рейне.');
    assert.equal(living.readLivingWorld(russianIntentGameId, { locale: 'ru' }).projection.processes[0].name, 'Сосредоточить действующую армию на Рейне.');
  });

  it('materializes one process when a model duplicates one source span as action and initiative', () => {
    const before = living.readLivingWorld(duplicateCandidateGameId);
    const actorEvidence = before.interpretationContext.entities.find((entry) => entry.entityId === 'polity:france').evidenceIds[0];
    const text = 'Start an optical relay service.';
    const sourceSpan = { start: 0, end: text.length, text };
    const submitted = living.submitLivingWorldIntent(duplicateCandidateGameId, {
      revision: before.projection.revision,
      sessionRevision: before.sessionRevision,
      intentions: [text],
      modelOutput: {
        revision: before.projection.revision, questions: [], claims: [],
        requestedActions: [{
          actionId: 'action:relay', domain: 'military', scope: 'domestic', intent: text, pace: 'slow',
          effectFamilies: ['capacity.modify'], targetEntityIds: ['polity:france'], claimRefs: [], evidenceIds: [actorEvidence],
          operation: { kind: 'process.propose' }, sourceSpan,
        }],
        proposedInitiatives: [{
          initiativeId: 'initiative:relay', kind: 'institution', name: 'Optical relay service',
          description: 'Create a standardized optical communications service.', pace: 'slow',
          effectFamilies: ['capacity.modify'], targetEntityIds: ['polity:france'], evidenceIds: [actorEvidence], sourceSpan,
        }],
      },
    });
    const confirmed = living.confirmLivingWorldIntent(duplicateCandidateGameId, {
      revision: submitted.projection.revision,
      sessionRevision: submitted.sessionRevision,
      interpretationId: submitted.projection.interpretation.interpretationId,
    });
    assert.equal(confirmed.lastTransition.createdProcesses.length, 1);
    assert.equal(confirmed.projection.processes.length, 1);
    assert.equal(confirmed.projection.processes[0].name, 'Optical relay service');
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
    assert.deepEqual(confirmed.lastTransition.modelMetadata, {
      role: 'utility', provider: 'codex-subscription', model: 'gpt-5.6-luna', effort: 'low',
    });
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
    const parsed = parseIntentFirstProjection(advanced.projection);
    assert.equal(parsed.briefing.territoryEffects.length, 1);
    const effect = parsed.briefing.territoryEffects[0];
    assert.equal(effect.fromPolityId, 'polity:france');
    assert.equal(effect.toPolityId, 'polity:austria');
    assert.match(effect.population, /^\d[\d,]*$/u);
    assert.match(effect.taxBefore, /^\d[\d,]*$/u);
    assert.match(effect.taxAfter, /^\d[\d,]*$/u);
    assert.match(effect.recruitmentBefore, /^\d[\d,]*$/u);
    assert.match(effect.recruitmentAfter, /^\d[\d,]*$/u);
  });
});

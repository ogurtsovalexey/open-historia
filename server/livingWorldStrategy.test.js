import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { buildLivingWorldStrategicTasks, resolveLivingWorldStrategicTasks } from './livingWorldStrategy.js';

let temporary;
let state;

const memory = { schemaVersion: 'open-historia-strategic-memory/1', polities: [] };

function durablePlan(task) {
  return {
    objective: `Preserve ${task.brief.actor.name}.`,
    goals: [], commitments: [], revisit: 'Review at the next staggered quarterly checkpoint.',
  };
}

function hold(task) {
  const evidenceId = task.brief.evidence[0].evidenceId;
  return {
    taskKey: task.taskKey,
    status: 'succeeded',
    modelOutput: {
      polityId: task.actorPolityId,
      revision: task.brief.revision,
      selectedChoiceIds: [], processDecisions: [], initiativeProposals: [],
      durablePlan: durablePlan(task), evidenceIds: [evidenceId],
      hold: { reason: 'no-legal-action', detail: 'Maintain the current position.', revisit: 'next-quarter' },
    },
  };
}

before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-living-strategy-'));
  process.env.OH_DATA_DIR = temporary;
  const library = await import('./libraryStore.js');
  const sessions = await import('./engineSessionStore.js');
  const game = library.createGame({
    scenarioId: 'scenario:napoleonic-europe-1805', playerPolityId: 'polity:france', name: 'V5 strategy fixture',
  }).game;
  state = sessions.readEngineSession(library.getGameDirectory(game.id)).state;
});

after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
  delete process.env.OH_DATA_DIR;
});

describe('living-world production Strategic V5', () => {
  it('schedules only a staggered third of active opponents and freezes actor-private briefs', () => {
    const tasks = buildLivingWorldStrategicTasks(state, 'polity:france', memory);
    const activeOpponents = state.polities.filter((entry) => entry.id !== 'polity:france' && entry.decisionMode === 'active');
    assert.ok(tasks.length > 0);
    assert.ok(tasks.length < activeOpponents.length);
    assert.ok(tasks.every((task) => task.brief.actor.id === task.actorPolityId && task.brief.revision === state.revision));
    assert.ok(tasks.every((task) => task.brief.initiativeEnvelope.allowedEffectFamilies.every((kind) => ['capacity.modify', 'supply-capacity.modify'].includes(kind))));
    assert.ok(tasks.every((task) => !task.userPrompt.includes('polity:france') || task.actorPolityId === 'polity:france'));
    for (const task of tasks) {
      const schema = task.tool.schema;
      assert.deepStrictEqual(schema.properties.polityId.const, task.actorPolityId);
      assert.deepStrictEqual(schema.properties.revision.const, task.brief.revision);
      assert.deepStrictEqual(schema.properties.selectedChoiceIds.items.enum, task.brief.frozenChoices.map((choice) => choice.choiceId));
      assert.deepStrictEqual(schema.properties.evidenceIds.items.enum, task.brief.evidence.map((entry) => entry.evidenceId));
      assert.deepStrictEqual(schema.properties.processDecisions.items.properties.processId.enum, task.brief.processOptions.map((option) => option.processId));
      const evidenceIds = task.brief.evidence.map((entry) => entry.evidenceId);
      assert.deepStrictEqual(schema.properties.processDecisions.items.properties.factsUsed.items.enum, evidenceIds);
      assert.deepStrictEqual(schema.properties.initiativeProposals.items.properties.factsUsed.items.enum, evidenceIds);
      assert.deepStrictEqual(schema.properties.durablePlan.properties.goals.items.properties.factsUsed.items.enum, evidenceIds);
      assert.deepStrictEqual(schema.properties.durablePlan.properties.commitments.items.properties.factsUsed.items.enum, evidenceIds);
    }
  });

  it('commits accepted holds only to retrieval memory and leaves canonical material state byte-identical', () => {
    const tasks = buildLivingWorldStrategicTasks(state, 'polity:france', memory);
    const result = resolveLivingWorldStrategicTasks(state, tasks, tasks.map(hold), memory);
    assert.deepStrictEqual(result.state, state);
    assert.equal(result.records.length, tasks.length);
    assert.ok(result.records.every((entry) => entry.status === 'accepted' && entry.materializedProcessIds.length === 0));
    assert.deepStrictEqual(result.strategicState.polities.map((entry) => entry.polityId), tasks.map((entry) => entry.actorPolityId).sort());
    assert.deepStrictEqual(buildLivingWorldStrategicTasks(state, 'polity:france', result.strategicState), []);
  });

  it('keeps the whole required checkpoint atomic when one model attempt fails', () => {
    const tasks = buildLivingWorldStrategicTasks(state, 'polity:france', memory);
    const failed = tasks[0];
    const result = resolveLivingWorldStrategicTasks(state, tasks, tasks.map((task) => task.taskKey === failed.taskKey
      ? { taskKey: task.taskKey, status: 'failed', message: 'provider unavailable' }
      : hold(task)), memory);
    assert.deepStrictEqual(result.state, state);
    assert.deepStrictEqual(result.strategicState, memory);
    assert.deepStrictEqual(result.blockedTasks.map((task) => task.taskKey), [failed.taskKey]);
    assert.ok(result.records.some((record) => record.status === 'accepted'));
    assert.ok(result.records.some((record) => record.status === 'pending'));
  });

  it('caps background work and permits a directly addressed supported actor only', () => {
    const capped = buildLivingWorldStrategicTasks(state, 'polity:france', memory, { backgroundTaskLimit: 1 });
    assert.equal(capped.length, 1);
    const supported = state.polities.find((polity) => polity.id !== 'polity:france' && polity.decisionMode === 'supported');
    assert.ok(supported);
    const directed = buildLivingWorldStrategicTasks(state, 'polity:france', memory, { directedPolityIds: [supported.id] });
    assert.ok(directed.some((task) => task.actorPolityId === supported.id));
    assert.ok(directed.length <= 5);
  });

  it('materializes a novel opponent initiative as a funded process while the model supplies no numbers', () => {
    const tasks = buildLivingWorldStrategicTasks(state, 'polity:france', memory);
    const chosen = tasks[0];
    const evidenceId = chosen.brief.evidence[0].evidenceId;
    const initiative = {
      type: 'technology',
      displayName: { en: 'Improved field logistics' },
      description: { en: 'Develop more reliable movement and provisioning practices.' },
      objective: 'Improve field logistics without asserting an accomplished result.',
      directionId: chosen.brief.initiativeEnvelope.allowedDirectionIds[0],
      domainIds: [chosen.brief.initiativeEnvelope.allowedDomains[0]],
      sponsorEntityRefs: [chosen.actorPolityId],
      affectedEntityRefs: [chosen.actorPolityId],
      pace: 'slow',
      effectFamilies: ['supply-capacity.modify'],
      causalTheory: 'Sustained organizational learning can gradually improve reliable supply.',
      factsUsed: [evidenceId],
    };
    const attempts = tasks.map((task) => task.taskKey === chosen.taskKey ? {
      taskKey: task.taskKey,
      status: 'succeeded',
      modelOutput: {
        polityId: task.actorPolityId,
        revision: task.brief.revision,
        selectedChoiceIds: [], processDecisions: [], initiativeProposals: [initiative],
        durablePlan: durablePlan(task), evidenceIds: [evidenceId], hold: null,
      },
    } : hold(task));
    const treasuryBefore = state.polities.find((entry) => entry.id === chosen.actorPolityId).treasury;
    const result = resolveLivingWorldStrategicTasks(state, tasks, attempts, memory);
    const process = result.state.processes.find((entry) => entry.sponsorEntityRefs.includes(chosen.actorPolityId));
    assert.ok(process);
    assert.equal(process.stage, 'proposed');
    assert.equal(process.currentPace, 'slow');
    assert.deepStrictEqual(process.selectedEffectFamilies, ['supply-capacity.modify']);
    assert.ok(result.state.polities.find((entry) => entry.id === chosen.actorPolityId).treasury < treasuryBefore);
    assert.ok(result.records.find((entry) => entry.taskKey === chosen.taskKey).materializedProcessIds.includes(process.processId));
  });
});

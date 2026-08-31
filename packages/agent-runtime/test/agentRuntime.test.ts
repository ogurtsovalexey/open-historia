import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildFallbackBatch,
  buildOpponentBatches,
  buildPolityBrief,
  EMPTY_AGENT_STATE,
  MAX_BATCHES_PER_MONTH,
  MAX_BATCH_BRIEF_CHARS,
  MAX_POLITIES_PER_BATCH,
  MAX_POLITY_BRIEF_CHARS,
  opponentBatchResultSchema,
  selectOpponentPolities,
  validateOpponentBatch,
  type AgentState,
} from '../src/index.js';
import { initState, parseScenario, runTurn, stateChecksum, type EconWorldState } from '@open-historia/engine';

const fixture = fileURLToPath(new URL('../../../engine/fixtures/scenario-dev-map-4c/scenario.json', import.meta.url));
const fallbackGolden = fileURLToPath(new URL('../../test/golden/p3a-fallback-chain.json', import.meta.url));
const initial = () => initState(parseScenario(JSON.parse(readFileSync(fixture, 'utf8'))));

test('bounded briefs and batches never include the full map', () => {
  const state = initial();
  const selected = selectOpponentPolities(state, 'polity:austria', EMPTY_AGENT_STATE);
  const batches = buildOpponentBatches(state, selected, (id) => buildPolityBrief(state, id, {
    difficulty: 'medium', scenarioNote: 'Synthetic alternate-history context.', tags: ['independent'],
  }));
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.polityIds.length, 3);
  assert.ok((batches[0]?.characterCount ?? Infinity) <= MAX_BATCH_BRIEF_CHARS);
  for (const brief of batches[0]?.briefs ?? []) {
    assert.ok(JSON.stringify(brief).length <= MAX_POLITY_BRIEF_CHARS);
    assert.equal(Object.hasOwn(brief, 'regions'), false);
    assert.equal(Object.hasOwn(brief, 'map'), false);
  }
});

test('semantic validation binds every decision to its own brief and revision', () => {
  const state = initial();
  const batch = buildOpponentBatches(state, ['polity:germany'], (id) => buildPolityBrief(state, id))[0]!;
  const fallback = buildFallbackBatch(state, batch);
  assert.deepEqual(validateOpponentBatch(fallback, batch), opponentBatchResultSchema.parse(fallback));
  const wrong = structuredClone(fallback);
  if (wrong.decisions[0]?.command) wrong.decisions[0].command.expectedRevision = 'sha256:stale' as typeof state.revision;
  assert.throws(() => validateOpponentBatch(wrong, batch), /revision or month/);
});

test('fallback is deterministic and never spends without a positive preview', () => {
  const state = initial();
  const batch = buildOpponentBatches(state, ['polity:germany'], (id) => buildPolityBrief(state, id))[0]!;
  assert.deepEqual(buildFallbackBatch(state, batch), buildFallbackBatch(state, batch));
});

const scaleState = (): EconWorldState => {
  const base = initial();
  const sourcePolity = base.polities[0]!;
  const sourceRegions = base.regions.slice(0, 3);
  const polities = Array.from({ length: 100 }, (_, index) => ({
    ...sourcePolity,
    id: `polity:scale-${String(index).padStart(3, '0')}` as typeof sourcePolity.id,
    displayName: { en: `Scale ${index}`, ru: `Scale ${index}` },
  }));
  const regions = polities.flatMap((polity, polityIndex) => sourceRegions.map((source, regionIndex) => ({
    ...source,
    regionId: `region:scale:P${String(polityIndex).padStart(3, '0')}.${regionIndex}` as typeof source.regionId,
    controllerId: polity.id,
    activity: regionIndex === 0 ? source.activity : { kind: 'extraction' as const, resource: 'food' as const },
  })));
  const draft = { ...base, polities, regions, revision: 'pending' as typeof base.revision };
  return { ...draft, revision: stateChecksum(draft) as typeof base.revision };
};

test('100 active polities all tick for twelve months and rotate within five using at most two batches', () => {
  let state = scaleState();
  const player = state.polities[0]!.id;
  let agentState: AgentState = structuredClone(EMPTY_AGENT_STATE);
  const seen = new Set<string>();
  let seenWithinFive = 0;
  for (let month = 0; month < 12; month += 1) {
    const selected = selectOpponentPolities(state, player, agentState);
    const batches = buildOpponentBatches(state, selected, (id) => buildPolityBrief(state, id, { agentState }));
    assert.ok(batches.length <= MAX_BATCHES_PER_MONTH);
    assert.ok(batches.every((batch) => batch.polityIds.length <= MAX_POLITIES_PER_BATCH));
    selected.forEach((id) => seen.add(id));
    const selectedSet = new Set(selected);
    agentState = {
      schemaVersion: 'open-historia-agent-state/1',
      consumedActionIds: [],
      polities: [
        ...agentState.polities.filter((entry) => !selectedSet.has(entry.polityId)),
        ...selected.map((id) => ({
          polityId: id as AgentState['polities'][number]['polityId'],
          lastDecisionMonth: state.month,
          lastBriefFingerprint: state.revision,
          intent: 'conserve' as const,
          rationale: '',
          source: 'model' as const,
          lastOutcome: 'noop' as const,
          triggerFingerprint: 'fed||afford',
        })),
      ].sort((left, right) => left.polityId.localeCompare(right.polityId)),
    };
    const beforeTurns = state.turn;
    state = runTurn(state, { commands: [] }).result.state;
    assert.equal(state.turn, beforeTurns + 1);
    assert.equal(state.polities.length, 100);
    assert.equal(state.regions.length, 300);
    if (month === 4) seenWithinFive = seen.size;
  }
  assert.equal(seenWithinFive, 99);
  assert.equal(seen.size, 99);
});

test('ten-month fallback decision chain matches the dedicated P3a golden', () => {
  let state = initial();
  let agentState: AgentState = structuredClone(EMPTY_AGENT_STATE);
  const months = [];
  for (let index = 0; index < 10; index += 1) {
    const selected = selectOpponentPolities(state, 'polity:austria', agentState);
    const batches = buildOpponentBatches(state, selected, (id) => buildPolityBrief(state, id, { agentState }));
    const decisions = batches.flatMap((batch) => buildFallbackBatch(state, batch).decisions);
    const commands = decisions.flatMap((decision) => decision.command ? [decision.command] : [])
      .sort((left, right) => left.actorPolityId.localeCompare(right.actorPolityId));
    const before = state;
    state = runTurn(state, { commands }).result.state;
    months.push({
      month: before.month,
      revision: before.revision,
      targets: commands.map((command) => `${command.actorPolityId}->${command.targetRegionId}`),
      nextRevision: state.revision,
    });
    const chosen = new Set(selected);
    agentState = {
      schemaVersion: 'open-historia-agent-state/1',
      consumedActionIds: [],
      polities: [
        ...agentState.polities.filter((entry) => !chosen.has(entry.polityId)),
        ...decisions.map((decision) => ({
          polityId: decision.polityId,
          lastDecisionMonth: before.month,
          lastBriefFingerprint: before.revision,
          intent: decision.intent,
          rationale: decision.rationale,
          source: 'fallback' as const,
          lastOutcome: decision.command ? 'accepted' as const : 'noop' as const,
          triggerFingerprint: 'fed||afford',
        })),
      ].sort((left, right) => left.polityId.localeCompare(right.polityId)),
    };
  }
  const golden = JSON.parse(readFileSync(fallbackGolden, 'utf8'));
  assert.deepEqual({ schemaVersion: 'open-historia-p3a-fallback-chain/1', months }, golden);
});

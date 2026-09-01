import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildFallbackBatch,
  buildDiplomacyBatch,
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
  validateDiplomacyBatch,
  type AgentState,
} from '../src/index.js';
import { initState, parseScenario, runTurn, stateChecksum, type EconWorldState } from '@open-historia/engine';

const fixture = fileURLToPath(new URL('../../../engine/fixtures/scenario-dev-map-4c/scenario.json', import.meta.url));
const fallbackGolden = fileURLToPath(new URL('../../test/golden/p3a-fallback-chain.json', import.meta.url));
const initial = () => initState(parseScenario(JSON.parse(readFileSync(fixture, 'utf8'))));
const diplomacyFixture = fileURLToPath(new URL('../../../engine/fixtures/scenario-dev-map-6c/scenario.json', import.meta.url));
const diplomacyInitial = () => initState(parseScenario(JSON.parse(readFileSync(diplomacyFixture, 'utf8'))));

test('strategic diplomacy batch is bounded, deterministic and contains no full map', () => {
  const state = diplomacyInitial();
  const first = buildDiplomacyBatch(state, 'polity:austria');
  const second = buildDiplomacyBatch(state, 'polity:austria');
  assert.deepEqual(first, second);
  assert.ok(first);
  assert.equal(first.polityIds.length, 5);
  assert.ok(first.characterCount <= MAX_BATCH_BRIEF_CHARS);
  assert.equal(JSON.stringify(first).includes('geometry'), false);
  assert.ok(first.briefs.every((brief) => brief.projectRegionCandidates.length <= 3
    && brief.mobilizationRegionCandidates.length <= 3 && brief.frontRegionCandidates.length <= 6
    && brief.peaceRegionCandidates.length <= 6));
  assert.ok(first.briefs.every((brief) => ((brief.identity?.candidates as string[] | undefined)?.length ?? 0) <= 6));
  assert.equal(JSON.stringify(first).includes('minorities'), false);
  assert.equal(JSON.stringify(first).includes('identity.regions'), false);
  assert.equal(JSON.stringify(first).includes('supplyLinks'), false);
  assert.equal(JSON.stringify(first).includes('truths'), false);
  assert.equal(JSON.stringify(first).includes('liquid-fuel reserves'), false);
  assert.equal(JSON.stringify(first).includes('character:'), false);
  assert.ok(first.briefs.every((brief) => brief.projectRegionCandidates.length <= 3));
  assert.equal(buildDiplomacyBatch(initial(), 'polity:austria'), null);
});

test('strategic diplomacy validation requires one bound decision per polity', () => {
  const state = diplomacyInitial();
  const batch = buildDiplomacyBatch(state, 'polity:austria')!;
  const holds = { decisions: batch.polityIds.map((polityId) => ({ polityId, intent: 'hold' as const, rationale: 'No material action.', command: null })) };
  assert.deepEqual(validateDiplomacyBatch(holds, batch), holds);
  assert.throws(() => validateDiplomacyBatch({ decisions: holds.decisions.slice(1) }, batch), /every and only/);
  const wrongActor: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  wrongActor.decisions[0] = {
    polityId: batch.polityIds[0]!, intent: 'propose', rationale: 'Test proposal.',
    command: {
      kind: 'diplomacy.propose', commandId: '00000000-0000-4000-8000-000000000001',
      actorPolityId: 'polity:austria', recipientPolityId: batch.polityIds[0]!,
      expectedRevision: state.revision, effectiveMonth: state.month, proposalId: 'proposal:test',
      terms: { kind: 'agreement', agreementType: 'non-aggression', fromPolityId: 'polity:austria', toPolityId: batch.polityIds[0]! },
    },
  };
  assert.throws(() => validateDiplomacyBatch(wrongActor, batch), /actor mismatch/);

  const policy: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  policy.decisions[0] = {
    polityId: batch.polityIds[0]!, intent: 'set-policy', rationale: 'Rebalance public spending.',
    command: {
      kind: 'finance.set-policy', commandId: '00000000-0000-4000-8000-000000000002',
      actorPolityId: batch.polityIds[0]!, expectedRevision: state.revision, effectiveMonth: state.month,
      taxBurdenBp: 10000, exemptionBp: 500,
      priorities: { administration: 2500, science: 1500, industry: 2500, security: 1500, military: 2000 },
    },
  };
  assert.equal(validateDiplomacyBatch(policy, batch).decisions[0]?.intent, 'set-policy');

  const politics: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  const actor = batch.briefs.find((brief) => brief.factions.some((entry) => entry.escalation !== 'calm'))!;
  const faction = actor.factions.find((entry) => entry.escalation !== 'calm')!;
  const index = batch.polityIds.indexOf(actor.polityId);
  politics.decisions[index] = {
    polityId: actor.polityId, intent: 'repress', rationale: 'Contain an active crisis.',
    command: { kind: 'politics.respond', commandId: '00000000-0000-4000-8000-000000000003', actorPolityId: actor.polityId,
      expectedRevision: state.revision, effectiveMonth: state.month, factionId: faction.factionId, response: 'repress' },
  };
  assert.equal(validateDiplomacyBatch(politics, batch).decisions[index]?.intent, 'repress');

  const war: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  war.decisions[0] = {
    polityId: batch.polityIds[0]!, intent: 'declare-war', rationale: 'Escalate a public rivalry.',
    command: { kind: 'war.declare', commandId: '00000000-0000-4000-8000-000000000004',
      actorPolityId: batch.polityIds[0]!, expectedRevision: state.revision, effectiveMonth: state.month,
      warId: 'war:agent-validation', defenderPolityId: 'polity:austria', reason: 'rivalry' },
  };
  assert.equal(validateDiplomacyBatch(war, batch).decisions[0]?.intent, 'declare-war');

  const identity: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  const identityActor = batch.briefs.find((brief) => brief.identity)!;
  const identityIndex = batch.polityIds.indexOf(identityActor.polityId);
  identity.decisions[identityIndex] = {
    polityId: identityActor.polityId, intent: 'set-identity-policy', rationale: 'Reduce identity pressure.',
    command: { kind: 'identity.set-policy', commandId: '00000000-0000-4000-8000-000000000005',
      actorPolityId: identityActor.polityId, expectedRevision: state.revision, effectiveMonth: state.month,
      domain: 'culture', policy: 'integration' },
  };
  assert.equal(validateDiplomacyBatch(identity, batch).decisions[identityIndex]?.intent, 'set-identity-policy');

  const unknownIdentity: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  unknownIdentity.decisions[identityIndex] = {
    polityId: identityActor.polityId, intent: 'set-identity-acceptance', rationale: 'Invalid candidate.',
    command: { kind: 'identity.set-culture-acceptance', commandId: '00000000-0000-4000-8000-000000000006',
      actorPolityId: identityActor.polityId, expectedRevision: state.revision, effectiveMonth: state.month,
      domain: 'culture', identityId: 'culture:unknown', accepted: true },
  };
  assert.throws(() => validateDiplomacyBatch(unknownIdentity, batch), /outside bounded candidates/);
});

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

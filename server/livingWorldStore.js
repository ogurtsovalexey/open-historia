import crypto from 'node:crypto';
import { processes, worldV2 } from '@open-historia/engine';
import { getGameDetails, getGameDirectory } from './libraryStore.js';
import { commitLivingWorldSession, ENGINE_SESSION_SCHEMA_V3, readEngineSession } from './engineSessionStore.js';
import { buildIntentFirstProjection } from './livingWorldProjection.js';

const hashId = (prefix, values) => `${prefix}:${crypto.createHash('sha256').update(values.join('\u001f')).digest('hex').slice(0, 32)}`;

function requireSession(gameId) {
  const details = getGameDetails(gameId);
  if (!details.game.livingWorld) throw new Error(`Game ${gameId} is not a living-world game.`);
  const session = readEngineSession(getGameDirectory(gameId));
  if (!session || session.manifest.schema !== ENGINE_SESSION_SCHEMA_V3) {
    throw new Error(`Game ${gameId} has no valid WorldStateV2 session.`);
  }
  const playerPolityId = details.game.playerPolityId ?? details.data.game.country;
  if (!session.state.polities.some((entry) => entry.id === playerPolityId)) {
    throw new Error(`Game ${gameId} has an invalid player polity.`);
  }
  return { details, session, playerPolityId };
}

function response(gameId) {
  const { session, playerPolityId } = requireSession(gameId);
  return {
    gameId,
    sessionRevision: session.manifest.revision,
    projection: buildIntentFirstProjection({ session, playerPolityId }),
  };
}

function assertConcurrency(session, worldRevision, sessionRevision) {
  if (session.state.revision !== worldRevision) throw new Error('Stale world revision. Refresh before issuing this command.');
  if (session.manifest.revision !== sessionRevision) throw new Error('Stale session revision. Refresh before issuing this command.');
}

function commonEvidence(state, polityId) {
  const visible = new Set(worldV2.selectEvidenceRegistry(state, polityId).value.entries.map((entry) => entry.evidenceId));
  const derived = worldV2.derivePolitySnapshot(state, polityId).evidenceIds.filter((id) => visible.has(id));
  return [...new Set(derived)].sort().slice(0, 12);
}

function buildPendingIntent(session, playerPolityId, intentions) {
  if (!Array.isArray(intentions)) throw new Error('Intentions must be an array of non-empty text lines.');
  const lines = intentions.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 12) throw new Error('Submit between one and twelve intentions.');
  const sourceText = lines.join('\n').slice(0, 6000);
  const evidenceIds = commonEvidence(session.state, playerPolityId);
  const pastClaim = /\b(?:ago|previously|already|formerly|last\s+turn|conquered|captured|owned)\b|(?:назад|раньше|уже|прошл\S*\s+ход|захватил\S*|принадлежал\S*)/iu.test(sourceText);
  const interpretationId = hashId('interpretation', [session.manifest.revision, playerPolityId, sourceText]);
  return {
    schemaVersion: 'open-historia-player-intent/1',
    interpretationId,
    createdWorldRevision: session.state.revision,
    playerPolityId,
    sourceText,
    status: 'pending',
    questions: [],
    claims: pastClaim ? [{
      claimId: hashId('claim', [interpretationId, 'past']),
      text: 'The order contains a claim about prior world state',
      status: 'unknown',
      explanation: 'Free text cannot rewrite history. The claim needs an entity-level ledger match before it can be treated as fact.',
      evidenceIds: [],
    }] : [],
    requestedActions: lines.map((line, index) => ({
      actionId: hashId('action', [interpretationId, String(index)]),
      summary: line,
      material: true,
      irreversible: false,
      targetLabels: [],
      evidenceIds,
    })),
    proposedInitiatives: [],
    preview: {
      cost: { kind: 'unknown', label: 'Not quantified until the semantic action is typed' },
      duration: { kind: 'unknown', label: 'Not quantified until feasibility is resolved' },
      risks: ['The intended effect may be infeasible or take many turns'],
      opportunityCosts: ['Resources and institutional capacity are finite'],
      affected: [session.state.polities.find((entry) => entry.id === playerPolityId)?.displayName.en ?? playerPolityId],
      evidenceIds,
    },
  };
}

function commit(gameId, session, values) {
  return commitLivingWorldSession(getGameDirectory(gameId), {
    expectedRevision: session.manifest.revision,
    gameId,
    scenarioId: session.manifest.scenarioId,
    seedChecksum: session.manifest.seedChecksum,
    state: values.state ?? session.state,
    lastTransition: values.lastTransition,
    strategicState: values.strategicState,
    agentTurn: values.agentTurn,
    playerIntent: values.playerIntent,
  });
}

export const readLivingWorld = (gameId) => response(gameId);

export function submitLivingWorldIntent(gameId, { revision, sessionRevision, intentions } = {}) {
  const { session, playerPolityId } = requireSession(gameId);
  assertConcurrency(session, revision, sessionRevision);
  if (session.playerIntent?.status === 'pending') throw new Error('Resolve the pending interpretation before submitting another intent.');
  commit(gameId, session, { playerIntent: buildPendingIntent(session, playerPolityId, intentions) });
  return response(gameId);
}

export function confirmLivingWorldIntent(gameId, { revision, sessionRevision, interpretationId } = {}) {
  const { session } = requireSession(gameId);
  assertConcurrency(session, revision, sessionRevision);
  if (session.playerIntent?.status !== 'pending' || session.playerIntent.interpretationId !== interpretationId) {
    throw new Error('Pending interpretation does not match this confirmation.');
  }
  commit(gameId, session, { playerIntent: { ...session.playerIntent, status: 'confirmed' } });
  return response(gameId);
}

export function dismissLivingWorldIntent(gameId, { revision, sessionRevision, interpretationId } = {}) {
  const { session } = requireSession(gameId);
  assertConcurrency(session, revision, sessionRevision);
  if (session.playerIntent?.status !== 'pending' || session.playerIntent.interpretationId !== interpretationId) {
    throw new Error('Pending interpretation does not match this dismissal.');
  }
  commit(gameId, session, { playerIntent: null });
  return response(gameId);
}

export function advanceLivingWorld(gameId, { revision, sessionRevision, optionId } = {}) {
  const { session } = requireSession(gameId);
  assertConcurrency(session, revision, sessionRevision);
  if (optionId !== 'advance-one-month') throw new Error(`Unsupported time option ${String(optionId)}.`);
  if (session.playerIntent?.status === 'pending') throw new Error('Confirm or revise the pending interpretation before advancing time.');
  const clock = worldV2.advanceWorldMonth(session.state, { expectedRevision: session.state.revision });
  const { state: _clockState, ...clockRecord } = clock;
  void _clockState;
  let state = clock.state;
  const processTransitions = [];
  for (const process of processes.activeProcesses(state)) {
    const transition = processes.advanceProcessDeterministically(state, process.processId);
    state = transition.state;
    processTransitions.push({
      processId: transition.processId,
      revisionAfter: transition.state.revision,
      eventIds: transition.eventIds,
      evidenceIds: transition.evidenceIds,
    });
  }
  commit(gameId, session, {
    state,
    lastTransition: { kind: 'world-month-advanced', clock: clockRecord, processTransitions },
    playerIntent: session.playerIntent?.status === 'confirmed' ? null : session.playerIntent,
  });
  return response(gameId);
}

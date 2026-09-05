import crypto from 'node:crypto';
import { processes, worldV2 } from '@open-historia/engine';
import { interpretPlayerInputV2 } from '@open-historia/agent-runtime';
import { getGameDetails, getGameDirectory } from './libraryStore.js';
import { commitLivingWorldSession, ENGINE_SESSION_SCHEMA_V3, readEngineSession } from './engineSessionStore.js';
import { buildIntentFirstProjection, buildPlayerIntentContext } from './livingWorldProjection.js';
import { buildLivingWorldStrategicTasks, resolveLivingWorldStrategicTasks } from './livingWorldStrategy.js';

const hashId = (prefix, values) => `${prefix}:${crypto.createHash('sha256').update(values.join('\u001f')).digest('hex').slice(0, 32)}`;

// Concepts need an ASCII semantic key, but player intentions are deliberately
// accepted in the UI language.  The process reducer derives the key from the
// English display name, so preserve the player's name as a localized label and
// derive a deterministic, legal fallback only when it cannot itself be a key.
const CYRILLIC_TO_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function semanticDisplayName(name, stableSeed) {
  const original = String(name ?? '').trim();
  const transliterated = [...original.toLocaleLowerCase('ru-RU')]
    .map((character) => CYRILLIC_TO_LATIN[character] ?? character)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return transliterated || `initiative-${hashId('semantic-name', [stableSeed]).split(':')[1]}`;
}

function localizedProposalText(name, stableSeed) {
  const original = String(name ?? '').trim();
  const english = semanticDisplayName(original, stableSeed);
  // Keep an existing Latin display name human-readable; the reducer will
  // normalize it to a semantic key itself.  For non-Latin player text, retain
  // the original as Russian UI text and use the deterministic transliteration
  // solely for the engine's English/key-bearing representation.
  if (/^[\x20-\x7e]+$/u.test(original)) return { en: original };
  return original ? { en: english, ru: original } : { en: english };
}

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

function response(gameId, requestedLocale = 'en') {
  const { session, playerPolityId } = requireSession(gameId);
  const locale = requestedLocale === 'ru' ? 'ru' : 'en';
  const strategicCheckpoint = session.agentTurn?.kind === 'strategic-checkpoint-blocked'
    && session.agentTurn.worldRevisionBefore === session.state.revision
    ? session.agentTurn.strategicCheckpoint
    : null;
  return {
    gameId,
    sessionRevision: session.manifest.revision,
    playerDecisionIndex: session.playerDecisionIndex ?? 0,
    lastTransition: session.lastTurn,
    projection: {
      ...buildIntentFirstProjection({ session, playerPolityId, locale }),
      strategicCheckpoint,
    },
    interpretationContext: buildPlayerIntentContext({ session, playerPolityId }),
    strategicTasks: buildLivingWorldStrategicTasks(session.state, playerPolityId, session.agentState),
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

function auditText(value, maximum) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum);
  return normalized || null;
}

// Provider provenance is audit context only: it cannot influence any engine
// choice. Keep the allowlist deliberately narrow so browser-side settings can
// never smuggle credentials, endpoints or raw prompts into a save.
function sanitizeModelMetadata(value, role) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const provider = auditText(value.provider, 80);
  const model = auditText(value.model, 160);
  const effort = auditText(value.effort, 40);
  if (!provider && !model && !effort) return null;
  return { role, provider, model, effort };
}

function buildPendingIntent(session, playerPolityId, intentions, modelOutput, modelMetadata) {
  if (!Array.isArray(intentions)) throw new Error('Intentions must be an array of non-empty text lines.');
  const lines = intentions.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 12) throw new Error('Submit between one and twelve intentions.');
  const sourceText = lines.join('\n').slice(0, 6000);
  const evidenceIds = commonEvidence(session.state, playerPolityId);
  const pastClaim = /\b(?:ago|previously|already|formerly|last\s+turn|conquered|captured|owned)\b|(?:назад|раньше|уже|прошл\S*\s+ход|захватил\S*|принадлежал\S*)/iu.test(sourceText);
  if (!modelOutput) throw new Error('A strict semantic interpreter result is required.');
  const grounded = interpretPlayerInputV2(session.state, {
    actorPolityId: playerPolityId,
    playerText: sourceText,
    modelOutput,
  }).value;
  const interpretationId = hashId('interpretation', [session.manifest.revision, playerPolityId, sourceText]);
  const claims = grounded.claims.map((claim) => ({
    claimId: claim.claimId,
    text: `${claim.subject} ${claim.predicate} ${String(claim.proposedValue)}`,
    status: claim.grounding,
    explanation: claim.reasons.length > 0
      ? `Not accepted: ${claim.reasons.join(', ')}.`
      : claim.grounding === 'supported' ? 'The canonical state supports this claim.'
        : claim.grounding === 'contradicted' ? 'The canonical state or complete causal ledger contradicts this claim.'
          : claim.grounding === 'subjective' ? 'This is treated as a viewpoint, not a canonical fact.'
            : 'The available canonical evidence cannot establish this claim.',
    // A deterministic supported/contradicted result is still a canonical
    // assertion in the UI. Models are allowed to omit evidence IDs because
    // the reducer independently verifies it; attach actor-visible baseline
    // evidence so the projection remains auditable and never violates the
    // strict UI contract by crashing on an otherwise safe rejection.
    evidenceIds: (claim.grounding === 'supported' || claim.grounding === 'contradicted')
      ? [...new Set([...claim.evidenceIds, ...evidenceIds])]
      : claim.evidenceIds,
  }));
  if (pastClaim && claims.length === 0) claims.push({
    claimId: hashId('claim', [interpretationId, 'unresolved-past']),
    text: 'The order contains an unverified claim about prior world state',
    status: 'unknown',
    explanation: 'Free text cannot rewrite history. No ledger-grounded claim was supplied by the interpreter.',
    evidenceIds: [],
  });
  const requestedActions = grounded.requestedActions.map((action) => ({
    actionId: action.actionId,
    summary: action.status === 'grounded' ? action.intent : `${action.intent} (blocked: ${action.reasons.join(', ')})`,
    material: action.status === 'grounded',
    irreversible: false,
    targetLabels: action.targetEntityIds,
    evidenceIds: action.status === 'grounded' ? [...new Set([...action.evidenceIds, ...evidenceIds])] : [],
    domain: action.domain,
    scope: action.scope,
    pace: action.pace,
    effectFamilies: action.effectFamilies,
    targetEntityIds: action.targetEntityIds,
    operation: action.operation ?? { kind: 'process.propose' },
    sourceSpan: action.sourceSpan,
    status: action.status,
  }));
  const proposedInitiatives = grounded.proposedInitiatives.map((initiative) => ({
    initiativeId: initiative.initiativeId,
    summary: initiative.status === 'grounded' ? `${initiative.name}: ${initiative.description}` : `${initiative.name} (blocked: ${initiative.reasons.join(', ')})`,
    material: initiative.status === 'grounded',
    irreversible: false,
    targetLabels: initiative.targetEntityIds,
    evidenceIds: initiative.status === 'grounded' ? [...new Set([...initiative.evidenceIds, ...evidenceIds])] : [],
    kind: initiative.kind,
    name: initiative.name,
    description: initiative.description,
    pace: initiative.pace,
    effectFamilies: initiative.effectFamilies,
    targetEntityIds: initiative.targetEntityIds,
    sourceSpan: initiative.sourceSpan,
    status: initiative.status,
  }));
  const enginePreviews = [];
  const previewCandidates = dedupeMaterialCandidates([
    ...requestedActions.filter((item) => item.operation.kind === 'process.propose' && item.material).map((entry) => ({
      kind: 'action', entry,
      sourceId: entry.actionId,
      sourceSpan: entry.sourceSpan,
      conceptType: conceptTypeForAction(entry.domain),
      domain: entry.domain,
      name: entry.summary.slice(0, 100),
      description: entry.summary,
      targetEntityIds: entry.targetEntityIds,
      pace: entry.pace,
      effectFamilies: entry.effectFamilies,
      evidenceIds: entry.evidenceIds,
    })),
    ...proposedInitiatives.filter((item) => item.material).map((entry) => ({
      kind: 'initiative', entry,
      sourceId: entry.initiativeId,
      sourceSpan: entry.sourceSpan,
      conceptType: conceptTypeFor(entry.kind, entry.name),
      domain: entry.kind,
      name: entry.name,
      description: entry.description,
      targetEntityIds: entry.targetEntityIds,
      pace: entry.pace,
      effectFamilies: entry.effectFamilies,
      evidenceIds: entry.evidenceIds,
    })),
  ]);
  for (const candidate of previewCandidates) {
    const { entry } = candidate;
    const proposal = proposalForCandidate(interpretationId, playerPolityId, candidate);
    const resolved = processes.buildSemanticProcessEnginePlan(session.state, proposal);
    if (!resolved.allowedPacesAfterCommitment.includes(candidate.pace)) {
      entry.material = false;
      entry.status = 'blocked';
      entry.evidenceIds = [];
      entry.summary = `${entry.summary} (blocked: ${candidate.pace} pace is infeasible; allowed: ${resolved.allowedPacesAfterCommitment.join(', ')})`;
    } else {
      enginePreviews.push({ ...resolved, pace: candidate.pace });
    }
  }
  const initialFunding = enginePreviews.reduce((sum, entry) => sum + entry.fundingCommitment, 0);
  const activeEvidence = [...new Set([...requestedActions, ...proposedInitiatives].flatMap((entry) => entry.evidenceIds))];
  return {
    schemaVersion: 'open-historia-player-intent/1',
    interpretationId,
    createdWorldRevision: session.state.revision,
    playerPolityId,
    modelMetadata: sanitizeModelMetadata(modelMetadata, 'utility'),
    sourceText,
    status: 'pending',
    questions: grounded.questions.map((question) => ({ questionId: question.questionId, prompt: question.text })),
    claims,
    requestedActions,
    proposedInitiatives,
    preview: {
      cost: enginePreviews.length > 0
        ? { kind: 'range', label: `${initialFunding} initial treasury commitment` }
        : { kind: 'unknown', label: 'No currently feasible material commitment' },
      duration: enginePreviews.length > 0
        ? { kind: 'range', label: 'Multi-stage; pace is rechecked at each monthly resolution' }
        : { kind: 'unknown', label: 'Blocked until the interpretation or conditions change' },
      risks: enginePreviews.some((entry) => entry.allowedPacesAfterCommitment.length <= 3)
        ? ['High contextual resistance limits acceleration']
        : ['Material blockers or opposition can slow the process at later checkpoints'],
      opportunityCosts: enginePreviews.map((entry) => `${entry.fundingCommitment} treasury plus committed institutional capacity`),
      affected: [...new Set([...requestedActions, ...proposedInitiatives].flatMap((entry) => entry.targetLabels))],
      evidenceIds: activeEvidence,
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
    playerDecisionIndex: values.playerDecisionIndex,
  });
}

function settleSubmonth(stateInput) {
  let state = stateInput;
  const monthBefore = state.month;
  const openingTransitions = [];
  const unsupportedCadences = state.tributeObligations
    .filter((obligation) => obligation.cadence !== 'monthly')
    .map((obligation) => `${obligation.obligationId}:${obligation.cadence}`);
  if (unsupportedCadences.length > 0) {
    throw new Error(`Unsupported tribute cadence(s): ${unsupportedCadences.join(', ')}.`);
  }
  const tributeSettlements = [];
  for (const obligation of [...state.tributeObligations].sort((left, right) => left.obligationId.localeCompare(right.obligationId))) {
    const settled = worldV2.applyTributeDelivery(state, { obligationId: obligation.obligationId, expectedRevision: state.revision });
    state = settled.state;
    tributeSettlements.push({
      obligationId: settled.obligationId, rows: settled.rows, laborReserved: settled.laborReserved,
      militaryPersonnelReserved: settled.militaryPersonnelReserved, revisionAfter: state.revision,
      eventId: settled.eventId, evidenceId: settled.evidenceId,
    });
  }
  const processTransitions = [];
  for (const process of processes.activeProcesses(state).sort((left, right) => left.processId.localeCompare(right.processId))) {
    const transition = processes.advanceProcessDeterministically(state, process.processId);
    state = transition.state;
    processTransitions.push({
      processId: transition.processId, revisionAfter: state.revision,
      eventIds: transition.eventIds, evidenceIds: transition.evidenceIds,
    });
  }
  const closingTransitions = [];
  const clock = worldV2.advanceWorldMonth(state, { expectedRevision: state.revision });
  state = clock.state;
  const { state: _clockState, ...clockRecord } = clock;
  void _clockState;
  return {
    state,
    record: { monthBefore, monthAfter: state.month, revisionBefore: stateInput.revision, revisionAfter: state.revision,
      openingTransitions, tributeSettlements, processTransitions, closingTransitions, clock: clockRecord },
  };
}

/** Resolve local state only; callers persist after every requested submonth succeeds. */
export function resolveLivingWorldSubmonths(stateInput, submonthCount, settle = settleSubmonth) {
  let state = stateInput;
  const submonths = [];
  for (let index = 0; index < submonthCount; index += 1) {
    const resolved = settle(state);
    state = resolved.state;
    submonths.push({ index: index + 1, ...resolved.record });
  }
  return { state, submonths };
}

function conceptTypeFor(kind, name) {
  if (kind === 'technology') return 'technology';
  if (kind === 'ideology') return 'ideology';
  if (kind === 'doctrine') return 'doctrine';
  if (kind === 'institution') return 'institution';
  if (kind === 'investigation') return 'scientific-theory';
  if (kind === 'movement') return /relig|faith|church|cult|sacred/i.test(name) ? 'religious-movement' : 'ideology';
  return kind === 'project' ? 'economic-practice' : 'institution';
}

function conceptTypeForAction(domain) {
  if (domain === 'science') return 'technology';
  if (domain === 'economy') return 'economic-practice';
  if (domain === 'politics' || domain === 'society') return 'ideology';
  if (domain === 'military' || domain === 'diplomacy') return 'doctrine';
  return 'institution';
}

function proposalForCandidate(interpretationId, playerPolityId, candidate) {
  const affectedEntityRefs = candidate.targetEntityIds.length > 0
    ? candidate.targetEntityIds
    : [playerPolityId];
  return {
    semanticProposalId: hashId('semantic-proposal', [interpretationId, candidate.sourceId]),
    type: candidate.conceptType,
    displayName: localizedProposalText(candidate.name, `${interpretationId}:${candidate.sourceId}`),
    description: localizedProposalText(candidate.description, `${interpretationId}:${candidate.sourceId}:description`),
    originEntityRefs: [playerPolityId],
    parentConceptIds: [],
    domains: [`domain:${candidate.domain}`],
    objective: candidate.description,
    direction: `direction:${candidate.domain === 'movement' ? 'organize' : 'develop'}`,
    sponsorEntityRefs: [playerPolityId],
    affectedEntityRefs,
    pace: 'stalled',
    effectFamilies: candidate.effectFamilies,
    evidenceIds: candidate.evidenceIds,
  };
}

// A Utility response can express one player sentence both as a typed
// `process.propose` action and as its richer proposed initiative. They are two
// views of one authorization, not two treasury commitments. Prefer the
// initiative (it carries a stable name/description), but leave separately
// sourced actions independent.
function dedupeMaterialCandidates(candidates) {
  const selected = new Map();
  for (const candidate of candidates) {
    const span = candidate.sourceSpan;
    const key = span
      ? `${span.start}:${span.end}:${span.text}`
      : `source:${candidate.sourceId}`;
    const current = selected.get(key);
    if (!current || candidate.kind === 'initiative') selected.set(key, candidate);
  }
  return [...selected.values()].sort((left, right) => (
    (left.sourceSpan?.start ?? Number.MAX_SAFE_INTEGER) - (right.sourceSpan?.start ?? Number.MAX_SAFE_INTEGER)
    || left.sourceId.localeCompare(right.sourceId)
  ));
}

function materializeConfirmedInitiatives(stateInput, playerIntent) {
  let state = stateInput;
  const created = [];
  const candidates = dedupeMaterialCandidates([
    ...playerIntent.requestedActions
      .filter((entry) => entry.material && entry.status === 'grounded' && entry.operation.kind === 'process.propose')
      .map((action) => ({
        kind: 'action',
        sourceId: action.actionId,
        sourceSpan: action.sourceSpan,
        conceptType: conceptTypeForAction(action.domain),
        domain: action.domain,
        name: action.summary.slice(0, 100),
        description: action.summary,
        targetEntityIds: action.targetEntityIds,
        pace: action.pace,
        effectFamilies: action.effectFamilies,
        evidenceIds: action.evidenceIds,
      })),
    ...playerIntent.proposedInitiatives
      .filter((entry) => entry.material && entry.status === 'grounded')
      .map((initiative) => ({
        kind: 'initiative',
        sourceId: initiative.initiativeId,
        sourceSpan: initiative.sourceSpan,
        conceptType: conceptTypeFor(initiative.kind, initiative.name),
        domain: initiative.kind,
        name: initiative.name,
        description: initiative.description,
        targetEntityIds: initiative.targetEntityIds,
        pace: initiative.pace,
        effectFamilies: initiative.effectFamilies,
        evidenceIds: initiative.evidenceIds,
      })),
  ]);
  for (const initiative of candidates) {
    const proposal = proposalForCandidate(playerIntent.interpretationId, playerIntent.playerPolityId, initiative);
    const affectedEntityRefs = proposal.affectedEntityRefs;
    const resolution = processes.buildSemanticProcessEnginePlan(state, proposal);
    if (!resolution.allowedPacesAfterCommitment.includes(initiative.pace)) {
      throw new Error(`The engine rejects ${initiative.pace} pace for ${initiative.name}; allowed after current commitment: ${resolution.allowedPacesAfterCommitment.join(', ')}.`);
    }
    const accepted = processes.acceptSemanticProcessProposal(state, proposal, resolution.plan);
    state = accepted.state;
    const resourced = processes.commitProcessResources(state, {
      processId: accepted.processId,
      expectedRevision: state.revision,
      investments: [{ investorEntityRef: playerIntent.playerPolityId, amount: resolution.fundingCommitment }],
      capacityUse: resolution.capacityUse,
      evidenceIds: initiative.evidenceIds,
    });
    state = resourced.state;
    const decided = processes.applyProcessDecision(state, {
      processId: accepted.processId,
      direction: proposal.direction,
      pace: initiative.pace,
      effectSelections: initiative.effectFamilies.map((kind) => ({ kind, targetEntityRef: affectedEntityRefs[0] })),
      evidenceIds: initiative.evidenceIds,
    });
    state = decided.state;
    created.push({
      processId: accepted.processId,
      conceptId: accepted.conceptId,
      pace: initiative.pace,
      fundingCommitted: resolution.fundingCommitment,
      revisionAfter: state.revision,
    });
  }
  const createdProposals = [];
  for (const action of playerIntent.requestedActions
    .filter((entry) => entry.material && entry.status === 'grounded' && entry.operation.kind !== 'process.propose')
    .sort((left, right) => left.actionId.localeCompare(right.actionId))) {
    const operation = action.operation;
    const base = {
      proposalId: hashId('proposal', [playerIntent.interpretationId, action.actionId]),
      proposerPolityId: playerIntent.playerPolityId,
    };
    const request = operation.kind === 'diplomacy.propose'
      ? {
        ...base, recipientPolityIds: operation.recipientPolityIds,
        terms: [{ kind: 'relationship', relationshipTypeId: operation.relationshipTypeId, participantPolityIds: [playerIntent.playerPolityId, ...operation.recipientPolityIds] }],
      }
      : {
        ...base, recipientPolityIds: [operation.recipientPolityId],
        terms: [{ kind: 'territorial-cession', regionId: operation.regionId, fromPolityId: playerIntent.playerPolityId, toPolityId: operation.recipientPolityId }],
      };
    state = worldV2.proposeDiplomaticProposal(state, { ...request, evidenceIds: action.evidenceIds, expectedRevision: state.revision });
    createdProposals.push({ proposalId: request.proposalId, actionId: action.actionId, revisionAfter: state.revision });
  }
  return { state, created, createdProposals };
}

export const readLivingWorld = (gameId, { locale = 'en' } = {}) => response(gameId, locale);

export function submitLivingWorldIntent(gameId, { revision, sessionRevision, intentions, modelOutput, modelMetadata, locale = 'en' } = {}) {
  const { session, playerPolityId } = requireSession(gameId);
  assertConcurrency(session, revision, sessionRevision);
  if (session.playerIntent?.status === 'pending') throw new Error('Resolve the pending interpretation before submitting another intent.');
  commit(gameId, session, { playerIntent: buildPendingIntent(session, playerPolityId, intentions, modelOutput, modelMetadata) });
  return response(gameId, locale);
}

export function confirmLivingWorldIntent(gameId, { revision, sessionRevision, interpretationId, locale = 'en' } = {}) {
  const { session } = requireSession(gameId);
  assertConcurrency(session, revision, sessionRevision);
  if (session.playerIntent?.status !== 'pending' || session.playerIntent.interpretationId !== interpretationId) {
    throw new Error('Pending interpretation does not match this confirmation.');
  }
  const materialized = materializeConfirmedInitiatives(session.state, session.playerIntent);
  commit(gameId, session, {
    state: materialized.state,
    lastTransition: {
      kind: 'player-intent-confirmed',
      interpretationId,
      modelMetadata: session.playerIntent.modelMetadata ?? null,
      createdProcesses: materialized.created,
      createdDiplomaticProposals: materialized.createdProposals,
    },
    playerIntent: { ...session.playerIntent, status: 'confirmed' },
  });
  return response(gameId, locale);
}

export function dismissLivingWorldIntent(gameId, { revision, sessionRevision, interpretationId, locale = 'en' } = {}) {
  const { session } = requireSession(gameId);
  assertConcurrency(session, revision, sessionRevision);
  if (session.playerIntent?.status !== 'pending' || session.playerIntent.interpretationId !== interpretationId) {
    throw new Error('Pending interpretation does not match this dismissal.');
  }
  commit(gameId, session, { playerIntent: null });
  return response(gameId, locale);
}

export function advanceLivingWorld(gameId, {
  revision, sessionRevision, optionId, strategicAttempts,
  strategicDisposition = 'resolve', strategicModelMetadata, locale = 'en',
} = {}) {
  const { session, playerPolityId } = requireSession(gameId);
  assertConcurrency(session, revision, sessionRevision);
  const submonthCount = optionId === 'advance-three-months' ? 3 : optionId === 'advance-one-month' ? 1 : 0;
  if (submonthCount === 0) throw new Error(`Unsupported time option ${String(optionId)}.`);
  if (session.playerIntent?.status === 'pending') throw new Error('Confirm or revise the pending interpretation before advancing time.');
  const strategicTasks = buildLivingWorldStrategicTasks(session.state, playerPolityId, session.agentState);
  if (strategicDisposition !== 'resolve' && strategicDisposition !== 'continue-without-decisions') {
    throw new Error(`Unsupported strategic disposition ${String(strategicDisposition)}.`);
  }
  const strategy = strategicDisposition === 'continue-without-decisions'
    ? {
      state: session.state,
      strategicState: session.agentState,
      records: strategicTasks.map((task) => ({
        taskKey: task.taskKey, actorPolityId: task.actorPolityId, status: 'skipped',
        materializedProcessIds: [], errors: ['Explicitly continued without this required strategic decision.'],
      })),
      blockedTasks: [],
    }
    : resolveLivingWorldStrategicTasks(session.state, strategicTasks, strategicAttempts, session.agentState);
  if (strategy.blockedTasks.length > 0) {
    commit(gameId, session, {
      state: session.state,
      lastTransition: {
        kind: 'strategic-checkpoint-blocked',
        modelMetadata: sanitizeModelMetadata(strategicModelMetadata, 'strategic'),
        strategicRecords: strategy.records,
        blockedTasks: strategy.blockedTasks,
      },
      strategicState: session.agentState,
      agentTurn: {
        schemaVersion: 'open-historia-agent-turn/2',
        kind: 'strategic-checkpoint-blocked',
        worldRevisionBefore: session.state.revision,
        worldRevisionAfter: session.state.revision,
        month: session.state.month,
        strategicRecords: strategy.records,
        strategicCheckpoint: {
          revision: session.state.revision,
          month: session.state.month,
          blockedTasks: strategy.blockedTasks,
          availableActions: ['retry', 'continue-without-decisions'],
        },
      },
      playerIntent: session.playerIntent,
    });
    return response(gameId, locale);
  }
  const batch = resolveLivingWorldSubmonths(strategy.state, submonthCount);
  const { state, submonths } = batch;
  commit(gameId, session, {
    state,
    lastTransition: {
      kind: 'world-month-advanced',
      modelMetadata: sanitizeModelMetadata(strategicModelMetadata, 'strategic'),
      strategicRecords: strategy.records,
      submonths,
    },
    strategicState: strategy.strategicState,
    agentTurn: {
      schemaVersion: 'open-historia-agent-turn/2',
      worldRevisionBefore: session.state.revision,
      worldRevisionAfter: state.revision,
      month: state.month,
      strategicRecords: strategy.records,
    },
    playerIntent: session.playerIntent?.status === 'confirmed' ? null : session.playerIntent,
    playerDecisionIndex: (session.playerDecisionIndex ?? 0) + (optionId === 'advance-three-months' ? 1 : 0),
  });
  return response(gameId, locale);
}

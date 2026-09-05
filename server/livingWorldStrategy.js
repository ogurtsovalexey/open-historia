import crypto from 'node:crypto';
import { exportJsonSchema } from '@open-historia/domain';
import { processes, worldV2 } from '@open-historia/engine';
import {
  commitStrategicMemoryV5,
  renderStrategicPromptV5,
  resolveStrategicDecisionV5,
  strategicBriefV5Schema,
  strategicDecisionV4Schema,
} from '@open-historia/agent-runtime';

const SYSTEM_PROMPT = 'Make one bounded strategic decision for this polity only. Preserve causal grounding. Choose only published IDs, qualitative pace, and semantic effect families. The engine owns all numbers and outcomes.';
const hashId = (prefix, values) => `${prefix}:${crypto.createHash('sha256').update(values.join('\u001f')).digest('hex').slice(0, 32)}`;
const labelOf = (value) => String(value ?? '').split(':').at(-1).replaceAll('-', ' ');
const localized = (value) => value?.en ?? value?.ru ?? '';
const unique = (values) => [...new Set(values)].sort();
const actorShard = (polityId) => [...polityId].reduce((sum, character) => sum + character.codePointAt(0), 0) % 3;
const BACKGROUND_TASK_LIMIT = 4;

function memoryFor(strategicState, polityId) {
  return strategicState?.polities?.find((entry) => entry.polityId === polityId) ?? {
    polityId, durablePlan: null, evidenceIds: [], lastAcceptedRevision: null,
    reviewedEvidenceIds: [], lastReviewedRevision: null,
  };
}

function visibleEvidence(state, polityId) {
  return worldV2.selectEvidenceRegistry(state, polityId).value.entries
    // Clock ticks are canonical, but do not by themselves require an actor to
    // consume a strategic-model call. Material evidence remains visible.
    .filter((entry) => entry.canonicalPointers.length > 0 && entry.kind !== 'clock-transition')
    .slice(0, 48)
    .map((entry) => ({
      evidenceId: entry.evidenceId,
      sourceRevision: entry.revision,
      validAtRevision: state.revision,
      visibility: entry.visibility === 'public' ? 'public' : 'actor-private',
      ownerPolityId: entry.visibility === 'public' ? null : polityId,
      summary: `${labelOf(entry.kind)} evidence`,
      canonicalPointers: entry.canonicalPointers.slice(0, 12),
    }));
}

function buildBrief(state, polity, strategicState, pendingProposals = []) {
  const evidence = visibleEvidence(state, polity.id);
  if (evidence.length === 0) return null;
  const factId = evidence[0].evidenceId;
  const snapshot = worldV2.derivePolitySnapshot(state, polity.id).value;
  const checkpointId = `checkpoint:strategic-${state.turn}-${polity.id.slice(7)}`;
  const targets = [
    polity.id,
    ...snapshot.contributions.filter((entry) => entry.controlledPopulation > 0).map((entry) => entry.regionId).slice(0, 12),
  ];
  const actorProcesses = processes.activeProcesses(state).filter((entry) => entry.sponsorEntityRefs.includes(polity.id));
  const processOptions = actorProcesses.slice(0, 12).map((process) => {
    const envelope = processes.buildFeasibilityEnvelope(state, process);
    const visibleIds = new Set(evidence.map((entry) => entry.evidenceId));
    const factsUsed = envelope.evidenceIds.filter((id) => visibleIds.has(id)).slice(0, 12);
    return {
      processId: process.processId,
      checkpointId,
      objective: process.objective,
      stage: process.stage,
      allowedDirections: envelope.allowedDirections.map((directionId) => ({ directionId, summary: labelOf(directionId) })),
      allowedPaces: envelope.allowedPaces,
      compatibleEffectFamilies: envelope.compatibleEffectFamilies.filter((kind) => processes.materializableEffectKinds.includes(kind)),
      allowedTargetEntityRefs: process.affectedEntityRefs.filter((ref) => targets.includes(ref)).slice(0, 16),
      blockers: envelope.blockers.filter((id) => visibleIds.has(id)).slice(0, 12),
      accelerators: envelope.accelerators.filter((id) => visibleIds.has(id)).slice(0, 12),
      opportunityCosts: envelope.opportunityCosts.map((entry) => `${labelOf(entry.resourceId)} ${entry.amount}`).slice(0, 8),
      factsUsed: factsUsed.length > 0 ? factsUsed : [factId],
    };
  });
  const domains = unique(state.concepts.flatMap((concept) => concept.domains)).slice(0, 16);
  const frozenChoices = pendingProposals.flatMap((proposal) => {
    const visibleFacts = proposal.evidenceIds.filter((id) => evidence.some((entry) => entry.evidenceId === id));
    const factsUsed = visibleFacts.length > 0 ? [visibleFacts[0]] : [factId];
    const territorial = proposal.terms.filter((term) => term.kind === 'territorial-cession').map((term) => labelOf(term.regionId)).join(', ');
    const relationship = proposal.terms.filter((term) => term.kind === 'relationship').map((term) => labelOf(term.relationshipTypeId)).join(', ');
    const subject = territorial || relationship || 'diplomatic proposal';
    return ['accept', 'reject'].map((decision) => ({
      choiceId: `choice:proposal-${decision}-${proposal.proposalId.slice('proposal:'.length)}`,
      family: 'choice-family:diplomatic-proposal', materializationRef: proposal.proposalId,
      triggerIds: [proposal.proposalId], factsUsed,
      summary: `${decision === 'accept' ? 'Accept' : 'Reject'} ${subject} proposed by ${labelOf(proposal.proposerPolityId)}.`,
      preview: {
        feasibility: decision === 'accept' ? 'feasible' : 'feasible',
        consequence: decision === 'accept' ? 'Commits only the published terms through the deterministic agreement reducer.' : 'Records a refusal without material territorial change.',
        factsUsed,
      },
    }));
  });
  const brief = {
    schemaVersion: 'open-historia-strategic-brief/5',
    decisionSchemaVersion: 'open-historia-strategic-decision/4',
    promptContract: 'StrategicBriefV5+StrategicDecisionV4',
    actor: { id: polity.id, name: localized(polity.displayName) },
    month: state.month,
    revision: state.revision,
    checkpoint: {
      checkpointId, reason: 'scheduled-quarter', required: true,
      summary: 'Staggered quarterly strategic review.', triggerIds: [],
    },
    goals: [{ goalId: `goal:preserve-${polity.id.slice(7)}`, summary: 'Preserve sovereignty and useful capacity.', factsUsed: [factId] }],
    redLines: ['Do not rely on invented history, resources, territory, forces, or completed outcomes.'],
    materialSituation: [{
      situationId: `situation:condition-${polity.id.slice(7)}`, domain: 'general', severity: 'watch',
      summary: `${snapshot.controlledPopulation} people under actual control; treasury ${snapshot.treasury}; fielded personnel ${snapshot.fieldedPersonnel}.`,
      factsUsed: [factId],
    }],
    claims: [], evidence, frozenChoices, processOptions,
    initiativeEnvelope: {
      allowedConceptTypes: ['technology', 'ideology', 'religious-movement', 'institution', 'doctrine', 'economic-practice', 'scientific-theory'],
      allowedDomains: domains.length > 0 ? domains : ['domain:general'],
      allowedDirectionIds: ['direction:develop', 'direction:investigate', 'direction:organize'],
      allowedSponsorEntityRefs: [polity.id],
      allowedTargetEntityRefs: targets,
      allowedEffectFamilies: [...processes.materializableEffectKinds],
    },
    candidateAudit: [],
    durablePlan: memoryFor(strategicState, polity.id).durablePlan,
    changesSinceLastDecision: [`Canonical review at ${state.month}.`],
  };
  return strategicBriefV5Schema.parse(brief);
}

function requiresBackgroundReview(state, polity, strategicState) {
  const memory = memoryFor(strategicState, polity.id);
  if (!memory.durablePlan) return true;
  const reviewed = new Set(memory.reviewedEvidenceIds ?? []);
  return visibleEvidence(state, polity.id).some((entry) => !reviewed.has(entry.evidenceId));
}

/**
 * Build only meaningful actor-private checkpoints. Autonomous reviews are
 * sparse and capped; directly addressed actors (wired by diplomacy in R2)
 * are intentionally allowed ahead of that background budget.
 */
export function buildLivingWorldStrategicTasks(state, playerPolityId, strategicState, options = {}) {
  const pendingByRecipient = new Map();
  for (const proposal of state.diplomaticProposals.filter((entry) => entry.status === 'pending')) {
    for (const recipientId of proposal.recipientPolityIds) {
      const proposals = pendingByRecipient.get(recipientId) ?? [];
      proposals.push(proposal);
      pendingByRecipient.set(recipientId, proposals);
    }
  }
  const directedPolityIds = new Set([...(options.directedPolityIds ?? []), ...pendingByRecipient.keys()]);
  const backgroundTaskLimit = options.backgroundTaskLimit ?? BACKGROUND_TASK_LIMIT;
  const actors = state.polities
    .filter((polity) => polity.id !== playerPolityId && polity.decisionMode !== 'inert')
    .sort((left, right) => left.id.localeCompare(right.id));
  const directed = actors.filter((polity) => directedPolityIds.has(polity.id));
  const background = actors.filter((polity) => (
    !directedPolityIds.has(polity.id)
    && polity.decisionMode === 'active'
    && actorShard(polity.id) === state.turn % 3
    && requiresBackgroundReview(state, polity, strategicState)
  )).slice(0, backgroundTaskLimit);
  return [...directed, ...background].map((polity) => {
    const proposals = (pendingByRecipient.get(polity.id) ?? []).sort((left, right) => left.proposalId.localeCompare(right.proposalId));
    const brief = buildBrief(state, polity, strategicState, proposals);
    if (!brief) return null;
    const taskKey = `strategic-v5:${state.turn}:${polity.id}`;
    return {
      taskKey,
      actorPolityId: polity.id,
      proposalResponses: Object.fromEntries(proposals.flatMap((proposal) => [
        [`choice:proposal-accept-${proposal.proposalId.slice('proposal:'.length)}`, { proposalId: proposal.proposalId, decision: 'accept' }],
        [`choice:proposal-reject-${proposal.proposalId.slice('proposal:'.length)}`, { proposalId: proposal.proposalId, decision: 'reject' }],
      ])),
      reviewEvidenceIds: brief.evidence.map((entry) => entry.evidenceId),
      brief,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: renderStrategicPromptV5(brief),
      tool: {
        name: 'submit_strategic_decision_v4',
        description: 'Submit one bounded strategic decision for this actor and frozen revision.',
        schema: exportJsonSchema(strategicDecisionV4Schema),
      },
    };
  }).filter(Boolean).sort((left, right) => left.taskKey.localeCompare(right.taskKey));
}

function normalizeAttempt(task, submitted) {
  const metadata = {
    provider: 'configured-runtime', model: 'configured-strategic-model', effort: 'configured',
    requestId: hashId('request', [task.taskKey]),
  };
  if (submitted?.status === 'succeeded') return { status: 'succeeded', metadata, response: submitted.modelOutput };
  return {
    status: 'failed', metadata,
    failure: { kind: 'provider', message: String(submitted?.message ?? 'Strategic model call was unavailable.').slice(0, 320) },
  };
}

function proposalFor(task, proposal, evidenceIds) {
  return {
    semanticProposalId: hashId('semantic-proposal', [task.taskKey, proposal.displayName.en, ...proposal.domainIds]),
    type: proposal.type,
    displayName: proposal.displayName,
    description: proposal.description,
    originEntityRefs: [task.actorPolityId],
    parentConceptIds: [],
    domains: proposal.domainIds,
    objective: proposal.objective,
    direction: proposal.directionId,
    sponsorEntityRefs: proposal.sponsorEntityRefs,
    affectedEntityRefs: proposal.affectedEntityRefs,
    pace: 'stalled',
    effectFamilies: proposal.effectFamilies,
    evidenceIds,
  };
}

function materializeInitiative(state, task, proposal) {
  const semantic = proposalFor(task, proposal, proposal.factsUsed);
  const resolution = processes.buildSemanticProcessEnginePlan(state, semantic);
  if (!resolution.allowedPacesAfterCommitment.includes(proposal.pace)) {
    throw new Error(`Engine rejected ${proposal.pace} pace; allowed ${resolution.allowedPacesAfterCommitment.join(', ')}`);
  }
  const accepted = processes.acceptSemanticProcessProposal(state, semantic, resolution.plan);
  let next = accepted.state;
  if (resolution.fundingCommitment > 0) {
    next = processes.commitProcessResources(next, {
      processId: accepted.processId, expectedRevision: next.revision,
      investments: [{ investorEntityRef: task.actorPolityId, amount: resolution.fundingCommitment }],
      capacityUse: resolution.capacityUse, evidenceIds: proposal.factsUsed,
    }).state;
  }
  next = processes.applyProcessDecision(next, {
    processId: accepted.processId, direction: proposal.directionId, pace: proposal.pace,
    effectSelections: proposal.effectFamilies.map((kind) => ({ kind, targetEntityRef: proposal.affectedEntityRefs[0] ?? task.actorPolityId })),
    evidenceIds: proposal.factsUsed,
  }).state;
  return { state: next, processId: accepted.processId };
}

export function resolveLivingWorldStrategicTasks(stateInput, tasks, submittedAttempts = [], strategicStateInput) {
  const attempts = new Map(submittedAttempts.map((entry) => [entry.taskKey, entry]));
  const prior = strategicStateInput?.schemaVersion === 'open-historia-strategic-memory/1'
    ? strategicStateInput : { schemaVersion: 'open-historia-strategic-memory/1', polities: [] };
  const resolutions = [];
  for (const task of [...tasks].sort((left, right) => left.taskKey.localeCompare(right.taskKey))) {
    const resolution = resolveStrategicDecisionV5(task.brief, normalizeAttempt(task, attempts.get(task.taskKey)));
    resolutions.push({ task, resolution });
  }
  const blockedTasks = resolutions
    .filter(({ task, resolution }) => task.brief.checkpoint.required && resolution.status !== 'accepted')
    .map(({ task, resolution }) => ({
      taskKey: task.taskKey,
      actorPolityId: task.actorPolityId,
      status: resolution.status,
      reason: resolution.status === 'accepted' ? '' : resolution.reason,
    }));
  if (blockedTasks.length > 0) {
    return {
      state: stateInput,
      strategicState: structuredClone(prior),
      records: resolutions.map(({ task, resolution }) => ({
        taskKey: task.taskKey, actorPolityId: task.actorPolityId, status: resolution.status,
        materializedProcessIds: [], errors: resolution.status === 'accepted' ? [] : [resolution.reason],
      })),
      blockedTasks,
    };
  }

  let state = stateInput;
  const memories = new Map((prior.polities ?? []).map((entry) => [entry.polityId, entry]));
  const records = [];
  for (const { task, resolution } of resolutions) {
    const record = { taskKey: task.taskKey, actorPolityId: task.actorPolityId, status: resolution.status, materializedProcessIds: [], errors: [] };
    if (resolution.status === 'accepted') {
      const selectedResponses = resolution.semanticPackage.selectedChoiceIds
        .map((choiceId) => task.proposalResponses?.[choiceId])
        .filter(Boolean);
      const responseProposalIds = selectedResponses.map((response) => response.proposalId);
      if (new Set(responseProposalIds).size !== responseProposalIds.length) {
        record.errors.push('A diplomatic proposal cannot be both accepted and rejected in one decision.');
      }
      for (const response of selectedResponses) {
        try {
          state = worldV2.resolveDiplomaticProposal(state, {
            proposalId: response.proposalId, actorPolityId: task.actorPolityId,
            decision: response.decision, expectedRevision: state.revision,
          });
        } catch (error) { record.errors.push(error instanceof Error ? error.message : String(error)); }
      }
      for (const decision of resolution.semanticPackage.processDecisions) {
        try {
          state = processes.applyProcessDecision(state, {
            processId: decision.processId, direction: decision.directionId, pace: decision.pace,
            effectSelections: decision.effectFamilies.map((kind, index) => ({ kind, targetEntityRef: decision.targetEntityRefs[index] ?? decision.targetEntityRefs[0] })),
            evidenceIds: decision.factsUsed,
          }).state;
        } catch (error) { record.errors.push(error instanceof Error ? error.message : String(error)); }
      }
      for (const proposal of resolution.semanticPackage.initiativeProposals) {
        try {
          const materialized = materializeInitiative(state, task, proposal);
          state = materialized.state;
          record.materializedProcessIds.push(materialized.processId);
        } catch (error) { record.errors.push(error instanceof Error ? error.message : String(error)); }
      }
    } else record.errors.push(resolution.reason);
    records.push(record);
  }
  // Materialization failures are also required-checkpoint failures. Return to
  // the original immutable state instead of committing a partial actor batch.
  const materializationFailures = records.filter((record) => record.errors.length > 0);
  if (materializationFailures.length > 0) {
    return {
      state: stateInput,
      strategicState: structuredClone(prior),
      records,
      blockedTasks: materializationFailures.map((record) => ({
        taskKey: record.taskKey, actorPolityId: record.actorPolityId,
        status: 'rejected', reason: record.errors.join(' ').slice(0, 320),
      })),
    };
  }
  for (const { task, resolution } of resolutions) {
    if (resolution.status !== 'accepted') continue;
    memories.set(task.actorPolityId, {
      ...commitStrategicMemoryV5(memoryFor(prior, task.actorPolityId), resolution),
      reviewedEvidenceIds: [...task.reviewEvidenceIds],
      lastReviewedRevision: stateInput.revision,
    });
  }
  return {
    state,
    strategicState: { schemaVersion: 'open-historia-strategic-memory/1', polities: [...memories.values()].sort((left, right) => left.polityId.localeCompare(right.polityId)) },
    records,
    blockedTasks: [],
  };
}

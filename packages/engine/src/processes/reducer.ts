import { createHash } from 'node:crypto';
import { z } from 'zod';
import { nextRevisionLineage, stampWorldStateRevision } from '../world/revision.js';
import {
  evidenceRecordSchema,
  worldEventSchema,
  type WorldStateV2,
  type WorldStateV2Input,
} from '../world/schema.js';
import {
  applyPermanentEffect,
  assertEffectFamiliesAllowed,
  deriveCheckpointPermanentEffects,
  type AppliedPermanentEffect,
  type PermanentEffect,
} from './effects.js';
import { buildFeasibilityEnvelope, computeProcessProgressDelta } from './feasibility.js';
import {
  normalizeSemanticKey,
  processEnginePlanSchema,
  processPaceSchema,
  processResourceCommitmentSchema,
  processStableIdSchema,
  semanticProcessProposalSchema,
  type ConceptState,
  type SemanticProcessProposal,
  type WorldProcessState,
} from './schema.js';

const stages: readonly WorldProcessState['stage'][] = [
  'proposed', 'emerging', 'organized', 'demonstrated', 'adopted', 'institutionalized',
];
const proposalDecisionSchema = z.object({
  processId: z.string().regex(/^process:[a-z0-9][a-z0-9._-]{0,139}$/),
  direction: processStableIdSchema,
  pace: processPaceSchema,
  effectSelections: z.array(z.object({
    kind: z.enum([
      'capacity.modify', 'efficiency.modify', 'resource-access.modify', 'recipe.unlock',
      'project-capacity.modify', 'administrative-access.modify', 'recruitment-access.modify',
      'supply-capacity.modify', 'group-support.shift', 'identity-share.shift',
      'legitimacy.modify', 'relation.modify', 'knowledge.reveal', 'institution.create',
    ]),
    targetEntityRef: processStableIdSchema,
  }).strict()),
  evidenceIds: z.array(z.string().regex(/^evidence:[a-z0-9][a-z0-9._-]{0,139}$/)),
}).strict();
export type ProcessDecision = z.infer<typeof proposalDecisionSchema>;

export interface ProcessCausalRecord {
  eventId: string;
  revisionBefore: WorldStateV2['revision'];
  revisionAfter: WorldStateV2['revision'];
}

export interface ProcessTransitionResult {
  state: WorldStateV2;
  processId: string;
  conceptId: string | null;
  eventIds: string[];
  evidenceIds: string[];
  appliedEffects: AppliedPermanentEffect[];
  causalRecord: ProcessCausalRecord | null;
  deduplicated: boolean;
}

const hashId = (prefix: string, parts: readonly string[]): string => {
  const digest = createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 24);
  return `${prefix}:${digest}`;
};
const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

function requireKnownRefs(state: WorldStateV2, proposal: SemanticProcessProposal): void {
  const entities = new Set<string>([
    ...state.polities.map((entry) => entry.id as string),
    ...state.regions.map((entry) => entry.regionId as string),
    ...state.populationCohorts.map((entry) => entry.cohortId as string),
    ...state.formations.map((entry) => entry.formationId as string),
    ...state.routes.map((entry) => entry.routeId as string),
    ...state.characters.map((entry) => entry.characterId as string),
    ...state.groups.map((entry) => entry.groupId as string),
    ...state.institutions.map((entry) => entry.institutionId as string),
    ...state.concepts.map((entry) => entry.conceptId as string),
    ...state.processes.map((entry) => entry.processId as string),
    ...state.relationships.map((entry) => entry.relationshipId as string),
  ]);
  const evidence = new Set(state.evidence.map((entry) => entry.evidenceId as string));
  const concepts = new Set(state.concepts.map((entry) => entry.conceptId as string));
  for (const ref of [...proposal.originEntityRefs, ...proposal.sponsorEntityRefs, ...proposal.affectedEntityRefs]) {
    if (!entities.has(ref)) throw new Error(`Semantic proposal references unknown entity ${ref}`);
  }
  for (const id of proposal.evidenceIds) if (!evidence.has(id)) throw new Error(`Semantic proposal references unknown evidence ${id}`);
  for (const id of proposal.parentConceptIds) if (!concepts.has(id)) throw new Error(`Semantic proposal references unknown parent concept ${id}`);
  const normalizedProhibitions = state.worldRules.hardProhibitions.flatMap((value) => {
    try { return [normalizeSemanticKey(value)]; } catch { return []; }
  });
  const semanticKey = normalizeSemanticKey(proposal.displayName.en);
  if (normalizedProhibitions.includes(semanticKey)) throw new Error(`Concept ${semanticKey} is prohibited by world rules`);
}

function commitProcessMutation(
  previous: WorldStateV2,
  mutated: WorldStateV2,
  processId: string,
  conceptId: string | null,
  action: string,
  sourceEvidenceIds: readonly string[],
  deduplicated: boolean,
  appliedEffects: AppliedPermanentEffect[] = [],
  changedEntityRefs: readonly string[] = [],
  changedPointers: readonly string[] = [],
): ProcessTransitionResult {
  if (deduplicated) {
    return { state: previous, processId, conceptId, eventIds: [], evidenceIds: [], appliedEffects: [], causalRecord: null, deduplicated: true };
  }
  const eventId = hashId('event', [previous.revision, processId, action]);
  const evidenceId = hashId('evidence', [eventId]);
  const event = worldEventSchema.parse({
    eventId,
    revision: previous.revision,
    kind: `process-${action}`,
    entityRefs: uniqueSorted([
      processId,
      ...(conceptId ? [conceptId] : []),
      ...appliedEffects.map((effect) => effect.targetEntityRef),
      ...changedEntityRefs,
    ]),
    evidenceIds: uniqueSorted([evidenceId, ...sourceEvidenceIds]),
  });
  const conceptIndex = conceptId === null ? -1 : [...mutated.concepts]
    .sort((left, right) => left.conceptId < right.conceptId ? -1 : left.conceptId > right.conceptId ? 1 : 0)
    .findIndex((entry) => entry.conceptId === conceptId);
  const processIndex = [...mutated.processes]
    .sort((left, right) => left.processId < right.processId ? -1 : left.processId > right.processId ? 1 : 0)
    .findIndex((entry) => entry.processId === processId);
  const effectPointers = appliedEffects.map((effect) => {
    const regionIndex = [...mutated.regions]
      .sort((left, right) => left.regionId < right.regionId ? -1 : left.regionId > right.regionId ? 1 : 0)
      .findIndex((entry) => entry.regionId === effect.targetEntityRef);
    return `/regions/${regionIndex}/${effect.parameter}`;
  });
  const evidence = evidenceRecordSchema.parse({
    evidenceId,
    revision: previous.revision,
    kind: 'process-transition',
    entityRefs: event.entityRefs,
    eventRefs: [eventId],
    canonicalPointers: uniqueSorted([
      `/processes/${processIndex}`,
      ...(conceptIndex >= 0 ? [`/concepts/${conceptIndex}`] : []),
      ...effectPointers,
      ...changedPointers,
    ]),
    visibility: 'public',
  });
  const concepts = mutated.concepts.map((concept) => concept.conceptId === conceptId
    ? { ...concept, evidenceIds: uniqueSorted([...concept.evidenceIds, evidenceId]) }
    : concept);
  const processes = mutated.processes.map((process) => process.processId === processId
    ? { ...process, evidenceIds: uniqueSorted([...process.evidenceIds, evidenceId, ...sourceEvidenceIds]) }
    : process);
  const { revision: _mutatedRevision, ...mutatedContent } = mutated;
  void _mutatedRevision;
  const input: WorldStateV2Input = {
    ...mutatedContent,
    revisionLineage: nextRevisionLineage(previous),
    concepts,
    processes,
    events: [...mutated.events, event],
    evidence: [...mutated.evidence, evidence],
  };
  const state = stampWorldStateRevision(input);
  return {
    state,
    processId,
    conceptId,
    eventIds: [eventId],
    evidenceIds: [evidenceId],
    appliedEffects,
    causalRecord: { eventId, revisionBefore: previous.revision, revisionAfter: state.revision },
    deduplicated: false,
  };
}

export function acceptSemanticProcessProposal(
  state: WorldStateV2,
  proposalInput: unknown,
  enginePlanInput: unknown,
): ProcessTransitionResult {
  const proposal = semanticProcessProposalSchema.parse(proposalInput);
  const plan = processEnginePlanSchema.parse(enginePlanInput);
  if (plan.initialFunding !== 0 || plan.investments.length !== 0 || plan.capacityUse.length !== 0) {
    throw new Error('A semantic proposal may create only an unfunded proposed process');
  }
  assertEffectFamiliesAllowed(proposal.effectFamilies, plan.compatibleEffectFamilies);
  requireKnownRefs(state, proposal);
  const semanticKey = normalizeSemanticKey(proposal.displayName.en);
  const equivalentConcept = proposal.equivalentConceptId
    ? state.concepts.find((entry) => entry.conceptId === proposal.equivalentConceptId)
    : undefined;
  if (proposal.equivalentConceptId && !equivalentConcept) {
    throw new Error(`Equivalent concept ${proposal.equivalentConceptId} is not in the frozen state`);
  }
  const nameCollision = state.concepts.find((entry) => entry.semanticKey === semanticKey);
  const sameProposal = nameCollision?.provenance.kind === 'semantic-proposal'
    && nameCollision.provenance.semanticProposalId === proposal.semanticProposalId;
  if (nameCollision && !proposal.equivalentConceptId && !sameProposal) {
    throw new Error(`Semantic key ${semanticKey} already exists; resolver must provide equivalentConceptId or choose a distinct concept`);
  }
  const existingConcept = equivalentConcept ?? (sameProposal ? nameCollision : undefined);
  if (existingConcept && existingConcept.type !== proposal.type) {
    throw new Error(`Semantic key ${semanticKey} already belongs to ${existingConcept.type}`);
  }
  if (existingConcept && proposal.equivalentConceptId) {
    const domainsMatch = uniqueSorted(existingConcept.domains).join('|') === uniqueSorted(proposal.domains).join('|');
    const parentsMatch = uniqueSorted(existingConcept.parentConceptIds).join('|') === uniqueSorted(proposal.parentConceptIds).join('|');
    const existingProcesses = state.processes.filter((entry) => entry.conceptId === existingConcept.conceptId);
    const compatibleFamilies = new Set(existingProcesses.flatMap((entry) => entry.compatibleEffectFamilies));
    const effectsMatch = proposal.effectFamilies.every((kind) => compatibleFamilies.has(kind));
    if (!domainsMatch || !parentsMatch || !effectsMatch) {
      throw new Error(`Equivalent concept ${existingConcept.conceptId} has incompatible domains, parents or effect families`);
    }
  }
  const conceptId = existingConcept?.conceptId ?? hashId('concept', [state.scenarioId, proposal.type, semanticKey]);
  const processId = hashId('process', [
    state.scenarioId,
    proposal.semanticProposalId,
    conceptId,
    ...uniqueSorted(proposal.sponsorEntityRefs),
  ]);
  if (state.processes.some((entry) => entry.processId === processId)) {
    return commitProcessMutation(state, state, processId, conceptId, 'proposed', proposal.evidenceIds, true);
  }
  const sourceEvidenceId = [...proposal.evidenceIds].sort()[0]!;
  const concept: ConceptState = existingConcept ?? {
    conceptId,
    type: proposal.type,
    semanticKey,
    displayName: proposal.displayName,
    description: proposal.description,
    origin: {
      kind: 'runtime',
      originEntityRefs: uniqueSorted(proposal.originEntityRefs),
      originMonth: state.month,
      ...(proposal.originEntityRefs[0] ? { discovererEntityRef: proposal.originEntityRefs[0] } : {}),
    },
    parentConceptIds: uniqueSorted(proposal.parentConceptIds),
    supportingEvidenceIds: uniqueSorted(proposal.evidenceIds),
    domains: uniqueSorted(proposal.domains),
    status: 'proposed',
    maturityBp: 0,
    diffusion: proposal.affectedEntityRefs.filter((id) => id.startsWith('region:')).map((regionId) => ({ regionId, awarenessBp: 0 })),
    adoption: proposal.affectedEntityRefs.reduce<ConceptState['adoption']>((records, entityId) => {
      if (entityId.startsWith('polity:')) records.push({ scope: 'polity', polityId: entityId, adoptionBp: 0 });
      if (entityId.startsWith('region:')) records.push({ scope: 'region', regionId: entityId, adoptionBp: 0 });
      return records;
    }, []),
    provenance: {
      kind: 'semantic-proposal',
      semanticProposalId: proposal.semanticProposalId,
      sourceEvidenceId,
      createdRevision: state.revision,
      createdMonth: state.month,
    },
    evidenceIds: uniqueSorted(proposal.evidenceIds),
  };
  const process: WorldProcessState = {
    processId,
    conceptId,
    kind: `process-kind:${proposal.type}`,
    objective: proposal.objective,
    direction: proposal.direction,
    sponsorEntityRefs: uniqueSorted(proposal.sponsorEntityRefs),
    affectedEntityRefs: uniqueSorted(proposal.affectedEntityRefs),
    stage: 'proposed',
    progressBp: 0,
    momentumBp: plan.initialMomentumBp,
    resistanceBp: plan.initialResistanceBp,
    funding: plan.initialFunding,
    capacityUse: [...plan.capacityUse],
    investments: [...plan.investments],
    currentPace: proposal.pace,
    blockers: [],
    accelerators: [],
    prerequisites: plan.prerequisites,
    compatibleEffectFamilies: [...new Set(plan.compatibleEffectFamilies)].sort(),
    selectedEffectFamilies: [...new Set(proposal.effectFamilies)].sort(),
    selectedEffects: [],
    startedMonth: state.month,
    lastDecisionMonth: state.month,
    lastAdvancedMonth: null,
    status: 'active',
    evidenceIds: uniqueSorted(proposal.evidenceIds),
  };
  const concepts = existingConcept ? state.concepts : [...state.concepts, concept];
  const mutated = { ...state, concepts, processes: [...state.processes, process] };
  return commitProcessMutation(state, mutated, processId, conceptId, 'proposed', proposal.evidenceIds, false);
}

function nextStage(stage: WorldProcessState['stage']): WorldProcessState['stage'] {
  const index = stages.indexOf(stage);
  return stages[Math.min(stages.length - 1, index + 1)]!;
}

function evolveConcept(concept: ConceptState, process: WorldProcessState): ConceptState {
  const stageIndex = stages.indexOf(process.stage);
  const maturityBp = Math.min(10000, Math.trunc((stageIndex * 10000 + process.progressBp) / (stages.length - 1)));
  const adoptionBp = process.stage === 'institutionalized' ? 10000
    : process.stage === 'adopted' ? Math.max(5000, maturityBp)
      : process.stage === 'demonstrated' ? Math.max(1000, maturityBp) : 0;
  return {
    ...concept,
    status: process.stage,
    maturityBp,
    diffusion: concept.diffusion.map((entry) => ({ ...entry, awarenessBp: Math.max(entry.awarenessBp, maturityBp) })),
    adoption: concept.adoption.map((entry) => ({ ...entry, adoptionBp: Math.max(entry.adoptionBp, adoptionBp) })),
  };
}

export function advanceProcessDeterministically(
  state: WorldStateV2,
  processId: string,
  permanentEffects: readonly PermanentEffect[] = [],
): ProcessTransitionResult {
  const process = state.processes.find((entry) => entry.processId === processId);
  if (!process) throw new Error(`Unknown process ${processId}`);
  if (process.status !== 'active') throw new Error(`Process ${processId} is ${process.status}`);
  if (process.lastAdvancedMonth === state.month) {
    throw new Error(`Process ${processId} already advanced for ${state.month}`);
  }
  const envelope = buildFeasibilityEnvelope(state, process);
  const delta = computeProcessProgressDelta(process, envelope);
  const reachedBoundary = process.progressBp + delta >= 10000;
  const stage = reachedBoundary ? nextStage(process.stage) : process.stage;
  const progressBp = reachedBoundary ? 0 : process.progressBp + delta;
  const status = stage === 'institutionalized' ? 'completed' as const : process.status;
  const updatedProcess = { ...process, stage, progressBp, status, lastAdvancedMonth: state.month };
  let mutated: WorldStateV2 = {
    ...state,
    processes: state.processes.map((entry) => entry.processId === processId ? updatedProcess : entry),
    concepts: state.concepts.map((entry) => entry.conceptId === process.conceptId ? evolveConcept(entry, updatedProcess) : entry),
  };
  const checkpointEffects = permanentEffects.length > 0
    ? permanentEffects
    : reachedBoundary ? deriveCheckpointPermanentEffects(state, process, stage) : [];
  const appliedEffects: AppliedPermanentEffect[] = [];
  if (checkpointEffects.length > 0 && !reachedBoundary) throw new Error('Effects apply only at a stage boundary');
  if (checkpointEffects.length > 0 && stages.indexOf(stage) < stages.indexOf('demonstrated')) {
    throw new Error(`Effects cannot apply before the demonstrated stage`);
  }
  assertEffectFamiliesAllowed(checkpointEffects.map((effect) => effect.kind), process.compatibleEffectFamilies);
  assertEffectFamiliesAllowed(checkpointEffects.map((effect) => effect.kind), process.selectedEffectFamilies);
  for (const effect of checkpointEffects) {
    if (!process.selectedEffects.some((selection) => {
      if (selection.kind !== effect.kind) return false;
      if (selection.targetEntityRef === effect.targetEntityRef) return true;
      return state.regions.some((region) => (
        region.regionId === effect.targetEntityRef
        && region.control.actualControllerPolityId === selection.targetEntityRef
      ));
    })) throw new Error(`Effect ${effect.kind} on ${effect.targetEntityRef} was not selected at a semantic checkpoint`);
    if (effect.sourceProcessId !== processId) throw new Error(`Effect source ${effect.sourceProcessId} does not match process ${processId}`);
    const result = applyPermanentEffect(mutated, effect);
    mutated = result.state;
    appliedEffects.push(result.applied);
  }
  return commitProcessMutation(state, mutated, processId, process.conceptId, `advanced-${stage}`, process.evidenceIds, false, appliedEffects);
}

export function applyProcessDecision(state: WorldStateV2, input: unknown): ProcessTransitionResult {
  const decision = proposalDecisionSchema.parse(input);
  const process = state.processes.find((entry) => entry.processId === decision.processId);
  if (!process) throw new Error(`Unknown process ${decision.processId}`);
  if (decision.direction !== process.direction) throw new Error(`Direction ${decision.direction} is not allowed for ${decision.processId}`);
  const envelope = buildFeasibilityEnvelope(state, process);
  if (!envelope.allowedPaces.includes(decision.pace)) throw new Error(`Pace ${decision.pace} is infeasible`);
  assertEffectFamiliesAllowed(decision.effectSelections.map((entry) => entry.kind), process.compatibleEffectFamilies);
  for (const selection of decision.effectSelections) {
    if (!process.affectedEntityRefs.includes(selection.targetEntityRef)) {
      throw new Error(`Effect target ${selection.targetEntityRef} is outside process scope`);
    }
  }
  const evidence = new Set(state.evidence.map((entry) => entry.evidenceId as string));
  for (const id of decision.evidenceIds) if (!evidence.has(id)) throw new Error(`Decision references unknown evidence ${id}`);
  const updated = {
    ...process,
    currentPace: decision.pace,
    selectedEffectFamilies: [...new Set(decision.effectSelections.map((entry) => entry.kind))].sort(),
    selectedEffects: [...decision.effectSelections].sort((left, right) => {
      const leftKey = `${left.kind}|${left.targetEntityRef}`;
      const rightKey = `${right.kind}|${right.targetEntityRef}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
    lastDecisionMonth: state.month,
  };
  const mutated = { ...state, processes: state.processes.map((entry) => entry.processId === decision.processId ? updated : entry) };
  return commitProcessMutation(state, mutated, process.processId, process.conceptId, 'decision', decision.evidenceIds, false);
}

/**
 * Commits exact engine-resolved funding/capacity after a semantic stance has
 * been confirmed. This is deliberately separate from the model proposal.
 */
export function commitProcessResources(state: WorldStateV2, input: unknown): ProcessTransitionResult {
  const commitment = processResourceCommitmentSchema.parse(input);
  if (commitment.expectedRevision !== state.revision) {
    throw new Error(`Process resource commitment expected ${commitment.expectedRevision}, current revision is ${state.revision}`);
  }
  const process = state.processes.find((entry) => entry.processId === commitment.processId);
  if (!process) throw new Error(`Unknown process ${commitment.processId}`);
  if (process.status !== 'active') throw new Error(`Process ${commitment.processId} is ${process.status}`);
  const evidenceIds = new Set(state.evidence.map((entry) => entry.evidenceId as string));
  for (const evidenceId of commitment.evidenceIds) {
    if (!evidenceIds.has(evidenceId)) throw new Error(`Resource commitment references unknown evidence ${evidenceId}`);
  }

  const sponsorPolityIds = new Set<string>();
  for (const sponsorRef of process.sponsorEntityRefs) {
    const polity = state.polities.find((entry) => entry.id === sponsorRef);
    if (polity) sponsorPolityIds.add(polity.id);
    const region = state.regions.find((entry) => entry.regionId === sponsorRef);
    if (region) sponsorPolityIds.add(region.control.actualControllerPolityId);
    const character = state.characters.find((entry) => entry.characterId === sponsorRef);
    if (character?.polityId) sponsorPolityIds.add(character.polityId);
    const group = state.groups.find((entry) => entry.groupId === sponsorRef);
    if (group?.polityId) sponsorPolityIds.add(group.polityId);
    const institution = state.institutions.find((entry) => entry.institutionId === sponsorRef);
    if (institution?.polityId) sponsorPolityIds.add(institution.polityId);
  }
  const investmentsByPolity = new Map<string, bigint>();
  for (const investment of commitment.investments) {
    if (!sponsorPolityIds.has(investment.investorEntityRef)) {
      throw new Error(`Investor ${investment.investorEntityRef} is outside the process sponsors`);
    }
    investmentsByPolity.set(
      investment.investorEntityRef,
      (investmentsByPolity.get(investment.investorEntityRef) ?? 0n) + BigInt(investment.amount),
    );
  }
  const changedPolityIds = [...investmentsByPolity.keys()].sort();
  const polities = state.polities.map((polity) => {
    const amount = investmentsByPolity.get(polity.id) ?? 0n;
    if (amount > BigInt(polity.treasury)) throw new Error(`Investment exceeds treasury for ${polity.id}`);
    return amount === 0n ? polity : { ...polity, treasury: polity.treasury - Number(amount) };
  });
  const totalInvestment = [...investmentsByPolity.values()].reduce((sum, amount) => sum + amount, 0n);
  const nextFunding = BigInt(process.funding) + totalInvestment;
  if (nextFunding > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Process funding exceeds safe integer range');

  const requiredCapacityKeys = new Set(process.prerequisites.capacity.map((entry) => `${entry.capacityId}|${entry.entityRef}`));
  const capacityKeys = new Set<string>();
  for (const allocation of commitment.capacityUse) {
    const key = `${allocation.capacityId}|${allocation.entityRef}`;
    if (!requiredCapacityKeys.has(key)) throw new Error(`Capacity allocation ${key} is not a declared prerequisite`);
    if (capacityKeys.has(key)) throw new Error(`Duplicate capacity allocation ${key}`);
    capacityKeys.add(key);
    const region = state.regions.find((entry) => entry.regionId === allocation.entityRef);
    if (region && !sponsorPolityIds.has(region.control.actualControllerPolityId)) {
      throw new Error(`Capacity allocation ${key} is outside sponsor control`);
    }
    const polity = state.polities.find((entry) => entry.id === allocation.entityRef);
    if (polity && !sponsorPolityIds.has(polity.id)) {
      throw new Error(`Capacity allocation ${key} is outside sponsor control`);
    }
  }

  const cumulativeInvestments = new Map<string, bigint>();
  for (const investment of [...process.investments, ...commitment.investments]) {
    cumulativeInvestments.set(
      investment.investorEntityRef,
      (cumulativeInvestments.get(investment.investorEntityRef) ?? 0n) + BigInt(investment.amount),
    );
  }
  const investments = [...cumulativeInvestments.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([investorEntityRef, amount]) => {
      if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Investment aggregate exceeds safe integer range for ${investorEntityRef}`);
      return { investorEntityRef, amount: Number(amount) };
    });
  const updated = {
    ...process,
    funding: Number(nextFunding),
    investments,
    capacityUse: [...commitment.capacityUse].sort((left, right) => {
      const leftKey = `${left.capacityId}|${left.entityRef}`;
      const rightKey = `${right.capacityId}|${right.entityRef}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  };
  const mutated = {
    ...state,
    polities,
    processes: state.processes.map((entry) => entry.processId === process.processId ? updated : entry),
  };
  const sortedPolities = [...polities].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const treasuryPointers = changedPolityIds.map((polityId) => `/polities/${sortedPolities.findIndex((entry) => entry.id === polityId)}/treasury`);
  return commitProcessMutation(
    state,
    mutated,
    process.processId,
    process.conceptId,
    'resourced',
    commitment.evidenceIds,
    false,
    [],
    changedPolityIds,
    treasuryPointers,
  );
}

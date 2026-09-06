import { z } from 'zod';
import { processes, worldV2 } from '@open-historia/engine';

const boundedText = z.string().trim().min(1).max(1000);
export const MAX_PLAYER_INPUT_V2_CHARS = 20000;
const interpretationIdSchema = (prefix: 'question' | 'claim' | 'action' | 'initiative') =>
  z.string().max(160).regex(new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]*$`));
const entityIdSchema = z.string().max(160).regex(/^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const sourceSpanSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  text: z.string().min(1).max(4000),
}).strict().refine((span) => span.end >= span.start, { message: 'source span end must not precede start' });

export const questionV2Schema = z.object({
  questionId: interpretationIdSchema('question'),
  text: boundedText,
  sourceSpan: sourceSpanSchema,
}).strict();

export const claimGroundingSchema = z.enum(['supported', 'contradicted', 'unknown', 'subjective']);
export type ClaimGrounding = z.infer<typeof claimGroundingSchema>;
// Claims are not an open-ended narration channel. These are the only
// assertions whose truth WorldStateV2 can establish from control, the causal
// ledger, or formations. A closed vocabulary prevents plausible-looking but
// permanently `unknown` predicates from leaking through the semantic layer.
export const claimPredicateSchema = z.enum(['controls-region', 'conquered-region', 'fielded-personnel']);

const claimV2CommonSchema = {
  claimId: interpretationIdSchema('claim'),
  subject: entityIdSchema,
  proposedTime: z.string().trim().min(1).max(120).nullable(),
  sourceSpan: sourceSpanSchema,
  grounding: claimGroundingSchema,
  evidenceIds: z.array(worldV2.evidenceIdSchema).max(64),
};

// The predicate fixes the value domain. In particular, a region claim cannot
// smuggle a display name such as "Malta": it must name one of the canonical
// `region:*` entities presented to the model.
export const claimV2ModelSchema = z.discriminatedUnion('predicate', [
  z.object({ ...claimV2CommonSchema, predicate: z.literal('controls-region'), proposedValue: entityIdSchema }).strict(),
  z.object({ ...claimV2CommonSchema, predicate: z.literal('conquered-region'), proposedValue: entityIdSchema }).strict(),
  z.object({ ...claimV2CommonSchema, predicate: z.literal('fielded-personnel'), proposedValue: z.number().finite() }).strict(),
]);

export const requestedActionV2ModelSchema = z.object({
  actionId: interpretationIdSchema('action'),
  domain: z.enum(['politics', 'economy', 'military', 'diplomacy', 'society', 'science', 'administration', 'other']),
  scope: z.enum(['domestic', 'external', 'mixed']),
  intent: boundedText,
  pace: z.enum(['stalled', 'slow', 'steady', 'fast', 'breakthrough']),
  effectFamilies: z.array(z.enum([
    'capacity.modify', 'efficiency.modify', 'resource-access.modify', 'recipe.unlock',
    'project-capacity.modify', 'administrative-access.modify', 'recruitment-access.modify',
    'supply-capacity.modify', 'group-support.shift', 'identity-share.shift',
    'legitimacy.modify', 'relation.modify', 'knowledge.reveal', 'institution.create',
  ])).min(1).max(4),
  /** Semantic route only: exact effects, access, profiles and authorities stay engine-owned. */
  operation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('process.propose') }).strict(),
    z.object({ kind: z.literal('process.adjust'), processId: entityIdSchema }).strict(),
    z.object({
      kind: z.literal('diplomacy.propose'),
      recipientPolityIds: z.array(entityIdSchema).min(1).max(16),
      relationshipTypeId: entityIdSchema,
    }).strict(),
    z.object({
      kind: z.literal('territory.offer'),
      recipientPolityId: entityIdSchema,
      regionId: entityIdSchema,
    }).strict(),
    z.object({ kind: z.literal('military.mobilize') }).strict(),
  ]).optional(),
  targetEntityIds: z.array(entityIdSchema).max(64),
  claimRefs: z.array(interpretationIdSchema('claim')).max(64),
  evidenceIds: z.array(worldV2.evidenceIdSchema).max(64),
  sourceSpan: sourceSpanSchema,
}).strict();

export const proposedInitiativeV2ModelSchema = z.object({
  initiativeId: interpretationIdSchema('initiative'),
  kind: z.enum(['technology', 'ideology', 'institution', 'doctrine', 'movement', 'project', 'investigation', 'other']),
  name: z.string().trim().min(1).max(160),
  description: boundedText,
  pace: z.enum(['stalled', 'slow', 'steady', 'fast', 'breakthrough']),
  effectFamilies: z.array(z.enum([
    'capacity.modify', 'efficiency.modify', 'resource-access.modify', 'recipe.unlock',
    'project-capacity.modify', 'administrative-access.modify', 'recruitment-access.modify',
    'supply-capacity.modify', 'group-support.shift', 'identity-share.shift',
    'legitimacy.modify', 'relation.modify', 'knowledge.reveal', 'institution.create',
  ])).min(1).max(4),
  targetEntityIds: z.array(entityIdSchema).max(64),
  evidenceIds: z.array(worldV2.evidenceIdSchema).max(64),
  sourceSpan: sourceSpanSchema,
}).strict();

export const playerInputV2ModelOutputSchema = z.object({
  revision: worldV2.worldRevisionHashSchema,
  questions: z.array(questionV2Schema).max(32),
  claims: z.array(claimV2ModelSchema).max(64),
  requestedActions: z.array(requestedActionV2ModelSchema).max(64),
  proposedInitiatives: z.array(proposedInitiativeV2ModelSchema).max(32),
}).strict().superRefine((output, context) => {
  const collections = [
    ['questions', output.questions.map((entry) => entry.questionId)],
    ['claims', output.claims.map((entry) => entry.claimId)],
    ['requestedActions', output.requestedActions.map((entry) => entry.actionId)],
    ['proposedInitiatives', output.proposedInitiatives.map((entry) => entry.initiativeId)],
  ] as const;
  for (const [field, ids] of collections) {
    const seen = new Set<string>();
    for (const [index, id] of ids.entries()) {
      if (seen.has(id)) context.addIssue({ code: 'custom', path: [field, index], message: `duplicate ${field} ID ${id}` });
      seen.add(id);
    }
  }
});

export type PlayerInputV2ModelOutput = z.infer<typeof playerInputV2ModelOutputSchema>;
export type PlayerInputV2ModelInput = z.input<typeof playerInputV2ModelOutputSchema>;
type ModelClaim = PlayerInputV2ModelOutput['claims'][number];
type ModelAction = PlayerInputV2ModelOutput['requestedActions'][number];
type ModelInitiative = PlayerInputV2ModelOutput['proposedInitiatives'][number];
type ModelQuestion = PlayerInputV2ModelOutput['questions'][number];

export interface GroundedQuestion extends ModelQuestion {
  status: 'grounded' | 'blocked';
  reasons: string[];
}

export interface GroundedClaim extends Omit<ModelClaim, 'grounding'> {
  grounding: ClaimGrounding;
  reasons: string[];
}

export interface GroundedRequestedAction extends ModelAction {
  status: 'grounded' | 'blocked';
  reasons: string[];
}

export interface GroundedProposedInitiative extends ModelInitiative {
  status: 'grounded' | 'blocked';
  reasons: string[];
}

export interface PlayerInputInterpretationV2 {
  actorPolityId: string;
  untrustedPlayerText: string;
  questions: GroundedQuestion[];
  claims: GroundedClaim[];
  requestedActions: GroundedRequestedAction[];
  proposedInitiatives: GroundedProposedInitiative[];
}

export interface InterpretPlayerInputV2Request {
  actorPolityId: string;
  playerText: string;
  modelOutput: unknown;
}

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort(compare);

function spanReasons(playerText: string, span: z.infer<typeof sourceSpanSchema>): string[] {
  if (span.end > playerText.length || playerText.slice(span.start, span.end) !== span.text) return ['invalid-source-span'];
  return [];
}

/**
 * Models sometimes copy an exact clause correctly but miscount its offsets.
 * Repair only an unambiguous verbatim match; a paraphrase, empty span or
 * repeated clause remains blocked, so this cannot broaden the player's order.
 */
function repairVerbatimSourceSpan(playerText: string, span: z.infer<typeof sourceSpanSchema>): z.infer<typeof sourceSpanSchema> {
  if (spanReasons(playerText, span).length === 0) return span;
  const first = playerText.indexOf(span.text);
  if (first < 0 || playerText.indexOf(span.text, first + 1) !== -1) return span;
  return { start: first, end: first + span.text.length, text: span.text };
}

function repairEntrySpan<T extends { sourceSpan: z.infer<typeof sourceSpanSchema> }>(playerText: string, entry: T): T {
  return { ...entry, sourceSpan: repairVerbatimSourceSpan(playerText, entry.sourceSpan) };
}

function entityIds(state: worldV2.WorldStateV2): Set<string> {
  return new Set([
    ...state.polities.map((entry) => entry.id),
    ...state.regions.map((entry) => entry.regionId),
    ...state.populationCohorts.map((entry) => entry.cohortId),
    ...state.formations.map((entry) => entry.formationId),
    ...state.characters.map((entry) => entry.characterId),
    ...state.groups.map((entry) => entry.groupId),
    ...state.institutions.map((entry) => entry.institutionId),
    ...state.concepts.map((entry) => entry.conceptId),
    ...state.processes.map((entry) => entry.processId),
    ...state.relationships.map((entry) => entry.relationshipId),
  ]);
}

function evidenceReasons(
  state: worldV2.WorldStateV2,
  actorPolityId: string,
  evidenceIds: readonly string[],
): { accepted: worldV2.EvidenceId[]; reasons: string[] } {
  const validation = worldV2.validateEvidenceIdsForPolity(state, {
    polityId: actorPolityId,
    expectedRevision: state.revision,
    evidenceIds,
  }).value;
  return {
    accepted: validation.acceptedEvidenceIds,
    reasons: validation.rejected.map((entry) => `evidence-${entry.reason}:${entry.evidenceId}`).sort(compare),
  };
}

function deterministicClaimGrounding(state: worldV2.WorldStateV2, claim: ModelClaim): ClaimGrounding {
  if (claim.grounding === 'subjective') return 'subjective';
  if (claim.predicate === 'controls-region' && typeof claim.proposedValue === 'string') {
    const polity = state.polities.find((entry) => entry.id === claim.subject);
    const region = state.regions.find((entry) => entry.regionId === claim.proposedValue);
    if (!polity || !region) return 'unknown';
    return region.control.actualControllerPolityId === polity.id ? 'supported' : 'contradicted';
  }
  if (claim.predicate === 'conquered-region' && typeof claim.proposedValue === 'string') {
    const polity = state.polities.find((entry) => entry.id === claim.subject);
    const region = state.regions.find((entry) => entry.regionId === claim.proposedValue);
    if (!polity || !region) return 'unknown';
    const recorded = state.events.some((event) =>
      event.kind.includes('territorial-transition')
      && event.entityRefs.includes(polity.id)
      && event.entityRefs.includes(region.regionId));
    // Entity references prove that a territorial event involved both entities,
    // not who gained control. Absence in the complete causal ledger contradicts
    // the claimed event; an ambiguous matching event requires richer evidence.
    return recorded ? 'unknown' : 'contradicted';
  }
  if (claim.predicate === 'fielded-personnel' && typeof claim.proposedValue === 'number') {
    const polity = state.polities.find((entry) => entry.id === claim.subject);
    if (!polity) return 'unknown';
    const actual = state.formations
      .filter((formation) => formation.polityId === polity.id)
      .reduce((sum, formation) => sum + formation.manpower, 0);
    return actual === claim.proposedValue ? 'supported' : 'contradicted';
  }
  return 'unknown';
}

function domesticScopeIsProven(state: worldV2.WorldStateV2, actorPolityId: string, entityId: string): boolean {
  if (entityId === actorPolityId) return true;
  const region = state.regions.find((entry) => entry.regionId === entityId);
  if (region) return region.control.actualControllerPolityId === actorPolityId;
  const formation = state.formations.find((entry) => entry.formationId === entityId);
  if (formation) return formation.polityId === actorPolityId;
  const character = state.characters.find((entry) => entry.characterId === entityId);
  if (character) return character.polityId === actorPolityId;
  const group = state.groups.find((entry) => entry.groupId === entityId);
  if (group) return group.polityId === actorPolityId;
  const institution = state.institutions.find((entry) => entry.institutionId === entityId);
  if (institution) return institution.polityId === actorPolityId;
  const process = state.processes.find((entry) => entry.processId === entityId);
  if (process) return process.sponsorEntityRefs.some((entityRef) => entityRef === actorPolityId);
  return false;
}

function operationReasons(state: worldV2.WorldStateV2, actorPolityId: string, action: ModelAction): string[] {
  const operation = action.operation ?? { kind: 'process.propose' as const };
  if (operation.kind === 'process.propose') return [];
  if (operation.kind === 'process.adjust') {
    const process = state.processes.find((entry) => entry.processId === operation.processId);
    const reasons: string[] = [];
    if (!process) reasons.push(`unknown-process:${operation.processId}`);
    else {
      if (!process.sponsorEntityRefs.includes(actorPolityId)) reasons.push(`not-sponsored-process:${operation.processId}`);
      if (process.status !== 'active') reasons.push(`process-not-active:${operation.processId}`);
      const envelope = processes.buildFeasibilityEnvelope(state, process);
      if (!envelope.allowedPaces.includes(action.pace)) reasons.push(`infeasible-process-pace:${action.pace}`);
    }
    return reasons;
  }
  if (operation.kind === 'diplomacy.propose') {
    const reasons: string[] = [];
    if (action.domain !== 'diplomacy') reasons.push('diplomacy-operation-requires-diplomacy-domain');
    for (const recipientId of operation.recipientPolityIds) {
      if (!state.polities.some((entry) => entry.id === recipientId)) reasons.push(`unknown-recipient:${recipientId}`);
      else if (recipientId === actorPolityId) reasons.push(`self-recipient:${recipientId}`);
    }
    const relationshipType = state.catalogs.relationshipTypes.find((entry) => entry.relationshipTypeId === operation.relationshipTypeId);
    if (!relationshipType) {
      reasons.push(`undeclared-relationship-type:${operation.relationshipTypeId}`);
    } else if (!relationshipType.playerProposable) {
      reasons.push(`relationship-type-not-player-proposable:${operation.relationshipTypeId}`);
    }
    return reasons;
  }
  if (operation.kind === 'military.mobilize') {
    const reasons: string[] = action.domain !== 'military' ? ['mobilization-operation-requires-military-domain'] : [];
    if (!state.modules.enabled.includes('module:military')) reasons.push('military-module-disabled');
    try {
      worldV2.deriveMobilizationPreview(state, actorPolityId);
    } catch {
      reasons.push('no-eligible-controlled-recruitment-capacity');
    }
    return reasons;
  }
  const region = state.regions.find((entry) => entry.regionId === operation.regionId);
  const recipient = state.polities.find((entry) => entry.id === operation.recipientPolityId);
  const reasons: string[] = action.domain !== 'diplomacy' ? ['territory-operation-requires-diplomacy-domain'] : [];
  if (!recipient || operation.recipientPolityId === actorPolityId) reasons.push(`unknown-or-self-recipient:${operation.recipientPolityId}`);
  if (!region) reasons.push(`unknown-region:${operation.regionId}`);
  else if (region.control.legalOwnerPolityId !== actorPolityId || region.control.actualControllerPolityId !== actorPolityId) {
    reasons.push(`not-owned-and-controlled-region:${operation.regionId}`);
  }
  return reasons;
}

function sortBySpanAndId<T extends { sourceSpan: { start: number }; }>(rows: T[], idOf: (row: T) => string): T[] {
  return rows.sort((left, right) => left.sourceSpan.start - right.sourceSpan.start || compare(idOf(left), idOf(right)));
}

/** Render player prose as JSON data, never as a prompt instruction section. */
export function quoteUntrustedPlayerText(playerText: string): string {
  return `[UNTRUSTED_PLAYER_TEXT]\n${JSON.stringify(playerText)}`;
}

export function interpretPlayerInputV2(
  state: worldV2.WorldStateV2,
  request: InterpretPlayerInputV2Request,
): worldV2.GroundedProjection<PlayerInputInterpretationV2> {
  if (request.playerText.length > MAX_PLAYER_INPUT_V2_CHARS) {
    throw new Error(`player input exceeds ${MAX_PLAYER_INPUT_V2_CHARS} characters`);
  }
  const actor = state.polities.find((entry) => entry.id === request.actorPolityId);
  if (!actor) throw new Error(`unknown polity ${request.actorPolityId}`);
  const modelOutput = playerInputV2ModelOutputSchema.parse(request.modelOutput);
  if (modelOutput.revision !== state.revision) {
    throw new Error(`stale interpretation revision: expected ${state.revision}, received ${modelOutput.revision}`);
  }

  const repairedOutput = {
    ...modelOutput,
    questions: modelOutput.questions.map((entry) => repairEntrySpan(request.playerText, entry)),
    claims: modelOutput.claims.map((entry) => repairEntrySpan(request.playerText, entry)),
    requestedActions: modelOutput.requestedActions.map((entry) => repairEntrySpan(request.playerText, entry)),
    proposedInitiatives: modelOutput.proposedInitiatives.map((entry) => repairEntrySpan(request.playerText, entry)),
  };

  const knownEntities = entityIds(state);
  const acceptedEvidence = new Set<worldV2.EvidenceId>();
  const questions = sortBySpanAndId(repairedOutput.questions.map((question): GroundedQuestion => {
    const reasons = spanReasons(request.playerText, question.sourceSpan);
    return { ...question, status: reasons.length === 0 ? 'grounded' : 'blocked', reasons };
  }), (question) => question.questionId);

  const claims = sortBySpanAndId(repairedOutput.claims.map((claim): GroundedClaim => {
    const evidence = evidenceReasons(state, actor.id, claim.evidenceIds);
    evidence.accepted.forEach((id) => acceptedEvidence.add(id));
    const reasons = [
      ...spanReasons(request.playerText, claim.sourceSpan),
      ...(!knownEntities.has(claim.subject) ? [`unknown-entity:${claim.subject}`] : []),
      ...evidence.reasons,
    ].sort(compare);
    const grounding = reasons.length === 0 ? deterministicClaimGrounding(state, claim) : 'unknown';
    return { ...claim, evidenceIds: evidence.accepted, grounding, reasons };
  }), (claim) => claim.claimId);
  const claimsById = new Map(claims.map((claim) => [claim.claimId, claim]));

  const requestedActions = sortBySpanAndId(repairedOutput.requestedActions.map((action): GroundedRequestedAction => {
    const evidence = evidenceReasons(state, actor.id, action.evidenceIds);
    evidence.accepted.forEach((id) => acceptedEvidence.add(id));
    const reasons = [
      ...spanReasons(request.playerText, action.sourceSpan),
      ...action.targetEntityIds.filter((id) => !knownEntities.has(id)).map((id) => `unknown-entity:${id}`),
      ...action.claimRefs.flatMap((claimId) => {
        const claim = claimsById.get(claimId);
        return !claim ? [`unknown-claim:${claimId}`]
          : claim.grounding === 'supported' ? [] : [`${claim.grounding}-claim:${claimId}`];
      }),
      ...(action.scope === 'domestic'
        ? action.targetEntityIds.filter((id) => knownEntities.has(id) && !domesticScopeIsProven(state, actor.id, id))
          .map((id) => `foreign-or-unproven-domestic-target:${id}`)
        : []),
      ...operationReasons(state, actor.id, action),
      ...evidence.reasons,
    ];
    const sortedReasons = sortedUnique(reasons);
    return {
      ...action,
      targetEntityIds: sortedUnique(action.targetEntityIds),
      claimRefs: sortedUnique(action.claimRefs),
      evidenceIds: evidence.accepted,
      status: sortedReasons.length === 0 ? 'grounded' : 'blocked',
      reasons: sortedReasons,
    };
  }), (action) => action.actionId);

  const proposedInitiatives = sortBySpanAndId(repairedOutput.proposedInitiatives.map((initiative): GroundedProposedInitiative => {
    const evidence = evidenceReasons(state, actor.id, initiative.evidenceIds);
    evidence.accepted.forEach((id) => acceptedEvidence.add(id));
    const reasons = sortedUnique([
      ...spanReasons(request.playerText, initiative.sourceSpan),
      ...initiative.targetEntityIds.filter((id) => !knownEntities.has(id)).map((id) => `unknown-entity:${id}`),
      ...evidence.reasons,
    ]);
    return {
      ...initiative,
      targetEntityIds: sortedUnique(initiative.targetEntityIds),
      evidenceIds: evidence.accepted,
      status: reasons.length === 0 ? 'grounded' : 'blocked',
      reasons,
    };
  }), (initiative) => initiative.initiativeId);

  return {
    revision: state.revision,
    asOfMonth: state.month,
    value: {
      actorPolityId: actor.id,
      untrustedPlayerText: request.playerText,
      questions,
      claims,
      requestedActions,
      proposedInitiatives,
    },
    evidenceIds: [...acceptedEvidence].sort(compare),
  };
}

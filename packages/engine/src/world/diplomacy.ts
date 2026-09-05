import { createHash } from 'node:crypto';
import { applyTerritorialTransition } from './control.js';
import {
  diplomaticProposalIdSchema,
  evidenceIdSchema,
  relationshipIdSchema,
  type DiplomaticTerm,
  type EvidenceId,
  type WorldStateV2,
  type WorldStateV2Input,
  worldEventIdSchema,
} from './schema.js';
import { assertExpectedWorldRevision, nextRevisionLineage, stampWorldStateRevision } from './revision.js';

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const hash = (...values: string[]) => createHash('sha256').update(values.join('\u001f'), 'utf8').digest('hex').slice(0, 32);

export type ProposedDiplomaticTerm =
  | { kind: 'relationship'; relationshipTypeId: string; participantPolityIds: string[] }
  | { kind: 'territorial-cession'; regionId: string; fromPolityId: string; toPolityId: string };

export interface ProposeDiplomaticProposalRequest {
  proposalId: string;
  proposerPolityId: string;
  recipientPolityIds: string[];
  terms: ProposedDiplomaticTerm[];
  evidenceIds: EvidenceId[];
  expectedRevision: WorldStateV2['revision'];
}

export interface ResolveDiplomaticProposalRequest {
  proposalId: string;
  actorPolityId: string;
  decision: 'accept' | 'reject';
  expectedRevision: WorldStateV2['revision'];
}

function fail(message: string): never { throw new Error(`diplomatic proposal: ${message}`); }
function requirePolity(state: WorldStateV2, polityId: string, context: string): void {
  if (!state.polities.some((entry) => entry.id === polityId)) fail(`${context} references unknown polity ${polityId}`);
}
function requireEvidence(state: WorldStateV2, evidenceIds: readonly string[]): void {
  const known = new Set(state.evidence.map((entry) => entry.evidenceId));
  for (const evidenceId of evidenceIds) if (!known.has(evidenceId as never)) fail(`references unknown evidence ${evidenceId}`);
}
function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates`);
}
function contentOf(state: WorldStateV2): Omit<WorldStateV2, 'revision'> {
  const { revision: _revision, ...content } = state;
  void _revision;
  return content;
}

function proposalTerms(state: WorldStateV2, request: ProposeDiplomaticProposalRequest): DiplomaticTerm[] {
  if (request.terms.length === 0) fail('requires at least one term');
  const relationshipTypes = new Set(state.catalogs.relationshipTypes.map((entry) => entry.relationshipTypeId));
  return request.terms.map((term): DiplomaticTerm => {
    if (term.kind === 'relationship') {
      unique(term.participantPolityIds, 'relationship participants');
      if (!relationshipTypes.has(term.relationshipTypeId as never)) fail(`references undeclared relationship type ${term.relationshipTypeId}`);
      if (!term.participantPolityIds.includes(request.proposerPolityId)) fail('relationship term omits proposer');
      for (const recipientId of request.recipientPolityIds) {
        if (!term.participantPolityIds.includes(recipientId)) fail(`relationship term omits recipient ${recipientId}`);
      }
      term.participantPolityIds.forEach((id) => requirePolity(state, id, 'relationship term'));
      return { kind: term.kind, relationshipTypeId: term.relationshipTypeId as never, participantPolityIds: [...term.participantPolityIds].sort(compare) as never };
    }
    const region = state.regions.find((entry) => entry.regionId === term.regionId);
    if (!region) fail(`references unknown region ${term.regionId}`);
    requirePolity(state, term.fromPolityId, 'territorial term');
    requirePolity(state, term.toPolityId, 'territorial term');
    if (term.fromPolityId !== request.proposerPolityId) fail('territorial cession proposer is not the stated ceding party');
    if (!request.recipientPolityIds.includes(term.toPolityId)) fail('territorial cession recipient is not a proposal recipient');
    if (region.control.legalOwnerPolityId !== term.fromPolityId || region.control.actualControllerPolityId !== term.fromPolityId) {
      fail(`territorial cession requires ${term.fromPolityId} to legally own and actually control ${term.regionId}`);
    }
    return { ...term, regionId: term.regionId as never, fromPolityId: term.fromPolityId as never, toPolityId: term.toPolityId as never, expectedControl: { ...region.control } };
  });
}

/** Creates an evidence-backed pending proposal. It deliberately has no material effect. */
export function proposeDiplomaticProposal(state: WorldStateV2, request: ProposeDiplomaticProposalRequest): WorldStateV2 {
  assertExpectedWorldRevision(state, request.expectedRevision);
  if (!diplomaticProposalIdSchema.safeParse(request.proposalId).success) fail('proposalId has invalid stable ID format');
  if (state.diplomaticProposals.some((entry) => entry.proposalId === request.proposalId)) fail(`proposal ${request.proposalId} already exists`);
  requirePolity(state, request.proposerPolityId, 'proposer');
  unique(request.recipientPolityIds, 'recipients');
  if (request.recipientPolityIds.length === 0) fail('requires at least one recipient');
  request.recipientPolityIds.forEach((id) => requirePolity(state, id, 'recipient'));
  if (request.recipientPolityIds.includes(request.proposerPolityId)) fail('proposer cannot be its own recipient');
  unique(request.evidenceIds, 'evidence IDs');
  requireEvidence(state, request.evidenceIds);
  const terms = proposalTerms(state, request);
  const suffix = hash(request.proposalId);
  const eventId = worldEventIdSchema.parse(`event:diplomatic-proposal-${suffix}`);
  const evidenceId = evidenceIdSchema.parse(`evidence:diplomatic-proposal-${suffix}`);
  const proposal = {
    proposalId: request.proposalId as never,
    proposerPolityId: request.proposerPolityId as never,
    recipientPolityIds: [...request.recipientPolityIds].sort(compare) as never,
    terms,
    status: 'pending' as const,
    createdAtRevision: state.revision,
    evidenceIds: [...request.evidenceIds, evidenceId].sort(compare) as never,
  };
  return stampWorldStateRevision({
    ...contentOf(state), revisionLineage: nextRevisionLineage(state),
    diplomaticProposals: [...state.diplomaticProposals, proposal],
    events: [...state.events, {
      eventId, revision: state.revision, kind: 'diplomatic-proposal-created',
      entityRefs: [request.proposalId, request.proposerPolityId, ...request.recipientPolityIds].sort(compare) as never,
      evidenceIds: [evidenceId],
    }],
    evidence: [...state.evidence, {
      evidenceId, revision: state.revision, kind: 'diplomatic-proposal-created',
      entityRefs: [request.proposalId, request.proposerPolityId, ...request.recipientPolityIds].sort(compare) as never,
      eventRefs: [eventId], canonicalPointers: [`/diplomaticProposals/${state.diplomaticProposals.length}`],
      visibility: 'polity' as const, visibleToPolityIds: [request.proposerPolityId, ...request.recipientPolityIds].sort(compare) as never,
    }],
  } as WorldStateV2Input);
}

function sovereignProfileId(state: WorldStateV2): string {
  const profile = [...state.catalogs.controlProfiles]
    .filter((entry) => entry.kind === 'sovereign')
    .sort((a, b) => compare(a.controlProfileId, b.controlProfileId))[0];
  if (!profile) fail('scenario declares no sovereign control profile for an agreed cession');
  return profile.controlProfileId;
}

/** Resolves a recipient's response; only an accepted territorial term reaches the control kernel. */
export function resolveDiplomaticProposal(state: WorldStateV2, request: ResolveDiplomaticProposalRequest): WorldStateV2 {
  assertExpectedWorldRevision(state, request.expectedRevision);
  const index = state.diplomaticProposals.findIndex((entry) => entry.proposalId === request.proposalId);
  if (index < 0) fail(`unknown proposal ${request.proposalId}`);
  const proposal = state.diplomaticProposals[index]!;
  if (proposal.status !== 'pending') fail(`proposal ${request.proposalId} is not pending`);
  if (!proposal.recipientPolityIds.includes(request.actorPolityId as never)) fail('only a proposal recipient may respond');
  const suffix = hash(request.proposalId, request.decision);
  const eventId = worldEventIdSchema.parse(`event:diplomatic-proposal-${request.decision}-${suffix}`);
  const evidenceId = evidenceIdSchema.parse(`evidence:diplomatic-proposal-${request.decision}-${suffix}`);
  const agreementId = `agreement:${hash(request.proposalId)}`;
  const acceptedRelationships = request.decision === 'accept'
    ? proposal.terms.filter((term) => term.kind === 'relationship').map((term, termIndex) => ({
      relationshipId: relationshipIdSchema.parse(`relationship:proposal-${hash(request.proposalId, String(termIndex))}`),
      kind: term.relationshipTypeId,
      participantPolityIds: [...term.participantPolityIds],
      evidenceIds: [evidenceId],
    })) : [];
  for (const relationship of acceptedRelationships) {
    if (state.relationships.some((entry) => entry.relationshipId === relationship.relationshipId)) fail(`relationship ${relationship.relationshipId} already exists`);
  }
  const updatedProposal = {
    ...proposal, status: request.decision === 'accept' ? 'accepted' as const : 'rejected' as const,
    ...(request.decision === 'accept' && proposal.terms.some((term) => term.kind === 'territorial-cession') ? { acceptedAgreementId: agreementId } : {}),
    evidenceIds: [...proposal.evidenceIds, evidenceId].sort(compare),
  };
  let next = stampWorldStateRevision({
    ...contentOf(state), revisionLineage: nextRevisionLineage(state),
    diplomaticProposals: state.diplomaticProposals.map((entry, entryIndex) => entryIndex === index ? updatedProposal : entry),
    relationships: [...state.relationships, ...acceptedRelationships],
    events: [...state.events, {
      eventId, revision: state.revision, kind: `diplomatic-proposal-${request.decision}`,
      entityRefs: [proposal.proposalId, proposal.proposerPolityId, request.actorPolityId, ...acceptedRelationships.map((entry) => entry.relationshipId)].sort(compare) as never,
      evidenceIds: [evidenceId],
    }],
    evidence: [...state.evidence, {
      evidenceId, revision: state.revision, kind: `diplomatic-proposal-${request.decision}`,
      entityRefs: [proposal.proposalId, proposal.proposerPolityId, request.actorPolityId, ...acceptedRelationships.map((entry) => entry.relationshipId)].sort(compare) as never,
      eventRefs: [eventId], canonicalPointers: [`/diplomaticProposals/${index}`], visibility: 'public' as const,
    }],
  } as WorldStateV2Input);
  if (request.decision === 'reject') return next;
  const territorialTerms = proposal.terms.filter((term) => term.kind === 'territorial-cession');
  for (const [termIndex, term] of territorialTerms.entries()) {
    const current = next.regions.find((entry) => entry.regionId === term.regionId);
    if (!current || JSON.stringify(current.control) !== JSON.stringify(term.expectedControl)) {
      fail(`territorial cession ${term.regionId} has stale expected control`);
    }
    next = applyTerritorialTransition(next, {
      transitionId: `transition:agreement-${hash(request.proposalId, String(termIndex))}`,
      regionId: term.regionId, kind: 'cede', expectedControl: term.expectedControl,
      targetControlProfileId: sovereignProfileId(next) as never,
      legalOwnerPolityId: term.toPolityId, actualControllerPolityId: term.toPolityId,
      authority: { kind: 'agreement', agreementId }, effectivePhase: 'opening', expectedRevision: next.revision,
    }).state;
  }
  return next;
}

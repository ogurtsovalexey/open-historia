import type { PolityId } from '@open-historia/domain';
import type { GroundedProjection } from './selectors.js';
import type { EvidenceId, EvidenceRecord, WorldStateV2 } from './schema.js';

type WorldEvent = WorldStateV2['events'][number];

export interface EvidenceRegistryEntry {
  evidenceId: EvidenceId;
  revision: EvidenceRecord['revision'];
  kind: string;
  entityRefs: string[];
  eventRefs: string[];
  canonicalPointers: string[];
  visibility: 'public' | 'polity';
}

export interface EvidenceRegistry {
  polityId: PolityId;
  entries: EvidenceRegistryEntry[];
}

export type EvidenceRejectionReason = 'stale-revision' | 'unknown-evidence' | 'not-visible';

export interface EvidenceValidationRequest {
  polityId: string;
  expectedRevision: string;
  evidenceIds: readonly string[];
}

export interface EvidenceValidationResult {
  valid: boolean;
  revisionMatches: boolean;
  acceptedEvidenceIds: EvidenceId[];
  rejected: Array<{ evidenceId: string; reason: EvidenceRejectionReason }>;
}

export interface CausalBriefEvent {
  eventId: string;
  revision: string;
  kind: string;
  entityRefs: string[];
  evidenceIds: EvidenceId[];
}

export interface CausalBrief {
  polityId: PolityId;
  sinceRevision: string;
  events: CausalBriefEvent[];
  evidence: EvidenceRegistryEntry[];
}

const compareIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function requirePolity(state: WorldStateV2, polityId: string) {
  const polity = state.polities.find((entry) => entry.id === polityId);
  if (!polity) throw new Error(`unknown polity ${polityId}`);
  return polity;
}

function grounded<T>(state: WorldStateV2, value: T, evidenceIds: Iterable<EvidenceId>): GroundedProjection<T> {
  return {
    revision: state.revision,
    asOfMonth: state.month,
    value,
    evidenceIds: [...new Set(evidenceIds)].sort(compareIds),
  };
}

function isNormallyVisible(record: EvidenceRecord, polityId: PolityId): boolean {
  if (record.visibility === 'public') return true;
  if (record.visibility !== 'polity') return false;
  return ('visibleToPolityIds' in record ? record.visibleToPolityIds : []).includes(polityId);
}

function registryEntry(record: EvidenceRecord): EvidenceRegistryEntry {
  if (record.visibility !== 'public' && record.visibility !== 'polity') {
    throw new Error(`evidence ${record.evidenceId} is not available to the normal actor registry`);
  }
  return {
    evidenceId: record.evidenceId,
    revision: record.revision,
    kind: record.kind,
    entityRefs: [...record.entityRefs].sort(compareIds),
    eventRefs: [...record.eventRefs].sort(compareIds),
    canonicalPointers: [...record.canonicalPointers].sort(compareIds),
    visibility: record.visibility,
  };
}

export function selectEvidenceRegistry(state: WorldStateV2, polityId: string): GroundedProjection<EvidenceRegistry> {
  const polity = requirePolity(state, polityId);
  const entries = state.evidence
    .filter((record) => isNormallyVisible(record, polity.id))
    .map(registryEntry)
    .sort((left, right) => compareIds(left.evidenceId, right.evidenceId));
  return grounded(state, { polityId: polity.id, entries }, entries.map((entry) => entry.evidenceId));
}

/**
 * Validate model-supplied evidence IDs against one exact world revision and actor scope.
 * Callers must require `valid`; accepted IDs are returned separately only for diagnostics.
 */
export function validateEvidenceIdsForPolity(
  state: WorldStateV2,
  request: EvidenceValidationRequest,
): GroundedProjection<EvidenceValidationResult> {
  const polity = requirePolity(state, request.polityId);
  const requestedIds = [...new Set(request.evidenceIds)].sort(compareIds);
  const revisionMatches = request.expectedRevision === state.revision;
  const evidenceById = new Map(state.evidence.map((record) => [record.evidenceId as string, record]));
  const acceptedEvidenceIds: EvidenceId[] = [];
  const rejected: EvidenceValidationResult['rejected'] = [];

  for (const evidenceId of requestedIds) {
    if (!revisionMatches) {
      rejected.push({ evidenceId, reason: 'stale-revision' });
      continue;
    }
    const record = evidenceById.get(evidenceId);
    if (!record) {
      rejected.push({ evidenceId, reason: 'unknown-evidence' });
      continue;
    }
    if (!isNormallyVisible(record, polity.id)) {
      rejected.push({ evidenceId, reason: 'not-visible' });
      continue;
    }
    acceptedEvidenceIds.push(record.evidenceId);
  }

  return grounded(state, {
    valid: revisionMatches && rejected.length === 0,
    revisionMatches,
    acceptedEvidenceIds,
    rejected,
  }, acceptedEvidenceIds);
}

function scopedEntityRefs(state: WorldStateV2, polityId: PolityId): Set<string> {
  const refs = new Set<string>([polityId]);
  for (const region of state.regions) {
    if (region.control.legalOwnerPolityId === polityId || region.control.actualControllerPolityId === polityId) refs.add(region.regionId);
  }
  for (const formation of state.formations) if (formation.polityId === polityId) refs.add(formation.formationId);
  for (const character of state.characters) if (character.polityId === polityId) refs.add(character.characterId);
  for (const group of state.groups) if (group.polityId === polityId) refs.add(group.groupId);
  for (const institution of state.institutions) if (institution.polityId === polityId) refs.add(institution.institutionId);
  for (const process of state.processes) if (process.sponsorEntityRefs.includes(polityId)) refs.add(process.processId);
  for (const relationship of state.relationships) if (relationship.participantPolityIds.includes(polityId)) refs.add(relationship.relationshipId);
  for (const knowledge of state.knowledge.records) if (knowledge.polityId === polityId) refs.add(knowledge.conceptId);
  return refs;
}

function evidenceForEvent(event: WorldEvent, visible: readonly EvidenceRecord[]): EvidenceRecord[] {
  const directIds = new Set<string>(event.evidenceIds);
  return visible
    .filter((record) => directIds.has(record.evidenceId) || record.eventRefs.includes(event.eventId))
    .sort((left, right) => compareIds(left.evidenceId, right.evidenceId));
}

export function selectCausalBrief(
  state: WorldStateV2,
  polityId: string,
  sinceRevision: string,
): GroundedProjection<CausalBrief> {
  const polity = requirePolity(state, polityId);
  const revisionOrder = [state.revisionLineage.seedRevision, ...state.revisionLineage.ancestorRevisions, state.revision];
  const sinceIndex = revisionOrder.indexOf(sinceRevision as WorldStateV2['revision']);
  if (sinceIndex < 0) throw new Error(`sinceRevision is not in world lineage or current revision: ${sinceRevision}`);

  const visible = state.evidence.filter((record) => isNormallyVisible(record, polity.id));
  const scope = scopedEntityRefs(state, polity.id);
  const selectedEvidence = new Map<string, EvidenceRecord>();
  const events: CausalBriefEvent[] = [];

  if (sinceRevision !== state.revision) {
    const eventCandidates = state.events
      .filter((event) => event.entityRefs.some((entityRef) => scope.has(entityRef)))
      .filter((event) => revisionOrder.indexOf(event.revision) >= sinceIndex)
      .sort((left, right) => {
        const revisionDifference = revisionOrder.indexOf(left.revision) - revisionOrder.indexOf(right.revision);
        return revisionDifference === 0 ? compareIds(left.eventId, right.eventId) : revisionDifference;
      });
    for (const event of eventCandidates) {
      const eventEvidence = evidenceForEvent(event, visible);
      if (eventEvidence.length === 0) continue;
      for (const record of eventEvidence) selectedEvidence.set(record.evidenceId, record);
      events.push({
        eventId: event.eventId,
        revision: event.revision,
        kind: event.kind,
        entityRefs: [...event.entityRefs].sort(compareIds),
        evidenceIds: eventEvidence.map((record) => record.evidenceId),
      });
    }
  }

  const evidence = [...selectedEvidence.values()].map(registryEntry).sort((left, right) => compareIds(left.evidenceId, right.evidenceId));
  return grounded(state, {
    polityId: polity.id,
    sinceRevision,
    events,
    evidence,
  }, evidence.map((entry) => entry.evidenceId));
}

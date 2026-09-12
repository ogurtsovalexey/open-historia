import { createHash } from 'node:crypto';
import {
  conflictIdSchema,
  evidenceIdSchema,
  worldEventIdSchema,
  type EvidenceId,
  type WorldStateV2,
  type WorldStateV2Input,
} from './schema.js';
import { assertExpectedWorldRevision, nextRevisionLineage, stampWorldStateRevision } from './revision.js';

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const hash = (...values: string[]) => createHash('sha256').update(values.join('\u001f'), 'utf8').digest('hex').slice(0, 32);

export interface DeclareConflictRequest {
  conflictId: string;
  attackerPolityId: string;
  defenderPolityId: string;
  evidenceIds: EvidenceId[];
  expectedRevision: WorldStateV2['revision'];
}

export interface DeclareConflictResult {
  state: WorldStateV2;
  conflictId: string;
  eventId: string;
  evidenceId: string;
}

function fail(message: string): never { throw new Error(`conflict declaration: ${message}`); }
function contentOf(state: WorldStateV2): Omit<WorldStateV2, 'revision'> {
  const { revision: _revision, ...content } = state;
  void _revision;
  return content;
}

/**
 * Records the legal/political state of an inter-polity conflict.  It cannot
 * alter a region, a formation, population, or any economic selector; those
 * consequences are intentionally reserved for their own causal operations.
 */
export function declareConflict(state: WorldStateV2, request: DeclareConflictRequest): DeclareConflictResult {
  assertExpectedWorldRevision(state, request.expectedRevision);
  if (!conflictIdSchema.safeParse(request.conflictId).success) fail('conflictId has invalid stable ID format');
  if (request.attackerPolityId === request.defenderPolityId) fail('attacker and defender must differ');
  if (!state.polities.some((entry) => entry.id === request.attackerPolityId)) fail(`unknown attacker ${request.attackerPolityId}`);
  if (!state.polities.some((entry) => entry.id === request.defenderPolityId)) fail(`unknown defender ${request.defenderPolityId}`);
  if (state.conflicts.some((entry) => entry.conflictId === request.conflictId)) fail(`conflict ${request.conflictId} already exists`);
  if (state.conflicts.some((entry) => entry.status === 'active' && (
    (entry.attackerPolityId === request.attackerPolityId && entry.defenderPolityId === request.defenderPolityId)
    || (entry.attackerPolityId === request.defenderPolityId && entry.defenderPolityId === request.attackerPolityId)
  ))) fail('the two polities already have an active conflict');
  if (new Set(request.evidenceIds).size !== request.evidenceIds.length) fail('evidenceIds contains duplicates');
  const knownEvidence = new Set(state.evidence.map((entry) => entry.evidenceId));
  for (const evidenceId of request.evidenceIds) if (!knownEvidence.has(evidenceId)) fail(`references unknown evidence ${evidenceId}`);

  const suffix = hash(request.conflictId, state.revision);
  const eventId = worldEventIdSchema.parse(`event:conflict-declared-${suffix}`);
  const evidenceId = evidenceIdSchema.parse(`evidence:conflict-declared-${suffix}`);
  const conflict = {
    conflictId: request.conflictId as never,
    attackerPolityId: request.attackerPolityId as never,
    defenderPolityId: request.defenderPolityId as never,
    status: 'active' as const,
    declaredAtRevision: state.revision,
    evidenceIds: [...request.evidenceIds, evidenceId].sort(compare) as never,
  };
  const next = stampWorldStateRevision({
    ...contentOf(state), revisionLineage: nextRevisionLineage(state),
    conflicts: [...state.conflicts, conflict],
    events: [...state.events, {
      eventId, revision: state.revision, kind: 'conflict-declared',
      entityRefs: [request.conflictId, request.attackerPolityId, request.defenderPolityId].sort(compare) as never,
      evidenceIds: [evidenceId],
    }],
    evidence: [...state.evidence, {
      evidenceId, revision: state.revision, kind: 'conflict-declared',
      entityRefs: [request.conflictId, request.attackerPolityId, request.defenderPolityId].sort(compare) as never,
      eventRefs: [eventId], canonicalPointers: [`/conflicts/${state.conflicts.length}`], visibility: 'public' as const,
    }],
  } as WorldStateV2Input);
  return { state: next, conflictId: request.conflictId, eventId, evidenceId };
}

import type { WorldStateV2 } from '../world/schema.js';
import { normalizeSemanticKey, type ConceptState, type WorldProcessState } from './schema.js';

export interface ProcessProjection<T> {
  revision: WorldStateV2['revision'];
  asOfMonth: WorldStateV2['month'];
  value: T;
  evidenceIds: string[];
}

const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const compareId = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export function findConceptBySemanticKey(state: WorldStateV2, value: string): ConceptState | undefined {
  const key = normalizeSemanticKey(value);
  return state.concepts.find((concept) => concept.semanticKey === key);
}

export function selectConcept(state: WorldStateV2, conceptId: string): ProcessProjection<ConceptState> {
  const concept = state.concepts.find((entry) => entry.conceptId === conceptId);
  if (!concept) throw new Error(`Unknown concept ${conceptId}`);
  return {
    revision: state.revision,
    asOfMonth: state.month,
    value: concept,
    evidenceIds: uniqueSorted([...concept.evidenceIds, ...concept.supportingEvidenceIds]),
  };
}

export function selectProcess(state: WorldStateV2, processId: string): ProcessProjection<WorldProcessState> {
  const process = state.processes.find((entry) => entry.processId === processId);
  if (!process) throw new Error(`Unknown process ${processId}`);
  return {
    revision: state.revision,
    asOfMonth: state.month,
    value: process,
    evidenceIds: uniqueSorted([...process.evidenceIds, ...process.blockers, ...process.accelerators]),
  };
}

export function processesForConcept(state: WorldStateV2, conceptId: string): WorldProcessState[] {
  return state.processes
    .filter((process) => process.conceptId === conceptId)
    .sort((left, right) => compareId(left.processId, right.processId));
}

export function conceptAdoptionBp(state: WorldStateV2, conceptId: string, entityId: string): number {
  const concept = selectConcept(state, conceptId).value;
  const record = concept.adoption.find((entry) => (
    entry.scope === 'polity' ? entry.polityId === entityId : entry.regionId === entityId
  ));
  return record?.adoptionBp ?? 0;
}

export function activeProcesses(state: WorldStateV2): WorldProcessState[] {
  return state.processes
    .filter((process) => process.status === 'active')
    .sort((left, right) => compareId(left.processId, right.processId));
}

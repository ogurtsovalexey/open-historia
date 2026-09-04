import type { WorldStateV2 } from '../world/schema.js';
import {
  effectKinds,
  processPaceSchema,
  type EffectKind,
  type WorldProcessState,
} from './schema.js';

export interface PreviewCost {
  kind: 'funding' | 'capacity' | 'material';
  resourceId: string;
  amount: number;
}

export interface FeasibilityEnvelope {
  allowedDirections: string[];
  allowedPaces: Array<WorldProcessState['currentPace']>;
  compatibleEffectFamilies: EffectKind[];
  accelerators: string[];
  blockers: string[];
  opportunityCosts: PreviewCost[];
  evidenceIds: string[];
  reasons: string[];
}

const paceProgressBp: Readonly<Record<WorldProcessState['currentPace'], number>> = {
  stalled: 0,
  slow: 250,
  steady: 500,
  fast: 750,
  breakthrough: 1000,
};

const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

function sponsorPolities(state: WorldStateV2, process: WorldProcessState): Set<string> {
  const sponsors = new Set<string>();
  for (const ref of process.sponsorEntityRefs) {
    if (state.polities.some((entry) => entry.id === ref)) sponsors.add(ref);
    const region = state.regions.find((entry) => entry.regionId === ref);
    if (region) sponsors.add(region.control.actualControllerPolityId);
    const character = state.characters.find((entry) => entry.characterId === ref);
    if (character?.polityId) sponsors.add(character.polityId);
    const group = state.groups.find((entry) => entry.groupId === ref);
    if (group?.polityId) sponsors.add(group.polityId);
    const institution = state.institutions.find((entry) => entry.institutionId === ref);
    if (institution?.polityId) sponsors.add(institution.polityId);
  }
  return sponsors;
}

function materialAvailable(state: WorldStateV2, process: WorldProcessState, resourceId: string): number {
  const sponsors = sponsorPolities(state, process);
  let total = 0n;
  for (const polity of state.polities) {
    if (!sponsors.has(polity.id)) continue;
    for (const stock of polity.stockpiles) if (stock.commodityId === resourceId) total += BigInt(stock.quantity);
  }
  for (const region of state.regions) {
    if (!sponsors.has(region.control.actualControllerPolityId)) continue;
    for (const deposit of region.resourceDeposits) {
      if (deposit.resourceId === resourceId) {
        total += BigInt(deposit.amount) * BigInt(region.control.extractionAccessBp) / 10000n;
      }
    }
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Material aggregate for ${resourceId} exceeds safe integer range`);
  return Number(total);
}

export function assertProcessReferencesClosed(state: WorldStateV2, process: WorldProcessState): void {
  const concepts = new Set(state.concepts.map((entry) => entry.conceptId as string));
  const institutions = new Set(state.institutions.map((entry) => entry.institutionId as string));
  const evidence = new Set(state.evidence.map((entry) => entry.evidenceId as string));
  const commodities = new Set(state.catalogs.commodities.map((entry) => entry.commodityId as string));
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
  for (const ref of [...process.sponsorEntityRefs, ...process.affectedEntityRefs]) {
    if (!entities.has(ref)) throw new Error(`Process ${process.processId} references unknown entity ${ref}`);
  }
  for (const id of process.prerequisites.conceptIds) {
    if (!concepts.has(id)) throw new Error(`Process ${process.processId} prerequisite references unknown concept ${id}`);
  }
  for (const id of process.prerequisites.institutionIds) {
    if (!institutions.has(id)) throw new Error(`Process ${process.processId} prerequisite references unknown institution ${id}`);
  }
  for (const item of process.prerequisites.material) {
    if (!commodities.has(item.resourceId)) throw new Error(`Process ${process.processId} prerequisite references unknown commodity ${item.resourceId}`);
  }
  for (const id of [
    ...process.prerequisites.knowledgeEvidenceIds,
    ...process.prerequisites.communicationEvidenceIds,
    ...process.prerequisites.oppositionEvidenceIds,
    ...process.blockers,
    ...process.accelerators,
  ]) {
    if (!evidence.has(id)) throw new Error(`Process ${process.processId} references unknown evidence ${id}`);
  }
  for (const kind of process.compatibleEffectFamilies) {
    if (!(effectKinds as readonly string[]).includes(kind)) throw new Error(`Unknown effect family ${kind}`);
  }
}

export function assertAcyclicConceptDependencies(state: WorldStateV2): void {
  const edges = new Map<string, string[]>();
  for (const concept of state.concepts) edges.set(concept.conceptId, [...concept.parentConceptIds]);
  for (const process of state.processes) {
    if (!process.conceptId) continue;
    const current = edges.get(process.conceptId) ?? [];
    edges.set(process.conceptId, uniqueSorted([...current, ...process.prerequisites.conceptIds]));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) throw new Error(`Cyclic concept dependency: ${[...path, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of edges.get(id) ?? []) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...edges.keys()].sort()) visit(id, []);
}

export function buildFeasibilityEnvelope(state: WorldStateV2, process: WorldProcessState): FeasibilityEnvelope {
  assertProcessReferencesClosed(state, process);
  assertAcyclicConceptDependencies(state);
  const reasons: string[] = [];
  let hardBlocked = false;
  const evidenceIds = new Set<string>(process.evidenceIds);
  const evidenceRegistry = new Set(state.evidence.map((entry) => entry.evidenceId as string));
  const concepts = new Map(state.concepts.map((entry) => [entry.conceptId as string, entry]));
  for (const conceptId of process.prerequisites.conceptIds) {
    const concept = concepts.get(conceptId)!;
    if (concept.status === 'proposed') {
      hardBlocked = true;
      reasons.push(`Prerequisite concept ${conceptId} has not emerged`);
    }
    concept.evidenceIds.forEach((id) => evidenceIds.add(id));
  }
  for (const item of process.prerequisites.material) {
    if (materialAvailable(state, process, item.resourceId) < item.amount) {
      hardBlocked = true;
      reasons.push(`Insufficient material ${item.resourceId}`);
    }
  }
  for (const id of [...process.prerequisites.knowledgeEvidenceIds, ...process.prerequisites.communicationEvidenceIds]) {
    evidenceIds.add(id);
    if (!evidenceRegistry.has(id)) {
      hardBlocked = true;
      reasons.push(`Missing required evidence ${id}`);
    }
  }
  if (process.funding < process.prerequisites.minimumFunding) reasons.push('Funding is below the required sustained investment');
  const allocatedByCapacity = new Map<string, number>();
  for (const entry of process.capacityUse) {
    allocatedByCapacity.set(entry.capacityId, (allocatedByCapacity.get(entry.capacityId) ?? 0) + entry.amount);
  }
  for (const required of process.prerequisites.capacity) {
    if ((allocatedByCapacity.get(required.capacityId) ?? 0) < required.amount) {
      hardBlocked = true;
      reasons.push(`Insufficient capacity ${required.capacityId}`);
    }
  }
  const opposition = process.prerequisites.oppositionEvidenceIds.filter((id) => evidenceRegistry.has(id));
  const blockers = uniqueSorted([...process.blockers, ...opposition]);
  const accelerators = uniqueSorted(process.accelerators);
  const allowedPaces: FeasibilityEnvelope['allowedPaces'] = hardBlocked
    ? ['stalled']
    : process.funding < process.prerequisites.minimumFunding
      ? ['stalled', 'slow']
      : process.momentumBp < process.resistanceBp
        ? ['stalled', 'slow', 'steady']
        : [...processPaceSchema.options];
  return {
    allowedDirections: [process.direction],
    allowedPaces,
    compatibleEffectFamilies: [...process.compatibleEffectFamilies].sort(),
    accelerators,
    blockers,
    opportunityCosts: [
      { kind: 'funding', resourceId: 'cost:funding', amount: process.prerequisites.minimumFunding },
      ...process.prerequisites.capacity.map((entry) => ({ kind: 'capacity' as const, resourceId: entry.capacityId, amount: entry.amount })),
      ...process.prerequisites.material.map((entry) => ({ kind: 'material' as const, resourceId: entry.resourceId, amount: entry.amount })),
    ],
    evidenceIds: uniqueSorted(evidenceIds),
    reasons: uniqueSorted(reasons),
  };
}

export function computeProcessProgressDelta(
  process: WorldProcessState,
  envelope: FeasibilityEnvelope,
): number {
  if (!envelope.allowedPaces.includes(process.currentPace)) throw new Error(`Pace ${process.currentPace} is infeasible`);
  const base = paceProgressBp[process.currentPace];
  const netMomentumBp = Math.max(0, Math.min(10000, 5000 + process.momentumBp - process.resistanceBp));
  const delta = Math.trunc(base * netMomentumBp / 5000);
  return Math.max(0, Math.min(1000, delta));
}

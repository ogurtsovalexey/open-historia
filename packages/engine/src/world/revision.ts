import { createHash } from 'node:crypto';
import { canonicalStringify } from '@open-historia/data-packs';
import {
  worldStateV2ContentSchema,
  worldStateV2Schema,
  type WorldStateV2,
  type WorldStateV2Input,
} from './schema.js';
import { assertWorldStateV2Invariants } from './invariants.js';

export interface RevisionStamp {
  revision: WorldStateV2['revision'];
  asOfMonth: WorldStateV2['month'];
}

const compareId = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const sortedStrings = <T extends string>(values: readonly T[]): T[] => [...values].sort(compareId);
const sortedEvidence = <T extends { evidenceIds: readonly string[] }>(entry: T): T => ({
  ...entry,
  evidenceIds: sortedStrings(entry.evidenceIds),
});

/** Normalize every collection whose semantics are set-like; caller order is never authority. */
export function canonicalWorldState(state: WorldStateV2): WorldStateV2 {
  return {
    ...state,
    worldRules: {
      ...state.worldRules,
      knowledgeBaseline: sortedStrings(state.worldRules.knowledgeBaseline),
      hardProhibitions: sortedStrings(state.worldRules.hardProhibitions),
      plausibilityContext: sortedStrings(state.worldRules.plausibilityContext),
    },
    revisionLineage: {
      ...state.revisionLineage,
      // This is an ordered causal chain, not a set. Hash order has no temporal
      // meaning and sorting it would corrupt `sinceRevision` queries.
      ancestorRevisions: [...state.revisionLineage.ancestorRevisions],
    },
    modules: { enabled: sortedStrings(state.modules.enabled) },
    catalogs: {
      modules: [...state.catalogs.modules].sort((a, b) => compareId(a.moduleId, b.moduleId)),
      worldModels: [...state.catalogs.worldModels].sort((a, b) => compareId(`${a.kind}|${a.modelId}`, `${b.kind}|${b.modelId}`)),
      commodities: [...state.catalogs.commodities].sort((a, b) => compareId(a.commodityId, b.commodityId)),
      controlProfiles: [...state.catalogs.controlProfiles].sort((a, b) => compareId(a.controlProfileId, b.controlProfileId)),
      formationArchetypes: state.catalogs.formationArchetypes.map((entry) => ({
        ...entry,
        equipmentClassIds: sortedStrings(entry.equipmentClassIds),
      })).sort((a, b) => compareId(a.formationArchetypeId, b.formationArchetypeId)),
      equipmentClasses: [...state.catalogs.equipmentClasses].sort((a, b) => compareId(a.equipmentClassId, b.equipmentClassId)),
      routeClasses: [...state.catalogs.routeClasses].sort((a, b) => compareId(a.routeClassId, b.routeClassId)),
      relationshipTypes: [...state.catalogs.relationshipTypes].sort((a, b) => compareId(a.relationshipTypeId, b.relationshipTypeId)),
    },
    polities: state.polities.map((entry) => ({
      ...sortedEvidence(entry),
      stockpiles: [...entry.stockpiles].sort((a, b) => compareId(a.commodityId, b.commodityId)),
    })).sort((a, b) => compareId(a.id, b.id)),
    regions: state.regions.map((entry) => ({
      ...sortedEvidence(entry),
      resourceDeposits: [...entry.resourceDeposits].sort((a, b) => compareId(a.resourceId, b.resourceId)),
    })).sort((a, b) => compareId(a.regionId, b.regionId)),
    populationCohorts: state.populationCohorts.map(sortedEvidence).sort((a, b) => compareId(a.cohortId, b.cohortId)),
    formations: state.formations.map((entry) => ({
      ...sortedEvidence(entry),
      personnelOrigins: [...entry.personnelOrigins].sort((a, b) => compareId(a.regionId, b.regionId)),
      equipment: [...entry.equipment].sort((a, b) => compareId(a.equipmentClassId, b.equipmentClassId)),
    })).sort((a, b) => compareId(a.formationId, b.formationId)),
    routes: state.routes.map((entry) => ({
      ...sortedEvidence(entry),
      regionIds: sortedStrings(entry.regionIds),
      allowedCommodityIds: sortedStrings(entry.allowedCommodityIds),
    })).sort((a, b) => compareId(a.routeId, b.routeId)),
    characters: state.characters.map(sortedEvidence).sort((a, b) => compareId(a.characterId, b.characterId)),
    groups: state.groups.map(sortedEvidence).sort((a, b) => compareId(a.groupId, b.groupId)),
    institutions: state.institutions.map(sortedEvidence).sort((a, b) => compareId(a.institutionId, b.institutionId)),
    concepts: state.concepts.map((entry) => ({
      ...sortedEvidence(entry),
      origin: { ...entry.origin, originEntityRefs: sortedStrings(entry.origin.originEntityRefs) },
      parentConceptIds: sortedStrings(entry.parentConceptIds),
      supportingEvidenceIds: sortedStrings(entry.supportingEvidenceIds),
      domains: sortedStrings(entry.domains),
      diffusion: [...entry.diffusion].sort((a, b) => compareId(a.regionId, b.regionId)),
      adoption: [...entry.adoption].sort((a, b) => compareId(
        a.scope === 'polity' ? `polity|${a.polityId}` : `region|${a.regionId}`,
        b.scope === 'polity' ? `polity|${b.polityId}` : `region|${b.regionId}`,
      )),
    })).sort((a, b) => compareId(a.conceptId, b.conceptId)),
    processes: state.processes.map((entry) => ({
      ...sortedEvidence(entry),
      sponsorEntityRefs: sortedStrings(entry.sponsorEntityRefs),
      affectedEntityRefs: sortedStrings(entry.affectedEntityRefs),
      capacityUse: [...entry.capacityUse].sort((a, b) => compareId(`${a.capacityId}|${a.entityRef}`, `${b.capacityId}|${b.entityRef}`)),
      investments: [...entry.investments].sort((a, b) => compareId(a.investorEntityRef, b.investorEntityRef)),
      blockers: sortedStrings(entry.blockers),
      accelerators: sortedStrings(entry.accelerators),
      prerequisites: {
        ...entry.prerequisites,
        conceptIds: sortedStrings(entry.prerequisites.conceptIds),
        material: [...entry.prerequisites.material].sort((a, b) => compareId(a.resourceId, b.resourceId)),
        knowledgeEvidenceIds: sortedStrings(entry.prerequisites.knowledgeEvidenceIds),
        institutionIds: sortedStrings(entry.prerequisites.institutionIds),
        communicationEvidenceIds: sortedStrings(entry.prerequisites.communicationEvidenceIds),
        oppositionEvidenceIds: sortedStrings(entry.prerequisites.oppositionEvidenceIds),
        capacity: [...entry.prerequisites.capacity].sort((a, b) => compareId(`${a.capacityId}|${a.entityRef}`, `${b.capacityId}|${b.entityRef}`)),
      },
      compatibleEffectFamilies: sortedStrings(entry.compatibleEffectFamilies),
      selectedEffectFamilies: sortedStrings(entry.selectedEffectFamilies),
      selectedEffects: [...entry.selectedEffects].sort((a, b) => compareId(`${a.kind}|${a.targetEntityRef}`, `${b.kind}|${b.targetEntityRef}`)),
    })).sort((a, b) => compareId(a.processId, b.processId)),
    relationships: state.relationships.map((entry) => ({
      ...sortedEvidence(entry),
      participantPolityIds: sortedStrings(entry.participantPolityIds),
    })).sort((a, b) => compareId(a.relationshipId, b.relationshipId)),
    diplomaticProposals: state.diplomaticProposals.map((entry) => ({
      ...sortedEvidence(entry),
      recipientPolityIds: sortedStrings(entry.recipientPolityIds),
      terms: entry.terms.map((term) => term.kind === 'relationship'
        ? { ...term, participantPolityIds: sortedStrings(term.participantPolityIds) }
        : { ...term, expectedControl: { ...term.expectedControl } })
        .sort((a, b) => compareId(
          a.kind === 'relationship' ? `relationship|${a.relationshipTypeId}` : `territory|${a.regionId}`,
          b.kind === 'relationship' ? `relationship|${b.relationshipTypeId}` : `territory|${b.regionId}`,
        )),
    })).sort((a, b) => compareId(a.proposalId, b.proposalId)),
    tributeObligations: state.tributeObligations.map((entry) => ({
      ...sortedEvidence(entry),
      payerPolityIds: sortedStrings(entry.payerPolityIds),
      sourceRegionIds: sortedStrings(entry.sourceRegionIds),
      beneficiaries: [...entry.beneficiaries].sort((a, b) => compareId(a.polityId, b.polityId)),
      deliveries: [...entry.deliveries].sort((a, b) => compareId(a.commodityId, b.commodityId)),
      routeIds: sortedStrings(entry.routeIds),
      arrears: [...entry.arrears].sort((a, b) => compareId(a.commodityId, b.commodityId)),
    })).sort((a, b) => compareId(a.obligationId, b.obligationId)),
    knowledge: {
      records: state.knowledge.records.map(sortedEvidence).sort((a, b) => compareId(`${a.polityId}|${a.conceptId}`, `${b.polityId}|${b.conceptId}`)),
    },
    events: state.events.map((entry) => ({
      ...sortedEvidence(entry),
      entityRefs: sortedStrings(entry.entityRefs),
      ...(entry.populationCausality ? {
        populationCausality: {
          ...entry.populationCausality,
          regions: entry.populationCausality.regions.map((region) => ({
            ...region,
            cohorts: [...region.cohorts].sort((a, b) => compareId(a.cohortId, b.cohortId)),
          })).sort((a, b) => compareId(a.regionId, b.regionId)),
        },
      } : {}),
    })).sort((a, b) => compareId(a.eventId, b.eventId)),
    evidence: state.evidence.map((entry) => ({
      ...entry,
      entityRefs: sortedStrings(entry.entityRefs),
      eventRefs: sortedStrings(entry.eventRefs),
      canonicalPointers: sortedStrings(entry.canonicalPointers),
    })).sort((a, b) => compareId(a.evidenceId, b.evidenceId)),
  };
}

function canonicalContent(state: WorldStateV2): Omit<WorldStateV2, 'revision'> {
  const canonical = canonicalWorldState(state);
  const { revision: _revision, ...content } = canonical;
  void _revision;
  return content;
}

export function canonicalWorldStateText(state: WorldStateV2): string {
  return canonicalStringify(canonicalContent(state));
}

export function worldStateChecksum(state: WorldStateV2): WorldStateV2['revision'] {
  const digest = createHash('sha256').update(canonicalWorldStateText(state), 'utf8').digest('hex');
  return `sha256:${digest}` as WorldStateV2['revision'];
}

/** Validate primary content, canonicalize it and attach its content-addressed revision. */
export function stampWorldStateRevision(input: WorldStateV2Input): WorldStateV2 {
  const content = worldStateV2ContentSchema.parse(input);
  const provisional = worldStateV2Schema.parse({
    ...content,
    revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  });
  const canonical = canonicalWorldState(provisional);
  assertWorldStateV2Invariants(canonical);
  const stamped = canonicalWorldState({ ...canonical, revision: worldStateChecksum(canonical) });
  assertWorldStateV2Invariants(stamped);
  return stamped;
}

export function revisionStampOf(state: WorldStateV2): RevisionStamp {
  return { revision: state.revision, asOfMonth: state.month };
}

/** Lineage for the next commit: current becomes a causal ancestor, never a self-reference. */
export function nextRevisionLineage(state: WorldStateV2): WorldStateV2['revisionLineage'] {
  return {
    seedRevision: state.revisionLineage.seedRevision,
    ancestorRevisions: [...state.revisionLineage.ancestorRevisions, state.revision],
  };
}

export function assertExpectedWorldRevision(state: WorldStateV2, expectedRevision: string): void {
  if (state.revision !== expectedRevision) {
    throw new Error(`stale world revision: expected ${expectedRevision}, current ${state.revision}`);
  }
}

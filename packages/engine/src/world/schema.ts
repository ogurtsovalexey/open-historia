import { z } from 'zod';
import {
  gameDateSchema,
  polityIdSchema,
  regionIdSchema,
  scenarioIdSchema,
} from '@open-historia/domain';
import {
  conceptStateSchema,
  worldProcessStateSchema,
} from '../processes/schema.js';
import { assertWorldStateV2Invariants } from './invariants.js';
import { canonicalWorldState, worldStateChecksum } from './revision.js';

export const WORLD_STATE_V2_SCHEMA_VERSION = 'open-historia-world/2' as const;

const safeNonNegativeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safeIntegerSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const basisPointsSchema = z.number().int().min(0).max(10000);
const nonEmptyTextSchema = z.string().trim().min(1);
const stableIdSchema = z.string().max(160).regex(
  /^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
  'Invalid stable ID format',
);
const prefixedIdSchema = (prefix: string) => z.string().max(160).regex(
  new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]{0,139}$`),
  `Invalid ${prefix} ID format`,
);

export const populationCohortIdSchema = prefixedIdSchema('cohort').brand<'PopulationCohortId'>();
export const formationIdSchema = prefixedIdSchema('formation').brand<'FormationId'>();
export const formationArchetypeIdSchema = prefixedIdSchema('formation-archetype').brand<'FormationArchetypeId'>();
export const equipmentClassIdSchema = prefixedIdSchema('equipment-class').brand<'EquipmentClassId'>();
export const routeClassIdSchema = prefixedIdSchema('route-class').brand<'RouteClassId'>();
export const routeIdSchema = prefixedIdSchema('route').brand<'RouteId'>();
export const characterIdSchema = prefixedIdSchema('character').brand<'CharacterId'>();
export const groupIdSchema = prefixedIdSchema('group').brand<'GroupId'>();
export const institutionIdSchema = prefixedIdSchema('institution').brand<'InstitutionId'>();
export const conceptIdSchema = prefixedIdSchema('concept').brand<'ConceptId'>();
export const processIdSchema = prefixedIdSchema('process').brand<'ProcessId'>();
export const relationshipIdSchema = prefixedIdSchema('relationship').brand<'RelationshipId'>();
export const diplomaticProposalIdSchema = prefixedIdSchema('proposal').brand<'DiplomaticProposalId'>();
export const tributeObligationIdSchema = prefixedIdSchema('obligation').brand<'TributeObligationId'>();
export const evidenceIdSchema = prefixedIdSchema('evidence').brand<'EvidenceId'>();
export const worldEventIdSchema = prefixedIdSchema('event').brand<'WorldEventId'>();
export const worldRevisionHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/, 'Invalid world revision hash');
const nonzeroWorldRevisionHashSchema = worldRevisionHashSchema.refine(
  (value) => value !== `sha256:${'0'.repeat(64)}`,
  'Causal revision must be nonzero',
);

export type PopulationCohortId = z.infer<typeof populationCohortIdSchema>;
export type FormationId = z.infer<typeof formationIdSchema>;
export type FormationArchetypeId = z.infer<typeof formationArchetypeIdSchema>;
export type EquipmentClassId = z.infer<typeof equipmentClassIdSchema>;
export type RouteClassId = z.infer<typeof routeClassIdSchema>;
export type RouteId = z.infer<typeof routeIdSchema>;
export type EvidenceId = z.infer<typeof evidenceIdSchema>;
export type WorldEventId = z.infer<typeof worldEventIdSchema>;

export const localizedTextSchema = z.object({
  en: nonEmptyTextSchema,
  ru: nonEmptyTextSchema.optional(),
}).strict();

const evidenceIdsSchema = z.array(evidenceIdSchema);

export const regionalControlSchema = z.object({
  legalOwnerPolityId: polityIdSchema,
  actualControllerPolityId: polityIdSchema,
  kind: z.enum(['sovereign', 'occupation', 'autonomy', 'indirect', 'contested']),
  controlProfileId: prefixedIdSchema('control-profile'),
  administrationAccessBp: basisPointsSchema,
  extractionAccessBp: basisPointsSchema,
  recruitmentAccessBp: basisPointsSchema,
  integrationBp: basisPointsSchema,
}).strict();
export type RegionalControl = z.infer<typeof regionalControlSchema>;

export const polityStateV2Schema = z.object({
  id: polityIdSchema,
  displayName: localizedTextSchema,
  decisionMode: z.enum(['active', 'supported', 'inert']).optional(),
  treasury: safeNonNegativeIntegerSchema,
  stockpiles: z.array(z.object({
    commodityId: stableIdSchema,
    quantity: safeNonNegativeIntegerSchema,
  }).strict()),
  evidenceIds: evidenceIdsSchema,
}).strict();
export type PolityStateV2 = z.infer<typeof polityStateV2Schema>;

export const regionStateV2Schema = z.object({
  regionId: regionIdSchema,
  displayName: localizedTextSchema,
  /** Canonical local topology used to prove any future bounded military pressure. */
  adjacentRegionIds: z.array(regionIdSchema).default([]),
  control: regionalControlSchema,
  fiscalBase: safeNonNegativeIntegerSchema,
  productiveCapacity: safeNonNegativeIntegerSchema,
  supplyCapacity: safeNonNegativeIntegerSchema,
  resourceDeposits: z.array(z.object({
    resourceId: stableIdSchema,
    amount: safeNonNegativeIntegerSchema,
  }).strict()),
  evidenceIds: evidenceIdsSchema,
}).strict();
export type RegionStateV2 = z.infer<typeof regionStateV2Schema>;

export const populationCohortStateSchema = z.object({
  cohortId: populationCohortIdSchema,
  regionId: regionIdSchema,
  population: safeNonNegativeIntegerSchema,
  workforceParticipationBp: basisPointsSchema,
  recruitmentEligibilityBp: basisPointsSchema,
  evidenceIds: evidenceIdsSchema,
}).strict();
export type PopulationCohortState = z.infer<typeof populationCohortStateSchema>;

export const formationPersonnelOriginSchema = z.object({
  regionId: regionIdSchema,
  personnel: safeNonNegativeIntegerSchema,
}).strict();
export type FormationPersonnelOrigin = z.infer<typeof formationPersonnelOriginSchema>;

export const populationCausalityTotalsSchema = z.object({
  births: safeNonNegativeIntegerSchema,
  naturalDeaths: safeNonNegativeIntegerSchema,
  combatDeaths: safeNonNegativeIntegerSchema,
  migrationNet: safeIntegerSchema,
  populationDelta: safeIntegerSchema,
}).strict();

export const populationCausalityCohortRowSchema = z.object({
  cohortId: populationCohortIdSchema,
  births: safeNonNegativeIntegerSchema,
  naturalDeaths: safeNonNegativeIntegerSchema,
  combatDeaths: safeNonNegativeIntegerSchema,
  migrationNet: safeIntegerSchema,
  populationDelta: safeIntegerSchema,
}).strict();

export const populationCausalityRegionRowSchema = z.object({
  regionId: regionIdSchema,
  totals: populationCausalityTotalsSchema,
  cohorts: z.array(populationCausalityCohortRowSchema),
}).strict();

export const populationCausalitySchema = z.object({
  totals: populationCausalityTotalsSchema,
  regions: z.array(populationCausalityRegionRowSchema).min(1),
}).strict();
export type PopulationCausality = z.infer<typeof populationCausalitySchema>;

export const formationStateV2Schema = z.object({
  formationId: formationIdSchema,
  polityId: polityIdSchema,
  archetypeId: formationArchetypeIdSchema,
  manpower: safeNonNegativeIntegerSchema,
  personnelOrigins: z.array(formationPersonnelOriginSchema).min(1),
  equipment: z.array(z.object({
    equipmentClassId: equipmentClassIdSchema,
    quantity: safeNonNegativeIntegerSchema,
  }).strict()),
  evidenceIds: evidenceIdsSchema,
}).strict();
export type FormationStateV2 = z.infer<typeof formationStateV2Schema>;

export const routeStateV2Schema = z.object({
  routeId: routeIdSchema,
  classId: routeClassIdSchema,
  regionIds: z.array(regionIdSchema).min(1),
  allowedCommodityIds: z.array(stableIdSchema),
  evidenceIds: evidenceIdsSchema,
}).strict();
export type RouteStateV2 = z.infer<typeof routeStateV2Schema>;

export const characterStateSchema = z.object({
  characterId: characterIdSchema,
  polityId: polityIdSchema.optional(),
  evidenceIds: evidenceIdsSchema,
}).strict();

export const groupStateSchema = z.object({
  groupId: groupIdSchema,
  homeRegionId: regionIdSchema.optional(),
  polityId: polityIdSchema.optional(),
  evidenceIds: evidenceIdsSchema,
}).strict();

export const institutionStateSchema = z.object({
  institutionId: institutionIdSchema,
  kind: nonEmptyTextSchema,
  polityId: polityIdSchema.optional(),
  regionId: regionIdSchema.optional(),
  evidenceIds: evidenceIdsSchema,
}).strict();

export const relationshipStateSchema = z.object({
  relationshipId: relationshipIdSchema,
  kind: nonEmptyTextSchema,
  participantPolityIds: z.array(polityIdSchema).min(2),
  evidenceIds: evidenceIdsSchema,
}).strict();

export const diplomaticTermSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('relationship'),
    relationshipTypeId: prefixedIdSchema('relationship-type'),
    participantPolityIds: z.array(polityIdSchema).min(2),
  }).strict(),
  z.object({
    kind: z.literal('territorial-cession'),
    regionId: regionIdSchema,
    fromPolityId: polityIdSchema,
    toPolityId: polityIdSchema,
    /** Frozen when offered; acceptance must fail rather than reinterpret changed control. */
    expectedControl: regionalControlSchema,
  }).strict(),
]);
export type DiplomaticTerm = z.infer<typeof diplomaticTermSchema>;

export const diplomaticProposalStateSchema = z.object({
  proposalId: diplomaticProposalIdSchema,
  proposerPolityId: polityIdSchema,
  recipientPolityIds: z.array(polityIdSchema).min(1),
  terms: z.array(diplomaticTermSchema).min(1),
  status: z.enum(['pending', 'accepted', 'rejected', 'withdrawn']),
  createdAtRevision: nonzeroWorldRevisionHashSchema,
  evidenceIds: evidenceIdsSchema,
  acceptedAgreementId: prefixedIdSchema('agreement').optional(),
}).strict();
export type DiplomaticProposalState = z.infer<typeof diplomaticProposalStateSchema>;

export const tributeObligationStateSchema = z.object({
  obligationId: tributeObligationIdSchema,
  payerPolityIds: z.array(polityIdSchema).min(1),
  sourceRegionIds: z.array(regionIdSchema).min(1),
  beneficiaries: z.array(z.object({
    polityId: polityIdSchema,
    shareBp: basisPointsSchema,
  }).strict()).min(1),
  deliveries: z.array(z.object({
    commodityId: stableIdSchema,
    quantity: safeNonNegativeIntegerSchema,
  }).strict()),
  laborService: z.object({ people: safeNonNegativeIntegerSchema }).strict().optional(),
  militaryService: z.object({ personnel: safeNonNegativeIntegerSchema }).strict().optional(),
  routeIds: z.array(routeIdSchema),
  cadence: nonEmptyTextSchema,
  arrears: z.array(z.object({
    commodityId: stableIdSchema,
    quantity: safeNonNegativeIntegerSchema,
  }).strict()),
  complianceBp: basisPointsSchema,
  enforcementBasisId: stableIdSchema,
  evidenceIds: evidenceIdsSchema,
}).strict();
export type TributeObligationState = z.infer<typeof tributeObligationStateSchema>;

export const knowledgeStateSchema = z.object({
  records: z.array(z.object({
    polityId: polityIdSchema,
    conceptId: conceptIdSchema,
    evidenceIds: evidenceIdsSchema,
  }).strict()),
}).strict();

const entityRefSchema = z.union([
  polityIdSchema,
  regionIdSchema,
  populationCohortIdSchema,
  formationIdSchema,
  routeIdSchema,
  characterIdSchema,
  groupIdSchema,
  institutionIdSchema,
  conceptIdSchema,
  processIdSchema,
  relationshipIdSchema,
  diplomaticProposalIdSchema,
  tributeObligationIdSchema,
]);

export const worldEventSchema = z.object({
  eventId: worldEventIdSchema,
  /** Revision whose committed facts caused/based this event; current revision would be circular. */
  revision: nonzeroWorldRevisionHashSchema,
  kind: nonEmptyTextSchema,
  entityRefs: z.array(entityRefSchema),
  evidenceIds: evidenceIdsSchema,
  /** Present only when this event changes living population. */
  populationCausality: populationCausalitySchema.optional(),
}).strict();

export const evidenceRecordSchema = z.object({
  evidenceId: evidenceIdSchema,
  /** Causal/basis revision from revisionLineage; never the self-hashed current revision. */
  revision: nonzeroWorldRevisionHashSchema,
  kind: nonEmptyTextSchema,
  entityRefs: z.array(entityRefSchema),
  eventRefs: z.array(worldEventIdSchema),
  canonicalPointers: z.array(z.string().regex(/^(?:\/(?:[^~/]|~0|~1)*)*$/, 'Invalid JSON pointer')),
  visibility: z.enum(['public', 'polity', 'private', 'editor']),
  /** Explicit scope for polity-visible evidence; ignored by normal access for private/editor records. */
  visibleToPolityIds: z.array(polityIdSchema).optional(),
}).strict().transform((record) => {
  const visibleToPolityIds = [...(record.visibleToPolityIds ?? [])].sort();
  if (visibleToPolityIds.length > 0) return { ...record, visibleToPolityIds };
  const { visibleToPolityIds: _emptyScope, ...withoutEmptyScope } = record;
  void _emptyScope;
  return withoutEmptyScope;
});
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

export const worldRulesSchema = z.object({
  physicalModel: stableIdSchema,
  knowledgeBaseline: z.array(conceptIdSchema),
  communicationModel: stableIdSchema,
  governmentModel: stableIdSchema,
  militaryModel: stableIdSchema,
  hardProhibitions: z.array(nonEmptyTextSchema),
  plausibilityContext: z.array(nonEmptyTextSchema),
}).strict();

export const moduleManifestSchema = z.object({
  enabled: z.array(prefixedIdSchema('module')),
}).strict();

export const catalogManifestSchema = z.object({
  modules: z.array(z.object({
    moduleId: prefixedIdSchema('module'),
  }).strict()),
  worldModels: z.array(z.object({
    modelId: stableIdSchema,
    kind: z.enum(['physical', 'communication', 'government', 'military']),
  }).strict()),
  commodities: z.array(z.object({
    commodityId: stableIdSchema,
    usage: z.enum(['stockpile', 'regional', 'both']),
  }).strict()),
  controlProfiles: z.array(z.object({
    controlProfileId: prefixedIdSchema('control-profile'),
    kind: z.enum(['sovereign', 'occupation', 'autonomy', 'indirect', 'contested']),
    administrationAccessBp: basisPointsSchema,
    extractionAccessBp: basisPointsSchema,
    recruitmentAccessBp: basisPointsSchema,
    integrationBp: basisPointsSchema,
  }).strict()),
  formationArchetypes: z.array(z.object({
    formationArchetypeId: formationArchetypeIdSchema,
    equipmentClassIds: z.array(equipmentClassIdSchema),
  }).strict()),
  equipmentClasses: z.array(z.object({
    equipmentClassId: equipmentClassIdSchema,
  }).strict()),
  routeClasses: z.array(z.object({
    routeClassId: routeClassIdSchema,
  }).strict()),
  relationshipTypes: z.array(z.object({
    relationshipTypeId: prefixedIdSchema('relationship-type'),
  }).strict()).default([]),
}).strict();

export const worldStateV2ContentSchema = z.object({
  schemaVersion: z.literal(WORLD_STATE_V2_SCHEMA_VERSION),
  scenarioId: scenarioIdSchema,
  month: gameDateSchema,
  turn: safeNonNegativeIntegerSchema,
  revisionLineage: z.object({
    seedRevision: nonzeroWorldRevisionHashSchema,
    /** Complete prior-state chain, excluding seedRevision and the current self-hash. */
    ancestorRevisions: z.array(nonzeroWorldRevisionHashSchema),
  }).strict(),
  worldRules: worldRulesSchema,
  modules: moduleManifestSchema,
  catalogs: catalogManifestSchema,
  polities: z.array(polityStateV2Schema).min(1),
  regions: z.array(regionStateV2Schema).min(1),
  populationCohorts: z.array(populationCohortStateSchema),
  formations: z.array(formationStateV2Schema),
  routes: z.array(routeStateV2Schema),
  characters: z.array(characterStateSchema),
  groups: z.array(groupStateSchema),
  institutions: z.array(institutionStateSchema),
  concepts: z.array(conceptStateSchema),
  processes: z.array(worldProcessStateSchema),
  relationships: z.array(relationshipStateSchema),
  diplomaticProposals: z.array(diplomaticProposalStateSchema).default([]),
  tributeObligations: z.array(tributeObligationStateSchema).default([]),
  knowledge: knowledgeStateSchema,
  events: z.array(worldEventSchema),
  evidence: z.array(evidenceRecordSchema),
}).strict();

export const worldStateV2Schema = worldStateV2ContentSchema.extend({
  revision: worldRevisionHashSchema,
}).strict();

export type WorldStateV2Input = z.input<typeof worldStateV2ContentSchema>;
export type WorldStateV2 = z.output<typeof worldStateV2Schema>;

export { conceptStateSchema, worldProcessStateSchema } from '../processes/schema.js';

/** Parse at a persistence/commit boundary: structure, references and revision all fail closed. */
export function parseWorldStateV2(input: unknown): WorldStateV2 {
  const parsed = worldStateV2Schema.parse(input);
  const canonical = canonicalWorldState(parsed);
  assertWorldStateV2Invariants(canonical);
  const expectedRevision = worldStateChecksum(canonical);
  if (parsed.revision !== expectedRevision) {
    throw new Error(`world state revision mismatch: recorded ${parsed.revision}, canonical content hashes to ${expectedRevision}`);
  }
  return canonical;
}

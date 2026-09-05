import { z } from 'zod';
import {
  assetIdSchema,
  gameDateSchema,
  polityIdSchema,
  regionIdSchema,
  scenarioIdSchema,
  sourceIdSchema,
} from '@open-historia/domain';

export const SCENARIO_V3_SCHEMA_VERSION = 'open-historia-scenario/3' as const;

const nonEmptyText = z.string().trim().min(1);
const nonNegativeSafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const basisPoints = z.number().int().min(0).max(10000);
const checksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const stableId = (prefix: string) => z.string().max(160).regex(
  new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]{0,139}$`),
  `Invalid ${prefix} ID`,
);
const genericStableId = z.string().max(160).regex(/^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._-]{0,139}$/);

export const scenarioProfileSchema = z.enum(['historical', 'fictional', 'development']);
export type ScenarioProfile = z.infer<typeof scenarioProfileSchema>;

const moduleIdSchema = stableId('module');
const worldModelIdSchema = stableId('world-model');
const commodityIdSchema = stableId('commodity');
const activityIdSchema = stableId('activity');
const recipeIdSchema = stableId('recipe');
const institutionTypeIdSchema = stableId('institution-type');
const officeTypeIdSchema = stableId('office-type');
const formationArchetypeIdSchema = stableId('formation-archetype');
const equipmentClassIdSchema = stableId('equipment-class');
const financeProfileIdSchema = stableId('finance-profile');
const revenueChannelIdSchema = stableId('revenue-channel');
const financeInstrumentIdSchema = stableId('finance-instrument');
const controlProfileIdSchema = stableId('control-profile');
const relationshipTypeIdSchema = stableId('relationship-type');
const routeClassIdSchema = stableId('route-class');
const evidenceIdSchema = stableId('evidence');
const cohortIdSchema = stableId('cohort');
const formationIdSchema = stableId('formation');
const institutionIdSchema = stableId('institution');
const relationshipIdSchema = stableId('relationship');
const tributeObligationIdSchema = stableId('obligation');
const routeIdSchema = stableId('route');
const conceptIdSchema = stableId('concept');
const knowledgeIdSchema = stableId('knowledge');
const unitIdSchema = stableId('unit');

export const scenarioConceptTypeSchema = z.enum([
  'technology',
  'ideology',
  'religious-movement',
  'institution',
  'doctrine',
  'economic-practice',
  'scientific-theory',
]);
export const scenarioProcessStageSchema = z.enum([
  'proposed',
  'emerging',
  'organized',
  'demonstrated',
  'adopted',
  'institutionalized',
]);
const semanticKeySchema = z.string().min(1).max(120).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  'Semantic key must be normalized lower-kebab-case',
);

const localizedTextSchema = z.object({ en: nonEmptyText, ru: nonEmptyText.optional() }).strict();
const evidenceIdsSchema = z.array(evidenceIdSchema).min(1);

const idOnly = <T extends z.ZodType<string>>(idSchema: T) => z.object({ id: idSchema }).strict();

const catalogsSchema = z.object({
  modules: z.record(moduleIdSchema, z.object({ id: moduleIdSchema, kind: nonEmptyText }).strict()),
  worldModels: z.record(worldModelIdSchema, z.object({ id: worldModelIdSchema, kind: z.enum(['physical', 'communication', 'government', 'military']) }).strict()),
  commodities: z.record(commodityIdSchema, z.object({
    id: commodityIdSchema,
    unitId: unitIdSchema,
    usage: z.enum(['stockpile', 'regional', 'both']),
  }).strict()),
  activities: z.record(activityIdSchema, z.object({
    id: activityIdSchema,
    inputCommodityIds: z.array(commodityIdSchema),
    outputCommodityIds: z.array(commodityIdSchema).min(1),
  }).strict()),
  recipes: z.record(recipeIdSchema, z.object({
    id: recipeIdSchema,
    inputs: z.record(commodityIdSchema, nonNegativeSafeInteger),
    outputs: z.record(commodityIdSchema, nonNegativeSafeInteger),
  }).strict()),
  institutionTypes: z.record(institutionTypeIdSchema, idOnly(institutionTypeIdSchema)),
  officeTypes: z.record(officeTypeIdSchema, idOnly(officeTypeIdSchema)),
  formationArchetypes: z.record(formationArchetypeIdSchema, z.object({ id: formationArchetypeIdSchema, equipmentClassIds: z.array(equipmentClassIdSchema) }).strict()),
  equipmentClasses: z.record(equipmentClassIdSchema, idOnly(equipmentClassIdSchema)),
  financeProfiles: z.record(financeProfileIdSchema, z.object({
    id: financeProfileIdSchema,
    revenueChannelIds: z.array(revenueChannelIdSchema),
    instrumentIds: z.array(financeInstrumentIdSchema),
  }).strict()),
  revenueChannels: z.record(revenueChannelIdSchema, idOnly(revenueChannelIdSchema)),
  financeInstruments: z.record(financeInstrumentIdSchema, idOnly(financeInstrumentIdSchema)),
  controlProfiles: z.record(controlProfileIdSchema, z.object({
    id: controlProfileIdSchema,
    kind: z.enum(['sovereign', 'occupation', 'autonomy', 'indirect', 'contested']),
    administrationAccessBp: basisPoints,
    extractionAccessBp: basisPoints,
    recruitmentAccessBp: basisPoints,
    integrationBp: basisPoints,
  }).strict()),
  relationshipTypes: z.record(relationshipTypeIdSchema, idOnly(relationshipTypeIdSchema)),
  routeClasses: z.record(routeClassIdSchema, idOnly(routeClassIdSchema)),
  terminology: z.record(genericStableId, localizedTextSchema),
}).strict();

const geographyLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scenario-asset'), assetId: assetIdSchema, featureId: nonEmptyText }).strict(),
  z.object({ kind: z.literal('base-dataset'), datasetId: genericStableId, featureId: nonEmptyText }).strict(),
  z.object({ kind: z.literal('off-map'), reason: nonEmptyText }).strict(),
]);

const historicalBasisSchema = z.object({
  kind: z.literal('historical'),
  sourceIds: z.array(sourceIdSchema).min(1),
  observationDate: gameDateSchema,
  method: nonEmptyText,
  confidence: z.enum(['high', 'medium', 'low']),
  todo: nonEmptyText.optional(),
}).strict();
const fictionalBasisSchema = z.object({ kind: z.literal('fictional'), premise: nonEmptyText }).strict();
const developmentBasisSchema = z.object({ kind: z.literal('development'), synthetic: z.literal(true) }).strict();

export const scenarioV3Schema = z.object({
  schemaVersion: z.literal(SCENARIO_V3_SCHEMA_VERSION),
  id: scenarioIdSchema,
  profile: scenarioProfileSchema,
  metadata: z.object({ title: localizedTextSchema, description: localizedTextSchema.optional() }).strict(),
  game: z.object({
    startDate: gameDateSchema,
    defaultPlayerPolityId: polityIdSchema,
    playerEligiblePolityIds: z.array(polityIdSchema).min(1),
  }).strict(),
  worldRules: z.object({
    physicalModel: worldModelIdSchema,
    knowledgeBaseline: z.array(conceptIdSchema),
    communicationModel: worldModelIdSchema,
    governmentModel: worldModelIdSchema,
    militaryModel: worldModelIdSchema,
    hardProhibitions: z.array(nonEmptyText),
    plausibilityContext: z.array(nonEmptyText),
  }).strict(),
  modules: z.object({ enabled: z.array(moduleIdSchema) }).strict(),
  catalogs: catalogsSchema,
  geography: z.object({
    assets: z.record(assetIdSchema, z.object({
      id: assetIdSchema,
      mediaType: nonEmptyText,
      checksum: checksumSchema,
      license: nonEmptyText,
      effectiveDate: gameDateSchema,
    }).strict()),
    regions: z.record(regionIdSchema, z.object({
      id: regionIdSchema,
      link: geographyLinkSchema,
      adjacentRegionIds: z.array(regionIdSchema),
    }).strict()),
  }).strict(),
  startingState: z.object({
    polities: z.record(polityIdSchema, z.object({
      id: polityIdSchema,
      displayName: localizedTextSchema,
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      decisionMode: z.enum(['active', 'supported', 'inert']).optional(),
      treasury: nonNegativeSafeInteger,
      stockpiles: z.record(commodityIdSchema, nonNegativeSafeInteger),
      evidenceIds: evidenceIdsSchema,
    }).strict()),
    regions: z.record(regionIdSchema, z.object({
      id: regionIdSchema,
      displayName: localizedTextSchema,
      legalOwnerPolityId: polityIdSchema,
      actualControllerPolityId: polityIdSchema,
      controlProfileId: controlProfileIdSchema,
      fiscalBase: nonNegativeSafeInteger,
      productiveCapacity: nonNegativeSafeInteger,
      supplyCapacity: nonNegativeSafeInteger,
      resources: z.record(commodityIdSchema, nonNegativeSafeInteger),
      evidenceIds: evidenceIdsSchema,
    }).strict()),
    populationCohorts: z.record(cohortIdSchema, z.object({
      id: cohortIdSchema,
      regionId: regionIdSchema,
      population: nonNegativeSafeInteger,
      workforceParticipationBp: basisPoints,
      recruitmentEligibilityBp: basisPoints,
      evidenceIds: evidenceIdsSchema,
    }).strict()),
    formations: z.record(formationIdSchema, z.object({
      id: formationIdSchema,
      polityId: polityIdSchema,
      archetypeId: formationArchetypeIdSchema,
      personnelOrigins: z.record(regionIdSchema, nonNegativeSafeInteger),
      equipment: z.record(equipmentClassIdSchema, nonNegativeSafeInteger),
      evidenceIds: evidenceIdsSchema,
    }).strict()),
    institutions: z.record(institutionIdSchema, z.object({
      id: institutionIdSchema,
      typeId: institutionTypeIdSchema,
      polityId: polityIdSchema.optional(),
      regionId: regionIdSchema.optional(),
      evidenceIds: evidenceIdsSchema,
    }).strict()),
    relationships: z.record(relationshipIdSchema, z.object({
      id: relationshipIdSchema,
      typeId: relationshipTypeIdSchema,
      participantPolityIds: z.array(polityIdSchema).min(2),
      evidenceIds: evidenceIdsSchema,
    }).strict()),
    tributeObligations: z.record(tributeObligationIdSchema, z.object({
      id: tributeObligationIdSchema,
      payerPolityIds: z.array(polityIdSchema).min(1),
      sourceRegionIds: z.array(regionIdSchema).min(1),
      beneficiaries: z.array(z.object({
        polityId: polityIdSchema,
        shareBp: basisPoints,
      }).strict()).min(1),
      deliveries: z.array(z.object({
        commodityId: commodityIdSchema,
        quantity: nonNegativeSafeInteger,
      }).strict()),
      laborService: z.object({ people: nonNegativeSafeInteger }).strict().optional(),
      militaryService: z.object({ personnel: nonNegativeSafeInteger }).strict().optional(),
      routeIds: z.array(routeIdSchema),
      cadence: nonEmptyText,
      arrears: z.array(z.object({
        commodityId: commodityIdSchema,
        quantity: nonNegativeSafeInteger,
      }).strict()),
      complianceBp: basisPoints,
      enforcementBasisId: genericStableId,
      evidenceIds: evidenceIdsSchema,
    }).strict()).default({}),
    routes: z.record(routeIdSchema, z.object({
      id: routeIdSchema,
      classId: routeClassIdSchema,
      regionIds: z.array(regionIdSchema).min(1),
      allowedCommodityIds: z.array(commodityIdSchema),
      evidenceIds: evidenceIdsSchema,
    }).strict()),
    concepts: z.record(conceptIdSchema, z.object({
      id: conceptIdSchema,
      type: scenarioConceptTypeSchema,
      semanticKey: semanticKeySchema,
      displayName: localizedTextSchema,
      description: localizedTextSchema,
      origin: z.object({
        originEntityRefs: z.array(genericStableId).min(1),
        originMonth: gameDateSchema,
        discovererEntityRef: genericStableId.optional(),
      }).strict(),
      parentConceptIds: z.array(conceptIdSchema),
      supportingEvidenceIds: evidenceIdsSchema,
      domains: z.array(genericStableId).min(1),
      status: scenarioProcessStageSchema,
      maturityBp: basisPoints,
      diffusion: z.record(regionIdSchema, basisPoints),
      adoption: z.object({
        polities: z.record(polityIdSchema, basisPoints),
        regions: z.record(regionIdSchema, basisPoints),
      }).strict(),
      sourceEvidenceId: evidenceIdSchema,
      evidenceIds: evidenceIdsSchema,
    }).strict()),
    knowledge: z.record(knowledgeIdSchema, z.object({
      id: knowledgeIdSchema,
      polityId: polityIdSchema,
      conceptId: conceptIdSchema,
      evidenceIds: evidenceIdsSchema,
    }).strict()),
  }).strict(),
  provenance: z.object({
    sources: z.record(sourceIdSchema, z.object({
      id: sourceIdSchema,
      title: nonEmptyText,
      locator: nonEmptyText,
      checksum: checksumSchema,
    }).strict()),
    evidence: z.record(evidenceIdSchema, z.object({
      id: evidenceIdSchema,
      binding: z.object({
        path: z.string().regex(/^(?:\/(?:[^~/]|~0|~1)*)+$/, 'Binding path must be an RFC 6901 JSON pointer'),
        valueChecksum: checksumSchema,
      }).strict(),
      basis: z.discriminatedUnion('kind', [historicalBasisSchema, fictionalBasisSchema, developmentBasisSchema]),
      visibility: z.enum(['public', 'polity', 'private', 'editor']),
      visibleToPolityIds: z.array(polityIdSchema).optional(),
    }).strict()),
  }).strict(),
}).strict();

export type ScenarioV3 = z.output<typeof scenarioV3Schema>;
export type ScenarioV3Input = z.input<typeof scenarioV3Schema>;

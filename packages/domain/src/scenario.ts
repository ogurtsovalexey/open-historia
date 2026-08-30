import { z } from 'zod';
import {
  scenarioIdSchema,
  polityIdSchema,
  regionIdSchema,
  sourceIdSchema,
  factIdSchema,
  assumptionIdSchema,
  macroRegionIdSchema,
  assetIdSchema,
  draftPatchIdSchema,
  gameDateSchema,
  dateRangeSchema,
  confidenceSchema
} from './ids.js';
import {
  historicalFactSchema,
  sourceRefSchema,
  assumptionSchema,
  FactValue
} from './facts.js';

/**
 * Asset reference schema
 */
export const assetRefSchema = z.object({
  id: assetIdSchema,
  kind: z.enum(['regions', 'cities', 'background', 'other']),
  path: z.string().optional(),
  contentAddress: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  mediaType: z.string(),
  required: z.boolean()
}).strict();
export type AssetRef = z.infer<typeof assetRefSchema>;

/**
 * Scenario manifest schema
 */
export const scenarioManifestSchema = z.object({
  schemaVersion: z.literal(2),
  id: scenarioIdSchema,
  contentVersion: z.string().regex(/^\d+\.\d+\.\d+$/), // SemVer without leading v
  engineRange: z.string(),
  defaultLocale: z.string(),
  scenarioPath: z.literal('scenario.json'),
  sourcesPath: z.literal('sources.json'),
  assets: z.array(assetRefSchema)
}).strict();
export type ScenarioManifest = z.infer<typeof scenarioManifestSchema>;

/**
 * Scenario metadata schema
 */
export const scenarioMetaSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  locales: z.record(
    z.string(),
    z.object({
      title: z.string(),
      description: z.string().optional()
    }).strict()
  ).optional()
}).strict();
export type ScenarioMeta = z.infer<typeof scenarioMetaSchema>;

/**
 * Polity definition schema
 */
export const polityDefSchema = z.object({
  id: polityIdSchema,
  name: z.string(),
  aliases: z.array(z.string()).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i)
}).strict();
export type PolityDef = z.infer<typeof polityDefSchema>;

/**
 * Region reference schema
 */
export const regionRefSchema = z.object({
  id: regionIdSchema,
  dataset: z.string(),
  datasetVersion: z.string(),
  nativeId: z.string()
}).strict();
export type RegionRef = z.infer<typeof regionRefSchema>;

/**
 * City definition schema
 */
export const cityDefSchema = z.object({
  id: z.string(), // City IDs follow their own pattern, not in scope-v2-integrity.md
  name: z.string(),
  regionId: regionIdSchema,
  population: z.number().optional(),
  note: z.string().optional()
}).strict();
export type CityDef = z.infer<typeof cityDefSchema>;

/**
 * Faction definition schema
 */
export const factionDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  leader: z.string().optional(),
  ideology: z.string().optional(),
  strength: z.string().optional() // e.g., "strong", "weak", "rising"
}).strict();
export type FactionDef = z.infer<typeof factionDefSchema>;

/**
 * Conflict definition schema
 */
export const conflictDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  participants: z.array(polityIdSchema),
  startDate: gameDateSchema.optional(),
  status: z.enum(['active', 'dormant', 'resolved']).optional(),
  type: z.enum(['war', 'civil-war', 'rebellion', 'colonial']).optional()
}).strict();
export type ConflictDef = z.infer<typeof conflictDefSchema>;

/**
 * Simulation rules schema
 */
export const simulationRulesSchema = z.object({
  era: z.string(),
  aiHistoryMode: z.enum(['conditional', 'free', 'guided']),
  eraNarrative: z.string().optional(),
  constraints: z.object({
    noAirPower: z.boolean().optional(),
    noGunpowder: z.boolean().optional(),
    noNaval: z.boolean().optional(),
    maxUnitTier: z.number().int().positive().optional(),
    narrativeRules: z.array(z.string()).optional()
  }).strict(),
  factions: z.array(factionDefSchema).optional(),
  activeConflicts: z.array(conflictDefSchema).optional(),
  technologyLevel: z.object({
    era: z.string(),
    notable: z.array(z.string()).optional()
  }).strict()
}).strict();
export type SimulationRules = z.infer<typeof simulationRulesSchema>;

/**
 * Macro region definition schema
 */
export const macroRegionDefSchema = z.object({
  id: macroRegionIdSchema,
  name: z.string(),
  members: z.array(regionIdSchema),
  purpose: z.enum(['aggregation', 'fixture', 'historical-area']),
  geometryAssetRef: assetIdSchema.optional()
}).strict();
export type MacroRegionDef = z.infer<typeof macroRegionDefSchema>;

/**
 * Fidelity gap schema
 */
export const fidelityGapSchema = z.object({
  path: z.string(), // JSON pointer
  disposition: z.enum(['unknown', 'assumption', 'not-applicable']),
  reason: z.string(),
  assumptionRef: assumptionIdSchema.optional()
}).strict();
export type FidelityGap = z.infer<typeof fidelityGapSchema>;

/**
 * Fidelity manifest schema
 */
export const fidelityManifestSchema = z.object({
  intendedUse: z.enum(['test-fixture', 'development-scenario', 'playable-scenario']),
  polityLevels: z.record(polityIdSchema, z.enum(['Baseline', 'Supported', 'Curated'])),
  gaps: z.array(fidelityGapSchema)
}).strict();
export type FidelityManifest = z.infer<typeof fidelityManifestSchema>;

/**
 * Main scenario schema
 */
export const scenarioV2Schema = z.object({
  schemaVersion: z.literal(2),
  id: scenarioIdSchema,
  meta: scenarioMetaSchema,
  game: z.object({
    startDate: gameDateSchema,
    defaultPlayer: polityIdSchema
  }).strict(),
  polities: z.record(polityIdSchema, polityDefSchema),
  regions: z.array(regionRefSchema),
  regionAssignments: z.record(regionIdSchema, polityIdSchema).optional(),
  cities: z.array(cityDefSchema).optional(),
  simulationRules: simulationRulesSchema,
  historicalFacts: z.array(historicalFactSchema),
  assumptions: z.array(assumptionSchema),
  macroRegions: z.array(macroRegionDefSchema),
  fidelity: fidelityManifestSchema
}).strict();
export type ScenarioV2 = z.infer<typeof scenarioV2Schema>;

/**
 * Pregame narrative segment schema
 */
export const pregameNarrativeSegmentSchema = z.object({
  text: z.string(),
  kind: z.enum(['fact', 'inference', 'narrative-color']),
  factRefs: z.array(factIdSchema),
  claimRefs: z.array(z.string())
}).strict();
export type PregameNarrativeSegment = z.infer<typeof pregameNarrativeSegmentSchema>;

/**
 * Inferred claim assertion operator schema
 */
export const assertionOperatorSchema = z.enum([
  'equals',
  'not-equals',
  'less-than',
  'less-or-equal',
  'greater-than',
  'greater-or-equal',
  'contains'
]);

/**
 * Inferred claim assertion schema (excluding unknown values)
 */
const comparableFactValueSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('quantity'),
    amount: z.string(),
    unit: z.string(),
    scope: z.string().optional()
  }).strict(),
  z.object({
    kind: z.literal('text'),
    value: z.string()
  }).strict(),
  z.object({
    kind: z.literal('boolean'),
    value: z.boolean()
  }).strict(),
  z.object({
    kind: z.literal('entity-ref'),
    value: z.string() // EntityId
  }).strict()
]);

/**
 * Inferred claim assertion schema
 */
export const inferredClaimAssertionSchema = z.object({
  subjectRef: z.string(), // EntityId
  predicate: z.string(),
  operator: assertionOperatorSchema,
  value: comparableFactValueSchema
}).strict();
export type InferredClaimAssertion = z.infer<typeof inferredClaimAssertionSchema>;

/**
 * Inferred claim schema
 */
export const inferredClaimSchema = z.object({
  id: z.string(),
  claim: z.string(),
  evidenceRefs: z.array(factIdSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  assertion: inferredClaimAssertionSchema
}).strict();
export type InferredClaim = z.infer<typeof inferredClaimSchema>;

/**
 * Pregame narrative draft schema
 */
export const pregameNarrativeDraftSchema = z.object({
  schemaVersion: z.literal(1),
  scenarioId: scenarioIdSchema,
  baseInputChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  segments: z.array(pregameNarrativeSegmentSchema),
  factsUsed: z.array(factIdSchema),
  inferredClaims: z.array(inferredClaimSchema)
}).strict();
export type PregameNarrativeDraft = z.infer<typeof pregameNarrativeDraftSchema>;

/**
 * Draft patch operation schema
 */
export const draftPatchOperationSchema = z.object({
  op: z.enum(['add', 'replace', 'remove']),
  path: z.string(), // JSON pointer
  value: z.any().optional(), // JSON value
  sourceRefs: z.array(sourceIdSchema),
  assumptionRefs: z.array(assumptionIdSchema),
  rationale: z.string()
}).strict();
export type DraftPatchOperation = z.infer<typeof draftPatchOperationSchema>;

/**
 * Draft scenario patch schema
 */
export const draftScenarioPatchSchema = z.object({
  schemaVersion: z.literal(1),
  id: draftPatchIdSchema,
  status: z.literal('draft'),
  base: z.object({
    scenarioId: scenarioIdSchema,
    contentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    inputChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/)
  }).strict(),
  operations: z.array(draftPatchOperationSchema)
}).strict();
export type DraftScenarioPatch = z.infer<typeof draftScenarioPatchSchema>;
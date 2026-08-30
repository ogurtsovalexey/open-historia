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
  entityIdSchema,
  historicalFactSchema,
  assumptionSchema,
} from '@open-historia/domain';

// ── SemVer (no leading "v") ───────────────────────────────────────────────────
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const semverRangePattern = /^(?:\*|(?:\^|~|>=?|<=?)?\s*(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\s+(?:>=?|<=?)?\s*(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)*)$/;

export const contentVersionSchema = z
  .string()
  .regex(semverPattern, 'Content version must be SemVer without a leading v');
export type ContentVersion = z.infer<typeof contentVersionSchema>;

export const engineRangeSchema = z
  .string()
  .regex(semverRangePattern, 'Engine range must be a deterministic SemVer range');

export const relativePackagePathSchema = z
  .string()
  .min(1)
  .refine((path) => {
    if (path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
    return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  }, 'Asset path must be a safe package-relative path using / separators');

// ── Package manifest ──────────────────────────────────────────────────────────
export const assetRefSchema = z
  .object({
    id: assetIdSchema,
    kind: z.enum(['regions', 'cities', 'background', 'other']),
    path: relativePackagePathSchema.optional(),
    contentAddress: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/, 'contentAddress must be `sha256:<hex>`')
      .optional(),
    mediaType: z.string(),
    required: z.boolean(),
  })
  .strict();
export type ScenarioAssetRef = z.infer<typeof assetRefSchema>;

export const scenarioManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: scenarioIdSchema,
    contentVersion: contentVersionSchema,
    engineRange: engineRangeSchema,
    defaultLocale: z.string().min(1),
    scenarioPath: z.literal('scenario.json'),
    sourcesPath: z.literal('sources.json'),
    assets: z.array(assetRefSchema),
  })
  .strict();
export type ScenarioV2Manifest = z.infer<typeof scenarioManifestSchema>;

// ── Scenario metadata ────────────────────────────────────────────────────────
export const scenarioMetaSchema = z
  .object({
    title: z.string(),
    description: z.string().optional(),
    locales: z
      .record(
        z.string(),
        z
          .object({
            title: z.string(),
            description: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type ScenarioMeta = z.infer<typeof scenarioMetaSchema>;

// ── Polities, regions, cities ─────────────────────────────────────────────────
export const polityDefSchema = z
  .object({
    id: polityIdSchema,
    name: z.string(),
    aliases: z.array(z.string()).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be `#RRGGBB`'),
  })
  .strict();
export type PolityDef = z.infer<typeof polityDefSchema>;

export const regionRefSchema = z
  .object({
    id: regionIdSchema,
    dataset: z.string(),
    datasetVersion: z.string(),
    nativeId: z.string(),
  })
  .strict();
export type RegionRef = z.infer<typeof regionRefSchema>;

export const cityDefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    regionId: regionIdSchema,
    population: z.number().int().nonnegative().optional(),
    note: z.string().optional(),
  })
  .strict();
export type CityDef = z.infer<typeof cityDefSchema>;

// ── Structured simulation rules ──────────────────────────────────────────────
export const factionDefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    leader: z.string().optional(),
    ideology: z.string().optional(),
    strength: z.string().optional(),
  })
  .strict();
export type FactionDef = z.infer<typeof factionDefSchema>;

export const conflictDefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    participants: z.array(polityIdSchema),
    startDate: gameDateSchema.optional(),
    status: z.enum(['active', 'dormant', 'resolved']).optional(),
    type: z.enum(['war', 'civil-war', 'rebellion', 'colonial']).optional(),
  })
  .strict();
export type ConflictDef = z.infer<typeof conflictDefSchema>;

export const simulationRulesSchema = z
  .object({
    era: z.string(),
    aiHistoryMode: z.enum(['conditional', 'free', 'guided']),
    eraNarrative: z.string().optional(),
    constraints: z
      .object({
        noAirPower: z.boolean().optional(),
        noGunpowder: z.boolean().optional(),
        noNaval: z.boolean().optional(),
        maxUnitTier: z.number().int().positive().optional(),
        narrativeRules: z.array(z.string()).optional(),
      })
      .strict(),
    factions: z.array(factionDefSchema).optional(),
    activeConflicts: z.array(conflictDefSchema).optional(),
    technologyLevel: z
      .object({
        era: z.string(),
        notable: z.array(z.string()).optional(),
      })
      .strict(),
  })
  .strict();
export type SimulationRules = z.infer<typeof simulationRulesSchema>;

// ── Macro regions and fidelity ───────────────────────────────────────────────
export const macroRegionDefSchema = z
  .object({
    id: macroRegionIdSchema,
    name: z.string(),
    members: z.array(regionIdSchema).min(1),
    purpose: z.enum(['aggregation', 'fixture', 'historical-area']),
    geometryAssetRef: assetIdSchema.optional(),
  })
  .strict();
export type MacroRegionDef = z.infer<typeof macroRegionDefSchema>;

export const fidelityGapSchema = z
  .object({
    path: z.string().regex(/^(?:\/(?:[^~/]|~0|~1)*)+$/, 'Path must be an RFC 6901 JSON pointer'),
    disposition: z.enum(['unknown', 'assumption', 'not-applicable']),
    reason: z.string(),
    assumptionRef: assumptionIdSchema.optional(),
  })
  .strict();
export type FidelityGap = z.infer<typeof fidelityGapSchema>;

export const fidelityManifestSchema = z
  .object({
    intendedUse: z.enum(['test-fixture', 'development-scenario', 'playable-scenario']),
    polityLevels: z.record(polityIdSchema, z.enum(['Baseline', 'Supported', 'Curated'])),
    gaps: z.array(fidelityGapSchema),
  })
  .strict();
export type FidelityManifest = z.infer<typeof fidelityManifestSchema>;

// ── Scenario V2 document ──────────────────────────────────────────────────────
export const scenarioV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: scenarioIdSchema,
    meta: scenarioMetaSchema,
    game: z
      .object({
        startDate: gameDateSchema,
        defaultPlayer: polityIdSchema,
      })
      .strict(),
    polities: z.record(polityIdSchema, polityDefSchema),
    regions: z.array(regionRefSchema),
    regionAssignments: z.record(regionIdSchema, polityIdSchema).optional(),
    cities: z.array(cityDefSchema).optional(),
    simulationRules: simulationRulesSchema,
    historicalFacts: z.array(historicalFactSchema),
    assumptions: z.array(assumptionSchema),
    macroRegions: z.array(macroRegionDefSchema),
    fidelity: fidelityManifestSchema,
  })
  .strict();
export type ScenarioV2 = z.infer<typeof scenarioV2Schema>;

// ── Pregame narrative draft ──────────────────────────────────────────────────
export const assertionOperatorSchema = z.enum([
  'equals',
  'not-equals',
  'less-than',
  'less-or-equal',
  'greater-than',
  'greater-or-equal',
  'contains',
]);
export type AssertionOperator = z.infer<typeof assertionOperatorSchema>;

// A claim assertion cannot carry an `unknown` value (contract §8).
export const assertionValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('quantity'), amount: z.string(), unit: z.string(), scope: z.string().optional() }).strict(),
  z.object({ kind: z.literal('text'), value: z.string() }).strict(),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('entity-ref'), value: entityIdSchema }).strict(),
]);
export type AssertionValue = z.infer<typeof assertionValueSchema>;

export const inferredClaimSchema = z
  .object({
    id: z.string(),
    claim: z.string(),
    evidenceRefs: z.array(factIdSchema).min(1),
    confidence: z.enum(['high', 'medium', 'low']),
    assertion: z
      .object({
        subjectRef: entityIdSchema,
        predicate: z.string(),
        operator: assertionOperatorSchema,
        value: assertionValueSchema,
      })
      .strict(),
  })
  .strict();
export type InferredClaim = z.infer<typeof inferredClaimSchema>;

export const pregameNarrativeSegmentSchema = z
  .object({
    text: z.string(),
    kind: z.enum(['fact', 'inference', 'narrative-color']),
    factRefs: z.array(factIdSchema),
    claimRefs: z.array(z.string()),
  })
  .strict();
export type PregameNarrativeSegment = z.infer<typeof pregameNarrativeSegmentSchema>;

export const pregameNarrativeDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarioId: scenarioIdSchema,
    baseInputChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    segments: z.array(pregameNarrativeSegmentSchema),
    factsUsed: z.array(factIdSchema),
    inferredClaims: z.array(inferredClaimSchema),
  })
  .strict();
export type PregameNarrativeDraft = z.infer<typeof pregameNarrativeDraftSchema>;

// ── Draft scenario patch ──────────────────────────────────────────────────────
export const draftPatchOperationSchema = z
  .object({
    op: z.enum(['add', 'replace', 'remove']),
    path: z.string().startsWith('/'),
    value: z.json().optional(),
    sourceRefs: z.array(sourceIdSchema),
    assumptionRefs: z.array(assumptionIdSchema),
    rationale: z.string(),
  })
  .strict();
export type DraftPatchOperation = z.infer<typeof draftPatchOperationSchema>;

export const draftScenarioPatchSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: draftPatchIdSchema,
    status: z.literal('draft'),
    base: z
      .object({
        scenarioId: scenarioIdSchema,
        contentVersion: contentVersionSchema,
        inputChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      })
      .strict(),
    operations: z.array(draftPatchOperationSchema),
  })
  .strict();
export type DraftScenarioPatch = z.infer<typeof draftScenarioPatchSchema>;

// ── Effective date range helper type (re-exported for adapter consumers) ────
export type DateRange = z.infer<typeof dateRangeSchema>;

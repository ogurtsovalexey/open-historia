import { z } from 'zod';

/**
 * Validates ID format: lowercase ASCII, begins with letter, ends with letter/digit,
 * contains only single '-' separators, max 160 chars
 */
/**
 * Base ID schema for all typed IDs
 */
const slugPattern = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';

const baseIdSchema = (prefix: string) =>
  z.string()
    .max(160)
    .regex(new RegExp(`^${prefix}:${slugPattern}$`), `Invalid ${prefix} ID format`);

const qualifiedIdSchema = (prefix: string) =>
  z.string()
    .max(160)
    .regex(
      new RegExp(`^${prefix}:${slugPattern}:${slugPattern}$`),
      `Invalid ${prefix} ID format`
    );

// Core ID types from scenario-v2-integrity.md
export const scenarioIdSchema = baseIdSchema('scenario').brand<'ScenarioId'>();
export type ScenarioId = z.infer<typeof scenarioIdSchema>;

export const polityIdSchema = baseIdSchema('polity').brand<'PolityId'>();
export type PolityId = z.infer<typeof polityIdSchema>;

export const sourceIdSchema = qualifiedIdSchema('source').brand<'SourceId'>();
export type SourceId = z.infer<typeof sourceIdSchema>;

export const factIdSchema = qualifiedIdSchema('fact').brand<'FactId'>();
export type FactId = z.infer<typeof factIdSchema>;

export const assumptionIdSchema = qualifiedIdSchema('assumption').brand<'AssumptionId'>();
export type AssumptionId = z.infer<typeof assumptionIdSchema>;

export const macroRegionIdSchema = qualifiedIdSchema('macro-region').brand<'MacroRegionId'>();
export type MacroRegionId = z.infer<typeof macroRegionIdSchema>;

export const draftPatchIdSchema = qualifiedIdSchema('draft-patch').brand<'DraftPatchId'>();
export type DraftPatchId = z.infer<typeof draftPatchIdSchema>;

export const assetIdSchema = qualifiedIdSchema('asset').brand<'AssetId'>();
export type AssetId = z.infer<typeof assetIdSchema>;

/**
 * Region ID schema with dataset slug and native ID
 * Format: region:<dataset-slug>:<native-id>
 * Native ID is case-sensitive and preserves original case
 */
export const regionIdSchema = z.string()
  .max(160)
  .regex(
    /^region:[a-z0-9]+(?:-[a-z0-9]+)*:[A-Za-z0-9._-]+$/,
    'Invalid region ID format'
  )
  .brand<'RegionId'>();
export type RegionId = z.infer<typeof regionIdSchema>;

/**
 * Entity ID union - any valid entity identifier
 */
export const entityIdSchema = z.union([
  polityIdSchema,
  regionIdSchema,
  macroRegionIdSchema,
  // Note: scenario, source, fact, assumption IDs are not entity references
  // in the context of fact subjects
]);
export type EntityId = z.infer<typeof entityIdSchema>;

/**
 * World revision ID - opaque equality-only string
 */
export const worldRevisionIdSchema = z.string().min(1).brand<'WorldRevision'>();
export type WorldRevisionId = z.infer<typeof worldRevisionIdSchema>;

/**
 * Command/Event ID - stable typed identities
 */
export const commandIdSchema = z.string().uuid().brand<'Command'>();
export type CommandId = z.infer<typeof commandIdSchema>;

export const eventIdSchema = z.string().uuid().brand<'Event'>();
export type EventId = z.infer<typeof eventIdSchema>;

/**
 * GameDate schema - YYYY-MM-DD proleptic-Gregorian
 */
export const gameDateSchema = z.iso.date({
  message: 'Date must be a valid YYYY-MM-DD proleptic-Gregorian date'
});
export type GameDate = z.infer<typeof gameDateSchema>;

/**
 * Date range with inclusive bounds
 */
export const dateRangeSchema = z.object({
  from: gameDateSchema,
  until: gameDateSchema.optional()
}).strict().refine(
  (data) => !data.until || data.from <= data.until,
  { message: 'from date must be <= until date', path: ['until'] }
);
export type DateRange = z.infer<typeof dateRangeSchema>;

/**
 * Decimal quantity schema - base-10 string, never binary floating point
 */
export const decimalQuantitySchema = z.string().regex(/^-?\d+(\.\d+)?$/, {
  message: 'Amount must be a decimal number as string'
});
export type DecimalQuantity = z.infer<typeof decimalQuantitySchema>;

/**
 * Unit schema for quantities
 */
export const unitSchema = z.string().min(1);
export type Unit = z.infer<typeof unitSchema>;

/**
 * Confidence levels
 */
export const confidenceSchema = z.enum(['high', 'medium', 'low', 'assumption']);
export type Confidence = z.infer<typeof confidenceSchema>;

/**
 * Transformation operations
 */
export const transformationOperationSchema = z.enum([
  'identity',
  'unit-conversion',
  'calendar-conversion',
  'currency-conversion',
  'territorial-allocation',
  'aggregation',
  'scenario-choice'
]);
export type TransformationOperation = z.infer<typeof transformationOperationSchema>;

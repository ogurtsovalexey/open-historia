import { z } from 'zod';
import {
  entityIdSchema,
  sourceIdSchema,
  factIdSchema,
  assumptionIdSchema,
  confidenceSchema,
  transformationOperationSchema,
  decimalQuantitySchema,
  unitSchema,
  dateRangeSchema
} from './ids.js';

/**
 * Fact value discriminated union
 */
export const factValueSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('quantity'),
    amount: decimalQuantitySchema,
    unit: unitSchema,
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
    value: entityIdSchema
  }).strict(),
  z.object({
    kind: z.literal('unknown'),
    expectedKind: z.enum(['quantity', 'text', 'boolean', 'entity-ref']),
    reason: z.string()
  }).strict()
]);
export type FactValue = z.infer<typeof factValueSchema>;

/**
 * Transformation step
 */
export const transformationStepSchema = z.object({
  operation: transformationOperationSchema,
  description: z.string(),
  inputSourceRefs: sourceIdSchema.array(),
  formula: z.string().optional()
}).strict();
export type TransformationStep = z.infer<typeof transformationStepSchema>;

/**
 * Historical fact schema
 */
export const historicalFactSchema = z.object({
  id: factIdSchema,
  role: z.enum(['observation', 'starting-value']),
  subjectRefs: entityIdSchema.array(),
  predicate: z.string(),
  effectiveRange: dateRangeSchema,
  value: factValueSchema,
  sourceRefs: sourceIdSchema.array(),
  assumptionRefs: assumptionIdSchema.array(),
  confidence: confidenceSchema,
  transformation: transformationStepSchema.array(),
  note: z.string().optional()
}).strict();
export type HistoricalFact = z.infer<typeof historicalFactSchema>;

/**
 * Source reference schema
 */
export const sourceRefSchema = z.object({
  id: sourceIdSchema,
  title: z.string(),
  publisher: z.string().optional(),
  publicationDate: z.string().optional(),
  locator: z.string(),
  retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  license: z.object({
    status: z.enum(['redistributable', 'metadata-only', 'unknown']),
    name: z.string().optional(),
    url: z.string().optional()
  }).strict(),
  note: z.string().optional()
}).strict();
export type SourceRef = z.infer<typeof sourceRefSchema>;

/**
 * Assumption schema
 */
export const assumptionSchema = z.object({
  id: assumptionIdSchema,
  statement: z.string(),
  rationale: z.string(),
  affectedPaths: z.string().array(), // JSON pointers
  sourceRefs: sourceIdSchema.array(),
  status: z.literal('authored')
}).strict();
export type Assumption = z.infer<typeof assumptionSchema>;

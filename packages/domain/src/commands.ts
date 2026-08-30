import { z } from 'zod';
import {
  commandIdSchema,
  eventIdSchema,
  worldRevisionIdSchema,
  polityIdSchema,
  regionIdSchema,
  gameDateSchema
} from './ids.js';

/**
 * Base command schema with common fields
 */
const baseCommandSchema = z.object({
  id: commandIdSchema,
  issuedAt: gameDateSchema,
  issuedBy: polityIdSchema,
  targetRevision: worldRevisionIdSchema.nullable()
});

/**
 * Base event schema with common fields
 */
const baseEventSchema = z.object({
  id: eventIdSchema,
  commandId: commandIdSchema,
  occurredAt: gameDateSchema,
  appliedToRevision: worldRevisionIdSchema
});

/**
 * Command: Request region transfer
 * This expresses player/AI intent to transfer a region from one polity to another
 */
export const requestRegionTransferCommandSchema = baseCommandSchema.extend({
  type: z.literal('request-region-transfer'),
  regionId: regionIdSchema,
  fromPolityId: polityIdSchema,
  toPolityId: polityIdSchema,
  reason: z.string().min(1),
  wholeCountry: z.boolean().optional()
}).strict();
export type RequestRegionTransferCommand = z.infer<typeof requestRegionTransferCommandSchema>;

/**
 * Event: Region transferred
 * This is the validated, engine-accepted effect of a region transfer
 */
export const regionTransferredEventSchema = baseEventSchema.extend({
  type: z.literal('region-transferred'),
  regionId: regionIdSchema,
  fromPolityId: polityIdSchema,
  toPolityId: polityIdSchema,
  effectiveDate: gameDateSchema,
  transferId: z.string().uuid()
}).strict();
export type RegionTransferredEvent = z.infer<typeof regionTransferredEventSchema>;

/**
 * Command: Request polity rename
 * This expresses player/AI intent to rename a polity
 */
export const requestPolityRenameCommandSchema = baseCommandSchema.extend({
  type: z.literal('request-polity-rename'),
  polityId: polityIdSchema,
  newName: z.string().min(1),
  newColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  newAliases: z.string().array().optional(),
  reason: z.string().min(1)
}).strict();
export type RequestPolityRenameCommand = z.infer<typeof requestPolityRenameCommandSchema>;

/**
 * Event: Polity renamed
 * This is the validated, engine-accepted effect of a polity rename
 */
export const polityRenamedEventSchema = baseEventSchema.extend({
  type: z.literal('polity-renamed'),
  polityId: polityIdSchema,
  previousName: z.string(),
  newName: z.string(),
  previousColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  newColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  previousAliases: z.string().array(),
  newAliases: z.string().array().optional(),
  effectiveDate: gameDateSchema
}).strict();
export type PolityRenamedEvent = z.infer<typeof polityRenamedEventSchema>;

/**
 * Command discriminated union
 */
export const commandSchema = z.discriminatedUnion('type', [
  requestRegionTransferCommandSchema,
  requestPolityRenameCommandSchema
]);
export type Command = z.infer<typeof commandSchema>;

/**
 * Event discriminated union
 */
export const eventSchema = z.discriminatedUnion('type', [
  regionTransferredEventSchema,
  polityRenamedEventSchema
]);
export type Event = z.infer<typeof eventSchema>;

/**
 * Command validation result
 */
export const commandValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({
    path: z.string(),
    code: z.string(),
    message: z.string()
  }).strict()),
  warnings: z.array(z.object({
    path: z.string(),
    code: z.string(),
    message: z.string()
  }).strict())
}).strict();
export type CommandValidationResult = z.infer<typeof commandValidationResultSchema>;

/**
 * Command processing result
 */
export const commandProcessingResultSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'conflict']),
  commandId: commandIdSchema,
  events: eventSchema.array(),
  validation: commandValidationResultSchema,
  appliedRevision: worldRevisionIdSchema.nullable()
}).strict();
export type CommandProcessingResult = z.infer<typeof commandProcessingResultSchema>;

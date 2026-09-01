import { z } from 'zod';
import { gameDateSchema, polityIdSchema, regionIdSchema } from '@open-historia/domain';

const displayName = z.object({ en: z.string().min(1).max(120), ru: z.string().min(1).max(120) }).strict();

export const capabilityIdSchema = z.string().regex(/^capability:[a-z0-9][a-z0-9._-]{0,99}$/);
export const cultureIdSchema = z.string().regex(/^culture:[a-z0-9][a-z0-9._-]{0,99}$/);
export const religionIdSchema = z.string().regex(/^religion:[a-z0-9][a-z0-9._-]{0,99}$/);
export const identityPolicySchema = z.enum(['tolerance', 'privilege', 'integration', 'coercion']);
export type IdentityPolicy = z.infer<typeof identityPolicySchema>;

export const capabilityModifierSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('extraction-output'), bonusBp: z.number().int().min(1).max(3000) }).strict(),
  z.object({ kind: z.literal('processing-output'), bonusBp: z.number().int().min(1).max(3000) }).strict(),
  z.object({ kind: z.literal('project-capacity'), capacity: z.enum(['administration', 'science', 'industry']), amount: z.number().int().min(1).max(20) }).strict(),
  z.object({ kind: z.literal('land-supply'), bonusBp: z.number().int().min(1).max(3000) }).strict(),
]);
export const capabilityDefinitionSchema = z.object({
  capabilityId: capabilityIdSchema,
  displayName,
  domain: z.enum(['economy', 'administration', 'military', 'society']),
  prerequisiteIds: z.array(capabilityIdSchema).max(4),
  modifier: capabilityModifierSchema,
}).strict();
export const unlockedCapabilitySchema = z.object({
  polityId: polityIdSchema,
  capabilityId: capabilityIdSchema,
  unlockedMonth: gameDateSchema,
  sourceProjectId: z.string().regex(/^project:[a-z0-9][a-z0-9._-]{0,99}$/).nullable(),
}).strict();
export const capabilityStateSchema = z.object({
  catalog: z.array(capabilityDefinitionSchema),
  unlocked: z.array(unlockedCapabilitySchema),
}).strict();
export type CapabilityState = z.infer<typeof capabilityStateSchema>;
export const authoredCapabilitiesSchema = z.object({
  catalog: z.array(capabilityDefinitionSchema),
  starting: z.array(z.object({ polityId: polityIdSchema, capabilityId: capabilityIdSchema }).strict()),
}).strict();

const validateComposition = (value: { primaryId: string; minorities: Array<{ identityId: string; shareBp: number }> }, ctx: z.RefinementCtx) => {
  const ids = value.minorities.map((entry) => entry.identityId as string);
  if (ids.includes(value.primaryId as string) || new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', message: 'primary and minority identity ids must be unique', path: ['minorities'] });
  }
  const minorityTotal = value.minorities.reduce((sum, entry) => sum + entry.shareBp, 0);
  const primaryShare = 10000 - minorityTotal;
  if (primaryShare <= 0 || value.minorities.some((entry) => entry.shareBp > primaryShare)) {
    ctx.addIssue({ code: 'custom', message: 'primary identity must have the largest positive share', path: ['minorities'] });
  }
};

export const cultureCompositionSchema = z.object({
  primaryId: cultureIdSchema,
  minorities: z.array(z.object({ identityId: cultureIdSchema, shareBp: z.number().int().min(1).max(9999) }).strict()).max(12),
}).strict().superRefine(validateComposition);
export const religionCompositionSchema = z.object({
  primaryId: religionIdSchema,
  minorities: z.array(z.object({ identityId: religionIdSchema, shareBp: z.number().int().min(1).max(9999) }).strict()).max(12),
}).strict().superRefine(validateComposition);
export const regionIdentitySchema = z.object({
  regionId: regionIdSchema,
  culture: cultureCompositionSchema,
  religion: religionCompositionSchema,
}).strict();
export const polityIdentitySchema = z.object({
  polityId: polityIdSchema,
  officialCultureId: cultureIdSchema,
  acceptedCultureIds: z.array(cultureIdSchema).max(12),
  culturePolicy: identityPolicySchema,
  officialReligionId: religionIdSchema,
  acceptedReligionIds: z.array(religionIdSchema).max(12),
  religionPolicy: identityPolicySchema,
}).strict();
export const identityStateSchema = z.object({
  cultures: z.array(z.object({ cultureId: cultureIdSchema, displayName }).strict()),
  religions: z.array(z.object({ religionId: religionIdSchema, displayName }).strict()),
  regions: z.array(regionIdentitySchema),
  polities: z.array(polityIdentitySchema),
}).strict();
export type IdentityState = z.infer<typeof identityStateSchema>;
export const authoredIdentitySchema = identityStateSchema;

export const compositionShares = (value: z.infer<typeof cultureCompositionSchema> | z.infer<typeof religionCompositionSchema>): Map<string, number> => {
  const minorityTotal = value.minorities.reduce((sum, entry) => sum + entry.shareBp, 0);
  return new Map([[value.primaryId, 10000 - minorityTotal], ...value.minorities.map((entry) => [entry.identityId, entry.shareBp] as const)]);
};

export const capabilityBonusBp = (state: CapabilityState | undefined, polityId: string, kind: 'extraction-output' | 'processing-output' | 'land-supply'): number => {
  if (!state) return 0;
  const unlocked = new Set(state.unlocked.filter((entry) => entry.polityId === polityId).map((entry) => entry.capabilityId));
  return state.catalog.filter((entry) => unlocked.has(entry.capabilityId) && entry.modifier.kind === kind)
    .reduce((sum, entry) => sum + (entry.modifier.kind === kind ? entry.modifier.bonusBp : 0), 0);
};

export const capabilityCapacityBonus = (state: CapabilityState | undefined, polityId: string, capacity: 'administration' | 'science' | 'industry'): number => {
  if (!state) return 0;
  const unlocked = new Set(state.unlocked.filter((entry) => entry.polityId === polityId).map((entry) => entry.capabilityId));
  return state.catalog.filter((entry) => unlocked.has(entry.capabilityId) && entry.modifier.kind === 'project-capacity'
    && entry.modifier.capacity === capacity).reduce((sum, entry) => sum + (entry.modifier.kind === 'project-capacity' ? entry.modifier.amount : 0), 0);
};

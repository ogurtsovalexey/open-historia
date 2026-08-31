import { z } from 'zod';
import { gameDateSchema, polityIdSchema } from '@open-historia/domain';
import { budgetCategorySchema } from './statecraft.js';

const bp = z.number().int().min(0).max(10000);
const displayName = z.object({ en: z.string().min(1).max(120), ru: z.string().min(1).max(120) }).strict();

export const factionIdSchema = z.string().regex(/^faction:[a-z0-9][a-z0-9._-]{0,99}$/);
export const characterIdSchema = z.string().regex(/^character:[a-z0-9][a-z0-9._-]{0,99}$/);
export const politicalOfficeSchema = z.enum(['ruler', 'heir', 'head-of-government', 'finance', 'foreign', 'military']);
export const characterTraitSchema = z.enum([
  'administrator', 'diplomat', 'industrialist', 'reformer', 'traditionalist',
  'populist', 'commander', 'loyalist', 'ambitious',
]);
export const escalationStageSchema = z.enum(['calm', 'demands', 'protest', 'strike', 'coup', 'rebellion']);
export const foreignPolicyPreferenceSchema = z.enum(['pacifist', 'status-quo', 'hawk']);

export const significantRelationSchema = z.object({
  characterId: characterIdSchema,
  sentiment: z.enum(['ally', 'rival', 'family']),
}).strict();

export const politicalCharacterSchema = z.object({
  characterId: characterIdSchema,
  polityId: polityIdSchema,
  displayName,
  origin: z.enum(['authored', 'historical-runtime', 'fictional-runtime']),
  factionId: factionIdSchema,
  office: politicalOfficeSchema.nullable(),
  startingTraits: z.array(characterTraitSchema).max(3),
  experienceTraits: z.array(characterTraitSchema).max(3),
  loyaltyBp: bp,
  ambitionBp: bp,
  relations: z.array(significantRelationSchema).max(6),
}).strict();
export type PoliticalCharacter = z.infer<typeof politicalCharacterSchema>;

export const politicalFactionSchema = z.object({
  factionId: factionIdSchema,
  polityId: polityIdSchema,
  displayName,
  leaderCharacterId: characterIdSchema,
  powerBp: bp,
  supportBp: bp,
  idealTaxBurdenBp: z.number().int().min(5000).max(15000),
  preferredBudgetCategory: budgetCategorySchema,
  foreignPolicy: foreignPolicyPreferenceSchema,
  ideology: z.enum(['traditionalist', 'liberal', 'socialist', 'nationalist']),
  traditionalismBp: bp,
  escalation: escalationStageSchema,
  lastResponseMonth: gameDateSchema.nullable(),
}).strict();
export type PoliticalFaction = z.infer<typeof politicalFactionSchema>;

export const politicalPolitySchema = z.object({
  polityId: polityIdSchema,
  legitimacyBp: bp,
  stabilityBp: bp,
  unrestBp: bp,
  successionLaw: z.enum(['hereditary', 'appointment']),
  rulerCharacterId: characterIdSchema,
  heirCharacterId: characterIdSchema.nullable(),
  governmentChanges: z.number().int().nonnegative(),
  lastTransferMonth: gameDateSchema.nullable(),
}).strict();

export const politicsStateSchema = z.object({
  polities: z.array(politicalPolitySchema),
  factions: z.array(politicalFactionSchema),
  characters: z.array(politicalCharacterSchema),
}).strict();
export type PoliticsState = z.infer<typeof politicsStateSchema>;

export const authoredPoliticalPolitySchema = politicalPolitySchema.omit({
  governmentChanges: true, lastTransferMonth: true,
});
export const authoredPoliticalFactionSchema = politicalFactionSchema.omit({ lastResponseMonth: true });
export const authoredPoliticalCharacterSchema = politicalCharacterSchema.extend({
  origin: z.literal('authored'),
}).strict();

export const authoredPoliticsSchema = z.object({
  polities: z.array(authoredPoliticalPolitySchema),
  factions: z.array(authoredPoliticalFactionSchema),
  characters: z.array(authoredPoliticalCharacterSchema),
}).strict();
export type AuthoredPolitics = z.infer<typeof authoredPoliticsSchema>;

export const qualitativeBandSchema = z.enum(['low', 'medium', 'high']);
export const bandToBp = (band: z.infer<typeof qualitativeBandSchema>): number =>
  band === 'low' ? 3000 : band === 'medium' ? 5500 : 8000;

export const ESCALATION_STAGES = escalationStageSchema.options;

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

export const politicalIdentitySchema = z.object({
  nativeLabel: z.string().min(1).max(120),
  legitimacyBases: z.array(z.string().min(1).max(160)).min(1).max(6),
  governingPrinciples: z.array(z.string().min(1).max(160)).min(1).max(8),
  strategicPreferences: z.array(z.string().min(1).max(160)).min(1).max(8),
  taboos: z.array(z.string().min(1).max(160)).max(8),
  riskAttitude: z.enum(['averse', 'cautious', 'balanced', 'assertive', 'risk-seeking']),
}).strict();
export type PoliticalIdentity = z.infer<typeof politicalIdentitySchema>;

export const leaderFactCardSchema = z.object({
  historical: z.boolean(),
  factCard: z.array(z.string().min(1).max(180)).min(1).max(8),
  knowledgePolicy: z.enum(['authored-card-plus-pre-scenario-prior', 'scenario-only']),
  sourceRefs: z.array(z.string().min(1)).min(1).max(8),
}).strict().superRefine((card, ctx) => {
  if (!card.historical && card.knowledgePolicy !== 'scenario-only') {
    ctx.addIssue({ code: 'custom', message: 'non-historical leaders require scenario-only knowledge' });
  }
});

export const politicalStrategyAuthoritySchema = z.object({
  headOfStateCharacterId: characterIdSchema,
  headOfGovernmentCharacterId: characterIdSchema,
  decisionAuthorityCharacterId: characterIdSchema,
  rulingFactionId: factionIdSchema,
  currentConstraints: z.array(z.string().min(1).max(180)).min(2).max(3),
}).strict();

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
  leaderCard: leaderFactCardSchema.optional(),
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
  politicalIdentity: politicalIdentitySchema.optional(),
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
  strategyAuthority: politicalStrategyAuthoritySchema.optional(),
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

export interface CurrentPoliticalStrategy {
  polityId: string;
  identity: PoliticalIdentity;
  headOfState: PoliticalCharacter;
  headOfGovernment: PoliticalCharacter;
  decisionAuthority: PoliticalCharacter;
  rulingFaction: PoliticalFaction;
  currentConstraints: string[];
}

/** Returns only authored strategic politics; absence is an explicit build failure. */
export function currentPoliticalStrategy(politics: PoliticsState, polityId: string): CurrentPoliticalStrategy {
  const polity = politics.polities.find((entry) => entry.polityId === polityId);
  if (!polity?.strategyAuthority) throw new Error(`political strategy authority missing for ${polityId}`);
  const character = (characterId: string, role: string) => {
    const result = politics.characters.find((entry) => entry.characterId === characterId && entry.polityId === polityId);
    if (!result?.leaderCard) throw new Error(`${role} leader card missing for ${polityId}`);
    return result;
  };
  const rulingFaction = politics.factions.find((entry) => entry.factionId === polity.strategyAuthority!.rulingFactionId
    && entry.polityId === polityId);
  if (!rulingFaction?.politicalIdentity) throw new Error(`ruling faction political identity missing for ${polityId}`);
  return {
    polityId,
    identity: structuredClone(rulingFaction.politicalIdentity),
    headOfState: structuredClone(character(polity.strategyAuthority.headOfStateCharacterId, 'head-of-state')),
    headOfGovernment: structuredClone(character(polity.strategyAuthority.headOfGovernmentCharacterId, 'head-of-government')),
    decisionAuthority: structuredClone(character(polity.strategyAuthority.decisionAuthorityCharacterId, 'decision-authority')),
    rulingFaction: structuredClone(rulingFaction),
    currentConstraints: [...polity.strategyAuthority.currentConstraints],
  };
}

export const qualitativeBandSchema = z.enum(['low', 'medium', 'high']);
export const bandToBp = (band: z.infer<typeof qualitativeBandSchema>): number =>
  band === 'low' ? 3000 : band === 'medium' ? 5500 : 8000;

export const ESCALATION_STAGES = escalationStageSchema.options;

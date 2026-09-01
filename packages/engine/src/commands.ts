/**
 * Typed player commands — the ONLY input surface for player intent.
 * A future free-text interpreter (LLM) must emit JSON valid against
 * `econCommandSchema`; the engine itself never sees prose and never lets a
 * model set numeric outcomes. Schema-level checks are structural only;
 * semantic acceptance (ownership, treasury, revision) happens in the resolver
 * so every refusal is a typed rejection event, not a parse error.
 */
import { z } from 'zod';
import {
  commandIdSchema,
  gameDateSchema,
  polityIdSchema,
  regionIdSchema,
  worldRevisionIdSchema,
} from '@open-historia/domain';
import { agreementIdSchema, negotiationTermsSchema, proposalIdSchema } from './diplomacy.js';
import { budgetPrioritiesSchema, intelligenceFactIdSchema, projectIdSchema, projectTemplateIdSchema } from './statecraft.js';
import { characterIdSchema, characterTraitSchema, factionIdSchema, qualitativeBandSchema } from './politics.js';
import {
  commanderIdSchema, formationIdSchema, militaryPostureSchema, peaceOfferIdSchema,
  peaceRegionTransferSchema, reparationSchema, warIdSchema, warReasonSchema,
} from './military.js';
import { cultureIdSchema, identityPolicySchema, religionIdSchema } from './society.js';

export const investInRegionCommandSchema = z
  .object({
    kind: z.literal('economy.invest-region'),
    commandId: commandIdSchema,
    actorPolityId: polityIdSchema,
    targetRegionId: regionIdSchema,
    /**
     * Optional in offline fixture files (a static file cannot know a content
     * hash in advance); the pipeline fills in the current revision. Any
     * interactive or LLM-produced command MUST carry it explicitly.
     */
    expectedRevision: worldRevisionIdSchema.optional(),
    effectiveMonth: gameDateSchema,
    /** Whole gold. Positivity is a semantic check → typed rejection. */
    spend: z.number().int(),
  })
  .strict();
export type InvestInRegionCommand = z.infer<typeof investInRegionCommandSchema>;

/**
 * Region control transfer (first-economy-mvp.md §7). In the finished game this
 * is the outcome of war or diplomacy; in the slice it is a directly issued
 * command so the re-aggregation contract can be tested on its own.
 */
export const transferRegionCommandSchema = z
  .object({
    kind: z.literal('territory.transfer-region'),
    commandId: commandIdSchema,
    /** Must currently control the region. */
    actorPolityId: polityIdSchema,
    targetRegionId: regionIdSchema,
    newControllerId: polityIdSchema,
    expectedRevision: worldRevisionIdSchema.optional(),
    effectiveMonth: gameDateSchema,
  })
  .strict();
export type TransferRegionCommand = z.infer<typeof transferRegionCommandSchema>;

const diplomaticCommandFields = {
  commandId: commandIdSchema,
  actorPolityId: polityIdSchema,
  expectedRevision: worldRevisionIdSchema.optional(),
  effectiveMonth: gameDateSchema,
};

export const proposeNegotiationCommandSchema = z.object({
  kind: z.literal('diplomacy.propose'),
  ...diplomaticCommandFields,
  proposalId: proposalIdSchema,
  recipientPolityId: polityIdSchema,
  terms: negotiationTermsSchema,
}).strict();

export const counterNegotiationCommandSchema = z.object({
  kind: z.literal('diplomacy.counter'),
  ...diplomaticCommandFields,
  proposalId: proposalIdSchema,
  counterProposalId: proposalIdSchema,
  terms: negotiationTermsSchema,
}).strict();

export const respondNegotiationCommandSchema = z.object({
  kind: z.literal('diplomacy.respond'),
  ...diplomaticCommandFields,
  proposalId: proposalIdSchema,
  response: z.enum(['accept', 'reject']),
}).strict();

export const terminateAgreementCommandSchema = z.object({
  kind: z.literal('diplomacy.terminate-agreement'),
  ...diplomaticCommandFields,
  agreementId: agreementIdSchema,
}).strict();

export type DiplomacyCommand = z.infer<typeof proposeNegotiationCommandSchema>
  | z.infer<typeof counterNegotiationCommandSchema>
  | z.infer<typeof respondNegotiationCommandSchema>
  | z.infer<typeof terminateAgreementCommandSchema>;

export const diplomacyCommandSchema = z.discriminatedUnion('kind', [
  proposeNegotiationCommandSchema,
  counterNegotiationCommandSchema,
  respondNegotiationCommandSchema,
  terminateAgreementCommandSchema,
]);

const statecraftCommandFields = {
  commandId: commandIdSchema,
  actorPolityId: polityIdSchema,
  expectedRevision: worldRevisionIdSchema.optional(),
  effectiveMonth: gameDateSchema,
};

export const setFinancePolicyCommandSchema = z.object({
  kind: z.literal('finance.set-policy'), ...statecraftCommandFields,
  taxBurdenBp: z.number().int().min(5000).max(15000),
  exemptionBp: z.number().int().min(0).max(5000),
  priorities: budgetPrioritiesSchema,
}).strict();

export const issueBondsCommandSchema = z.object({
  kind: z.literal('finance.issue-bonds'), ...statecraftCommandFields,
  amount: z.number().int().positive(),
}).strict();

export const restructureDebtCommandSchema = z.object({
  kind: z.literal('finance.restructure'), ...statecraftCommandFields,
}).strict();

export const startProjectCommandSchema = z.object({
  kind: z.literal('project.start'), ...statecraftCommandFields,
  projectId: projectIdSchema,
  templateId: projectTemplateIdSchema,
  targetPolityId: polityIdSchema.optional(),
  targetRegionId: regionIdSchema.optional(),
  targetFactId: intelligenceFactIdSchema.optional(),
  monthlyFunding: z.number().int().positive(),
  priority: z.number().int().min(1).max(5),
}).strict();

export const updateProjectCommandSchema = z.object({
  kind: z.literal('project.update'), ...statecraftCommandFields,
  projectId: projectIdSchema,
  monthlyFunding: z.number().int().positive(),
  priority: z.number().int().min(1).max(5),
}).strict();

export const cancelProjectCommandSchema = z.object({
  kind: z.literal('project.cancel'), ...statecraftCommandFields,
  projectId: projectIdSchema,
}).strict();

export type StatecraftCommand = z.infer<typeof setFinancePolicyCommandSchema>
  | z.infer<typeof issueBondsCommandSchema>
  | z.infer<typeof restructureDebtCommandSchema>
  | z.infer<typeof startProjectCommandSchema>
  | z.infer<typeof updateProjectCommandSchema>
  | z.infer<typeof cancelProjectCommandSchema>;

export const statecraftCommandSchema = z.discriminatedUnion('kind', [
  setFinancePolicyCommandSchema, issueBondsCommandSchema, restructureDebtCommandSchema,
  startProjectCommandSchema, updateProjectCommandSchema, cancelProjectCommandSchema,
]);

export const respondToFactionCommandSchema = z.object({
  kind: z.literal('politics.respond'), ...statecraftCommandFields,
  factionId: factionIdSchema,
  response: z.enum(['concede', 'repress', 'refuse']),
}).strict();

export const appointCharacterCommandSchema = z.object({
  kind: z.literal('politics.appoint'), ...statecraftCommandFields,
  characterId: characterIdSchema,
  office: z.enum(['head-of-government', 'finance', 'foreign', 'military']),
}).strict();

export const abdicateCommandSchema = z.object({
  kind: z.literal('politics.abdicate'), ...statecraftCommandFields,
}).strict();

export const createCharacterCommandSchema = z.object({
  kind: z.literal('character.create'), ...statecraftCommandFields,
  characterId: characterIdSchema,
  displayName: z.object({ en: z.string().min(1).max(120), ru: z.string().min(1).max(120) }).strict(),
  origin: z.enum(['historical-runtime', 'fictional-runtime']),
  factionId: factionIdSchema,
  aptitudeTrait: characterTraitSchema,
  loyaltyBand: qualitativeBandSchema,
  ambitionBand: qualitativeBandSchema,
}).strict();

export type PoliticsCommand = z.infer<typeof respondToFactionCommandSchema>
  | z.infer<typeof appointCharacterCommandSchema>
  | z.infer<typeof abdicateCommandSchema>
  | z.infer<typeof createCharacterCommandSchema>;

export const politicsCommandSchema = z.discriminatedUnion('kind', [
  respondToFactionCommandSchema, appointCharacterCommandSchema,
  abdicateCommandSchema, createCharacterCommandSchema,
]);

export const setIdentityPolicyCommandSchema = z.object({
  kind: z.literal('identity.set-policy'), ...statecraftCommandFields,
  domain: z.enum(['culture', 'religion']), policy: identityPolicySchema,
}).strict();
export const setCultureAcceptanceCommandSchema = z.object({ kind: z.literal('identity.set-culture-acceptance'), ...statecraftCommandFields,
  domain: z.literal('culture'), identityId: cultureIdSchema, accepted: z.boolean() }).strict();
export const setReligionAcceptanceCommandSchema = z.object({ kind: z.literal('identity.set-religion-acceptance'), ...statecraftCommandFields,
  domain: z.literal('religion'), identityId: religionIdSchema, accepted: z.boolean() }).strict();
export type IdentityCommand = z.infer<typeof setIdentityPolicyCommandSchema>
  | z.infer<typeof setCultureAcceptanceCommandSchema> | z.infer<typeof setReligionAcceptanceCommandSchema>;
export const identityCommandSchema = z.discriminatedUnion('kind', [setIdentityPolicyCommandSchema, setCultureAcceptanceCommandSchema, setReligionAcceptanceCommandSchema]);

export const declareWarCommandSchema = z.object({
  kind: z.literal('war.declare'), ...statecraftCommandFields,
  warId: warIdSchema, defenderPolityId: polityIdSchema, reason: warReasonSchema,
}).strict();
export const mobilizeCommandSchema = z.object({
  kind: z.literal('military.mobilize'), ...statecraftCommandFields,
  formationId: formationIdSchema, locationRegionId: regionIdSchema,
  manpower: z.number().int().positive(), equipment: z.number().int().positive(),
  commanderId: commanderIdSchema.nullable(),
}).strict();
export const demobilizeCommandSchema = z.object({
  kind: z.literal('military.demobilize'), ...statecraftCommandFields, formationId: formationIdSchema,
}).strict();
export const splitFormationCommandSchema = z.object({
  kind: z.literal('military.split'), ...statecraftCommandFields,
  sourceFormationId: formationIdSchema, newFormationId: formationIdSchema,
  manpower: z.number().int().positive(), equipment: z.number().int().positive(),
}).strict();
export const mergeFormationCommandSchema = z.object({
  kind: z.literal('military.merge'), ...statecraftCommandFields,
  primaryFormationId: formationIdSchema, secondaryFormationId: formationIdSchema,
}).strict();
export const issueMilitaryOrderCommandSchema = z.object({
  kind: z.literal('military.order'), ...statecraftCommandFields,
  formationId: formationIdSchema, posture: militaryPostureSchema, targetRegionId: regionIdSchema.nullable(),
}).strict();
export const proposePeaceCommandSchema = z.object({
  kind: z.literal('peace.propose'), ...statecraftCommandFields,
  offerId: peaceOfferIdSchema, warId: warIdSchema, recipientPolityId: polityIdSchema,
  regionTransfers: z.array(peaceRegionTransferSchema).max(12), reparation: reparationSchema.nullable(),
}).strict();
export const respondPeaceCommandSchema = z.object({
  kind: z.literal('peace.respond'), ...statecraftCommandFields,
  offerId: peaceOfferIdSchema, response: z.enum(['accept', 'reject']),
}).strict();

export type MilitaryCommand = z.infer<typeof declareWarCommandSchema>
  | z.infer<typeof mobilizeCommandSchema> | z.infer<typeof demobilizeCommandSchema>
  | z.infer<typeof splitFormationCommandSchema> | z.infer<typeof mergeFormationCommandSchema>
  | z.infer<typeof issueMilitaryOrderCommandSchema> | z.infer<typeof proposePeaceCommandSchema>
  | z.infer<typeof respondPeaceCommandSchema>;
export const militaryCommandSchema = z.discriminatedUnion('kind', [
  declareWarCommandSchema, mobilizeCommandSchema, demobilizeCommandSchema,
  splitFormationCommandSchema, mergeFormationCommandSchema, issueMilitaryOrderCommandSchema,
  proposePeaceCommandSchema, respondPeaceCommandSchema,
]);

export const econCommandSchema = z.discriminatedUnion('kind', [
  investInRegionCommandSchema,
  transferRegionCommandSchema,
  proposeNegotiationCommandSchema,
  counterNegotiationCommandSchema,
  respondNegotiationCommandSchema,
  terminateAgreementCommandSchema,
  setFinancePolicyCommandSchema,
  issueBondsCommandSchema,
  restructureDebtCommandSchema,
  startProjectCommandSchema,
  updateProjectCommandSchema,
  cancelProjectCommandSchema,
  respondToFactionCommandSchema,
  appointCharacterCommandSchema,
  abdicateCommandSchema,
  createCharacterCommandSchema,
  declareWarCommandSchema,
  mobilizeCommandSchema,
  demobilizeCommandSchema,
  splitFormationCommandSchema,
  mergeFormationCommandSchema,
  issueMilitaryOrderCommandSchema,
  proposePeaceCommandSchema,
  respondPeaceCommandSchema,
  setIdentityPolicyCommandSchema,
  setCultureAcceptanceCommandSchema,
  setReligionAcceptanceCommandSchema,
]);
export type EconCommand = z.infer<typeof econCommandSchema>;

export const turnCommandsFileSchema = z
  .object({
    commands: z.array(econCommandSchema),
  })
  .strict();
export type TurnCommandsFile = z.infer<typeof turnCommandsFileSchema>;

export const REJECTION_REASONS = [
  'unknown-actor',
  'unknown-region',
  'foreign-target',
  'wrong-month',
  'stale-revision',
  'invalid-amount',
  'insufficient-treasury',
  'command-limit',
  'unknown-new-controller',
  'same-controller',
  'processing-competition',
  // A selector that matched no region is a rejection, never a silent no-op:
  // "invest in my oil regions" when you hold none must say so.
  'selector-matched-nothing',
  'module-disabled',
  'unknown-polity',
  'unknown-proposal',
  'unknown-agreement',
  'unauthorized',
  'duplicate-id',
  'invalid-terms',
  'duplicate-agreement',
  'route-unavailable',
  'unknown-project',
  'unknown-template',
  'unknown-fact',
  'invalid-target',
  'credit-limit',
  'unknown-faction',
  'unknown-character',
  'inactive-crisis',
  'no-successor',
  'office-conflict',
  'unknown-war',
  'unknown-formation',
  'unknown-commander',
  'unknown-peace-offer',
  'not-at-war',
  'disconnected-front',
  'illegal-peace-term',
  'unknown-identity',
  'unknown-capability',
  'missing-prerequisite',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface CommandRejection {
  command: EconCommand;
  reason: RejectionReason;
  detail: string;
}

export function parseTurnCommands(raw: unknown): TurnCommandsFile {
  return turnCommandsFileSchema.parse(raw);
}

export const EMPTY_TURN_COMMANDS: TurnCommandsFile = { commands: [] };

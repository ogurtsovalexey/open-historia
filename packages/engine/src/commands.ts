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

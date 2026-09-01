import { z } from 'zod';
import { gameDateSchema, polityIdSchema, regionIdSchema } from '@open-historia/domain';
import { capabilityIdSchema } from './society.js';

const bp = z.number().int().min(0).max(10000);
const displayName = z.object({ en: z.string().min(1).max(160), ru: z.string().min(1).max(160) }).strict();

export const campaignGoalIdSchema = z.string().regex(/^goal:[a-z0-9][a-z0-9._-]{0,99}$/);
export const crisisTemplateIdSchema = z.string().regex(/^crisis-template:[a-z0-9][a-z0-9._-]{0,99}$/);
export const crisisIdSchema = z.string().regex(/^crisis:[a-z0-9][a-z0-9._-]{0,119}$/);
export const legacyAssessmentIdSchema = z.string().regex(/^legacy:[a-z0-9][a-z0-9._-]{0,99}$/);
export const crisisPositionSchema = z.enum(['compromise', 'status-quo', 'press', 'escalate']);
export type CrisisPosition = z.infer<typeof crisisPositionSchema>;

const goalBase = { goalId: campaignGoalIdSchema, polityId: polityIdSchema, displayName, initiallyActive: z.boolean() };
export const authoredCampaignGoalSchema = z.discriminatedUnion('kind', [
  z.object({ ...goalBase, kind: z.literal('secure-alliance'), targetPolityId: polityIdSchema }).strict(),
  z.object({ ...goalBase, kind: z.literal('unlock-capability'), capabilityId: capabilityIdSchema }).strict(),
  z.object({ ...goalBase, kind: z.literal('control-region'), regionId: regionIdSchema }).strict(),
  z.object({ ...goalBase, kind: z.literal('stabilize-government'), thresholdBp: bp }).strict(),
]);
export type AuthoredCampaignGoal = z.infer<typeof authoredCampaignGoalSchema>;

const crisisBase = {
  templateId: crisisTemplateIdSchema,
  displayName,
  participants: z.array(polityIdSchema).min(1).max(6),
};
export const authoredCrisisTemplateSchema = z.discriminatedUnion('kind', [
  z.object({ ...crisisBase, kind: z.literal('identity-pressure'), subjectPolityId: polityIdSchema, thresholdBp: bp }).strict(),
  z.object({ ...crisisBase, kind: z.literal('debt-distress'), subjectPolityId: polityIdSchema, threshold: z.number().int().positive() }).strict(),
  z.object({ ...crisisBase, kind: z.literal('war-escalation'), subjectPolityId: polityIdSchema }).strict(),
  z.object({ ...crisisBase, kind: z.literal('political-escalation'), subjectPolityId: polityIdSchema, thresholdStage: z.enum(['protest', 'strike', 'coup', 'rebellion']) }).strict(),
]);
export type AuthoredCrisisTemplate = z.infer<typeof authoredCrisisTemplateSchema>;

export const legacyDimensionsSchema = z.object({
  prosperity: bp, security: bp, stability: bp, diplomacy: bp, capability: bp, pluralism: bp,
}).strict();
export type LegacyDimensions = z.infer<typeof legacyDimensionsSchema>;

export const authoredLegacyBaselineSchema = z.object({
  polityId: polityIdSchema,
  treasuryReference: z.number().int().positive(),
  scores: legacyDimensionsSchema,
}).strict();

export const authoredCampaignSchema = z.object({
  softHorizonMonth: gameDateSchema,
  goals: z.array(authoredCampaignGoalSchema),
  crisisTemplates: z.array(authoredCrisisTemplateSchema),
  legacyBaselines: z.array(authoredLegacyBaselineSchema),
}).strict();
export type AuthoredCampaign = z.infer<typeof authoredCampaignSchema>;

const goalRuntime = {
  status: z.enum(['candidate', 'active', 'achieved']), progressBp: bp,
  adoptedMonth: gameDateSchema.nullable(), achievedMonth: gameDateSchema.nullable(),
};
export const campaignGoalStateSchema = z.discriminatedUnion('kind', [
  z.object({ ...goalBase, kind: z.literal('secure-alliance'), targetPolityId: polityIdSchema, ...goalRuntime }).strict(),
  z.object({ ...goalBase, kind: z.literal('unlock-capability'), capabilityId: capabilityIdSchema, ...goalRuntime }).strict(),
  z.object({ ...goalBase, kind: z.literal('control-region'), regionId: regionIdSchema, ...goalRuntime }).strict(),
  z.object({ ...goalBase, kind: z.literal('stabilize-government'), thresholdBp: bp, ...goalRuntime }).strict(),
]);

export const campaignCrisisSchema = z.object({
  crisisId: crisisIdSchema,
  templateId: crisisTemplateIdSchema,
  displayName,
  kind: z.enum(['identity-pressure', 'debt-distress', 'war-escalation', 'political-escalation']),
  subjectPolityId: polityIdSchema,
  participants: z.array(polityIdSchema).min(1).max(6),
  status: z.enum(['active', 'escalated', 'resolved']),
  openedMonth: gameDateSchema,
  resolvedMonth: gameDateSchema.nullable(),
  evidenceValue: z.number().int().nonnegative(),
  evidenceThreshold: z.number().int().nonnegative(),
  positions: z.array(z.object({ polityId: polityIdSchema, position: crisisPositionSchema, updatedMonth: gameDateSchema }).strict()),
}).strict();

export const legacyAssessmentSchema = z.object({
  assessmentId: legacyAssessmentIdSchema,
  polityId: polityIdSchema,
  month: gameDateSchema,
  horizonReached: z.boolean(),
  scores: legacyDimensionsSchema,
  baseline: legacyDimensionsSchema,
  deltas: z.object({
    prosperity: z.number().int(), security: z.number().int(), stability: z.number().int(),
    diplomacy: z.number().int(), capability: z.number().int(), pluralism: z.number().int(),
  }).strict(),
}).strict();

export const campaignStateSchema = z.object({
  softHorizonMonth: gameDateSchema,
  goals: z.array(campaignGoalStateSchema),
  crisisTemplates: z.array(authoredCrisisTemplateSchema),
  crises: z.array(campaignCrisisSchema),
  legacyBaselines: z.array(authoredLegacyBaselineSchema),
  startingRegionCounts: z.array(z.object({ polityId: polityIdSchema, count: z.number().int().positive() }).strict()),
  assessments: z.array(legacyAssessmentSchema),
}).strict();
export type CampaignState = z.infer<typeof campaignStateSchema>;

export const POSITION_PRESSURE: Record<CrisisPosition, number> = {
  compromise: 0, 'status-quo': 1000, press: 2000, escalate: 3000,
};

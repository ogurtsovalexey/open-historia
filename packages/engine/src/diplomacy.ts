import { z } from 'zod';
import { gameDateSchema, polityIdSchema, regionIdSchema } from '@open-historia/domain';
import { resourceIdSchema } from './scenario.js';

const nonNegInt = z.number().int().nonnegative();
const bpSchema = z.number().int().min(0).max(10000);
export const proposalIdSchema = z.string().regex(/^proposal:[a-z0-9][a-z0-9._-]{0,99}$/);
export const agreementIdSchema = z.string().regex(/^agreement:[a-z0-9][a-z0-9._-]{0,99}$/);

export const relationStateSchema = z.object({
  polities: z.tuple([polityIdSchema, polityIdSchema]),
  opinion: z.number().int().min(-10000).max(10000),
  trust: bpSchema,
  threat: bpSchema,
  updatedMonth: gameDateSchema,
}).strict();

export const diplomaticAgreementTermsSchema = z.object({
  kind: z.literal('agreement'),
  agreementType: z.enum(['non-aggression', 'defensive-alliance', 'guarantee', 'military-access']),
  fromPolityId: polityIdSchema,
  toPolityId: polityIdSchema,
}).strict().refine((terms) => terms.fromPolityId !== terms.toPolityId, { message: 'agreement parties must differ' });

export const tradeLegSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resource'), resource: resourceIdSchema, amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('treasury'), amount: z.number().int().positive() }).strict(),
]);

export const tradeAgreementTermsSchema = z.object({
  kind: z.literal('trade'),
  fromPolityId: polityIdSchema,
  toPolityId: polityIdSchema,
  fromLeg: tradeLegSchema,
  toLeg: tradeLegSchema,
  cadence: z.enum(['one-off', 'monthly']),
  durationMonths: z.number().int().min(1).max(120),
  earlyTerminationPenalty: nonNegInt,
}).strict().superRefine((terms, ctx) => {
  if (terms.fromPolityId === terms.toPolityId) ctx.addIssue({ code: 'custom', message: 'trade parties must differ' });
  if (terms.fromLeg.kind === 'treasury' && terms.toLeg.kind === 'treasury') ctx.addIssue({ code: 'custom', message: 'treasury-for-treasury is not trade' });
  if (terms.cadence === 'one-off' && terms.durationMonths !== 1) ctx.addIssue({ code: 'custom', message: 'one-off trade duration must be one month' });
  if (terms.cadence === 'monthly' && terms.durationMonths < 2) ctx.addIssue({ code: 'custom', message: 'monthly trade duration must be at least two months' });
});

export const territorialSettlementTermsSchema = z.object({
  kind: z.literal('territorial-settlement'),
  fromPolityId: polityIdSchema,
  toPolityId: polityIdSchema,
  regionIds: z.array(regionIdSchema).min(1).max(12),
}).strict().superRefine((terms, ctx) => {
  if (terms.fromPolityId === terms.toPolityId) ctx.addIssue({ code: 'custom', message: 'settlement parties must differ' });
  if (new Set(terms.regionIds).size !== terms.regionIds.length) ctx.addIssue({ code: 'custom', message: 'settlement regions must be unique' });
});

export const negotiationTermsSchema = z.union([diplomaticAgreementTermsSchema, tradeAgreementTermsSchema, territorialSettlementTermsSchema]);
export type NegotiationTerms = z.infer<typeof negotiationTermsSchema>;

export const negotiationProposalSchema = z.object({
  proposalId: proposalIdSchema,
  proposerId: polityIdSchema,
  recipientId: polityIdSchema,
  terms: negotiationTermsSchema,
  createdMonth: gameDateSchema,
  parentProposalId: proposalIdSchema.optional(),
}).strict();
export type NegotiationProposal = z.infer<typeof negotiationProposalSchema>;

export const agreementStateSchema = z.object({
  agreementId: agreementIdSchema,
  sourceProposalId: proposalIdSchema,
  acceptedMonth: gameDateSchema,
  terms: negotiationTermsSchema,
}).strict();

export const diplomacyStateSchema = z.object({
  relations: z.array(relationStateSchema),
  proposals: z.array(negotiationProposalSchema),
  agreements: z.array(agreementStateSchema),
}).strict();
export type DiplomacyState = z.infer<typeof diplomacyStateSchema>;

export const tradeRouteStateSchema = z.object({
  polities: z.tuple([polityIdSchema, polityIdSchema]),
  monthlyCapacity: z.number().int().positive(),
}).strict();

export const tradeContractStateSchema = z.object({
  contractId: agreementIdSchema,
  sourceProposalId: proposalIdSchema,
  terms: tradeAgreementTermsSchema,
  remainingSettlements: z.number().int().positive(),
  nextSettlementMonth: gameDateSchema,
}).strict();

export const tradeStateSchema = z.object({
  routes: z.array(tradeRouteStateSchema),
  contracts: z.array(tradeContractStateSchema),
}).strict();
export type TradeState = z.infer<typeof tradeStateSchema>;

export const relationKey = (left: string, right: string): string => left < right ? `${left}|${right}` : `${right}|${left}`;

import { z } from 'zod';

const nonEmptyTextSchema = z.string().trim().min(1);
const safeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const processBasisPointsSchema = z.number().int().min(0).max(10000);
export const processStableIdSchema = z.string().max(160).regex(
  /^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
  'Invalid stable ID format',
);
const prefixedIdSchema = (prefix: string) => z.string().max(160).regex(
  new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]{0,139}$`),
  `Invalid ${prefix} ID format`,
);

export const semanticKeySchema = z.string().min(1).max(120).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  'Semantic key must be normalized lower-kebab-case',
);
export const processStageSchema = z.enum([
  'proposed',
  'emerging',
  'organized',
  'demonstrated',
  'adopted',
  'institutionalized',
]);
export const processPaceSchema = z.enum(['stalled', 'slow', 'steady', 'fast', 'breakthrough']);
export const conceptTypeSchema = z.enum([
  'technology',
  'ideology',
  'religious-movement',
  'institution',
  'doctrine',
  'economic-practice',
  'scientific-theory',
]);
export const processStatusSchema = z.enum(['active', 'suspended', 'cancelled', 'completed']);

export const effectKinds = [
  'capacity.modify',
  'efficiency.modify',
  'resource-access.modify',
  'recipe.unlock',
  'project-capacity.modify',
  'administrative-access.modify',
  'recruitment-access.modify',
  'supply-capacity.modify',
  'group-support.shift',
  'identity-share.shift',
  'legitimacy.modify',
  'relation.modify',
  'knowledge.reveal',
  'institution.create',
] as const;
export const effectKindSchema = z.enum(effectKinds);
export type EffectKind = z.infer<typeof effectKindSchema>;

const localizedTextSchema = z.object({
  en: nonEmptyTextSchema,
  ru: nonEmptyTextSchema.optional(),
}).strict();
const evidenceIdSchema = prefixedIdSchema('evidence');
const conceptIdSchema = prefixedIdSchema('concept');
const processIdSchema = prefixedIdSchema('process');
const regionIdSchema = processStableIdSchema.refine((value) => value.startsWith('region:'), 'Invalid region ID');
const polityIdSchema = processStableIdSchema.refine((value) => value.startsWith('polity:'), 'Invalid polity ID');
const institutionIdSchema = prefixedIdSchema('institution');
const revisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const gameMonthSchema = z.string().regex(/^\d{4,}-\d{2}-\d{2}$/);

export const conceptOriginSchema = z.object({
  kind: z.enum(['scenario', 'runtime']),
  originEntityRefs: z.array(processStableIdSchema),
  originMonth: gameMonthSchema,
  discovererEntityRef: processStableIdSchema.optional(),
}).strict();

export const conceptProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('scenario'),
    sourceEvidenceId: evidenceIdSchema,
    createdRevision: revisionSchema,
    createdMonth: gameMonthSchema,
  }).strict(),
  z.object({
    kind: z.literal('semantic-proposal'),
    semanticProposalId: prefixedIdSchema('semantic-proposal'),
    sourceEvidenceId: evidenceIdSchema,
    createdRevision: revisionSchema,
    createdMonth: gameMonthSchema,
  }).strict(),
]);

export const conceptStateSchema = z.object({
  conceptId: conceptIdSchema,
  type: conceptTypeSchema,
  semanticKey: semanticKeySchema,
  displayName: localizedTextSchema,
  description: localizedTextSchema,
  origin: conceptOriginSchema,
  parentConceptIds: z.array(conceptIdSchema),
  supportingEvidenceIds: z.array(evidenceIdSchema),
  domains: z.array(processStableIdSchema),
  status: processStageSchema,
  maturityBp: processBasisPointsSchema,
  diffusion: z.array(z.object({
    regionId: regionIdSchema,
    awarenessBp: processBasisPointsSchema,
  }).strict()),
  adoption: z.array(z.discriminatedUnion('scope', [
    z.object({ scope: z.literal('polity'), polityId: polityIdSchema, adoptionBp: processBasisPointsSchema }).strict(),
    z.object({ scope: z.literal('region'), regionId: regionIdSchema, adoptionBp: processBasisPointsSchema }).strict(),
  ])),
  provenance: conceptProvenanceSchema,
  evidenceIds: z.array(evidenceIdSchema),
}).strict();
export type ConceptState = z.infer<typeof conceptStateSchema>;

export const capacityUseSchema = z.object({
  capacityId: processStableIdSchema,
  entityRef: processStableIdSchema,
  amount: safeIntegerSchema,
}).strict();

export const processPrerequisitesSchema = z.object({
  conceptIds: z.array(conceptIdSchema),
  material: z.array(z.object({ resourceId: processStableIdSchema, amount: safeIntegerSchema }).strict()),
  knowledgeEvidenceIds: z.array(evidenceIdSchema),
  institutionIds: z.array(institutionIdSchema),
  communicationEvidenceIds: z.array(evidenceIdSchema),
  oppositionEvidenceIds: z.array(evidenceIdSchema),
  minimumFunding: safeIntegerSchema,
  capacity: z.array(capacityUseSchema),
}).strict();
export type ProcessPrerequisites = z.infer<typeof processPrerequisitesSchema>;

export const worldProcessStateSchema = z.object({
  processId: processIdSchema,
  conceptId: conceptIdSchema.nullable(),
  kind: processStableIdSchema,
  objective: nonEmptyTextSchema,
  direction: processStableIdSchema,
  sponsorEntityRefs: z.array(processStableIdSchema).min(1),
  affectedEntityRefs: z.array(processStableIdSchema),
  stage: processStageSchema,
  progressBp: processBasisPointsSchema,
  momentumBp: processBasisPointsSchema,
  resistanceBp: processBasisPointsSchema,
  funding: safeIntegerSchema,
  capacityUse: z.array(capacityUseSchema),
  investments: z.array(z.object({ investorEntityRef: processStableIdSchema, amount: safeIntegerSchema }).strict()),
  currentPace: processPaceSchema,
  blockers: z.array(evidenceIdSchema),
  accelerators: z.array(evidenceIdSchema),
  prerequisites: processPrerequisitesSchema,
  compatibleEffectFamilies: z.array(effectKindSchema),
  selectedEffectFamilies: z.array(effectKindSchema),
  selectedEffects: z.array(z.object({
    kind: effectKindSchema,
    targetEntityRef: processStableIdSchema,
  }).strict()),
  startedMonth: gameMonthSchema,
  lastDecisionMonth: gameMonthSchema,
  /** Null until the first deterministic monthly resolution; prevents same-month fast-forward. */
  lastAdvancedMonth: gameMonthSchema.nullable(),
  status: processStatusSchema,
  evidenceIds: z.array(evidenceIdSchema),
}).strict();
export type WorldProcessState = z.infer<typeof worldProcessStateSchema>;

/** Model-owned semantic selection. Strict by design: there are no numeric result fields. */
export const semanticProcessProposalSchema = z.object({
  semanticProposalId: prefixedIdSchema('semantic-proposal'),
  type: conceptTypeSchema,
  displayName: localizedTextSchema,
  description: localizedTextSchema,
  originEntityRefs: z.array(processStableIdSchema),
  /** Resolver-validated semantic equivalence; reuses canonical concept identity. */
  equivalentConceptId: conceptIdSchema.optional(),
  parentConceptIds: z.array(conceptIdSchema),
  domains: z.array(processStableIdSchema).min(1),
  objective: nonEmptyTextSchema,
  direction: processStableIdSchema,
  sponsorEntityRefs: z.array(processStableIdSchema).min(1),
  affectedEntityRefs: z.array(processStableIdSchema),
  pace: processPaceSchema,
  effectFamilies: z.array(effectKindSchema),
  evidenceIds: z.array(evidenceIdSchema).min(1),
}).strict();
export type SemanticProcessProposal = z.infer<typeof semanticProcessProposalSchema>;

/** Engine-owned materialization. This object never crosses the model boundary. */
export const processEnginePlanSchema = z.object({
  prerequisites: processPrerequisitesSchema,
  compatibleEffectFamilies: z.array(effectKindSchema),
  initialFunding: safeIntegerSchema.max(1_000_000_000),
  capacityUse: z.array(capacityUseSchema),
  investments: z.array(z.object({ investorEntityRef: processStableIdSchema, amount: safeIntegerSchema }).strict()),
  initialMomentumBp: processBasisPointsSchema,
  initialResistanceBp: processBasisPointsSchema,
}).strict();
export type ProcessEnginePlan = z.infer<typeof processEnginePlanSchema>;

/** Engine-materialized resource commitment after a player/actor confirms a qualitative stance. */
export const processResourceCommitmentSchema = z.object({
  processId: processIdSchema,
  expectedRevision: revisionSchema,
  investments: z.array(z.object({
    investorEntityRef: polityIdSchema,
    amount: safeIntegerSchema.min(1),
  }).strict()).min(1),
  capacityUse: z.array(capacityUseSchema),
  evidenceIds: z.array(evidenceIdSchema).min(1),
}).strict();
export type ProcessResourceCommitment = z.infer<typeof processResourceCommitmentSchema>;

export function normalizeSemanticKey(value: string): string {
  const normalized = value.normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return semanticKeySchema.parse(normalized);
}

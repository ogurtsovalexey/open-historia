import { z } from 'zod';
import { gameDateSchema, polityIdSchema, regionIdSchema } from '@open-historia/domain';

const nonNegInt = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();
const bp = z.number().int().min(0).max(10000);

export const projectIdSchema = z.string().regex(/^project:[a-z0-9][a-z0-9._-]{0,99}$/);
export const projectTemplateIdSchema = z.string().regex(/^project-template:[a-z0-9][a-z0-9._-]{0,99}$/);
export const intelligenceFactIdSchema = z.string().regex(/^intel:[a-z0-9][a-z0-9._-]{0,99}$/);
export const evidenceIdSchema = z.string().regex(/^evidence:[a-z0-9][a-z0-9._-]{0,119}$/);

export const budgetPrioritiesSchema = z.object({
  administration: bp,
  science: bp,
  industry: bp,
  security: bp,
  military: bp,
}).strict().refine((value) => Object.values(value).reduce((sum, entry) => sum + entry, 0) === 10000, {
  message: 'budget priorities must sum to 10000 basis points',
});
export type BudgetPriorities = z.infer<typeof budgetPrioritiesSchema>;

export const DEFAULT_BUDGET_PRIORITIES: BudgetPriorities = {
  administration: 2500, science: 1500, industry: 2500, security: 1500, military: 2000,
};

export const financePolityStateSchema = z.object({
  polityId: polityIdSchema,
  taxBurdenBp: z.number().int().min(5000).max(15000),
  exemptionBp: z.number().int().min(0).max(5000),
  priorities: budgetPrioritiesSchema,
  debtPrincipal: nonNegInt,
  annualInterestBp: z.number().int().min(0).max(10000),
  creditLimit: nonNegInt,
  interestRemainder: nonNegInt,
  defaultCount: nonNegInt,
  lastDefaultMonth: gameDateSchema.nullable(),
}).strict();

export const financeStateSchema = z.object({
  polities: z.array(financePolityStateSchema),
}).strict();
export type FinanceState = z.infer<typeof financeStateSchema>;

export const capacityKindSchema = z.enum(['administration', 'science', 'industry']);
export const projectKindSchema = z.enum(['construction', 'reform', 'research', 'mobilization', 'intelligence', 'deception']);
export const budgetCategorySchema = z.enum(['administration', 'science', 'industry', 'security', 'military']);

export const projectEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('infrastructure'), gainBp: z.number().int().min(1).max(5000) }).strict(),
  z.object({ kind: z.literal('capacity'), capacity: capacityKindSchema, amount: positiveInt }).strict(),
  z.object({ kind: z.literal('credit-limit'), amount: positiveInt }).strict(),
  z.object({ kind: z.literal('reveal-intelligence') }).strict(),
]);

export const projectTemplateSchema = z.object({
  templateId: projectTemplateIdSchema,
  displayName: z.object({ en: z.string().min(1).max(120), ru: z.string().min(1).max(120) }).strict(),
  kind: projectKindSchema,
  budgetCategory: budgetCategorySchema,
  totalCost: positiveInt,
  durationMonths: z.number().int().min(1).max(120),
  capacity: z.object({ kind: capacityKindSchema, amount: positiveInt }).strict(),
  effect: projectEffectSchema,
}).strict();
export type ProjectTemplate = z.infer<typeof projectTemplateSchema>;

export const polityCapacitySchema = z.object({
  polityId: polityIdSchema,
  administration: positiveInt,
  science: positiveInt,
  industry: positiveInt,
}).strict();

export const activeProjectSchema = z.object({
  projectId: projectIdSchema,
  templateId: projectTemplateIdSchema,
  actorPolityId: polityIdSchema,
  targetPolityId: polityIdSchema.optional(),
  targetRegionId: regionIdSchema.optional(),
  targetFactId: intelligenceFactIdSchema.optional(),
  monthlyFunding: positiveInt,
  priority: z.number().int().min(1).max(5),
  status: z.enum(['active', 'completed', 'cancelled']),
  startedMonth: gameDateSchema,
  completedMonth: gameDateSchema.nullable(),
  progressCost: nonNegInt,
  progressMonths: nonNegInt,
  effectiveTotalCost: positiveInt,
}).strict();

export const familiaritySchema = z.object({
  polityId: polityIdSchema,
  templateId: projectTemplateIdSchema,
  familiarityBp: z.number().int().min(0).max(5000),
}).strict();

export const projectsStateSchema = z.object({
  capacities: z.array(polityCapacitySchema),
  templates: z.array(projectTemplateSchema),
  projects: z.array(activeProjectSchema),
  familiarity: z.array(familiaritySchema),
}).strict();
export type ProjectsState = z.infer<typeof projectsStateSchema>;

export const intelligenceFactSchema = z.object({
  factId: intelligenceFactIdSchema,
  subjectPolityId: polityIdSchema,
  domain: z.enum(['economy', 'diplomacy', 'dynasty', 'politics', 'war', 'other']),
  summary: z.object({ en: z.string().min(1).max(500), ru: z.string().min(1).max(500) }).strict(),
  evidenceId: evidenceIdSchema,
}).strict();
export type IntelligenceFact = z.infer<typeof intelligenceFactSchema>;

export const knownFactSchema = z.object({
  observerPolityId: polityIdSchema,
  factId: intelligenceFactIdSchema,
  confidence: z.enum(['low', 'medium', 'high']),
  observedMonth: gameDateSchema,
  source: z.enum(['scenario', 'intelligence', 'deception']),
  evidenceId: evidenceIdSchema,
  staleAfterMonths: z.number().int().min(1).max(240),
}).strict();
export type KnownFact = z.infer<typeof knownFactSchema>;

export const intelligenceStateSchema = z.object({
  truths: z.array(intelligenceFactSchema),
  knownFacts: z.array(knownFactSchema),
}).strict();
export type IntelligenceState = z.infer<typeof intelligenceStateSchema>;

export const authoredFinanceSchema = financePolityStateSchema.omit({ interestRemainder: true, defaultCount: true, lastDefaultMonth: true });
export const authoredKnowledgeSeedSchema = knownFactSchema.omit({ observedMonth: true, source: true }).extend({
  observedMonth: gameDateSchema.optional(),
}).strict();

export const authoredStatecraftSchema = z.object({
  finance: z.array(authoredFinanceSchema),
  capacities: z.array(polityCapacitySchema),
  projectTemplates: z.array(projectTemplateSchema),
  intelligenceFacts: z.array(intelligenceFactSchema),
  knowledgeSeeds: z.array(authoredKnowledgeSeedSchema),
}).strict();
export type AuthoredStatecraft = z.infer<typeof authoredStatecraftSchema>;

export const coreProjectTemplates: ProjectTemplate[] = projectTemplateSchema.array().parse([
  {
    templateId: 'project-template:infrastructure', displayName: { en: 'Regional infrastructure', ru: 'Региональная инфраструктура' },
    kind: 'construction', budgetCategory: 'industry', totalCost: 600, durationMonths: 3,
    capacity: { kind: 'industry', amount: 2 }, effect: { kind: 'infrastructure', gainBp: 500 },
  },
  {
    templateId: 'project-template:tax-administration', displayName: { en: 'Tax administration reform', ru: 'Реформа налогового управления' },
    kind: 'reform', budgetCategory: 'administration', totalCost: 500, durationMonths: 3,
    capacity: { kind: 'administration', amount: 2 }, effect: { kind: 'credit-limit', amount: 1000 },
  },
  {
    templateId: 'project-template:intelligence-assessment', displayName: { en: 'Intelligence assessment', ru: 'Разведывательная оценка' },
    kind: 'intelligence', budgetCategory: 'security', totalCost: 300, durationMonths: 2,
    capacity: { kind: 'administration', amount: 1 }, effect: { kind: 'reveal-intelligence' },
  },
]);

export const monthsBetween = (from: string, to: string): number => {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  return (toYear! - fromYear!) * 12 + toMonth! - fromMonth!;
};
